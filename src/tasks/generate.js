import pLimit from 'p-limit';
import { callImageModel, isImageGenerationModel } from '../utils/providers.js';
import { buildTemplateContext, renderTemplate, getPromptTemplate } from '../utils/templates.js';
import { resolveModels } from '../utils/config.js';

export async function generateTask(spec, options = {}) {
  const {
    models,
    variants = 3,
    screens,
    concurrency = 3,
    seed,
    config,
    runStore,
    promptOverrides = {},
    dryRun = false,
    style,
    maxRetries = 3
  } = options;

  await runStore.log('info', 'generate-start', 'Starting image generation', {
    models,
    variants,
    screens: screens || spec.screens
  });

  const resolvedModels = resolveModels(models, config);
  const targetScreens = screens || spec.screens;
  const limit = pLimit(concurrency);

  if (dryRun) {
    return simulateGeneration(spec, resolvedModels, targetScreens, variants, style, config, promptOverrides);
  }

  const tasks = [];
  const results = [];

  for (const model of resolvedModels) {
    if (!isImageGenerationModel(model)) {
      await runStore.log('warn', 'generate-skip', `Skipping non-image model: ${model}`);
      continue;
    }

    for (const screen of targetScreens) {
      for (let variant = 1; variant <= variants; variant++) {
        tasks.push(
          limit(() => generateSingleImage({
            spec,
            model,
            screen,
            variant,
            seed: seed ? seed + variant : undefined,
            config,
            runStore,
            promptOverrides,
            style,
            maxRetries
          }))
        );
      }
    }
  }

  try {
    const taskResults = await Promise.allSettled(tasks);
    
    for (const result of taskResults) {
      if (result.status === 'fulfilled' && result.value) {
        results.push(result.value);
      } else if (result.status === 'rejected') {
        await runStore.log('error', 'generate-failed', 'Image generation failed', {
          error: result.reason.message
        });
      }
    }

    await updateGenerateManifest(runStore, spec, resolvedModels, targetScreens, results);

    await runStore.log('info', 'generate-complete', 'Image generation completed', {
      totalResults: results.length,
      successCount: results.filter(r => r.success).length
    });

    return {
      results,
      manifest: await runStore.getPath('generate/manifest.json')
    };
  } catch (error) {
    await runStore.log('error', 'generate-error', 'Generation task failed', {
      error: error.message
    });
    throw error;
  }
}

async function generateSingleImage({
  spec,
  model,
  screen,
  variant,
  seed,
  config,
  runStore,
  promptOverrides,
  style,
  maxRetries
}) {
  try {
    await runStore.log('info', 'generate-image-start', `Generating image for ${screen} (variant ${variant})`, {
      model,
      screen,
      variant
    });

    const context = await buildTemplateContext(spec, {
      screen,
      variant,
      config,
      style
    });

    const template = getPromptTemplate('generate', config, promptOverrides);
    const prompt = renderTemplate(template, context);
    const promptHash = runStore.hashPrompt(prompt);

    const [provider, modelName] = model.split(':');
    
    const result = await callImageModel({
      providerModel: model,
      prompt,
      seed,
      config,
      maxRetries
    });

    const metadata = {
      provider,
      model: modelName,
      screen,
      variant,
      promptHash,
      seed,
      prompt
    };

    const imagePath = await runStore.saveImage(result.image, metadata);
    const manifestItem = await runStore.addImageToManifest(imagePath, metadata);

    console.log(`✅ Image saved to: ${imagePath}`);
    
    await runStore.log('info', 'generate-image-complete', `Image generated successfully`, {
      imagePath,
      imageId: manifestItem.id
    });

    return {
      success: true,
      imagePath,
      metadata,
      manifestItem
    };

  } catch (error) {
    await runStore.log('error', 'generate-image-error', `Failed to generate image`, {
      model,
      screen,
      variant,
      error: error.message
    });

    return {
      success: false,
      model,
      screen,
      variant,
      error: error.message
    };
  }
}

async function updateGenerateManifest(runStore, spec, models, screens, results) {
  const manifest = {
    spec: spec.path || 'inline',
    title: spec.title,
    screens,
    models,
    totalImages: results.length,
    successfulImages: results.filter(r => r.success).length,
    timestamp: new Date().toISOString(),
    items: results
      .filter(r => r.success && r.manifestItem)
      .map(r => r.manifestItem)
  };

  await runStore.updateManifest('generate', manifest);
  return manifest;
}

async function simulateGeneration(spec, models, screens, variants, style, config, promptOverrides) {
  const plan = [];
  
  for (const model of models) {
    if (!isImageGenerationModel(model)) {
      console.log(`⚠️  Skipping non-image model: ${model}`);
      continue;
    }

    for (const screen of screens) {
      for (let variant = 1; variant <= variants; variant++) {
        plan.push({
          model,
          screen,
          variant,
          filename: `screen-${screen.toLowerCase().replace(/\s+/g, '-')}_v${variant}.png`
        });
      }
    }
  }

  console.log('\n📋 Generation Plan:');
  console.log(`   Spec: ${spec.title}`);
  console.log(`   Models: ${models.join(', ')}`);
  console.log(`   Screens: ${screens.join(', ')}`);
  console.log(`   Variants per screen: ${variants}`);
  console.log(`   Total images to generate: ${plan.length}\n`);

  plan.forEach((item, index) => {
    console.log(`   ${index + 1}. ${item.model} → ${item.screen} (v${item.variant}) → ${item.filename}`);
  });

  // Show example prompt for the first screen/variant
  if (plan.length > 0) {
    const firstPlan = plan[0];
    console.log('\n📝 Example Prompt (first generation):');
    console.log('═'.repeat(80));
    
    try {
      const context = await buildTemplateContext(spec, {
        screen: firstPlan.screen,
        variant: firstPlan.variant,
        config,
        style
      });

      const template = getPromptTemplate('generate', config, promptOverrides);
      const prompt = renderTemplate(template, context);
      
      console.log(prompt);
    } catch (error) {
      console.log(`Error building example prompt: ${error.message}`);
    }
    
    console.log('═'.repeat(80));
  }

  return { plan, dryRun: true };
}