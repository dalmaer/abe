# abe — AI Best‑Effort UI Design Engine

## Purpose

`abe` helps you ask multiple AI systems to produce the **best possible app/web UI designs**, without time pressure. It:

* fans out across models/providers,
* generates multi‑screen and multi‑variant images,
* **critiques** and **scores** each result,
* can **iterate** (generate → critique → revise → re‑critique),
* saves **all images and artifacts to disk**, and
* runs as a **pipeline** (single command, reproducible runs).

---

## 1) High‑Level Architecture

* **CLI (Node.js, ESM)** — entry point for subcommands: `generate`, `critique`, `iterate`, `run`.
* **Tasks** — small composable functions (generate/critique/revise) that can be chained.
* **Providers / Models** — thin adapters around [`ai`](https://www.npmjs.com/package/ai) to call multiple model endpoints for:

  * **Image generation** (UI screens & variants)
  * **Vision critique** (LLM‑V) and/or **Text critique** (LLM)
* **Run Store (Filesystem)** — all outputs persist under `./runs/<timestamp-or-run-id>/…`
* **Spec Loader** — parses a Markdown **Design Spec** (sections described below) + optional CLI overrides.
* **Scoring** — rubric‑based LLM critique returns 0–100 **scores** + structured justification.
* **Pipelines** — declarative sequences (e.g., generate → critique → revise → critique).

```
project/
  abe.config.json                # global defaults (models, prompts, paths)
  specs/
    parking-app.md               # example design spec
  pipelines/
    best-effort.json             # example pipeline
  runs/
    2025-09-05T20-12-44Z/        # one run
      input/
        spec.md
        inspiration/…            
      generate/
        <modelA>/screen-1.png
        <modelB>/screen-1_v1.png
        manifest.json            # catalog of images & metadata
      critique/
        <image-id>.json
        summary.md               # leaderboard & commentary
      iterate/
        <modelX>/screen-1_rev1.png
      logs.jsonl                 # step-by-step events
```

---

## 2) CLI Surface

### Commands

* `abe generate --spec specs/parking-app.md [--images path/] [--models a,b] [--variants N] [--screens "Home,Details"] [--out runs/] [--seed 123]`

  * Creates images per spec across models, screens, and variants. Saves to disk.
* `abe critique --image runs/.../screen-1.png --prompt "…" [--out runs/.../critique/]`

  * Scores a single image against the supplied prompt (or spec description).
* `abe iterate --spec specs/parking-app.md --origin runs/.../generate/manifest.json [--passes 2]`

  * Multi‑pass: for each selected image, request a revision using critique feedback; re‑critique results.
* `abe run --pipeline pipelines/best-effort.json`

  * Executes a declarative pipeline (see §6).
* `abe models` — prints configured model aliases and providers.
* `abe init` — creates `abe.config.json`, `pipelines/`, and an example spec.

### Common Flags

* `--spec` path to design spec (Markdown).
* `--images` folder of input images (optional).
* `--models` comma‑separated list or alias group from config (e.g., `baseline`, `all`).
* `--variants` number of variations per screen/model (default from config).
* `--screens` comma list to override/augment spec’s requested screens.
* `--out` output base directory (default `./runs`).
* `--seed` optional seed for deterministic providers (where supported).
* `--concurrency` max parallel calls (default from config).
* `--dry-run` show plan but don’t call providers.

---

## 3) Prompt Templates & Overrides (Defaults + CLI/File/Config)

`abe` ships with **default prompt templates** for each call type (generate, critique, revise). Templates use `{{mustache_like}}` placeholders.

### CLI Overrides

* `--gen-prompt "..."` (inline override for **generate**)
* `--gen-prompt-file path/to/file.txt` (file override for **generate**)
* `--critique-prompt "..."` (inline override for **critique**)
* `--critique-prompt-file path/to/file.txt` (file override for **critique**)
* `--revise-prompt "..."` (inline override for **revise**)
* `--revise-prompt-file path/to/file.txt` (file override for **revise**)

**Precedence (highest → lowest):** Inline flag → File flag → `abe.config.json` → built‑in defaults.

### Config Additions (`abe.config.json`)

```json
{
  "outDir": "runs",
  "defaultVariants": 3,
  "defaultConcurrency": 3,
  "modelAliases": {
    "baseline": ["openai:gpt-image-1", "google:imagen-3", "stability:sd3-medium"],
    "all": ["openai:gpt-image-1", "google:imagen-3", "stability:sd3-medium", "openai:o4-mini-vision"]
  },
  "providerOptions": {
    "openai": { "apiKeyEnv": "OPENAI_API_KEY" },
    "google": { "apiKeyEnv": "GOOGLE_API_KEY" },
    "stability": { "apiKeyEnv": "STABILITY_API_KEY" }
  },
  "critique": {
    "model": "openai:o4-mini-vision",
    "rubric": [
      { "id": "task_fitness", "label": "Task fitness & clarity", "weight": 0.35 },
      { "id": "hierarchy", "label": "Visual hierarchy & layout", "weight": 0.20 },
      { "id": "a11y", "label": "Accessibility (contrast/tap targets)", "weight": 0.20 },
      { "id": "consistency", "label": "Consistency across screens", "weight": 0.15 },
      { "id": "aesthetic", "label": "Aesthetic quality", "weight": 0.10 }
    ]
  },
  "prompts": {
    "generate": "SYSTEM: You are a senior product designer generating high-fidelity UI mockups. Output images that look like real app screens, flat front-on, no device frame unless requested.\n\nUSER:\nTitle: {{title}}\nType: {{type}}\nScreen: {{screen}}\nDescription: {{description_for_screen_or_overall}}\nStyle guidelines: {{styles}}\nConstraints:\n- WCAG AA contrast\n- Touch targets \u226548dp\n- Clear hierarchy; no device chrome unless requested\nVariant bias: {{variant_descriptor}}\nInspiration: {{inspiration}}\nReturn: a single high-res image.",
    "critique": "SYSTEM: You are an exacting design critic and accessibility reviewer. Return valid JSON only.\n\nUSER:\nEvaluate the provided UI against the spec.\nSpec summary:\nTitle: {{title}}\nType: {{type}}\nKey tasks: {{primary_tasks}}\nStyle intent: {{styles}}\nScreens: {{screens_list}}\nCriteria with weights:\n{{rubric_with_weights}}\nFor each image return: {\"scores\":{...},\"weightedTotal\":#,\"strengths\":[3],\"issues\":[3],\"revisePrompt\":\"<=50 words\"}",
    "revise": "SYSTEM: You are refining an existing UI mockup using the critique notes. Keep original intent.\n\nUSER:\nOriginal intent: {{title}} / {{type}}\nStyle: {{styles}}\nScreen: {{screen}}\nRevise instructions: {{revisePrompt}}\nReturn: one updated image, same framing."
  }
}
```

### Template Tokens (available to all)

* `{{title}}`, `{{type}}`, `{{styles}}`, `{{screens_list}}`, `{{primary_tasks}}`
* `{{screen}}`, `{{description_for_screen_or_overall}}`
* `{{inspiration}}` (normalized list/URIs)
* `{{rubric_with_weights}}`
* `{{revisePrompt}}` (for revise)
* `{{variant_descriptor}}` (e.g., “spacious + warm accent”, per‑variant)
* `{{now}}` (ISO timestamp)

### Pipelines: Per‑Step Overrides

You can add prompt overrides directly in pipeline steps:

```json
{
  "name": "best-effort",
  "steps": [
    {
      "id": "generate-pass-1",
      "run": "generate",
      "spec": "specs/parking-app.md",
      "models": "baseline",
      "variants": 4,
      "genPrompt": "SYSTEM: Focus on tap targets and contrast.\nUSER:\nTitle: {{title}} ...",
      "genPromptFile": "prompts/generate_v2.txt"
    },
    {
      "id": "critique-pass-1",
      "run": "critique",
      "critiquePromptFile": "prompts/critique_accessibility_bias.txt"
    }
  ]
}
```

> In `run`, per‑step overrides take precedence over top‑level CLI flags for that step.

---

## 4) Design Spec (Markdown)

A single **Markdown** file with human‑readable sections. Minimal required: **Title**, **Description**, **Type**. Others optional.

### Required Sections

* `# <Title>`
* `## Description`

  * What to design; can describe **multiple screens** and any special states.
* `## Type`

  * e.g., `Mobile application UI`, `Web app dashboard`, `Marketing landing page`.

### Optional Sections

* `## Styles`

  * e.g., “Warm palette with subtle gradients and rounded UI elements.”
* `## Inspiration`

  * Links and/or embedded image paths (local or remote).
* `## Models`

  * Suggest model aliases or explicit providers.
* `## Critique Criteria`

  * Override/add to the default rubric.
* `## Notes`

  * Constraints, brand hints, accessibility requirements, platform conventions.

### Example Spec (save as `specs/parking-app.md`)

```markdown
# Where Is My Car? (Parking Tracker)

## Description
Design a simple mobile UI with two screens:
1) **Save Spot** — large level buttons (e.g., P0, P1, P2, P3), plus text field to add a custom label (e.g., “Street + Cross”).
2) **Find Car** — shows the last saved spot, big contrasty “Navigate” call to action, and a small history list.

## Type
Mobile application UI (iOS/Android agnostic, but feel native).

## Styles
- Warm palette with a red accent, subtle depth shadows, rounded cards, bold H1.
- Keep main actions one‑tap reachable.

## Inspiration
- https://dribbble.com/shots/parking-app
- images/garage-level-signage.jpg
- images/minimal-cards.png

## Models
- baseline

## Critique Criteria
- Task success (clarity of “Save” + “Find”)
- Visual hierarchy & tap targets
- Accessibility (contrast, touch area)
- Consistency across screens

## Notes
Prefer a simple layout that beginners can grok instantly.
```

---

## 5) Execution Flow (Core Tasks)

### 5.1 Generate

**Input**

* Spec (parsed sections)
* Optional input images (inspiration, brand assets)
* Models (resolved via aliases)
* Screens & variants

**Process**

1. Build a **prompt** per `(screen × model × variant)` including Title/Type/Description/Styles, screen‑specific instructions, inspiration references, and output requirements (e.g., flat front‑on UI, no device chrome unless specified).
2. Call image models via `ai` package.
3. Save image → `runs/<id>/generate/<model>/screen-<name>_v<k>.png`
4. Write/update `manifest.json` with model/variant/seed/prompt hash/file path/screen/timestamps.

**Output**

* PNG files
* `manifest.json` (catalog)
* `logs.jsonl` appended

### 5.2 Critique

**Input**

* One image path (or a set)
* Prompt (defaults to spec description + styles + screen notes)
* Rubric (config + spec overrides)

**Process**

* Use a **vision LLM** to return structured JSON scores:

  * Individual criterion scores 0–100
  * Weighted total
  * Strengths (bullets), Issues (bullets), **Actionable revision prompt** (concise)
* Persist per‑image `critique/<image-id>.json`
* Aggregate a **leaderboard** `critique/summary.md`

**Output (schema)**

```json
{
  "image": "runs/…/screen-1_v2.png",
  "scores": {
    "task_fitness": 82,
    "hierarchy": 75,
    "a11y": 70,
    "consistency": 78,
    "aesthetic": 80
  },
  "weightedTotal": 77.9,
  "strengths": ["Clear primary action", "Readable headings"],
  "issues": ["CTA contrast insufficient", "History list too small"],
  "revisePrompt": "Increase CTA contrast to WCAG AA, enlarge history list items to 48dp min, keep red accent but reduce saturation by ~10%."
}
```

### 5.3 Revise (Iterate)

**Input**

* Original image (or prompt seed)
* `revisePrompt` from critique
* Original generation prompt (for context)

**Process**

* Send **revision** request to an image model that supports image‑to‑image or instruction‑based edits.
* Save to `iterate/<model>/screen-<name>_rev<pass>_v<k>.png`
* Re‑run **critique**; update leaderboard.

---

## 6) Pipelines

A pipeline is a JSON file describing steps and parallelism.

```json
{
  "name": "best-effort",
  "steps": [
    {
      "id": "generate-pass-1",
      "run": "generate",
      "spec": "specs/parking-app.md",
      "models": "baseline",
      "variants": 4,
      "screens": ["Save Spot", "Find Car"]
    },
    {
      "id": "critique-pass-1",
      "run": "critique",
      "from": "generate-pass-1"
    },
    {
      "id": "revise-pass-2",
      "run": "iterate",
      "from": "critique-pass-1",
      "select": { "topK": 3, "minScore": 70 },
      "passes": 1
    },
    {
      "id": "critique-pass-2",
      "run": "critique",
      "from": "revise-pass-2"
    }
  ]
}
```

* `from` references a prior step’s outputs.
* `select` filters which images advance (e.g., **top K**).
* `passes` controls additional revision rounds.

Run with: `abe run --pipeline pipelines/best-effort.json`

---

## 7) Implementation Guide (Node.js, ESM, `ai`)

* **Language:** Node.js 20+, ESM (`"type": "module"`)
* **Dependencies:** `ai`, `yargs`, `fs-extra`, `globby`, `gray-matter`, `remark`, `remark-parse`, `uuid`, `p-limit`

### `package.json`

```json
{
  "name": "abe",
  "type": "module",
  "bin": { "abe": "./cli/index.mjs" },
  "dependencies": {
    "ai": "^3.3.0",
    "fs-extra": "^11.2.0",
    "globby": "^14.0.0",
    "gray-matter": "^4.0.3",
    "remark": "^15.0.1",
    "remark-parse": "^11.0.0",
    "uuid": "^9.0.1",
    "yargs": "^17.7.2",
    "p-limit": "^5.0.0"
  }
}
```

### CLI Skeleton (`cli/index.mjs`)

```js
#!/usr/bin/env node
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { generateCmd } from '../src/cmd/generate.mjs';
import { critiqueCmd } from '../src/cmd/critique.mjs';
import { iterateCmd } from '../src/cmd/iterate.mjs';
import { runCmd } from '../src/cmd/run.mjs';
import { modelsCmd, initCmd } from '../src/cmd/misc.mjs';

yargs(hideBin(process.argv))
  .scriptName('abe')
  .command(generateCmd)
  .command(critiqueCmd)
  .command(iterateCmd)
  .command(runCmd)
  .command(modelsCmd)
  .command(initCmd)
  .demandCommand(1)
  .strict()
  .help()
  .parse();
```

### Provider Helpers (via `ai`)

```js
// src/providers.mjs
import { generateText, generateImage } from 'ai';

export async function callImageModel({ providerModel, prompt, imageInput, seed }) {
  const res = await generateImage({
    model: providerModel,
    prompt,
    ...(seed != null ? { seed } : {}),
    ...(imageInput ? { image: imageInput } : {})
  });
  return res; // expect { image: Buffer | base64 | url, ... }
}

export async function callVisionCritic({ providerModel, prompt, imagePath }) {
  const res = await generateText({
    model: providerModel,
    images: [imagePath],
    prompt
  });
  return res; // expect { text }
}
```

### Tasks

* `src/tasks/generate.mjs` — builds prompts per screen/variant, calls `callImageModel`, saves files, updates `manifest.json`.
* `src/tasks/critique.mjs` — builds critique prompt, calls `callVisionCritic`, parses JSON (with guardrails), writes `<image>.json`, updates `summary.md`.
* `src/tasks/iterate.mjs` — reads best images from critique, sends revise requests (image‑to‑image if available), re‑critiques.

### Storage/Manifests

* `logs.jsonl` — one JSON per line: `{ ts, level, step, message, meta }`
* `manifest.json` (per generate step):

```json
{
  "spec": "specs/parking-app.md",
  "screens": ["Save Spot","Find Car"],
  "models": ["openai:gpt-image-1","google:imagen-3"],
  "items": [
    {
      "id": "save-spot_openai_v1",
      "screen": "Save Spot",
      "model": "openai:gpt-image-1",
      "variant": 1,
      "promptHash": "sha256:…",
      "path": "runs/.../generate/openai/screen-save-spot_v1.png",
      "seed": 123
    }
  ]
}
```

---

## 8) Scoring & Selection

* **Default rubric** from `abe.config.json` (weights sum to 1.0).
* **LLM‑JSON enforcement**: wrap critique prompt with “Return **valid JSON** only (no prose).”
* **Selection**:

  * `topK`: keep N highest `weightedTotal`.
  * `threshold`: keep all with score ≥ X.
  * Ties broken by `task_fitness` > `a11y` > `hierarchy`.

---

## 9) Variations & Exploration Strategy

* **Diverse prompts**: auto‑produce small **prompt deltas** per variant: layout bias, type bias, accent color tweaks (±10% saturation), density (compact vs spacious).
* **Model fan‑out**: include at least one render‑heavy and one diagrammatic model where available.
* **Seeds**: different seeds per variant where supported.
* **Reproducibility**: store seed, variant descriptor, prompt hash.

---

## 10) Error Handling & Guardrails

* **Retry** transient provider errors with backoff (max 3).
* **JSON parse recovery** for critique: attempt to extract JSON via regex; if invalid, re‑ask once with a stricter instruction.
* **Quota awareness**: respect `--concurrency` and surface per‑provider rate limits.
* **Security**: when users pass prompts via CLI, store them in `logs.jsonl` unless `--redact-prompts` is set (then store only a hash).

---

## 11) Outputs & Developer Ergonomics

* All images (PNG), critiques (JSON), and summaries (MD) are saved under `runs/<id>/…`.
* `critique/summary.md` renders a leaderboard with table: image path, model, screen, total score, per‑criterion mini‑scores, and `revisePrompt`.
* `abe models` reveals current alias ↔ models mapping (from config).

---

## 12) Examples

* **One‑shot generate**:

```bash
abe generate --spec specs/parking-app.md --models baseline --variants 3
```

* **Critique a single image**:

```bash
abe critique --image runs/.../generate/openai/screen-save-spot_v2.png \
             --critique-prompt-file prompts/critique_strict_accessibility.txt
```

* **Best‑effort pipeline**:

```bash
abe run --pipeline pipelines/best-effort.json
```

---

## 13) Not‑a‑Framework Philosophy

* A **Node.js CLI** using the `ai` package. No heavy agent framework.
* Small, explicit tasks you can compose, inspect, and test.
* Everything saved to disk, reproducible, scriptable.

---

## 14) Future Nice‑to‑Haves

* Simple CV/heuristics (approx contrast, tap target bounds).
* HTML export of leaderboard with thumbnails.
* Figma export (attach best variants with metadata).
* Notion sync of summary + top picks.

