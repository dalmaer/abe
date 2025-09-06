import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

export class RunStore {
  constructor(baseDir = './runs', runId = null) {
    this.baseDir = baseDir;
    this.runId = runId || this.generateRunId();
    this.runDir = path.join(baseDir, this.runId);
  }

  generateRunId() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    
    return `${year}-${month}-${day}@${hour}${minute}`;
  }

  async initialize() {
    await fs.ensureDir(this.runDir);
    
    const subdirs = ['input', 'generate', 'critique', 'iterate'];
    for (const subdir of subdirs) {
      await fs.ensureDir(path.join(this.runDir, subdir));
    }
    
    await this.log('info', 'run-initialized', 'Run directory created', {
      runId: this.runId,
      runDir: this.runDir
    });
  }

  async saveSpec(spec, style = null) {
    const inputDir = path.join(this.runDir, 'input');
    const specPath = path.join(inputDir, 'spec.md');
    
    if (spec.path && await fs.pathExists(spec.path)) {
      await fs.copy(spec.path, specPath);
    } else {
      await fs.writeFile(specPath, this.reconstructSpecMarkdown(spec));
    }
    
    // Save style information if available
    await this.saveStyle(spec, style);
    
    await this.log('info', 'spec-saved', 'Design spec saved to run', {
      specPath,
      title: spec.title
    });
  }

  async saveStyle(spec, style) {
    // Only create style.txt if --style is passed from command line
    if (style) {
      const inputDir = path.join(this.runDir, 'input');
      const stylePath = path.join(inputDir, 'style.txt');
      
      await fs.writeFile(stylePath, style);
      await this.log('info', 'style-saved', 'Style information saved to run', {
        stylePath,
        source: 'command-line'
      });
    }
  }

  async saveImage(imageData, metadata) {
    const { provider, model, screen, variant } = metadata;
    const generateDir = path.join(this.runDir, 'generate', provider);
    await fs.ensureDir(generateDir);
    
    const filename = this.generateImageFilename(screen, variant);
    const imagePath = path.join(generateDir, filename);
    
    if (Buffer.isBuffer(imageData)) {
      await fs.writeFile(imagePath, imageData);
    } else if (typeof imageData === 'string') {
      const buffer = Buffer.from(imageData, 'base64');
      await fs.writeFile(imagePath, buffer);
    } else {
      throw new Error('Unsupported image data format');
    }
    
    await this.log('info', 'image-saved', 'Generated image saved', {
      imagePath,
      metadata
    });
    
    return imagePath;
  }

  async updateManifest(step, data) {
    const manifestPath = path.join(this.runDir, step, 'manifest.json');
    
    let manifest = {};
    if (await fs.pathExists(manifestPath)) {
      manifest = await fs.readJson(manifestPath);
    }
    
    Object.assign(manifest, data);
    await fs.writeJson(manifestPath, manifest, { spaces: 2 });
    
    return manifest;
  }

  async addImageToManifest(imagePath, metadata) {
    const { provider, model, screen, variant, promptHash, seed } = metadata;
    
    const item = {
      id: this.generateImageId(screen, provider, variant),
      screen,
      model: `${provider}:${model}`,
      variant,
      promptHash,
      path: imagePath,
      seed,
      timestamp: new Date().toISOString()
    };
    
    const manifestPath = path.join(this.runDir, 'generate', 'manifest.json');
    let manifest = {};
    
    if (await fs.pathExists(manifestPath)) {
      manifest = await fs.readJson(manifestPath);
    } else {
      manifest = {
        spec: '',
        screens: [],
        models: [],
        items: []
      };
    }
    
    if (!manifest.items) manifest.items = [];
    manifest.items.push(item);
    
    await fs.writeJson(manifestPath, manifest, { spaces: 2 });
    return item;
  }

  async saveCritique(imageId, critiqueData) {
    const critiquePath = path.join(this.runDir, 'critique', `${imageId}.json`);
    await fs.writeJson(critiquePath, critiqueData, { spaces: 2 });
    
    await this.log('info', 'critique-saved', 'Critique saved', {
      imageId,
      score: critiqueData.weightedTotal
    });
    
    return critiquePath;
  }

  async updateCritiqueSummary(summaryData) {
    const summaryPath = path.join(this.runDir, 'critique', 'summary.md');
    const markdown = this.generateCritiqueSummary(summaryData);
    await fs.writeFile(summaryPath, markdown);
    
    return summaryPath;
  }

  async log(level, step, message, meta = {}) {
    const logEntry = {
      ts: new Date().toISOString(),
      level,
      step,
      message,
      meta
    };
    
    const logsPath = path.join(this.runDir, 'logs.jsonl');
    const logLine = JSON.stringify(logEntry) + '\n';
    
    await fs.appendFile(logsPath, logLine);
    
    if (level === 'error') {
      console.error(`[${step}] ${message}`, meta);
    } else if (level === 'warn') {
      console.warn(`[${step}] ${message}`, meta);
    } else {
      console.log(`[${step}] ${message}`);
    }
  }

  generateImageFilename(screen, variant) {
    const screenSlug = screen.toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    
    return `screen-${screenSlug}_v${variant}.png`;
  }

  generateImageId(screen, provider, variant) {
    const screenSlug = screen.toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    
    return `${screenSlug}_${provider}_v${variant}`;
  }

  hashPrompt(prompt) {
    return crypto.createHash('sha256').update(prompt).digest('hex').slice(0, 16);
  }

  reconstructSpecMarkdown(spec) {
    let markdown = `# ${spec.title}\n\n`;
    
    if (spec.description) {
      markdown += `## Description\n\n${spec.description}\n\n`;
    }
    
    if (spec.type) {
      markdown += `## Type\n\n${spec.type}\n\n`;
    }
    
    if (spec.styles) {
      markdown += `## Styles\n\n${spec.styles}\n\n`;
    }
    
    if (spec.inspiration && spec.inspiration.length > 0) {
      markdown += `## Inspiration\n\n`;
      spec.inspiration.forEach(item => {
        markdown += `- ${item}\n`;
      });
      markdown += '\n';
    }
    
    if (spec.models && spec.models.length > 0) {
      markdown += `## Models\n\n`;
      spec.models.forEach(model => {
        markdown += `- ${model}\n`;
      });
      markdown += '\n';
    }
    
    if (spec.notes) {
      markdown += `## Notes\n\n${spec.notes}\n\n`;
    }
    
    return markdown;
  }

  generateCritiqueSummary(summaryData) {
    let markdown = `# Critique Summary\n\n`;
    markdown += `Generated: ${new Date().toISOString()}\n\n`;
    
    if (summaryData.leaderboard && summaryData.leaderboard.length > 0) {
      markdown += `## Leaderboard\n\n`;
      markdown += `| Rank | Image | Model | Screen | Score | Task Fitness | Hierarchy | A11y | Consistency | Aesthetic |\n`;
      markdown += `|------|--------|-------|--------|--------|--------------|-----------|------|-------------|----------|\n`;
      
      summaryData.leaderboard.forEach((item, index) => {
        const scores = item.scores || {};
        markdown += `| ${index + 1} | ${path.basename(item.image)} | ${item.model} | ${item.screen} | ${item.weightedTotal?.toFixed(1) || 'N/A'} | ${scores.task_fitness || 'N/A'} | ${scores.hierarchy || 'N/A'} | ${scores.a11y || 'N/A'} | ${scores.consistency || 'N/A'} | ${scores.aesthetic || 'N/A'} |\n`;
      });
      
      markdown += '\n';
    }
    
    if (summaryData.insights && summaryData.insights.length > 0) {
      markdown += `## Key Insights\n\n`;
      summaryData.insights.forEach(insight => {
        markdown += `- ${insight}\n`;
      });
      markdown += '\n';
    }
    
    return markdown;
  }

  getPath(subpath = '') {
    return path.join(this.runDir, subpath);
  }

  async exists(subpath = '') {
    return fs.pathExists(this.getPath(subpath));
  }

  async list(subpath = '') {
    try {
      return await fs.readdir(this.getPath(subpath));
    } catch (error) {
      return [];
    }
  }
}