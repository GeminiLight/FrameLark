# Install FrameLark

For on-location advice in Codex, install Photography Eye on its own. Use the unified plugin for pixel retouching and photo series. Other agents that support skills can install them separately. For manual browser editing, start the studio. Choose one entry point.

[Home](../README.en.md) · [简体中文](INSTALLATION.md) · [User guide](USAGE.en.md)

## Prerequisites

Local retouching needs **Node.js 20.9+ with npm**. Cloning requires Git. The commands below use macOS / Linux shell syntax.

The plugin also requires a Codex CLI that supports `codex plugin`. Installing the desktop app alone does not ensure `codex` is on your terminal’s PATH. Check:

```sh
node --version
npm --version
git --version
codex plugin --help
```

If `codex` or plugin support is missing, follow the [official CLI setup](https://learn.chatgpt.com/docs/codex/cli), or use standalone skills below.

The plugin and skills use the host agent for vision and conversation, without another model API key. Retouching also requires local tool execution and access to the selected photos. Optional image generation and editing depend on the host’s available tools.

Photography Eye has a no-checkout installer below. Download the repository for a local build, the full plugin, standalone skills, or the local studio:

```sh
git clone https://github.com/GeminiLight/FrameLark.git
cd FrameLark
```

Run the remaining npm commands in this repository directory.

## Photography Eye plugin only

Open the [Photography Eye installation page](https://tianfuwang.tech/FrameLark/install.html) (Chinese) to start a local Codex chat with a prefilled installation request. Send the request to begin; the button does not send it automatically.

For a no-checkout terminal installation, Node.js 20.9+, Git, and a plugin-capable Codex CLI are required. Download and execute the [standalone installer](../scripts/install-photography-eye.mjs):

```sh
node --input-type=module -e "const r=await fetch('https://raw.githubusercontent.com/GeminiLight/FrameLark/main/scripts/install-photography-eye.mjs');if(!r.ok)throw Error('Download failed: '+r.status);await import('data:text/javascript;base64,'+Buffer.from(await r.text()).toString('base64'))"
```

It registers or refreshes the GitHub marketplace and installs only `framelark-eye@framelark`. Success requires exactly the `photography-eye` skill and an installed, enabled plugin. A same-name marketplace with another source is preserved rather than silently replaced. No npm or image-processing dependencies are installed.

From a checkout, `npm run plugin:install:photography-eye:github` runs the same installer. Installation applies to the Codex environment running the command, not other devices or your ChatGPT mobile account.

For a local development build instead:

```sh
npm run plugin:install:photography-eye
```

This installs `framelark-eye` with only the `photography-eye` skill, without preparing retouching dependencies. You can also ask local Codex to register or refresh the marketplace from GeminiLight/FrameLark and install only `framelark-eye@framelark`. Open a new chat, attach a scene photo, and ask “Use FrameLark Photography Eye to show me how to shoot here.”

The local build uses its own `framelark-eye` marketplace. Both installers check installed contents and enabled state before reporting success.

These are local installation instructions. Eligible ChatGPT workspace admins can import the repository marketplace, but ordinary mobile GitHub installation and account availability still need verification. See [plugin distribution](PLUGIN.md#chatgpt-工作区与手机) (Chinese).

## Unified Codex plugin

```sh
npm run plugin:install
```

The installer builds the plugin, registers the FrameLark marketplace, installs `framelark@framelark`, and prepares local retouching dependencies. The first dependency setup needs an internet connection. Success reports `ok: true`, both skill names, and `retouchDependencies: ready`, followed by starting requests and follow-up examples for the installed workflows. Vision and optional image generation still need to be checked in the current session; installation does not enable a model service.

**Open a new chat**, confirm the plugin is enabled, and attach a photograph:

> Use FrameLark to find photographs here. Suggest viewpoints, compositions, camera settings, and finishing directions.

> Use FrameLark to refine this photograph. Preserve the feeling I like, review it first, and show candidates I can compare.

You can also ask an existing Codex chat:

> Register GeminiLight/FrameLark as the FrameLark plugin marketplace and install framelark@framelark. Confirm that photography-eye and photo-retouch are both included.

The agent will install it according to your environment. See [plugin documentation](PLUGIN.md) (Chinese) for direct marketplace commands, verification, ZIP distribution, and publication scope. FrameLark uses a repository marketplace and is not yet listed in OpenAI’s universal directory.

### Update the plugin

In the FrameLark directory you cloned:

```sh
git pull --ff-only
npm run plugin:install
```

The installer points the FrameLark marketplace at this local build and installs the corresponding version. Other marketplaces and standalone skills are preserved. Open a new chat afterward.

## Standalone skills

The unified plugin already includes both skills. Use this route for standalone use or a host without plugin support.

| Install | Command |
| --- | --- |
| Both photography and retouching | `npm run install:skills` |
| Retouching only | `npm run install:skill` |
| Photography guidance only | `npm run install:photography-eye` |

The default locations are `~/.codex/skills/photography-eye` and `~/.codex/skills/photo-retouch`. Photography-eye needs no extra image-processing dependencies; photo-retouch prepares its pinned dependencies.

Reload the skill list or open a new chat, then attach an image:

> Use $photography-eye to find worthwhile photographs here. Tell me where to stand, how to frame them, and which settings to use.

> Use $photo-retouch to review this photograph, explain what to preserve, and show adjustments I can preview.

### Updates and migration

```sh
git pull --ff-only
npm run install:skills -- --update
```

Existing skills are backed up before replacement. To update only one, append `-- --update` to its installation command. An old `guangjian-retouch` installation can be backed up and migrated with `npm run install:skill -- --update`.

### Other compatible agents

Replace the **skills root directory** below with your host’s location:

```sh
npm run install:skills -- /your/agent/skills
```

For a single skill, specify that skill’s destination directory:

```sh
node scripts/install-photo-skill.mjs /your/agent/skills/photo-retouch
node scripts/install-photo-skill.mjs --skill photography-eye /your/agent/skills/photography-eye
```

Follow your host’s instructions to discover and enable installed skills.

## Browser studio

```sh
npm start
```

Open [localhost:3177](http://localhost:3177). Manual color work, cropping, styles, and export need no model key or image-dependency setup.

Connect a visual model in the studio’s AI settings for diagnosis and the advisor. AI requests send analysis images and related intent or annotations to your configured model service. Run `npm run setup` when sharing local file projects with the skill.

[Deployment](DEPLOYMENT.md) (Chinese) covers model connections, local Codex subscriptions, ports, Docker, and Vercel. The [online demo](https://ai-photography-preview-geminilights-projects.vercel.app/) currently requires Vercel access; use the local studio if access is unavailable.

## Troubleshooting

| Symptom | Next step |
| --- | --- |
| `codex` is missing or has no `plugin` command | Install / update the CLI, or choose standalone skills. Manual browser editing does not require Codex. |
| A skill is already installed | Add `--update` to preserve a backup and replace it. |
| A plugin / skill is not listed | Open a new chat, or refresh / restart the host as needed. |
| Dependency download fails | Check Node and npm connectivity, then retry. The standalone installer preserves previous skills until preparation succeeds. |
| The studio port is occupied | Stop the earlier studio, or use `PORT=3180 npm start`. |
| Image generation is unavailable | Skip optional generation / editing and continue with the available original-photo workflow. |
| Vision is unavailable | Connect a model that can inspect images. Manual browser tools remain available; color statistics do not replace visual review. |
