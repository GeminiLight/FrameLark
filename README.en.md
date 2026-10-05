# FrameLark · 帧好

![FrameLark: From first look to finished image. With Xiaozhen, our photography companion](docs/images/framelark-banner.png)

**Find scenes, refine photographs, and curate a series with Xiaozhen.**

FrameLark offers a Codex plugin, standalone skills, and a browser studio to help you take a photograph from an idea to a finished image.

[简体中文](README.md) · [Get started](#get-started) · [User guide](docs/USAGE.en.md)

## Creative tools

| What you want to do | How Xiaozhen helps |
| --- | --- |
| **[Find scenes · Photography Eye](#photography-eye-demo)** | Discover worthwhile photographs in a scene, with viewpoints, composition, timing, and camera settings. |
| **[Refine photos · Retouch Desk](#photo-retouch-demo)** | Work on light, color, cropping, and local details; customize a look and compare candidates before accepting. |
| **[Curate a series · Series Album](#photo-series-demo)** | Define a theme, select varied images, refine each one, and arrange a sequence that holds together. |

People, wider scenes, and small details can belong in the same set. Photography Eye uses the `photography-eye` skill; Retouch Desk and Series Album use `photo-retouch`.

Xiaozhen · 小帧 is FrameLark’s curious little bird and photography companion. [Meet Xiaozhen](docs/WEB_DESIGN.md#品牌与小帧) (Chinese)

<a id="codex-plugin"></a>

## Get started

**For Codex, install the unified plugin to get both skills and the local retouching tools.**

You need **Node.js 20.9+ with npm, Git, and a Codex CLI that supports plugins**. Check `codex plugin --help`; if the command is missing, see [prerequisites](docs/INSTALLATION.en.md#prerequisites).

Run in a terminal:

```sh
git clone https://github.com/GeminiLight/FrameLark.git
cd FrameLark
npm run plugin:install
```

After installation, **open a new chat** and confirm FrameLark is enabled. Attach a photograph or provide a photo-folder path, then try the [examples below](#usage-examples).

The plugin uses your current agent for vision and conversation, with no additional model API key. It checks whether the host supports optional image generation or editing and skips those steps when unavailable. Installation uses the repository marketplace; FrameLark is not yet listed in OpenAI’s universal directory.

### Other ways to use FrameLark

Run these commands in the repository above. Choose the entry point that suits you.

| Entry point | How to start |
| --- | --- |
| <a id="agent-skill"></a>Standalone skills | Run `npm run install:skills` to install into `~/.codex/skills/` by default; [individual skills, other hosts, and updates](docs/INSTALLATION.en.md#standalone-skills). |
| <a id="web-ui"></a>Browser studio | Run `npm start`, then open [localhost:3177](http://localhost:3177) to upload, refine, compare, and export. |

Manual browser editing needs no model key. Connect a visual model in settings for the AI advisor. Scene-scouting guidance is currently provided through the Photography Eye skill.

## Usage examples

<a id="photography-eye-demo"></a>

### Find scenes · Photography Eye

Attach a scene photo and describe your equipment and intent:

> Use FrameLark to explore this staircase and its light and shadows. Suggest different compositions and finishing directions.

![Photography Eye: five staircase compositions around layered space, warm light, and handrail lines](docs/images/showcase/photography-eye.png)

Explore layered space, slices of warm light, and handrail lines, with framing, camera settings, and finishing advice. This board shows AI shot goals that need a real reshoot.

<a id="photo-retouch-demo"></a>

### Refine photos · Retouch Desk

Attach the original and explain what to keep and improve:

> Use FrameLark to refine this photo. Preserve the morning light and mountain layers, make the person a little clearer, and show me a trial first.

![Retouch Desk: a real comparison of the original and a saved retouch](docs/images/showcase/photo-retouch.png)

Review, preview crop, color, and local adjustments, compare details, then accept and export. The screenshot compares the built-in original with a saved retouch.

<a id="photo-series-demo"></a>

### Curate a series · Series Album

Provide a photo folder, its purpose, the image count, and required photographs:

> Use FrameLark to make a nine-image grid from this folder. Define a theme, select photos, refine each one, and arrange the sequence. Preserve the originals.

![Series Album: set the intent, arrange photographs, and refine each image](docs/images/screenshots/series-workspace.png)

Get a selection, sequence, and finished set around your theme. This screenshot uses two cat and coffee samples to demonstrate a quiet daily-life series.

[Example sources and capture notes](docs/SCREENSHOTS.md#三个能力的使用示例) (Chinese)

## Studio preview

![FrameLark studio: photo preview and the Xiaozhen advisor](docs/images/screenshots/studio-overview.png)

An actual screenshot of the current local studio, using its built-in example with no visual model connected. [More screenshots and capture notes](docs/SCREENSHOTS.md) (Chinese)

## Documentation

| What you need | Where to look |
| --- | --- |
| Installation, updates, and troubleshooting | [Installation guide](docs/INSTALLATION.en.md) · [Plugin distribution](docs/PLUGIN.md) |
| Photography, retouching, series, and delivery | [User guide](docs/USAGE.en.md) |
| Composition, color, and photographer references | [Photography knowledge](docs/USAGE.en.md#photography-knowledge) |
| Local hosting, model settings, and deployment | [Deployment](docs/DEPLOYMENT.md) |
| Development, tests, and contributions | [Architecture](docs/ARCHITECTURE.md) · [Contributing](CONTRIBUTING.md) · [Validation](docs/VALIDATION.md) |

Installation and usage guides are available in English; technical and photography references are currently in Chinese.

## Contributors

Thanks to [Yijie Xu (@yeahjack)](https://github.com/yeahjack) for selective edit acceptance, parameter and local-layer locks, protected regions, and rendering and preview responsiveness improvements: [#1](https://github.com/GeminiLight/FrameLark/pull/1), [#2](https://github.com/GeminiLight/FrameLark/pull/2).
