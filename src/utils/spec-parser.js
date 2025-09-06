import fs from 'fs-extra';
import matter from 'gray-matter';
import { unified } from 'unified';
import remarkParse from 'remark-parse';

export async function parseSpec(specPath) {
  const content = await fs.readFile(specPath, 'utf8');
  const { data: frontmatter, content: markdown } = matter(content);
  
  const ast = unified().use(remarkParse).parse(markdown);
  const sections = extractSections(ast);
  
  const spec = {
    path: specPath,
    frontmatter,
    ...sections
  };
  
  validateSpec(spec);
  return spec;
}

function extractSections(ast) {
  const sections = {};
  let currentSection = null;
  let currentContent = [];
  
  for (const node of ast.children) {
    if (node.type === 'heading') {
      if (currentSection) {
        sections[currentSection] = currentContent.join('\n').trim();
      }
      
      if (node.depth === 1) {
        sections.title = extractHeadingText(node);
      }
      
      currentSection = extractHeadingText(node).toLowerCase();
      currentContent = [];
    } else if (currentSection) {
      currentContent.push(nodeToText(node));
    }
  }
  
  if (currentSection && currentContent.length > 0) {
    sections[currentSection] = currentContent.join('\n').trim();
  }
  
  return normalizeSpec(sections);
}

function extractHeadingText(node) {
  return node.children
    .map(child => child.type === 'text' ? child.value : '')
    .join('');
}

function nodeToText(node) {
  switch (node.type) {
    case 'paragraph':
      return node.children.map(child => 
        child.type === 'text' ? child.value : 
        child.type === 'strong' ? `**${child.children.map(c => c.value).join('')}**` :
        child.type === 'link' ? child.url : ''
      ).join('');
    case 'list':
      return node.children.map(item => 
        '- ' + item.children.map(p => nodeToText(p)).join('')
      ).join('\n');
    case 'listItem':
      return node.children.map(p => nodeToText(p)).join('');
    case 'strong':
      return `**${node.children.map(c => nodeToText(c)).join('')}**`;
    case 'text':
      return node.value;
    default:
      return '';
  }
}

function normalizeSpec(sections) {
  return {
    title: sections.title || 'Untitled Design',
    description: sections.description || '',
    type: sections.type || 'Mobile application UI',
    styles: sections.styles || sections.style || '',
    inspiration: parseInspiration(sections.inspiration || ''),
    models: parseModels(sections.models || ''),
    critiqueCriteria: sections['critique criteria'] || '',
    notes: sections.notes || '',
    screens: extractScreens(sections.description || ''),
    primaryTasks: extractPrimaryTasks(sections.description || '')
  };
}

function parseInspiration(inspirationText) {
  if (!inspirationText) return [];
  
  const urls = inspirationText.match(/https?:\/\/[^\s]+/g) || [];
  const localPaths = inspirationText.match(/[^\s]+\.(jpg|jpeg|png|gif|webp)/gi) || [];
  
  return [...urls, ...localPaths];
}

function parseModels(modelsText) {
  if (!modelsText) return null;
  
  return modelsText
    .split(/[,\n]/)
    .map(model => model.trim())
    .filter(model => model.length > 0);
}

function extractScreens(description) {
  const screenPatterns = [
    /(\d+)\)\s*\*\*([^*]+)\*\*/g,
    /(\d+)\.\s*\*\*([^*]+)\*\*/g,
    /screen[s]?:\s*([^.]+)/gi
  ];
  
  const screens = new Set();
  
  for (const pattern of screenPatterns) {
    pattern.lastIndex = 0; // Reset regex state
    let match;
    while ((match = pattern.exec(description)) !== null) {
      const screenName = match[2] || match[1];
      if (screenName) {
        screens.add(screenName.trim().replace(/—.*$/, '').trim());
      }
    }
  }
  
  // Also look for text within **bold** markers that might be screen names
  const boldPattern = /\*\*([^*]+)\*\*/g;
  let match;
  while ((match = boldPattern.exec(description)) !== null) {
    const text = match[1].trim();
    // Check if it looks like a screen name (contains words like "screen", or is short and descriptive)
    if (text.includes('Screen') || text.includes('Spot') || text.includes('Car') || text.includes('Find') || 
        (text.length < 20 && !text.includes(' — ') && !text.includes('buttons'))) {
      const cleanName = text.replace(/—.*$/, '').trim();
      if (cleanName.length > 0 && !cleanName.startsWith('-')) {
        screens.add(cleanName);
      }
    }
  }
  
  if (screens.size === 0) {
    screens.add('Main Screen');
  }
  
  // Clean up screen names and remove duplicates
  const cleanedScreens = Array.from(screens)
    .map(screen => screen.replace(/^-\s*\*\*|\*\*$/g, '').trim())
    .filter(screen => screen.length > 0)
    .filter((screen, index, arr) => arr.indexOf(screen) === index);
  
  return cleanedScreens.length > 0 ? cleanedScreens : ['Main Screen'];
}

function extractPrimaryTasks(description) {
  const taskPatterns = [
    /task[s]?:([^.]+)/gi,
    /goal[s]?:([^.]+)/gi,
    /user[s]? (?:can|should|will) ([^.]+)/gi
  ];
  
  const tasks = [];
  
  for (const pattern of taskPatterns) {
    let match;
    while ((match = pattern.exec(description)) !== null) {
      tasks.push(match[1].trim());
    }
  }
  
  return tasks;
}

function validateSpec(spec) {
  const required = ['title', 'description', 'type'];
  const missing = required.filter(field => !spec[field] || spec[field].trim() === '');
  
  if (missing.length > 0) {
    throw new Error(`Spec validation failed. Missing required sections: ${missing.join(', ')}`);
  }
  
  if (spec.screens.length === 0) {
    console.warn('Warning: No screens detected in spec description. Using default "Main Screen".');
  }
}

export function getScreenDescription(spec, screenName) {
  const description = spec.description || '';
  
  const screenRegex = new RegExp(`\\*\\*${screenName}[^*]*\\*\\*[^\\n]*([^*]+?)(?=\\*\\*|$)`, 'i');
  const match = description.match(screenRegex);
  
  if (match && match[1]) {
    return match[1].trim().replace(/^—\s*/, '');
  }
  
  return description;
}