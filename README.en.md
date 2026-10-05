# FrameLark · 帧好

![FrameLark · 帧好 — From first look to finished image. With Xiaozhen, our photography companion](docs/images/framelark-banner.png)

[![Install the Codex plugin](https://img.shields.io/badge/Codex_Plugin-Install-DDA26C?style=for-the-badge&labelColor=2B2C34)](#codex-plugin)
[![Open the Online Demo](https://img.shields.io/badge/Online_Demo-Open_Studio-CDBB9E?style=for-the-badge&logo=vercel&logoColor=white&labelColor=2B2C34)](https://ai-photography-preview-geminilights-projects.vercel.app/ "Online demo · Vercel access required")
[![Install standalone skills](https://img.shields.io/badge/Agent_Skill-Install-6C6A86?style=for-the-badge&labelColor=2B2C34)](#agent-skill)
[![Start the local Web UI](https://img.shields.io/badge/Web_UI-Local-686D79?style=for-the-badge&labelColor=2B2C34)](#web-ui)
[![Deploy to Vercel](https://img.shields.io/badge/Deploy-Vercel-2B2C34?style=for-the-badge&logo=vercel&logoColor=white)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FGeminiLight%2FFrameLark)
[![Browse photography knowledge](https://img.shields.io/badge/Photo_Knowledge-Browse-75677D?style=for-the-badge&labelColor=2B2C34)](#photography-knowledge)

**Photography guidance and retouching through a unified Codex plugin, standalone skills, or a browser studio.**

Upload photos, adjust color, compare styles, curate a series, and export in your browser. Your own visual agent can also use the Skill to work with originals, annotations, and saved versions. The frontend, AI routes, and Skill source are all included in this repository.

[简体中文](README.md) · [Get started](#get-started) · [Capabilities](#capabilities) · [Interface](#interface) · [Photography knowledge](#photography-knowledge)

## Get started

**For Codex, install the unified plugin to get photography-eye and photo-retouch together.** Choose standalone skills for another compatible agent, or the Web UI for hands-on browser editing. Pick one entry point.

| How you want to work | Start | What you get |
| --- | --- | --- |
| Photography guidance and retouching in Codex (recommended) | [Unified plugin](#codex-plugin) | Both skills, knowledge, and portable retouch tools |
| Standalone skills or another compatible agent | [Install skills](#agent-skill) | Both skills together, or either one individually |
| Manual browser editing and comparison | [Web UI](#web-ui) | A complete studio; connect a visual model for its AI advisor |

### Prerequisites

Local retouching needs **Node.js 20.9+ with npm**. Cloning needs Git. Plugin installation also needs a Codex CLI with `codex plugin` support: check `codex plugin --help`, or follow the [official CLI setup](https://learn.chatgpt.com/docs/codex/cli). Installing the desktop application alone does not ensure `codex` is on your terminal’s PATH.

The skills use your existing agent for vision and conversation; they do not require another model API key. Optional image generation depends on the host. The Web UI’s built-in advisor has its own connection settings.

Commands below use macOS / Linux shell syntax. Download the repository:

```sh
git clone https://github.com/GeminiLight/FrameLark.git
cd FrameLark
```

<a id="codex-plugin"></a>

### Install the Codex plugin (recommended)

```sh
npm run plugin:install
```

Success reports `ok: true`, both skill names, and `retouchDependencies: ready`. **Open a new chat**, confirm FrameLark is enabled in the plugin / skill list, then attach an image:

> Use FrameLark to find different photographs here. Explain the viewpoints, camera settings, and finishing directions.

> Use FrameLark to refine this photograph. Preserve the feeling I like; review the original and show candidates I can compare.

You can also ask an existing Codex chat to register GeminiLight/FrameLark as a marketplace and install `framelark@framelark`. [Direct installation commands, verification, and ZIP distribution](docs/PLUGIN.md). This uses a repository marketplace; FrameLark is not yet listed in OpenAI’s universal directory.

<a id="agent-skill"></a>

### Install standalone skills

The plugin already includes both skills. Choose this route for standalone use or an agent without Codex plugin support.

Install both into `~/.codex/skills/`:

```sh
npm run install:skills
```

Install retouching only:

```sh
npm run install:skill
```

Install photography guidance only:

```sh
npm run install:photography-eye
```

Reload the skill list or open a new chat. The defaults are `~/.codex/skills/photo-retouch` and `~/.codex/skills/photography-eye`. Photography-eye needs no extra image-processing dependencies; photo-retouch prepares its pinned dependencies during installation. Use an agent that can see images and run local tools:

> Use $photography-eye to find worthwhile photographs here. Tell me where to stand, how to frame them, and which settings to use.

> Use $photo-retouch to review this photograph, explain what to preserve, and show adjustments I can preview.

To update, keeping backups:

```sh
npm run install:skills -- --update
```

For another compatible host, replace its **skills root directory** below:

```sh
npm run install:skills -- /your/agent/skills
```

Existing single-skill destination syntax remains supported:

```sh
node scripts/install-photo-skill.mjs /your/agent/skills/photo-retouch
node scripts/install-photo-skill.mjs --skill photography-eye /your/agent/skills/photography-eye
```

An old `guangjian-retouch` installation can be backed up and migrated with `npm run install:skill -- --update`. See [retouching workflows](skills/photo-retouch/SKILL.md) and [photography guidance](skills/photography-eye/SKILL.md) for the complete usage.

<a id="web-ui"></a>

### Start the Web UI

```sh
npm start
```

Open **http://localhost:3177**. The browser studio uses Node’s built-in modules and needs no dependency installation or model key for manual editing, crop, styles, and export. Configure a visual model in the studio to enable diagnosis and its AI advisor. Run `npm run setup` when sharing local file projects with the skill.

[Deployment, Docker, and model settings](docs/DEPLOYMENT.md). The [Online Demo](https://ai-photography-preview-geminilights-projects.vercel.app/) currently requires Vercel access; use the local studio if access is unavailable.

### If setup does not work

| Symptom | Next step |
| --- | --- |
| `codex` is missing or has no `plugin` command | Install / update the CLI, or choose standalone skills; the Web UI does not require Codex |
| A skill is already installed | Add `--update` to preserve a backup and replace it |
| The new plugin / skill is not listed | Open a new chat, or refresh / restart the host as needed |
| Native dependency download fails | Check Node and npm connectivity, then retry; previous skills stay intact until preparation succeeds |
| Image generation or vision is unavailable | Skills skip unavailable generation; the Web UI keeps manual tools, and basic color statistics do not replace visual review |

## Meet Xiaozhen · 小帧

**Xiaozhen is FrameLark’s photography companion: a curious little bird with an eye for photographs.** It helps you notice light, consider composition, and refine the feeling you want to keep.

Its graphite feathers, cream chest, apricot wings, and upward gaze stay consistent. The pencil texture adds warmth to the welcome screen, advisor avatar, and agent darkroom while your photograph remains the focus. The product is **FrameLark · 帧好**; the companion is **Xiaozhen · 小帧**.

[Transparent avatar](apps/studio/public/assets/xiaozhen-avatar.png) · [Character guidelines](docs/WEB_DESIGN.md#品牌与小帧)

## Find your next photograph

Attach a scene photo and use the project’s [photography-eye skill](skills/photography-eye/SKILL.md):

> Use $photography-eye to find different photographs here. Tell me where to stand, how high to hold the camera, how to frame the shot, which settings to use, and how to finish the image afterward.

The skill offers viewpoints, timing, settings, and finishing targets, normally with one recommended image and four alternatives. Codex discovers it through `.agents/skills/photography-eye`. This scene-scouting workflow is currently available as a project skill.

## Theme-led selection and optional AI finishing

For a series, define its theme, choose varied images that belong together, refine each photograph, then review the sequence. People, wider scenes, and details can work together; a nine-image grid need not repeat one subject. See the [series workflow](skills/photo-retouch/references/theme-led-series.md).

The retouching skill checks which image-generation or editing tools the host actually provides. If none are available, it continues with the originals. When useful, it can generate a multi-image finishing board in one call, then review each panel before using it as a reference or deliverable. Individual panels still need adequate pixels and detail; see [AI finishing](skills/photo-retouch/references/generated-reference.md).

## Capabilities

### From a folder of photos to a finished set

Ask your agent to review a folder, select a set for a stated purpose, keep specific moments, propose an order, and preview a shared direction before editing. The skill creates stable-ID contact sheets, records selected / reserve / excluded decisions with visual reasons, and exports saved versions in sequence with a manifest. Originals stay intact; nothing is published automatically.

Supported workflows include travel stories, portraits, events, product catalogs, portfolios, and archives. A story or a shared preset is optional. Current intent takes priority over previous preferences.

- **Skill:** up to 500 files per batch, 20 thumbnails per page. The host supplies visual judgment; detail decisions require individual image inspection. Failed exports can be retried separately.
- **Web UI:** a 2–12 photo workspace for already selected images, with purpose, intent, sequencing, previews and ordered export. Manual order is respected.
- Changes to the brief, saved images or annotations make earlier curation stale. Browser drafts remain separate; shared file projects synchronize with the Skill.

[Collection workflow](skills/photo-retouch/references/collection-craft.md) · [CLI and tool contracts](skills/photo-retouch/references/collection-tools.md) (Chinese)

![The photo-series workspace: purpose, intent, manual order, and individual inspection.](docs/images/screenshots/series-workspace.png)

| Feature | Support |
| --- | --- |
| Light, color, and styles | 31 global controls, 14 presets, a separate style layer, and adjustable strength. |
| Cropping and local work | Cropping, straightening, rectangular / radial / gradient geometric masks, and feathering. |
| Viewing and comparison | Originals and versions, matched position and magnification, 100% viewing, zoom, and pan. |
| Annotations and collaboration | Region comments; the agent reads the current version, intent, and all latest annotations before continuing. |
| Projects and versions | Candidate previews, accept / discard, named versions, restoration, and export records. |
| Review and continuation | Structured diagnosis, combination-specific audits, adjustment sources, and compatible project exchange. |

- **Input:** static JPEG, PNG, WebP, and AVIF; 8-bit sRGB. Up to 30 MB, 50 megapixels, and a 16384 px longest edge.
- **Output:** PNG / JPEG with sharing, printing, and original-size presets. At most 8192 px / 16 megapixels, without upscaling; the original-size preset has the same limits.
- **HEIC / HEIF:** The macOS local workspace can convert static images. Other environments, RAW, and TIFF require conversion first. RAW development, a 16-bit workflow, automatic subject segmentation, and generative object editing are not supported.

Local tools make no model API requests. The preview listens only on `127.0.0.1`. Explicit user choices live in photo projects and can be organized into a local preference file on request, without automatic training or uploads.

## Selective edits and preservation

Select individual proposal items, preview the combined result, and accept one atomic version. Lock manual and effective style-adjusted parameters, or preserve an accepted rectangular/radial pixel core with an outward feather. Unlocking is previewed; crop/rotation changes are blocked while pixel protection is active. CLI, host JSON tools, and Web UI share validation.

See [controlled editing](docs/CONTROLLED_EDITS.md) for guarantees, migration, and verification limits.

## Optional lettering

Lettering is a separate mode, enabled only when requested. Keep the retouched photograph and preview short captions, cream-colored stickers, or small editorial titles before accepting. The local Web UI supports text, placement, size, color, and small heart or sparkle accents. Export with or without lettering; ordinary photo edits never add text automatically.

```text
Use $photo-retouch to add “A little joy” to this retouched photo.
Try a small cream-colored sticker in the negative space, away from the subject.
Show me the trial and keep a clean edition.
```

Fonts are supplied by the host computer; Chinese text requires an installed CJK font. See the [lettering guide](skills/photo-retouch/references/lettering.md).

## Interface

**Complete studio**: started with `npm start`, using the same source as the online application. The screenshot shows the built-in example with no visual model configured.

![Complete studio: photo navigation, retouching, learning, preferences, and review.](docs/images/screenshots/studio-overview.png)

**Agent darkroom**: compare candidates in a file-based project with your own agent.

**Manual retouching**

![Local Web UI: the full photograph and light/color controls.](docs/images/screenshots/darkroom-edit.png)

<details>
<summary>Annotations, comparison, and export</summary>

**Annotations:** each marker has its own region and comment.

![Separate markers for the person and morning light, with two comments.](docs/images/screenshots/darkroom-annotations.png)

**Comparison:** current version on the left, unaccepted trial on the right.

![The current version and candidate share position and magnification.](docs/images/screenshots/darkroom-compare.png)

**Export:** choose the purpose, format, size, and quality.

![The sharing preset produces a 1448 × 1086 JPEG.](docs/images/screenshots/darkroom-export.png)

</details>

Actual local-interface screenshots using the built-in demo image. [Capture notes](docs/SCREENSHOTS.md)

## Photography knowledge

169 sections cover 10 subject and scene playbooks, look development and result review, collection curation and delivery, with learning references from 10 photographers. These references guide observation; they are not official presets or exact reproductions.

<details>
<summary>Knowledge directory and search</summary>

References are currently written in Chinese.

| Topic | Documents |
| --- | --- |
| Judgment and composition | [Aesthetic judgment](skills/photo-retouch/references/aesthetic-judgment.md) · [Composition](skills/photo-retouch/references/composition-craft.md) |
| Subjects and scenes | [Subject playbooks](skills/photo-retouch/references/subject-playbooks.md) |
| Collections | [Purpose, curation and sequencing](skills/photo-retouch/references/collection-craft.md) · [Local collection tools](skills/photo-retouch/references/collection-tools.md) |
| Light, color, and detail | [Light and color](skills/photo-retouch/references/light-color.md) · [Local work and output](skills/photo-retouch/references/detail-local-crop.md) |
| Styles and sources | [Style atlas](skills/photo-retouch/references/style-atlas.md) · [Sources](skills/photo-retouch/references/sources.md) |
| Cases and feedback | [Casebook](skills/photo-retouch/references/casebook.md) · [Learning records](skills/photo-retouch/references/learning-memory.md) |
| Calibration and delivery | [Visual examples](skills/photo-retouch/references/visual-examples.md) · [Diagnosis, review and exchange](skills/photo-retouch/references/reviewed-workflow.md) |
| Video | [Color and editing knowledge](skills/photo-retouch/references/video-craft.md) |

```sh
node skills/photo-retouch/scripts/knowledge.mjs search --query 'Hideaki Hamada portrait skin'
node skills/photo-retouch/scripts/knowledge.mjs read --id style-daily-soft
```

Local keyword search makes no model requests; review still requires the agent to inspect the image. Video guidance supports planning. Execution needs other host media tools; this photo CLI does not import or export video.

</details>

<details>
<summary>Architecture</summary>

```mermaid
flowchart LR
    person[You] <--> studio[Complete studio]
    studio --> api[Visual model API]
    person <--> ui[Agent darkroom]
    person <--> agent[Your visual agent]
    skill[Photography skill] --> agent
    agent -->|Tool Use| cli[Local CLI]
    ui <--> project[Photo project and versions]
    cli <--> project
```

The agent darkroom and CLI share file-based project records. Originals are stored separately. A candidate becomes current only after acceptance; changes to the base version or annotations invalidate old candidates. The complete studio uses browser drafts and connects its advisor to the configured visual model through server-side routes.

</details>

## Development

| Directory | Contents |
| --- | --- |
| `apps/studio` | Complete Web workspace and server |
| `api` | Vercel function adapters |
| `skills` | Standalone photo-retouch and photography-eye skills |
| `scripts` / `test` | Developer tools, quality checks and tests |
| `docs` | Architecture, deployment, design and screenshots |

[Repository structure and dependencies](docs/ARCHITECTURE.md)

```sh
npm run setup
npm run architecture:check
npm run engine:check
npm run knowledge:check
npm test
```

`npm run test:web` checks the complete studio, AI routes, and photo processing. `npm run test:skill` checks projects, selective editing, protections, rendering, and knowledge retrieval. `npm test` runs both. Licensed Web photo fixtures and generated Skill charts are kept separately. See [validation scope](docs/VALIDATION.md).

[Contributing](CONTRIBUTING.md) · [Skill entry point](skills/photo-retouch/SKILL.md) · [CLI and JSON reference](skills/photo-retouch/references/tools.md)

## Contributors

Thanks to [Yijie Xu (@yeahjack)](https://github.com/yeahjack) for selective edit acceptance, parameter and local-layer locks, protected regions, and rendering and preview responsiveness improvements: [#1](https://github.com/GeminiLight/FrameLark/pull/1), [#2](https://github.com/GeminiLight/FrameLark/pull/2).

## Shared local projects

After `npm run setup`, use **文件项目** in the Web workspace to save the current photo or open an existing Skill project. Both surfaces share annotations, candidates, saved versions and export records, with revision checks for concurrent edits. `npm run photo -- studio --project /path/to/project` returns a link to the same project in the complete workspace. Protected or lettering projects continue in the standalone darkroom.

The macOS local workspace can convert static HEIC/HEIF images with the system decoder and preserve original bytes. Other platforms, RAW and TIFF still require conversion.

### Continuing with an agent in the local studio

Local file projects now open reviewed workflows, text overlays, and protected edits inside the full studio's collaboration editor. The native project runtime remains authoritative; advanced edits are not flattened into browser snapshots. The standalone `serve` command remains available.

“Continue with Agent” stores a handoff request and copies project context. Use `handoff` to claim work, report progress, and return real candidates; `watch --project <folder> --timeout 60` waits for requests or project changes. The host agent owns model execution and visual assessment. Human acceptance, cancellation, revision checks, and audit requirements remain separate.
