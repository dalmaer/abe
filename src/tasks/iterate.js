import fs from 'fs-extra';
import path from 'path';
import pLimit from 'p-limit';
import { callImageModel, isImageGenerationModel } from '../utils/providers.js';
import { buildTemplateContext, renderTemplate, getPromptTemplate } from '../utils/templates.js';
import { critiqueTask } from './critique.js';

export async function iterateTask(originManifest, spec, options = {}) {
  const {
    passes = 1,
    select = { topK: 3, minScore: 70 },
    models,
    config,
    runStore,
    concurrency = 3,
    promptOverrides = {},
    dryRun = false
  } = options;

  await runStore.log('info', 'iterate-start', 'Starting iteration task', {
    passes,
    select
  });

  if (dryRun) {
    return simulateIteration(originManifest, select, passes);
  }

  let currentImages = await selectImagesForIteration(originManifest, select, runStore);
  const allResults = [];

  for (let pass = 1; pass <= passes; pass++) {
    await runStore.log('info', 'iterate-pass-start', `Starting iteration pass ${pass}`, {
      pass,
      imageCount: currentImages.length
    });

    const passResults = await executeIterationPass(currentImages, spec, {
      pass,
      models,
      config,
      runStore,
      concurrency,
      promptOverrides
    });

    if (passResults.length === 0) {
      await runStore.log('warn', 'iterate-pass-empty', `No successful revisions in pass ${pass}`);
      break;
    }

    allResults.push(...passResults);

    const revisedImages = passResults
      .filter(r => r.success && r.imagePath)
      .map(r => r.imagePath);

    if (pass < passes && revisedImages.length > 0) {
      await runStore.log('info', 'iterate-critique-start', `Critiquing pass ${pass} results`);
      
      const critiqueResults = await critiqueTask(revisedImages, spec, {
        config,
        runStore,
        concurrency,
        promptOverrides
      });

      currentImages = await selectImagesForIteration(
        { items: critiqueResults.critiques }, 
        select, 
        runStore
      );

      if (currentImages.length === 0) {
        await runStore.log('warn', 'iterate-no-candidates', `No images meet criteria for pass ${pass + 1}`);
        break;
      }
    }
  }

  await runStore.log('info', 'iterate-complete', 'Iteration task completed', {
    totalPasses: passes,
    totalRevisions: allResults.length,
    successfulRevisions: allResults.filter(r => r.success).length
  });

  return {
    results: allResults,
    passes,
    finalImages: allResults
      .filter(r => r.success && r.imagePath)
      .map(r => r.imagePath)
  };
}

async function selectImagesForIteration(manifest, select, runStore) {
  const images = manifest.items || [];
  
  if (images.length === 0) {
    await runStore.log('warn', 'iterate-no-images', 'No images available for iteration');
    return [];
  }

  let selectedImages = [...images];

  if (select.minScore !== undefined) {
    selectedImages = selectedImages.filter(img => 
      (img.weightedTotal || 0) >= select.minScore
    );
    await runStore.log('info', 'iterate-filter-score', `Filtered by min score ${select.minScore}`, {
      before: images.length,
      after: selectedImages.length
    });
  }

  if (select.topK !== undefined && selectedImages.length > select.topK) {
    selectedImages = selectedImages
      .sort((a, b) => (b.weightedTotal || 0) - (a.weightedTotal || 0))
      .slice(0, select.topK);
    await runStore.log('info', 'iterate-filter-topk', `Filtered to top ${select.topK}`, {
      selected: selectedImages.length
    });
  }

  return selectedImages;
}

async function executeIterationPass(images, spec, options) {
  const {
    pass,
    models,
    config,
    runStore,
    concurrency,
    promptOverrides
  } = options;

  const limit = pLimit(concurrency);
  const tasks = [];

  for (const imageData of images) {
    const revisePrompt = imageData.revisePrompt || 'Improve the overall design quality and usability.';
    const imagePath = imageData.image || imageData.path;
    
    if (!imagePath || !await fs.pathExists(imagePath)) {
      await runStore.log('warn', 'iterate-missing-image', 'Image file not found', {
        path: imagePath
      });
      continue;
    }

    const imageModels = models || extractModelFromImage(imageData);
    
    for (const model of [].concat(imageModels)) {
      if (!isImageGenerationModel(model)) {
        continue;
      }

      tasks.push(
        limit(() => reviseImage({
          originalImagePath: imagePath,
          revisePrompt,
          model,
          spec,
          pass,
          config,
          runStore,
          promptOverrides,
          originalData: imageData
        }))
      );
    }
  }

  if (tasks.length === 0) {
    await runStore.log('warn', 'iterate-no-tasks', 'No revision tasks created for this pass');
    return [];
  }

  const results = await Promise.allSettled(tasks);
  const successfulResults = [];

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      successfulResults.push(result.value);
    } else if (result.status === 'rejected') {
      await runStore.log('error', 'iterate-task-failed', 'Revision task failed', {
        error: result.reason.message
      });
    }
  }

  return successfulResults;
}

