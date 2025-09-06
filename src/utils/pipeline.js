import fs from 'fs-extra';
import { loadConfig } from './config.js';
import { parseSpec } from './spec-parser.js';
import { generateTask } from '../tasks/generate.js';
import { critiqueTask } from '../tasks/critique.js';
import { iterateTask } from '../tasks/iterate.js';
import { RunStore } from './run-store.js';

export class PipelineExecutor {
  constructor(pipelineConfig, options = {}) {
    this.pipeline = pipelineConfig;
    this.globalOptions = options;
    this.stepResults = new Map();
    this.runStore = null;
  }

  async execute() {
    const config = await loadConfig();
    
    this.runStore = new RunStore(this.globalOptions.out || config.outDir);
    await this.runStore.initialize();

    await this.runStore.log('info', 'pipeline-start', `Starting pipeline: ${this.pipeline.name}`, {
      steps: this.pipeline.steps.length
    });

    try {
      for (const step of this.pipeline.steps) {
        await this.executeStep(step, config);
      }

      await this.runStore.log('info', 'pipeline-complete', 'Pipeline completed successfully', {
        totalSteps: this.pipeline.steps.length
      });

      return {
        success: true,
        runDir: this.runStore.runDir,
        results: Object.fromEntries(this.stepResults)
      };

    } catch (error) {
      await this.runStore.log('error', 'pipeline-error', 'Pipeline execution failed', {
        error: error.message
      });
      throw error;
    }
  }

  async executeStep(step, config) {
    await this.runStore.log('info', 'step-start', `Starting step: ${step.id}`, {
      stepType: step.run
    });

    const stepOptions = this.buildStepOptions(step, config);

    let result;
    switch (step.run) {
      case 'generate':
        result = await this.executeGenerateStep(step, stepOptions);
        break;
      case 'critique':
        result = await this.executeCritiqueStep(step, stepOptions);
        break;
      case 'iterate':
        result = await this.executeIterateStep(step, stepOptions);
        break;
      default:
        throw new Error(`Unknown step type: ${step.run}`);
    }

    this.stepResults.set(step.id, result);

    await this.runStore.log('info', 'step-complete', `Step completed: ${step.id}`, {
      stepType: step.run
    });

    return result;
  }

  async executeGenerateStep(step, options) {
    const spec = await this.loadStepSpec(step);
    
    const generateOptions = {
      models: step.models || options.models,
      variants: step.variants || options.variants,
      screens: step.screens ? step.screens : undefined,
      concurrency: step.concurrency || options.concurrency,
      seed: step.seed || options.seed,
      config: options.config,
      runStore: this.runStore,
      promptOverrides: this.getPromptOverrides(step, 'gen'),
      dryRun: this.globalOptions.dryRun || false
    };

    return await generateTask(spec, generateOptions);
  }

  async executeCritiqueStep(step, options) {
    const spec = await this.loadStepSpec(step);
    const images = await this.resolveStepImages(step);

    const critiqueOptions = {
      model: step.model || options.model,
      config: options.config,
      runStore: this.runStore,
      concurrency: step.concurrency || options.concurrency,
      promptOverrides: this.getPromptOverrides(step, 'critique'),
      dryRun: this.globalOptions.dryRun || false
    };

    return await critiqueTask(images, spec, critiqueOptions);
  }

  async executeIterateStep(step, options) {
    const spec = await this.loadStepSpec(step);
    const originManifest = await this.resolveStepOrigin(step);

    const select = {};
    if (step.select) {
      Object.assign(select, step.select);
    } else {
      select.topK = 3;
      select.minScore = 70;
    }

    const iterateOptions = {
      passes: step.passes || 1,
      select,
      models: step.models ? step.models.split(',').map(m => m.trim()) : undefined,
      config: options.config,
      runStore: this.runStore,
      concurrency: step.concurrency || options.concurrency,
      promptOverrides: this.getPromptOverrides(step, 'revise'),
      dryRun: this.globalOptions.dryRun || false
    };

    return await iterateTask(originManifest, spec, iterateOptions);
  }

  buildStepOptions(step, config) {
    return {
      ...this.globalOptions,
      config,
      ...step
    };
  }

