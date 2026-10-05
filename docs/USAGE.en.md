# Use FrameLark

Choose a workflow for the photograph you want to make. Photography Eye uses `photography-eye`; Retouch Desk and Series Album share `photo-retouch`. There is no third skill to install.

[Home](../README.en.md) · [简体中文](USAGE.md) · [Installation](INSTALLATION.en.md)

## Find scenes · Photography Eye

Attach a scene photo and describe your equipment, intent, and whether you can move:

> Use $photography-eye to find photographs here. I am using a phone and can walk around. Suggest different shots: where to stand, camera height, framing, settings, and how to finish the image afterward.

Photography Eye offers viewpoints, angles, timing, settings, and finishing targets. A full board normally contains one recommendation and four alternatives. Choose a direction, take another photograph, and compare composition and light.

Scene-scouting guidance is currently available through the skill, rather than the website. Hand the photographs to photo-retouch for actual pixel editing. See the [Photography Eye entry point](../skills/photography-eye/SKILL.md).

## Refine photos · Retouch Desk

Attach the original and explain its purpose, the feeling you want to keep, and anything that must be preserved:

> Use $photo-retouch to refine this photo for sharing. Keep real skin tones and natural light. You may adjust the crop, background brightness, and color. Review it first, then show candidates I can compare.

A retouching session usually follows this order:

1. Inspect the original, explain its subject, light, composition, and distractions, and identify what to preserve.
2. Establish a finishing direction and preview crop, tone, color, and local adjustments.
3. Compare the original and candidates, inspect individual-image details, and refine from annotations.
4. Accept a candidate, save a version, and export for the intended use.

Adjust preset strength or customize parameters. Select individual proposal items, preview their combined result, and accept one version. Parameters and local layers can be locked. Region protection preserves an accepted pixel core; crop and straightening are locked while protection is active, and unlocking is previewed. See [controlled editing](CONTROLLED_EDITS.md).

The browser studio also supports manual editing. For agent collaboration, mark regions and leave comments. The agent must read the current version, intent, and all latest annotations before continuing. See the [retouching skill](../skills/photo-retouch/SKILL.md).

## Curate a series · Series Album

Explain the purpose, number of images, theme preferences, and required photographs:

> Use $photo-retouch to make a nine-image grid from this folder. Define a theme, select nine varied images that belong together, and refine each one. Keep the second group portrait. Preserve the originals, save selected copies and finished photos separately, and show a preview of the set.

Define the theme, shortlist from contact sheets, inspect individual candidates, refine each photograph, and then review the sequence. People, wider scenes, and details can work together. Consider variation, light and color relationships, and repetition.

Travel sharing, portraits, events, product catalogs, portfolios, and archives need different selection criteria. A story or one shared preset is optional.

| Entry point | Scope |
| --- | --- |
| Skill | Select from folders of up to 500 files per batch, with 20 contact-sheet thumbnails per page. Record selected, reserve, and excluded decisions, inspect individual images, and export in order. |
| Browser series workspace | Work with 2–12 already selected images: set purpose and intent, sequence them, review, preview, and export. You can keep your own order. |

Changes to the theme, saved photographs, or annotations make earlier curation stale and require another review. Failed exports can be retried individually. Originals stay intact; nothing is published automatically.

[Theme-led series](../skills/photo-retouch/references/theme-led-series.md) · [Selection and sequencing](../skills/photo-retouch/references/collection-craft.md) · [Collection tools](../skills/photo-retouch/references/collection-tools.md)

## Optional AI finishing

The skill first checks whether the host provides usable image-generation or editing tools. When unavailable, it skips those steps and continues with original-photo retouching.

When available, it can generate multiple trials or a finishing board in one call, covering crop, lighting, local work, and texture. Inspect each panel’s details and pixel quality before treating it as a reference or deliverable. A board does not guarantee an independently high-resolution image in every panel or replace final review against the originals.

Original-pixel processing and generative image editing are different workflows; delivery should explain which was used. See [multi-image trials and AI finishing](../skills/photo-retouch/references/generated-reference.md).

## Annotations, versions, and collaboration

Mark regions, leave comments, compare candidates with the current version, then accept or discard. Named versions support saving, comparison, and restoration; export records remain in the project.

The local studio can share file projects with the skill. Run `npm run setup` in the repository, then use **文件项目** in the studio to save the current photograph or open an existing project. An agent can open the same project with:

```sh
npm run photo -- studio --project /path/to/photo-project
```

