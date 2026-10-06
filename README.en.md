# FrameLark · 帧好

**[Website](https://tianfuwang.tech/FrameLark/) · [Browser photo editor](https://tianfuwang.tech/FrameLark/studio/)**

![FrameLark: From first look to finished image. With Xiaozhen, our photography companion](docs/images/framelark-banner.png)

**Your AI photography companion. Find scenes, refine photographs, and curate a series with Xiaozhen.**

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

**Install one plugin for shooting guidance, photo retouching, and series creation.**

### Install

Recommended: ask your local Codex agent to install it:

> Install the FrameLark plugin from https://github.com/GeminiLight/FrameLark. Check my environment, prepare the local retouching tools, and tell me how to start.

For manual installation, you need **Node.js 20.9+ with npm, Git, and a Codex CLI that supports plugins**. Run:

```sh
git clone https://github.com/GeminiLight/FrameLark.git
cd FrameLark
npm run plugin:install
```

### Start a conversation

**Open a new chat**, then attach a photo or provide an accessible photo folder:

| Input | What to say |
| --- | --- |
| A scene photo | Use FrameLark to show me how to shoot here. |
| An existing original | Use FrameLark to retouch this for sharing. Show me a trial first. |
| A photo folder | Use FrameLark to create a nine-image series. Define a theme and preserve the originals. |

Follow up with “I like P3—where should I stand?”, “Soften this background”, or “Use this version and export it.” Vision and optional generation use your current agent, without another model key. Without generation tools, you still receive shooting advice.

Installation uses the repository marketplace. [Setup and updates](docs/INSTALLATION.en.md) · [Full guide](docs/USAGE.en.md) · [Examples](#usage-examples)

### Other ways to use FrameLark

For standalone skills or the browser studio, download this repository first and run the commands inside it:

| Entry point | How to start |
| --- | --- |
| <a id="agent-skill"></a>Standalone skills | Run `npm run install:skills` to install into `~/.codex/skills/` by default; [individual skills, other hosts, and updates](docs/INSTALLATION.en.md#standalone-skills). |
| <a id="web-ui"></a>Browser studio | Run `npm start`, then open [localhost:3177](http://localhost:3177) to upload, refine, compare, and export. |

Manual browser editing needs no model key. Connect a visual model in settings for the AI advisor. Scene-scouting guidance is currently provided through the Photography Eye skill.

## Usage examples

<a id="photography-eye-demo"></a>

### Find scenes · Photography Eye

Attach a scene photo and ask how to shoot:

> Use FrameLark to show me how to shoot this staircase.

![Photography Eye: five staircase compositions around layered space, warm light, and handrail lines](docs/images/showcase/photography-eye.png)

With image generation available, the skill creates a five-option reference board and shooting directions by default. This staircase example explores space, warm light, and lines; its AI shot goals need a real reshoot.

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

