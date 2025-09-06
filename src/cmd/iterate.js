import fs from 'fs-extra';
import { loadConfig } from '../utils/config.js';
import { parseSpec } from '../utils/spec-parser.js';
import { iterateTask } from '../tasks/iterate.js';
import { RunStore } from '../utils/run-store.js';
import { loadPromptOverrides } from '../utils/templates.js';

export const iterateCmd = {
  command: 'iterate',
  describe: 'Iterate on images using critique feedback',
  builder: {
    spec: {
      describe: 'Path to design spec (Markdown)',
      type: 'string'
    },
    origin: {
      describe: 'Origin manifest.json or run directory',
      demandOption: true,
      type: 'string'
    },
    passes: {
      describe: 'Number of iteration passes',
      type: 'number',
      default: 1
    },
    'top-k': {
      describe: 'Select top K images for iteration',
      type: 'number'
    },
    'min-score': {
      describe: 'Minimum score threshold for iteration',
      type: 'number'
    },
    models: {
      describe: 'Models to use for revision',
      type: 'string'
    },
    out: {
      describe: 'Output directory',
      type: 'string'
    },
    concurrency: {
      describe: 'Max parallel requests',
      type: 'number'
    },
    'dry-run': {
      describe: 'Show plan without iterating',
      type: 'boolean',
      default: false
    },
    'revise-prompt': {
      describe: 'Override revise prompt (inline)',
      type: 'string'
    },
    'revise-prompt-file': {
      describe: 'Override revise prompt (from file)',
      type: 'string'
    }
  },
  handler: async (argv) => {
    try {
      const config = await loadConfig();
      
      const originManifest = await loadOriginManifest(argv.origin);
      
      let spec;
      if (argv.spec) {
        spec = await parseSpec(argv.spec);
      } else {
        spec = await findSpecFromManifest(argv.origin);
      }

      if (!spec) {
        throw new Error('No design spec found. Use --spec or ensure origin run contains spec.');
      }

      const runStore = new RunStore(argv.out || config.outDir);
      await runStore.initialize();

      const select = {};
      if (argv['top-k'] !== undefined) select.topK = argv['top-k'];
      if (argv['min-score'] !== undefined) select.minScore = argv['min-score'];
      
      if (Object.keys(select).length === 0) {
        select.topK = 3;
        select.minScore = 70;
      }

      const promptOverrides = loadPromptOverrides(argv, 'revise');

      const options = {
        passes: argv.passes,
        select,
        models: argv.models ? argv.models.split(',').map(m => m.trim()) : undefined,
        config,
        runStore,
        concurrency: argv.concurrency || config.defaultConcurrency,
        promptOverrides,
        dryRun: argv['dry-run']
      };

      if (argv['dry-run']) {
        console.log('🔄 Iterate Command - Dry Run Mode\n');
      }

      const result = await iterateTask(originManifest, spec, options);

      if (!argv['dry-run']) {
        console.log('\n✅ Iteration completed successfully!');
        console.log(`📁 Results saved to: ${runStore.runDir}`);
        console.log(`🔄 Passes completed: ${result.passes}`);
        console.log(`🖼️  Final images: ${result.finalImages.length}`);
        console.log(`✨ Successful revisions: ${result.results.filter(r => r.success).length}`);
      }

    } catch (error) {
      console.error('❌ Iteration failed:', error.message);
      process.exit(1);
    }
  }
};

async function loadOriginManifest(originPath) {
  if (await fs.pathExists(originPath)) {
    const stat = await fs.stat(originPath);
    
    if (stat.isFile() && originPath.endsWith('.json')) {
      return await fs.readJson(originPath);
    } else if (stat.isDirectory()) {
      const manifestPath = `${originPath}/generate/manifest.json`;
      if (await fs.pathExists(manifestPath)) {
        return await fs.readJson(manifestPath);
      }
      
      const critiqueManifest = `${originPath}/critique/summary.md`;
      if (await fs.pathExists(critiqueManifest)) {
        return await loadCritiqueResults(originPath);
      }
    }
  }

  throw new Error(`Cannot find manifest at: ${originPath}`);
}

async function loadCritiqueResults(runDir) {
  const critiqueDir = `${runDir}/critique`;
  const files = await fs.readdir(critiqueDir);
  
  const items = [];
  for (const file of files) {
    if (file.endsWith('.json') && file !== 'summary.json') {
      const critiquePath = `${critiqueDir}/${file}`;
      const critique = await fs.readJson(critiquePath);
      items.push(critique);
    }
  }

  return { items };
}

async function findSpecFromManifest(originPath) {
  let runDir;
  
  if (originPath.endsWith('.json')) {
    runDir = originPath.split('/').slice(0, -2).join('/');
  } else {
    runDir = originPath;
  }

  const specPath = `${runDir}/input/spec.md`;
  
  if (await fs.pathExists(specPath)) {
    return parseSpec(specPath);
  }

  return null;
}