async function reviseImage({
  originalImagePath,
  revisePrompt,
  model,
  spec,
  pass,
  config,
  runStore,
  promptOverrides,
  originalData
}) {
  try {
    await runStore.log('info', 'iterate-revise-start', `Revising image`, {
      originalImage: path.basename(originalImagePath),
      model,
      pass
    });

    const screen = extractScreenFromData(originalData);
    const context = await buildTemplateContext(spec, {
      screen,
      revisePrompt,
      config
    });

    const template = getPromptTemplate('revise', config, promptOverrides);
    const prompt = renderTemplate(template, context);

    const imageBuffer = await fs.readFile(originalImagePath);

    const result = await callImageModel({
      providerModel: model,
      prompt,
      imageInput: imageBuffer,
      config
    });

    const [provider, modelName] = model.split(':');
    const metadata = {
      provider,
      model: modelName,
      screen,
      pass,
      originalImage: originalImagePath,
      revisePrompt
    };

    const revisedImagePath = await saveRevisedImage(result.image, metadata, runStore);

    await runStore.log('info', 'iterate-revise-complete', `Image revision completed`, {
      originalImage: path.basename(originalImagePath),
      revisedImage: path.basename(revisedImagePath)
    });

    return {
      success: true,
      imagePath: revisedImagePath,
      originalImagePath,
      metadata,
      pass,
      revisePrompt
    };

  } catch (error) {
    await runStore.log('error', 'iterate-revise-error', `Failed to revise image`, {
      originalImage: path.basename(originalImagePath),
      model,
      error: error.message
    });

    return {
      success: false,
      originalImagePath,
      model,
      pass,
      error: error.message
    };
  }
}

async function saveRevisedImage(imageData, metadata, runStore) {
  const { provider, screen, pass } = metadata;
  const iterateDir = path.join(runStore.runDir, 'iterate', provider);
  await fs.ensureDir(iterateDir);

  const screenSlug = screen.toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const filename = `screen-${screenSlug}_rev${pass}.png`;
  const imagePath = path.join(iterateDir, filename);

  if (Buffer.isBuffer(imageData)) {
    await fs.writeFile(imagePath, imageData);
  } else if (typeof imageData === 'string') {
    const buffer = Buffer.from(imageData, 'base64');
    await fs.writeFile(imagePath, buffer);
  } else {
    throw new Error('Unsupported image data format');
  }

  return imagePath;
}

function extractModelFromImage(imageData) {
  if (imageData.model) {
    return imageData.model.includes(':') ? imageData.model : `provider:${imageData.model}`;
  }
  
  if (imageData.path) {
    const pathParts = imageData.path.split(path.sep);
    for (let i = 0; i < pathParts.length; i++) {
      if (pathParts[i] === 'generate' && i + 1 < pathParts.length) {
        return `${pathParts[i + 1]}:model`;
      }
    }
  }

  return 'openai:gpt-4o';
}

function extractScreenFromData(imageData) {
  if (imageData.screen) {
    return imageData.screen;
  }

  if (imageData.path || imageData.image) {
    const imagePath = imageData.path || imageData.image;
    const basename = path.basename(imagePath);
    const match = basename.match(/screen-([^_]+)/);
    if (match) {
      return match[1].replace(/-/g, ' ');
    }
  }

  return 'Main Screen';
}

function simulateIteration(manifest, select, passes) {
  const images = manifest.items || [];
  
  console.log('\n🔄 Iteration Plan:');
  console.log(`   Available images: ${images.length}`);
  console.log(`   Selection criteria: ${JSON.stringify(select)}`);
  console.log(`   Iteration passes: ${passes}\n`);

  let selectedCount = images.length;
  
  if (select.minScore !== undefined) {
    const qualifying = images.filter(img => (img.weightedTotal || 0) >= select.minScore);
    selectedCount = qualifying.length;
    console.log(`   After min score filter (≥${select.minScore}): ${selectedCount} images`);
  }

  if (select.topK !== undefined && selectedCount > select.topK) {
    selectedCount = select.topK;
    console.log(`   After top-K filter: ${selectedCount} images`);
  }

  for (let pass = 1; pass <= passes; pass++) {
    console.log(`\n   Pass ${pass}:`);
    console.log(`     - Revise ${selectedCount} images`);
    console.log(`     - Critique revised images`);
    if (pass < passes) {
      console.log(`     - Select best candidates for pass ${pass + 1}`);
    }
  }

  return { 
    plan: {
      totalImages: images.length,
      selectedImages: selectedCount,
      passes
    }, 
    dryRun: true 
  };
}