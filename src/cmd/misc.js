import fs from 'fs-extra';
import path from 'path';
import { loadConfig, saveConfig, defaultConfig } from '../utils/config.js';

export const modelsCmd = {
  command: 'models',
  describe: 'List configured models and aliases',
  handler: async () => {
    try {
      const config = await loadConfig();
      
      console.log('🤖 Configured Models\n');
      
      if (config.modelAliases && Object.keys(config.modelAliases).length > 0) {
        console.log('📋 Model Aliases:');
        for (const [alias, models] of Object.entries(config.modelAliases)) {
          console.log(`   ${alias}:`);
          models.forEach(model => {
            console.log(`     • ${model}`);
          });
          console.log('');
        }
      }

      if (config.providerOptions && Object.keys(config.providerOptions).length > 0) {
        console.log('🔧 Provider Configuration:');
        for (const [provider, options] of Object.entries(config.providerOptions)) {
          const apiKeyEnv = options.apiKeyEnv || `${provider.toUpperCase()}_API_KEY`;
          const hasKey = process.env[apiKeyEnv] ? '✅' : '❌';
          console.log(`   ${provider}: ${hasKey} (${apiKeyEnv})`);
        }
        console.log('');
      }

      console.log('💡 Usage examples:');
      console.log('   abe generate --models baseline --spec specs/my-app.md');
      console.log('   abe generate --models "openai:gpt-4o,anthropic:claude-3-5-sonnet-20241022" --spec specs/my-app.md');

    } catch (error) {
      console.error('❌ Failed to load models:', error.message);
      process.exit(1);
    }
  }
};

export const initCmd = {
  command: 'init',
  describe: 'Initialize abe project with config and examples',
  builder: {
    force: {
      describe: 'Overwrite existing files',
      type: 'boolean',
      default: false
    }
  },
  handler: async (argv) => {
    try {
      console.log('🚀 Initializing abe project...\n');

      await ensureDirectory('specs');
      await ensureDirectory('pipelines');
      await ensureDirectory('runs');

      await createConfigFile(argv.force);
      await createExampleSpec(argv.force);
      await createExamplePipeline(argv.force);
      await createGitignore(argv.force);

      console.log('✅ Initialization complete!\n');
      console.log('📁 Created directories:');
      console.log('   • specs/     - Design specifications');
      console.log('   • pipelines/ - Pipeline definitions');
      console.log('   • runs/      - Generated outputs\n');
      
      console.log('🎯 Next steps:');
      console.log('   1. Set up API keys in environment variables');
      console.log('   2. Edit specs/parking-app.md to match your project');
      console.log('   3. Run: abe generate --spec specs/parking-app.md');
      console.log('   4. Or run: abe run --pipeline pipelines/best-effort.json');

    } catch (error) {
      console.error('❌ Initialization failed:', error.message);
      process.exit(1);
    }
  }
};

async function ensureDirectory(dirName) {
  if (!await fs.pathExists(dirName)) {
    await fs.ensureDir(dirName);
    console.log(`📁 Created directory: ${dirName}/`);
  }
}

async function createConfigFile(force) {
  const configPath = 'abe.config.json';
  
  if (!force && await fs.pathExists(configPath)) {
    console.log(`⚠️  Config file already exists: ${configPath}`);
    return;
  }

  await saveConfig(defaultConfig, configPath);
  console.log(`⚙️  Created config file: ${configPath}`);
}

async function createExampleSpec(force) {
  const specPath = 'specs/parking-app.md';
  
  if (!force && await fs.pathExists(specPath)) {
    console.log(`⚠️  Example spec already exists: ${specPath}`);
    return;
  }

  const exampleSpec = `# Where Is My Car? (Parking Tracker)

## Description
Design a simple mobile UI with two screens:
1) **Save Spot** — large level buttons (e.g., P0, P1, P2, P3), plus text field to add a custom label (e.g., "Street + Cross").
2) **Find Car** — shows the last saved spot, big contrasty "Navigate" call to action, and a small history list.

## Type
Mobile application UI (iOS/Android agnostic, but feel native).

## Styles
- Warm palette with a red accent, subtle depth shadows, rounded cards, bold H1.
- Keep main actions one-tap reachable.

## Inspiration
- https://dribbble.com/shots/parking-app
- images/garage-level-signage.jpg
- images/minimal-cards.png

## Models
- baseline

## Critique Criteria
- Task success (clarity of "Save" + "Find")
- Visual hierarchy & tap targets
- Accessibility (contrast, touch area)
- Consistency across screens

## Notes
Prefer a simple layout that beginners can grok instantly.
`;

  await fs.writeFile(specPath, exampleSpec);
  console.log(`📝 Created example spec: ${specPath}`);
}

async function createExamplePipeline(force) {
  const pipelinePath = 'pipelines/best-effort.json';
  
  if (!force && await fs.pathExists(pipelinePath)) {
    console.log(`⚠️  Example pipeline already exists: ${pipelinePath}`);
    return;
  }

  const examplePipeline = {
    name: 'best-effort',
    steps: [
      {
        id: 'generate-pass-1',
        run: 'generate',
        spec: 'specs/parking-app.md',
        models: 'baseline',
        variants: 4,
        screens: ['Save Spot', 'Find Car']
      },
      {
        id: 'critique-pass-1',
        run: 'critique',
        from: 'generate-pass-1'
      },
      {
        id: 'revise-pass-2',
        run: 'iterate',
        from: 'critique-pass-1',
        select: { topK: 3, minScore: 70 },
        passes: 1
      },
      {
        id: 'critique-pass-2',
        run: 'critique',
        from: 'revise-pass-2'
      }
    ]
  };

  await fs.writeJson(pipelinePath, examplePipeline, { spaces: 2 });
  console.log(`🔧 Created example pipeline: ${pipelinePath}`);
}

async function createGitignore(force) {
  const gitignorePath = '.gitignore';
  
  if (!force && await fs.pathExists(gitignorePath)) {
    const existing = await fs.readFile(gitignorePath, 'utf8');
    if (existing.includes('runs/')) {
      return;
    }
  }

  const gitignoreContent = `# abe generated files
runs/
*.log

# API keys and secrets
.env
.env.local

# Node modules (if using npm locally)
node_modules/
`;

  if (!force && await fs.pathExists(gitignorePath)) {
    await fs.appendFile(gitignorePath, '\n' + gitignoreContent);
    console.log(`📝 Updated .gitignore`);
  } else {
    await fs.writeFile(gitignorePath, gitignoreContent);
    console.log(`📝 Created .gitignore`);
  }
}