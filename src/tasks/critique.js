import fs from 'fs-extra';
import path from 'path';
import pLimit from 'p-limit';
import { callVisionCritic, isVisionModel } from '../utils/providers.js';
import { buildTemplateContext, renderTemplate, getPromptTemplate } from '../utils/templates.js';

export async function critiqueTask(images, spec, options = {}) {
  const {
    model,
    config,
    runStore,
    concurrency = 3,
    promptOverrides = {},
    dryRun = false
  } = options;

  await runStore.log('info', 'critique-start', 'Starting image critique', {
    model,
    imageCount: images.length
  });

  const critiqueModel = model || config?.critique?.model || 'openai:gpt-4o';
  
  if (!isVisionModel(critiqueModel)) {
    throw new Error(`Model ${critiqueModel} does not support vision capabilities`);
  }

  if (dryRun) {
    return simulateCritique(images, spec, critiqueModel);
  }

  const limit = pLimit(concurrency);
  const rubric = config?.critique?.rubric || [];
  
  const tasks = images.map(imagePath => 
    limit(() => critiqueSingleImage({
      imagePath,
      spec,
      model: critiqueModel,
      rubric,
      config,
      runStore,
      promptOverrides
    }))
  );

  try {
    const results = await Promise.allSettled(tasks);
    const critiques = [];
    
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        critiques.push(result.value);
      } else if (result.status === 'rejected') {
        await runStore.log('error', 'critique-failed', 'Image critique failed', {
          error: result.reason.message
        });
      }
    }

    const summary = generateCritiqueSummary(critiques);
    await runStore.updateCritiqueSummary(summary);

    await runStore.log('info', 'critique-complete', 'Critique task completed', {
      totalCritiques: critiques.length,
      averageScore: summary.averageScore
    });

    return {
      critiques,
      summary,
      leaderboard: summary.leaderboard
    };
  } catch (error) {
    await runStore.log('error', 'critique-error', 'Critique task failed', {
      error: error.message
    });
    throw error;
  }
}

async function critiqueSingleImage({
  imagePath,
  spec,
  model,
  rubric,
  config,
  runStore,
  promptOverrides
}) {
  try {
    await runStore.log('info', 'critique-image-start', `Critiquing image`, {
      imagePath: path.basename(imagePath),
      model
    });

    const context = await buildTemplateContext(spec, {
      config,
      rubric
    });

    const template = getPromptTemplate('critique', config, promptOverrides);
    const prompt = renderTemplate(template, context);

    const result = await callVisionCritic({
      providerModel: model,
      prompt,
      imagePath,
      config
    });

    const critique = parseCritiqueResponse(result.text, rubric);
    critique.image = imagePath;
    critique.model = model;
    critique.timestamp = new Date().toISOString();

    const imageId = extractImageId(imagePath);
    await runStore.saveCritique(imageId, critique);

    await runStore.log('info', 'critique-image-complete', `Image critique completed`, {
      imagePath: path.basename(imagePath),
      score: critique.weightedTotal
    });

    return critique;

  } catch (error) {
    await runStore.log('error', 'critique-image-error', `Failed to critique image`, {
      imagePath: path.basename(imagePath),
      error: error.message
    });

    return {
      image: imagePath,
      error: error.message,
      success: false
    };
  }
}

function parseCritiqueResponse(responseText, rubric) {
  try {
    let jsonStr = responseText.trim();
    
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }

    const parsed = JSON.parse(jsonStr);

    if (!parsed.scores) {
      throw new Error('No scores found in critique response');
    }

    const weightedTotal = calculateWeightedTotal(parsed.scores, rubric);

    return {
      scores: parsed.scores,
      weightedTotal,
      strengths: parsed.strengths || [],
      issues: parsed.issues || [],
      revisePrompt: parsed.revisePrompt || '',
      success: true
    };

  } catch (parseError) {
    console.warn('Failed to parse critique JSON, attempting recovery:', parseError.message);
    
    const recoveredCritique = attemptCritiqueRecovery(responseText, rubric);
    if (recoveredCritique) {
      return recoveredCritique;
    }

    throw new Error(`Failed to parse critique response: ${parseError.message}`);
  }
}

