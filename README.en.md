# Frameyn · 帧映

![Frameyn — An eye for every frame.](assets/frameyn-cover.svg)

**Give your agent an eye for photography.**

Frameyn is a photography review and retouching skill for your existing visual agent. Tell it what you want a photograph to express. It reviews the actual image, explains what to preserve, and uses local tools to produce editable previews. Mark a region, leave a comment, and refine the result together.

[简体中文](README.md) · [Quick start](#quick-start) · [Photography knowledge](#photography-knowledge) · [Tool reference](skills/guangjian-retouch/references/tools.md)

## From understanding a photograph to choosing a version

| Step | What you can do |
| --- | --- |
| **Review** | Examine subject, background, light, composition, visual order, and mood. A photograph that already works can receive a recommendation to keep it as it is. |
| **Preview** | Create candidates around an intent such as natural skin tones or a quiet morning atmosphere. Inspect actual results and their tradeoffs. |
| **Refine** | Compare with the original, inspect at 100%, zoom and pan, adjust controls, or annotate a region in the local darkroom. Ask your agent to read the latest comments and continue. |
| **Choose** | Accept or discard candidates, save named versions such as “Natural” or “Film,” restore an earlier version, and export. |

Candidates start from the current version. Global controls, styles, and local adjustments have distinct processing layers. Original image bytes are stored separately; previews and discarded candidates leave accepted versions intact.

## Quick start

You need **Node.js 20.9+** and an agent that can read images, run local tools, and load skills, such as Codex.

### 1. Install

```sh
git clone https://github.com/GeminiLight/frameyn.git
cd frameyn
npm run install:skill
```

The first installation prepares pinned Sharp and native Canvas dependencies. The default destination is `~/.codex/skills/guangjian-retouch`. Reload your host's skill list or start a new task if the skill has not appeared yet.

> **Installation identifier:** the brand and repository are now Frameyn. The skill keeps `guangjian-retouch` for compatibility with existing installations and invocations. The examples below use this working identifier.

### 2. Bring a photograph and an intent

Send this to your agent, replacing the path with your photograph:

```text
Use $guangjian-retouch on /photos/morning.jpg.
Keep the quiet morning atmosphere and natural colors. Review the image first
and explain what is worth preserving. Make changes only when they offer a
clear benefit, and show me candidate previews before accepting them.
```

Your agent reads the image and relevant photography knowledge, creates a local photo project, and returns review observations or candidates. Ask it to open the local darkroom to inspect, annotate, and refine.

### 3. Continue from annotations

Mark regions and save your comments, then return to your agent:

```text
Read all the annotations I just saved.
Make the person a little clearer while keeping the background quiet.
Preserve the warm light I marked. Work from the current version,
explain the changes and tradeoffs, and let me compare the candidate first.
```

Conversation happens in your host agent. The local darkroom provides viewing, annotation, and retouching controls. The agent reads updated annotations when continuing a task; the page does not contain a separate chat model.

<details>
<summary>Update an existing skill or install into another host</summary>

Updates back up the previous skill first:

```sh
npm run install:skill -- --update
```

Choose another compatible host's skill directory:

```sh
node scripts/install-photo-skill.mjs /your/skills/guangjian-retouch
```

This repository contains a standalone skill and local tools. No web application deployment or additional model service is required. Cloning a private repository requires a GitHub account with access.

</details>

## Photography knowledge

Frameyn loads knowledge for the current subject and task: **79 sections, 10 subject and scene playbooks, 14 style presets, and learning references from 10 photographers**.

The guidance explains when a treatment helps and what it costs. A backlit portrait needs a readable subject while preserving the backlight relationship. A style should suit the existing light, subject, and intent. References to Hideaki Hamada, Saul Leiter, Rinko Kawauchi, and others guide observation; photographer names do not imply official presets, licensed recipes, or exact reproductions.

<details>
<summary>Explore the knowledge map</summary>

Reference documents are currently written in Chinese; your host agent can use them in a conversation in your preferred language.

| Question | Reference |
| --- | --- |
| What should change, and what should stay? | [Aesthetic judgment](skills/guangjian-retouch/references/aesthetic-judgment.md) |
| How does the subject or scene affect the approach? | [Subject playbooks](skills/guangjian-retouch/references/subject-playbooks.md) |
| How do hierarchy, space, and framing work? | [Composition and photographic craft](skills/guangjian-retouch/references/composition-craft.md) |
| How should exposure, skin tones, curves, and HSL be handled? | [Light and color](skills/guangjian-retouch/references/light-color.md) |
| How should detail, masks, crops, and output be checked? | [Detail, local adjustments, and cropping](skills/guangjian-retouch/references/detail-local-crop.md) |
| Which styles suit the image, and under what conditions? | [Style atlas](skills/guangjian-retouch/references/style-atlas.md) |
| How should video color, shot matching, editing, and sound be approached? | [Video craft](skills/guangjian-retouch/references/video-craft.md) |
| How are accepted choices and feedback recorded? | [Learning and memory](skills/guangjian-retouch/references/learning-memory.md) |
| What happened in actual cases and reasoning exercises? | [Casebook](skills/guangjian-retouch/references/casebook.md) |
| Where do the references and tool facts come from? | [Sources](skills/guangjian-retouch/references/sources.md) |

Search locally from the repository directory:

```sh
node skills/guangjian-retouch/scripts/knowledge.mjs search --query 'Hideaki Hamada portrait skin'
node skills/guangjian-retouch/scripts/knowledge.mjs read --id style-daily-soft
```

Keyword search does not call a model. Visual review still requires the agent to inspect the actual image.

</details>

## How the agent and local tools work together

| Part | Responsibility |
| --- | --- |
| **Your visual agent** | Read images, understand intent, explain evidence, plan candidates, and continue the conversation from the latest annotations. |
| **The Frameyn skill** | Supply photography knowledge, review workflows, tool instructions, and processing checks. |
| **Local pixel tools and darkroom** | Adjust existing pixels, persist projects and versions, and provide comparison, annotation, manual controls, and export. |

The local tools make no model API requests and require no additional model key. Images shared with your host's visual model follow that host's data handling rules and usage limits. The preview service listens only on `127.0.0.1`. Projects store the photograph, controls, crop, annotations, and versions; restart the same project to continue editing.

Preference records come from accepted choices and currently stay within one photo project. Browsing, previewing, or discarding a candidate does not count as approval. The current creative intent takes priority.

## Current capabilities

| Area | Supported |
| --- | --- |
| Light, color, and style | 31 global controls, an independent style layer, and adjustable style strength. |
| Composition and local work | Cropping, straightening, rectangular / radial / gradient regions, and feathering. Local regions use geometric masks. |
| Input | Static JPEG, PNG, WebP, and AVIF; 8-bit sRGB. Up to 30 MB, 50 megapixels, and a 16384 px longest edge. |
| Output | PNG / JPEG; sharing, printing, and original-size presets. At most 8192 px on the longest edge and 16 megapixels, with no upscaling. |

Convert HEIC, RAW, and TIFF before importing. RAW development, a 16-bit workflow, semantic subject segmentation, and generative object additions or removals are not available. The original-size preset is also subject to the output limits above.

Video references cover color and editing decisions. Actual video execution needs other media tools in the host; this photo CLI has no video timeline or video export.

## Development and validation

```sh
npm run setup
npm run knowledge:check
npm test
```

The existing **15 tests** cover original protection, orientation, candidate conflicts, parameters and local snapshots, named versions, PNG preview/export pixel consistency, local sessions, and knowledge retrieval. Technical tests use generated charts. Actual photo observations are recorded separately; photographic quality still needs inspection for each subject and output size.

[Validation scope](docs/VALIDATION.md) · [Contributing](CONTRIBUTING.md) · [Skill entry point](skills/guangjian-retouch/SKILL.md) · [Tool commands and JSON](skills/guangjian-retouch/references/tools.md)
