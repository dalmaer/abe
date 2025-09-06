import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const defaultConfig = {
  outDir: 'runs',
  defaultVariants: 3,
  defaultConcurrency: 3,
  modelAliases: {
    baseline: ['openai:gpt-4o', 'openai:dall-e-3'],
    image: ['openai:dall-e-3', 'openai:dall-e-2', 'google:imagen-3.0-generate-002', 'google:gemini-2.5-flash-image-preview'],
    vision: ['openai:gpt-4o', 'anthropic:claude-3-5-sonnet-20241022'],
    google: ['google:imagen-3.0-generate-002', 'google:gemini-2.5-flash-image-preview'],
    all: ['openai:gpt-4o', 'openai:dall-e-3', 'google:imagen-3.0-generate-002', 'google:gemini-2.5-flash-image-preview', 'anthropic:claude-3-5-sonnet-20241022']
  },
  providerOptions: {
    openai: { apiKeyEnv: 'OPENAI_API_KEY' },
    anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY' },
    google: { apiKeyEnv: 'GEMINI_API_KEY' },
    stability: { apiKeyEnv: 'STABILITY_API_KEY' }
  },
  critique: {
    model: 'openai:gpt-4o',
    rubric: [
      { id: 'task_fitness', label: 'Task fitness & clarity', weight: 0.35 },
      { id: 'hierarchy', label: 'Visual hierarchy & layout', weight: 0.20 },
      { id: 'a11y', label: 'Accessibility (contrast/tap targets)', weight: 0.20 },
      { id: 'consistency', label: 'Consistency across screens', weight: 0.15 },
      { id: 'aesthetic', label: 'Aesthetic quality', weight: 0.10 }
    ]
  },
  prompts: {
    generate: `SYSTEM: You are a senior product designer generating high-fidelity UI mockups. Output images that look like real app screens, flat front-on, no device frame unless requested.

USER:
Title: {{title}}
Type: {{type}}
Screen: {{screen}}
Description: {{description_for_screen_or_overall}}
Style guidelines: {{styles}}
Constraints:
- WCAG AA contrast
- Touch targets ≥48dp
- Clear hierarchy; no device chrome unless requested
Variant bias: {{variant_descriptor}}
Inspiration: {{inspiration}}
Return: a single high-res image.`,
    critique: `SYSTEM: You are an exacting design critic and accessibility reviewer. Return valid JSON only.

USER:
Evaluate the provided UI against the spec.
Spec summary:
Title: {{title}}
Type: {{type}}
Key tasks: {{primary_tasks}}
Style intent: {{styles}}
Screens: {{screens_list}}
Criteria with weights:
{{rubric_with_weights}}
For each image return: {"scores":{...},"weightedTotal":#,"strengths":[3],"issues":[3],"revisePrompt":"<=50 words"}`,
    revise: `SYSTEM: You are refining an existing UI mockup using the critique notes. Keep original intent.

USER:
Original intent: {{title}} / {{type}}
Style: {{styles}}
Screen: {{screen}}
Revise instructions: {{revisePrompt}}
Return: one updated image, same framing.`
  }
};

export async function loadConfig(configPath = './abe.config.json') {
  try {
    if (await fs.pathExists(configPath)) {
      const userConfig = await fs.readJson(configPath);
      return mergeConfig(defaultConfig, userConfig);
    }
  } catch (error) {
    console.warn(`Warning: Could not load config from ${configPath}:`, error.message);
  }
  return defaultConfig;
}

export async function saveConfig(config, configPath = './abe.config.json') {
  await fs.writeJson(configPath, config, { spaces: 2 });
}

function mergeConfig(defaultConfig, userConfig) {
  const merged = { ...defaultConfig };
  
  for (const [key, value] of Object.entries(userConfig)) {
    if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
      merged[key] = { ...defaultConfig[key], ...value };
    } else {
      merged[key] = value;
    }
  }
  
  return merged;
}

export function resolveModels(modelSpec, config) {
  if (Array.isArray(modelSpec)) {
    return modelSpec;
  }
  
  if (typeof modelSpec === 'string') {
    const aliases = modelSpec.split(',').map(s => s.trim());
    const resolved = [];
    
    for (const alias of aliases) {
      if (config.modelAliases[alias]) {
        resolved.push(...config.modelAliases[alias]);
      } else {
        resolved.push(alias);
      }
    }
    
    return [...new Set(resolved)];
  }
  
  return config.modelAliases.baseline || [];
}