import Mustache from 'mustache';
import fs from 'fs-extra';
import { getStylePrompt } from './styles.js';

const VARIANT_DESCRIPTORS = [
  'clean and minimal',
  'spacious with warm accents',
  'compact and efficient',
  'bold with high contrast',
  'soft with subtle shadows',
  'modern with sharp edges',
  'playful with rounded corners',
  'professional and structured'
];

export function renderTemplate(template, context) {
  try {
    return Mustache.render(template, context);
  } catch (error) {
    console.error('Template rendering error:', error);
    return template;
  }
}

export async function buildTemplateContext(spec, options = {}) {
  const {
    screen,
    variant = 1,
    config,
    revisePrompt,
    rubric,
    inspiration = [],
    style
  } = options;

  // Get style prompt if style is specified
  let stylePrompt = null;
  if (style) {
    try {
      stylePrompt = await getStylePrompt(style);
    } catch (error) {
      // Log warning but continue - don't fail the generation
      console.warn(`Warning: ${error.message}`);
    }
  }

  // Helper function to clean up empty or placeholder values
  const cleanValue = (value) => {
    if (!value || value === '-' || value.trim() === '') {
      return null;
    }
    return value;
  };

  const description = screen 
    ? getScreenDescription(spec, screen)
    : spec.description;

  const context = {
    title: spec.title,
    type: spec.type,
    styles: cleanValue(spec.styles),
    screens_list: spec.screens.join(', '),
    primary_tasks: spec.primaryTasks.join(', '),
    now: new Date().toISOString(),
    
    screen: screen || 'Main Screen',
    description_for_screen_or_overall: cleanValue(description),
    
    variant_descriptor: getVariantDescriptor(variant),
    inspiration: formatInspiration(inspiration.length > 0 ? inspiration : spec.inspiration),
    
    rubric_with_weights: formatRubric(rubric || config?.critique?.rubric || []),
    
    revisePrompt: revisePrompt || '',
    style_prompt: stylePrompt || ''
  };

  return context;
}

function getScreenDescription(spec, screenName) {
  const description = spec.description || '';
  
  const screenRegex = new RegExp(
    `\\*\\*${escapeRegex(screenName)}[^*]*\\*\\*[^\\n]*([^*]+?)(?=\\*\\*|$)`, 
    'i'
  );
  const match = description.match(screenRegex);
  
  if (match && match[1]) {
    return match[1].trim().replace(/^—\s*/, '');
  }
  
  return description;
}

function getVariantDescriptor(variantNumber) {
  if (variantNumber < 1 || variantNumber > VARIANT_DESCRIPTORS.length) {
    return VARIANT_DESCRIPTORS[0];
  }
  return VARIANT_DESCRIPTORS[variantNumber - 1];
}

function formatInspiration(inspiration) {
  if (!inspiration || inspiration.length === 0) {
    return 'No specific inspiration provided.';
  }
  
  return inspiration
    .map(item => `- ${item}`)
    .join('\n');
}

function formatRubric(rubric) {
  if (!rubric || rubric.length === 0) {
    return 'No specific criteria provided.';
  }
  
  return rubric
    .map(criterion => `- ${criterion.label} (${Math.round(criterion.weight * 100)}%)`)
    .join('\n');
}

function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function loadPromptOverrides(args, step) {
  const overrides = {};
  
  const promptArg = args[`${step}Prompt`];
  const promptFileArg = args[`${step}PromptFile`];
  
  if (promptArg) {
    overrides[step] = promptArg;
  } else if (promptFileArg) {
    try {
      overrides[step] = fs.readFileSync(promptFileArg, 'utf8');
    } catch (error) {
      console.warn(`Warning: Could not load prompt file ${promptFileArg}:`, error.message);
    }
  }
  
  return overrides;
}

export function getPromptTemplate(step, config, overrides = {}) {
  if (overrides[step]) {
    return overrides[step];
  }
  
  if (config?.prompts?.[step]) {
    return config.prompts[step];
  }
  
  return getDefaultPrompt(step);
}

function getDefaultPrompt(step) {
  const defaults = {
    generate: `SYSTEM: You are a senior product designer generating high-fidelity UI mockups. Output images that look like real app screens, flat front-on, no device frame unless requested.

USER:
Title: {{title}}
Type: {{type}}
Screen: {{screen}}
Description: {{description_for_screen_or_overall}}
Style guidelines: {{styles}}{{#style_prompt}}
Style specification: {{style_prompt}}{{/style_prompt}}
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
  };
  
  return defaults[step] || '';
}