File projects share annotations, candidates, versions, and export records, with concurrent-edit checks. Originals are stored separately; candidates become current only after acceptance. Browser drafts remain separate and are not migrated unless selected.

“Continue with Agent” saves intent and annotations and records a handoff request. An agent claims the request, works on it, and returns real candidates. Projects with diagnosis, audits, lettering, or protection open in the full studio’s collaboration editor. The host agent owns model execution and visual judgment. See [shared projects](DEPLOYMENT.md#网页与-skill-共享文件项目) and [handoff requests](DEPLOYMENT.md#给-agent-留下可接续的请求).

## Tools and file limits

| Feature | Support |
| --- | --- |
| Light, color, and styles | 31 global controls, 14 presets, a separate style layer, and adjustable strength. |
| Crop and local work | Cropping, straightening, rectangular / radial / gradient geometric masks, and feathering. |
| Viewing and comparison | Originals and versions, matched position and magnification, 100% viewing, zoom, and pan. |
| Annotations and collaboration | Region comments; read the latest version and annotations before continuing. |
| Projects and versions | Candidate previews, accept / discard, named versions, restoration, and export records. |
| Review and continuation | Structured diagnosis, combination-specific audits, adjustment sources, and project exchange. |
| Optional lettering | Short captions, stickers, or titles on a separate layer, with clean and lettered exports. Ordinary retouching does not add text. [Lettering guide](../skills/photo-retouch/references/lettering.md) |

**Input:** static JPEG, PNG, WebP, and AVIF, in 8-bit sRGB; at most 30 MB, 50 megapixels, and a 16384 px longest edge per image. The studio accepts at most 12 images and 100 megapixels in total.

**Output:** PNG / JPEG with sharing, printing, and original-size presets; at most 8192 px / 16 megapixels without upscaling. The original-size preset has the same limits.

The macOS local workspace can convert static HEIC / HEIF images and preserve the original bytes. Other environments, RAW, and TIFF require conversion first. The local pixel tools do not provide RAW development, a 16-bit workflow, automatic subject segmentation, or generative object editing. Optional host image-editing capabilities depend on the tool available.

Local image tools make no model API requests and preview only on `127.0.0.1`. Host vision and image-editing tools follow their own data-handling rules. The studio’s AI sends analysis images and related intent or annotations to your configured model service. Explicit choices remain in photo projects and can be organized into a local preference file on request, without automatic training or preference uploads.

## Photography knowledge

References cover judgment, composition, subjects, light, color, local work, selection, delivery, and photographer studies. Photographer references guide observation and style learning; they are not official filters or exact reproductions. The references below are currently in Chinese.

| Topic | Documents |
| --- | --- |
| Judgment and composition | [Aesthetic judgment](../skills/photo-retouch/references/aesthetic-judgment.md) · [Composition](../skills/photo-retouch/references/composition-craft.md) |
| Subjects and scenes | [Subject playbooks](../skills/photo-retouch/references/subject-playbooks.md) |
| Collections | [Purpose, selection, and sequencing](../skills/photo-retouch/references/collection-craft.md) · [Contact sheets and tools](../skills/photo-retouch/references/collection-tools.md) |
| Light, color, and detail | [Light and color](../skills/photo-retouch/references/light-color.md) · [Local work and output](../skills/photo-retouch/references/detail-local-crop.md) |
| Styles and sources | [Style atlas](../skills/photo-retouch/references/style-atlas.md) · [Sources](../skills/photo-retouch/references/sources.md) |
| Cases and feedback | [Casebook](../skills/photo-retouch/references/casebook.md) · [Learning records](../skills/photo-retouch/references/learning-memory.md) |
| Calibration and delivery | [Visual examples](../skills/photo-retouch/references/visual-examples.md) · [Diagnosis, review, and exchange](../skills/photo-retouch/references/reviewed-workflow.md) |
| Video | [Color and editing guidance](../skills/photo-retouch/references/video-craft.md) |

Search from the repository directory:

```sh
node skills/photo-retouch/scripts/knowledge.mjs search --query '滨田英明 柔光人像 肤色'
node skills/photo-retouch/scripts/knowledge.mjs read --id style-daily-soft
```

Local keyword search makes no model requests; review still requires the agent to inspect images. Video guidance supports planning. Execution needs other host media tools; this photo CLI does not import or export video.

[Screenshots](SCREENSHOTS.md) · [Architecture](ARCHITECTURE.md) · [Development and checks](../CONTRIBUTING.md) · [Validation](VALIDATION.md)
