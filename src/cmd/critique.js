import fs from 'fs-extra';
import { loadConfig } from '../utils/config.js';
import { parseSpec } from '../utils/spec-parser.js';
import { critiqueTask } from '../tasks/critique.js';
import { RunStore } from '../utils/run-store.js';
import { loadPromptOverrides } from '../utils/templates.js';

export const critiqueCmd = {
  command: 'critique',
  describe: 'Critique generated images against design spec',
  builder: {
    image: {
      describe: 'Single image path to critique',
      type: 'string'
    },
    images: {
      describe: 'Directory or pattern of images to critique',
      type: 'string'
    },
    from: {
      describe: 'Source run directory or manifest file',
      type: 'string'
    },
    spec: {
      describe: 'Path to design spec (Markdown)',
      type: 'string'
    },
    model: {
      describe: 'Model to use for critique',
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
      describe: 'Show plan without critiquing',
      type: 'boolean',
      default: false
    },
    'critique-prompt': {
      describe: 'Override critique prompt (inline)',
      type: 'string'
    },
    'critique-prompt-file': {
      describe: 'Override critique prompt (from file)',
      type: 'string'
    }
  },
  handler: async (argv) => {
    try {
      const config = await loadConfig();
      
      let spec;
      if (argv.spec) {
        spec = await parseSpec(argv.spec);
      } else {
        spec = await findSpecFromRun(argv.from, argv.out);
      }

      if (!spec) {
        throw new Error('No design spec provided. Use --spec or ensure run directory contains spec.');
      }

      const runStore = new RunStore(argv.out || config.outDir);
      await runStore.initialize();

      const images = await resolveImagePaths(argv);
      
      if (images.length === 0) {
        throw new Error('No images found to critique. Use --image, --images, or --from.');
      }

      const promptOverrides = loadPromptOverrides(argv, 'critique');

      const options = {
        model: argv.model,
        config,
        runStore,
        concurrency: argv.concurrency || config.defaultConcurrency,
        promptOverrides,
        dryRun: argv['dry-run']
      };

      if (argv['dry-run']) {
        console.log('🔍 Critique Command - Dry Run Mode\n');
      }

      const result = await critiqueTask(images, spec, options);

      if (!argv['dry-run']) {
        console.log('\n✅ Critique completed successfully!');
        console.log(`📁 Results saved to: ${runStore.runDir}`);
        console.log(`🏆 Top score: ${result.summary.leaderboard[0]?.weightedTotal || 'N/A'}`);
        console.log(`📊 Average score: ${result.summary.averageScore}`);
        
        if (result.summary.leaderboard.length > 0) {
          console.log('\n🏅 Top 3 Results:');
          result.summary.leaderboard.slice(0, 3).forEach((item, i) => {
            console.log(`   ${i + 1}. ${item.image.split('/').pop()} - ${item.weightedTotal} pts`);
          });
        }
      }

    } catch (error) {
      console.error('❌ Critique failed:', error.message);
      process.exit(1);
    }
  }
};

async function resolveImagePaths(argv) {
  const images = [];

  if (argv.image) {
    if (await fs.pathExists(argv.image)) {
      images.push(argv.image);
    } else {
      throw new Error(`Image not found: ${argv.image}`);
    }
  }

  if (argv.images) {
    const globby = await import('globby');
    const foundImages = await globby.globby(argv.images);
    images.push(...foundImages);
  }

  if (argv.from) {
    const fromImages = await resolveImagesFromRun(argv.from);
    images.push(...fromImages);
  }

  return [...new Set(images)];
}

async function resolveImagesFromRun(fromPath) {
  const images = [];

  if (await fs.pathExists(fromPath)) {
    const stat = await fs.stat(fromPath);
    
    if (stat.isFile() && fromPath.endsWith('manifest.json')) {
      const manifest = await fs.readJson(fromPath);
      if (manifest.items) {
        for (const item of manifest.items) {
          if (item.path && await fs.pathExists(item.path)) {
            images.push(item.path);
          }
        }
      }
    } else if (stat.isDirectory()) {
      const manifestPath = `${fromPath}/generate/manifest.json`;
      if (await fs.pathExists(manifestPath)) {
        return resolveImagesFromRun(manifestPath);
      } else {
        const globby = await import('globby');
        const foundImages = await globby.globby(`${fromPath}/**/*.png`);
        images.push(...foundImages);
      }
    }
  }

  return images;
}

async function findSpecFromRun(fromPath, outPath) {
  if (!fromPath && !outPath) return null;

  const searchPaths = [];
  
  if (fromPath) {
    if (fromPath.endsWith('manifest.json')) {
      searchPaths.push(`${fromPath}/../input/spec.md`);
    } else {
      searchPaths.push(`${fromPath}/input/spec.md`);
    }
  }
  
  if (outPath) {
    searchPaths.push(`${outPath}/input/spec.md`);
  }

  for (const specPath of searchPaths) {
    if (await fs.pathExists(specPath)) {
      return parseSpec(specPath);
    }
  }

  return null;
}