function attemptCritiqueRecovery(responseText, rubric) {
  try {
    const scores = {};
    const strengths = [];
    const issues = [];
    let revisePrompt = '';

    for (const criterion of rubric) {
      const scoreMatch = responseText.match(new RegExp(`"?${criterion.id}"?\\s*:?\\s*(\\d+)`, 'i'));
      if (scoreMatch) {
        scores[criterion.id] = parseInt(scoreMatch[1]);
      }
    }

    const strengthsMatch = responseText.match(/"strengths"?\s*:?\s*\[(.*?)\]/s);
    if (strengthsMatch) {
      const strengthItems = strengthsMatch[1].split(',').map(s => s.trim().replace(/['"]/g, ''));
      strengths.push(...strengthItems.filter(s => s.length > 0));
    }

    const issuesMatch = responseText.match(/"issues"?\s*:?\s*\[(.*?)\]/s);
    if (issuesMatch) {
      const issueItems = issuesMatch[1].split(',').map(s => s.trim().replace(/['"]/g, ''));
      issues.push(...issueItems.filter(s => s.length > 0));
    }

    const reviseMatch = responseText.match(/"revisePrompt"?\s*:?\s*"([^"]+)"/);
    if (reviseMatch) {
      revisePrompt = reviseMatch[1];
    }

    if (Object.keys(scores).length > 0) {
      const weightedTotal = calculateWeightedTotal(scores, rubric);
      return {
        scores,
        weightedTotal,
        strengths,
        issues,
        revisePrompt,
        success: true,
        recovered: true
      };
    }
  } catch (error) {
    console.warn('Critique recovery failed:', error.message);
  }

  return null;
}

function calculateWeightedTotal(scores, rubric) {
  let total = 0;
  let totalWeight = 0;

  for (const criterion of rubric) {
    const score = scores[criterion.id];
    if (typeof score === 'number' && !isNaN(score)) {
      total += score * criterion.weight;
      totalWeight += criterion.weight;
    }
  }

  return totalWeight > 0 ? Math.round(total / totalWeight * 100) / 100 : 0;
}

function extractImageId(imagePath) {
  const basename = path.basename(imagePath, path.extname(imagePath));
  return basename.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
}

function generateCritiqueSummary(critiques) {
  const successful = critiques.filter(c => c.success);
  
  if (successful.length === 0) {
    return {
      leaderboard: [],
      averageScore: 0,
      insights: ['No successful critiques to analyze']
    };
  }

  const leaderboard = successful
    .sort((a, b) => (b.weightedTotal || 0) - (a.weightedTotal || 0))
    .map((critique, rank) => ({
      rank: rank + 1,
      image: critique.image,
      model: critique.model,
      screen: extractScreenFromPath(critique.image),
      weightedTotal: critique.weightedTotal,
      scores: critique.scores,
      strengths: critique.strengths,
      issues: critique.issues,
      revisePrompt: critique.revisePrompt
    }));

  const averageScore = successful.reduce((sum, c) => sum + (c.weightedTotal || 0), 0) / successful.length;
  
  const insights = generateInsights(successful);

  return {
    leaderboard,
    averageScore: Math.round(averageScore * 100) / 100,
    totalCritiques: critiques.length,
    successfulCritiques: successful.length,
    insights,
    timestamp: new Date().toISOString()
  };
}

function extractScreenFromPath(imagePath) {
  const basename = path.basename(imagePath);
  const match = basename.match(/screen-([^_]+)/);
  return match ? match[1].replace(/-/g, ' ') : 'Unknown';
}

function generateInsights(critiques) {
  const insights = [];
  
  if (critiques.length === 0) return insights;

  const topCritique = critiques.reduce((best, current) => 
    (current.weightedTotal || 0) > (best.weightedTotal || 0) ? current : best
  );

  insights.push(`Highest scoring design: ${Math.round(topCritique.weightedTotal || 0)} points`);

  const commonIssues = {};
  critiques.forEach(critique => {
    critique.issues?.forEach(issue => {
      const key = issue.toLowerCase().trim();
      commonIssues[key] = (commonIssues[key] || 0) + 1;
    });
  });

  const mostCommonIssue = Object.entries(commonIssues)
    .sort(([,a], [,b]) => b - a)[0];

  if (mostCommonIssue) {
    insights.push(`Most common issue: ${mostCommonIssue[0]} (${mostCommonIssue[1]} occurrences)`);
  }

  const averageScores = {};
  const scoreCounts = {};
  
  critiques.forEach(critique => {
    Object.entries(critique.scores || {}).forEach(([criterion, score]) => {
      if (typeof score === 'number') {
        averageScores[criterion] = (averageScores[criterion] || 0) + score;
        scoreCounts[criterion] = (scoreCounts[criterion] || 0) + 1;
      }
    });
  });

  const weakestArea = Object.entries(averageScores)
    .map(([criterion, total]) => [criterion, total / scoreCounts[criterion]])
    .sort(([,a], [,b]) => a - b)[0];

  if (weakestArea) {
    insights.push(`Weakest area: ${weakestArea[0]} (avg: ${Math.round(weakestArea[1])})`);
  }

  return insights;
}

function simulateCritique(images, spec, model) {
  console.log('\n🔍 Critique Plan:');
  console.log(`   Model: ${model}`);
  console.log(`   Images to critique: ${images.length}`);
  console.log(`   Spec: ${spec.title}\n`);

  images.forEach((imagePath, index) => {
    console.log(`   ${index + 1}. ${path.basename(imagePath)} → critique analysis`);
  });

  return { plan: images, dryRun: true };
}