  getPromptOverrides(step, promptType) {
    const overrides = {};
    
    if (step[`${promptType}Prompt`]) {
      overrides[promptType] = step[`${promptType}Prompt`];
    } else if (step[`${promptType}PromptFile`]) {
      try {
        overrides[promptType] = fs.readFileSync(step[`${promptType}PromptFile`], 'utf8');
      } catch (error) {
        console.warn(`Warning: Could not load prompt file ${step[`${promptType}PromptFile`]}:`, error.message);
      }
    }

    return overrides;
  }

  async loadStepSpec(step) {
    if (step.spec) {
      return await parseSpec(step.spec);
    }

    if (this.globalOptions.spec) {
      return await parseSpec(this.globalOptions.spec);
    }

    const specPath = `${this.runStore.runDir}/input/spec.md`;
    if (await fs.pathExists(specPath)) {
      return await parseSpec(specPath);
    }

    throw new Error(`No spec found for step ${step.id}. Provide step.spec or global --spec.`);
  }

  async resolveStepImages(step) {
    if (step.from) {
      const fromResult = this.stepResults.get(step.from);
      if (fromResult && fromResult.results) {
        return fromResult.results
          .filter(r => r.success && r.imagePath)
          .map(r => r.imagePath);
      }
    }

    if (step.images) {
      if (typeof step.images === 'string') {
        const globby = await import('globby');
        return await globby.globby(step.images);
      } else if (Array.isArray(step.images)) {
        return step.images;
      }
    }

    throw new Error(`No images found for critique step ${step.id}. Use 'from' or 'images'.`);
  }

  async resolveStepOrigin(step) {
    if (step.from) {
      const fromResult = this.stepResults.get(step.from);
      if (fromResult) {
        if (fromResult.critiques) {
          return { items: fromResult.critiques };
        }
        if (fromResult.results) {
          const manifest = {
            items: fromResult.results.filter(r => r.success && r.manifestItem).map(r => r.manifestItem)
          };
          return manifest;
        }
      }
    }

    if (step.origin) {
      return await this.loadManifestFromPath(step.origin);
    }

    throw new Error(`No origin found for iterate step ${step.id}. Use 'from' or 'origin'.`);
  }

  async loadManifestFromPath(manifestPath) {
    if (await fs.pathExists(manifestPath)) {
      const stat = await fs.stat(manifestPath);
      
      if (stat.isFile() && manifestPath.endsWith('.json')) {
        return await fs.readJson(manifestPath);
      } else if (stat.isDirectory()) {
        const fullPath = `${manifestPath}/generate/manifest.json`;
        if (await fs.pathExists(fullPath)) {
          return await fs.readJson(fullPath);
        }
      }
    }

    throw new Error(`Cannot load manifest from: ${manifestPath}`);
  }
}

export async function loadPipeline(pipelinePath) {
  if (!await fs.pathExists(pipelinePath)) {
    throw new Error(`Pipeline file not found: ${pipelinePath}`);
  }

  const pipeline = await fs.readJson(pipelinePath);
  
  validatePipeline(pipeline);
  
  return pipeline;
}

function validatePipeline(pipeline) {
  if (!pipeline.name) {
    throw new Error('Pipeline must have a name');
  }

  if (!pipeline.steps || !Array.isArray(pipeline.steps)) {
    throw new Error('Pipeline must have a steps array');
  }

  if (pipeline.steps.length === 0) {
    throw new Error('Pipeline must have at least one step');
  }

  const stepIds = new Set();
  for (const step of pipeline.steps) {
    if (!step.id) {
      throw new Error('Each step must have an id');
    }

    if (stepIds.has(step.id)) {
      throw new Error(`Duplicate step id: ${step.id}`);
    }
    stepIds.add(step.id);

    if (!step.run) {
      throw new Error(`Step ${step.id} must have a 'run' property`);
    }

    if (!['generate', 'critique', 'iterate'].includes(step.run)) {
      throw new Error(`Step ${step.id} has invalid run type: ${step.run}`);
    }

    if (step.from && !stepIds.has(step.from)) {
      console.warn(`Warning: Step ${step.id} references unknown step: ${step.from}`);
    }
  }
}