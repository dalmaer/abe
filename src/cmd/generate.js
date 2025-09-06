import { loadConfig } from '../utils/config.js';
import { parseSpec } from '../utils/spec-parser.js';
import { generateTask } from '../tasks/generate.js';
import { RunStore } from '../utils/run-store.js';
import { loadPromptOverrides } from '../utils/templates.js';

export const generateCmd = {
  command: 'generate',
  describe: 'Generate UI mockup images from design spec',
  builder: {
    spec: {
      describe: 'Path to design spec (Markdown)',
      demandOption: true,
      type: 'string'
    },
    models: {
      describe: 'Models to use (comma-separated or alias)',
      type: 'string',
      default: 'baseline'
    },
    variants: {
      describe: 'Number of variants per screen',
      type: 'number'
    },
    screens: {
      describe: 'Screens to generate (comma-separated)',
      type: 'string'
    },
    out: {
      describe: 'Output directory',
      type: 'string'
    },
    seed: {
      describe: 'Random seed for reproducibility',
      type: 'number'
    },
    concurrency: {
      describe: 'Max parallel requests',
      type: 'number'
    },
    'dry-run': {
      describe: 'Show plan without generating',
      type: 'boolean',
      default: false
    },
    'gen-prompt': {
      describe: 'Override generation prompt (inline)',
      type: 'string'
    },
    'gen-prompt-file': {
      describe: 'Override generation prompt (from file)',
      type: 'string'
    },
    style: {
      describe: 'UI style to apply (e.g., neumorphism, glassmorphism)',
      type: 'string'
    },
    retries: {
      describe: 'Number of retry attempts for failed generations',
      type: 'number',
      default: 3
    }
  },
  handler: async (argv) => {
    try {
      const config = await loadConfig();
      const spec = await parseSpec(argv.spec);
      
      const runStore = new RunStore(argv.out || config.outDir);
      await runStore.initialize();
      await runStore.saveSpec(spec, argv.style);

      const screens = argv.screens ? argv.screens.split(',').map(s => s.trim()) : undefined;
      const promptOverrides = loadPromptOverrides(argv, 'gen');

      const options = {
        models: argv.models,
        variants: argv.variants || config.defaultVariants,
        screens,
        concurrency: argv.concurrency || config.defaultConcurrency,
        seed: argv.seed,
        config,
        runStore,
        promptOverrides,
        dryRun: argv['dry-run'],
        style: argv.style,
        maxRetries: argv.retries
      };

      if (argv['dry-run']) {
        console.log('🎯 Generate Command - Dry Run Mode\n');
      }

      const result = await generateTask(spec, options);

      if (!argv['dry-run']) {
        console.log('\n✅ Generation completed successfully!');
        console.log(`📁 Results saved to: ${runStore.runDir}`);
        console.log(`🖼️  Images generated: ${result.results.filter(r => r.success).length}`);
      }

    } catch (error) {
      console.error('❌ Generation failed:', error.message);
      process.exit(1);
    }
  }
};