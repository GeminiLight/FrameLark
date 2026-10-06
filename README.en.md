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

### Use Photography Eye in your cloud chat

Use the [cloud setup page](https://tianfuwang.tech/FrameLark/cloud.html) to load shooting guidance in a conversation or your own private project. This uses the assistant's existing vision and optional image-generation tools; it does not install a global plugin or local retouching runtime.

Ask an assistant with public-web access to read [CLOUD.md](CLOUD.md) and follow its Photography Eye workflow in this conversation. If it cannot read the link, download the startup text file and attach it instead. Then upload a scene photo and ask how to shoot here. For ongoing use, add the guide and project instructions to your own private project. A new ordinary chat does not automatically inherit this setup. Account availability, tools and usage limits still apply.

**For local plugin use, install Photography Eye on its own for shooting advice. Choose the full plugin for pixel retouching and photo series.**

### Install Photography Eye only

**[Open the Photography Eye installer](https://tianfuwang.tech/FrameLark/install.html)** (Chinese): open a local Codex chat with the installation request already filled in, then send it. No checkout is required. A copyable terminal command is also available.

The standalone **FrameLark Photography Eye** plugin (`framelark-eye`) contains only the `photography-eye` skill, reference material, and Xiaozhen assets. It does not prepare local retouching dependencies. In a local Codex client with plugin support, say:

> Install only framelark-eye@framelark from the latest published GitHub Release at https://github.com/GeminiLight/FrameLark/releases, without cloning the repository. Confirm that it contains only photography-eye. I will open a new chat, attach a scene photo, and ask how to shoot here.

From a checkout, run `npm run plugin:install:photography-eye` to install and verify `framelark-eye@framelark` from GitHub Releases. Use `npm run plugin:install:local:photography-eye` for the local development build. Both installers verify the installed skills and enabled state without preparing retouching dependencies. Open a new chat, attach a scene photo, and ask “How should I shoot here?”

These are local Codex installation instructions. They do not establish direct GitHub installation in an ordinary ChatGPT mobile chat. Eligible workspace admins can import the repository marketplace and make the standalone plugin available to members; account and mobile availability still need verification. [Distribution scope](docs/PLUGIN.md#chatgpt-工作区与手机) (Chinese).

### Install the full plugin

Install one plugin for shooting guidance, photo retouching, and series creation.

Recommended: ask your local Codex agent to install it:

> Install the FrameLark plugin from https://github.com/GeminiLight/FrameLark. Check my environment, prepare the local retouching tools, and tell me how to start.

For release installation, you need **Node.js 20.9+ with npm and a Codex CLI that supports plugins**. No Git checkout is needed. Run:

```sh
node --input-type=module -e "const r=await fetch('https://github.com/GeminiLight/FrameLark/releases/latest/download/install-framelark.mjs');if(!r.ok)throw Error('Download failed: '+r.status);await import('data:text/javascript;base64,'+Buffer.from(await r.text()).toString('base64'))"
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
| <a id="web-ui"></a>Browser studio | Use the [online basic editor](https://tianfuwang.tech/FrameLark/studio/), or run `npm start` and open [localhost:3177](http://localhost:3177) for the full local studio. |

The online basic editor supports browser-side color, cropping, looks, versions, and export. Connect a visual model in the full local studio for the AI advisor. Scene-scouting guidance is currently provided through the Photography Eye skill.

## Usage examples

<a id="photography-eye-demo"></a>

### Find scenes · Photography Eye

**Provide a scene photo and ask how to shoot. FrameLark proposes different photographs.**

| User input | User request |
| --- | --- |
| <img src="apps/studio/public/assets/cases/arcade-input.jpg" width="220" alt="Input: an arcade with diagonal sunlight and distant people" /> | Use FrameLark to show me how to shoot here. |

**Delivery: one recommendation and four alternatives, with viewpoints, focus, finishing directions, and Xiaozhen tips.**

![Output: five arcade photographs in the selected warm paper editorial design](apps/studio/public/assets/cases/arcade-reference.png)

This board was developed from scene-based shooting proposals and then refined as a design example. It shows AI capture and finishing goals; details may be redrawn and new viewpoints need a real reshoot. Actual retouching continues from the user's original.

<details>
<summary>More Photography Eye cases: an independent glass-reflection test and the staircase</summary>

**Another input: café window reflections.** An independent agent received only the scene photo, the Photography Eye skill, and “How should I shoot here?” One board-generation call delivered five directions, without an old board or prompt as reference.

<img src="apps/studio/public/assets/cases/cafe-input.jpg" width="320" alt="Input: warm lamps, chairs, people and street reflections overlap in glass" />

![Independent first output: a seated back, light strips, chairs, cool/warm boundary and a silhouette gap](apps/studio/public/assets/cases/cafe-reference.png)

This first output has aspect-ratio and redrawn-detail deviations. Use it for direction, and the [original-photo framing guide](apps/studio/public/assets/cases/cafe-framing.png) for the current-view boundaries.

**Light-and-shadow staircase:** the previously approved example of space, warm light and handrail lines.

![Five photographic directions from the staircase](docs/images/showcase/photography-eye.png)

</details>

[Case process and sources](docs/CASE_STUDIES.md) (Chinese). [Website cases: inputs and deliveries](https://tianfuwang.tech/FrameLark/examples.html).

<a id="photo-retouch-demo"></a>

### Refine photos · Retouch Desk

**Input:** an existing original, with what you want to preserve or improve:

> Use FrameLark to refine this photo. Preserve the morning light and mountain layers, make the person a little clearer, and show me a trial first.

![Retouch Desk: a real comparison of the original and a saved retouch](docs/images/showcase/photo-retouch.png)

**Delivery:** comparable trials, editable saved versions, and exported finished files after acceptance. The screenshot shows an existing built-in demo version, not a new automatic retouch run.

<a id="photo-series-demo"></a>

### Curate a series · Series Album

**Input:** photos or an accessible folder, its purpose, the image count, and required photographs:

> Use FrameLark to make a nine-image grid from this folder. Define a theme, select photos, refine each one, and arrange the sequence. Preserve the originals.

![Series Album: set the intent, arrange photographs, and refine each image](docs/images/screenshots/series-workspace.png)

**Delivery:** a theme-led selection, sequence, and individually finished photos. This screenshot demonstrates a two-image cat-and-coffee workflow, not a completed nine-image delivery.

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
