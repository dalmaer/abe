# Getting Started with ABE

## Quick Start

1. **Initialize a new project:**
   ```bash
   npm install
   node cli/index.js init
   ```

2. **Set up API keys:**
   ```bash
   export OPENAI_API_KEY="your-openai-key"           # For DALL-E models
   export GOOGLE_API_KEY="your-google-key"           # For Gemini models
   export ANTHROPIC_API_KEY="your-anthropic-key"     # Optional for critique models
   ```

3. **Check configured models:**
   ```bash
   node cli/index.js models
   ```

4. **Generate your first mockups:**
   ```bash
   node cli/index.js generate --spec specs/parking-app.md --models image --dry-run
   ```

5. **Run a complete pipeline:**
   ```bash
   node cli/index.js run --pipeline pipelines/best-effort.json --dry-run
   ```

## Project Structure

After running `abe init`, your project will have:

```
project/
├── abe.config.json              # Configuration file
├── specs/
│   └── parking-app.md          # Example design spec
├── pipelines/
│   └── best-effort.json        # Example pipeline
└── runs/
    └── [timestamp]/            # Generated outputs (created on first run)
        ├── input/
        ├── generate/
        ├── critique/
        └── iterate/
```

## Core Concepts

### Design Specs
Markdown files that describe what to design:

```markdown
# My App

## Description
Design screens for...

## Type  
Mobile application UI

## Styles
- Clean, minimal design
- Blue color scheme

## Models
- baseline
```

### Commands

- `generate` - Create UI mockups from specs
- `critique` - Score and analyze generated images  
- `iterate` - Improve designs based on feedback
- `run` - Execute multi-step pipelines
- `models` - List available models
- `init` - Set up new project

### Pipelines
JSON files defining multi-step workflows:

```json
{
  "name": "best-effort",
  "steps": [
    {
      "id": "generate-pass-1", 
      "run": "generate",
      "spec": "specs/my-app.md",
      "models": "baseline",
      "variants": 3
    },
    {
      "id": "critique-pass-1",
      "run": "critique", 
      "from": "generate-pass-1"
    }
  ]
}
```

## Important Notes

✅ **Real Image Generation Enabled:**
- **ABE now supports real image generation** using AI SDK 5.0
- **DALL-E 3 & DALL-E 2 integration** for high-quality UI mockups
- **Vision models** (GPT-4o) for critiquing generated images
- **Automatic image format handling** (PNG, Base64, URLs)

🔧 **Available Image Models:**
- `openai:dall-e-3` - Latest DALL-E model (recommended)
- `openai:dall-e-2` - Previous DALL-E model  
- `google:gemini-2.5-flash-image-preview` - Google's image generation model
- Model aliases: `image`, `baseline`, `vision`, `google`, `all`

⚡ **Requirements:**
- **OpenAI API Key** for DALL-E models (`OPENAI_API_KEY`)
- **Google API Key** for Gemini models (`GOOGLE_API_KEY`)
- Anthropic API key optional for vision critique models (`ANTHROPIC_API_KEY`)

## Next Steps

1. **Try the examples (with real API key):**
   ```bash
   # Set your API keys
   export OPENAI_API_KEY="sk-your-key-here"
   export GOOGLE_API_KEY="your-google-key-here"
   
   # Generate real mockups with DALL-E
   node cli/index.js generate --spec specs/parking-app.md --models image
   
   # Or try Google's Gemini model
   node cli/index.js generate --spec specs/parking-app.md --models google
   
   # Run complete pipeline with real generation
   node cli/index.js run --pipeline pipelines/best-effort.json
   ```

2. **Customize for your needs:**
   - Edit `abe.config.json` for your preferred models
   - Create new design specs in `specs/`
   - Build custom pipelines in `pipelines/`
   - Adjust image sizes, variant counts, and critique criteria

3. **Extend the implementation:**
   - Add more image providers (Stability AI, others)
   - Integrate with design tools (Figma, Sketch)
   - Add custom critique criteria
   - Build web interfaces or integrations
   - Implement image-to-image editing for iterations

## Getting Help

- Check command help: `node cli/index.js --help`
- View specific command options: `node cli/index.js generate --help`
- Review the original README.md for detailed architecture information