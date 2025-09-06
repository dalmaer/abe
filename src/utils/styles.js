import fs from 'fs-extra';
import path from 'path';

const STYLES_FILE = path.join(process.cwd(), 'styles/styles.md');

let stylesCache = null;

function parseStylesMarkdown(content) {
  const lines = content.split('\n');
  const styles = new Map();
  
  // Find the table header and start parsing after it
  let tableStartIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('| Name') && lines[i].includes('| Image Prompt')) {
      tableStartIndex = i + 2; // Skip header and separator line
      break;
    }
  }
  
  if (tableStartIndex === -1) {
    throw new Error('Could not find styles table in styles.md');
  }
  
  // Parse each table row
  for (let i = tableStartIndex; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || !line.startsWith('|')) {
      continue; // Skip empty lines or non-table lines
    }
    
    const columns = line.split('|').map(col => col.trim()).filter(col => col);
    if (columns.length >= 5) {
      const name = columns[0];
      const description = columns[1];
      const visualCues = columns[2];
      const whenToUse = columns[3];
      const imagePrompt = columns[4];
      
      if (name && imagePrompt) {
        // Strip quotes from image prompt if present
        let cleanImagePrompt = imagePrompt;
        
        // Handle various quote formats
        cleanImagePrompt = cleanImagePrompt.replace(/^"(.*)"$/, '$1'); // Regular quotes
        cleanImagePrompt = cleanImagePrompt.replace(/^"(.*)"$/, '$1'); // Smart quotes
        cleanImagePrompt = cleanImagePrompt.replace(/^'(.*)'$/, '$1'); // Single quotes
        
        styles.set(name.toLowerCase(), {
          name,
          description,
          visualCues,
          whenToUse,
          imagePrompt: cleanImagePrompt
        });
      }
    }
  }
  
  return styles;
}

async function loadStyles() {
  if (stylesCache) {
    return stylesCache;
  }
  
  try {
    const content = await fs.readFile(STYLES_FILE, 'utf8');
    stylesCache = parseStylesMarkdown(content);
    return stylesCache;
  } catch (error) {
    throw new Error(`Failed to load styles from ${STYLES_FILE}: ${error.message}`);
  }
}

export async function getStylePrompt(styleName) {
  if (!styleName) {
    return null;
  }
  
  const styles = await loadStyles();
  const style = styles.get(styleName.toLowerCase());
  
  if (!style) {
    const availableStyles = Array.from(styles.keys()).map(key => styles.get(key).name);
    throw new Error(`Style "${styleName}" not found. Available styles: ${availableStyles.join(', ')}`);
  }
  
  return style.imagePrompt;
}

export async function listAvailableStyles() {
  const styles = await loadStyles();
  return Array.from(styles.values()).map(style => ({
    name: style.name,
    description: style.description
  }));
}