# Install FrameLark

For Codex, use the unified plugin. Other agents that support skills and local tools can install the skills separately. For manual browser editing, start the studio. Choose one entry point.

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

Download the repository:

```sh
git clone https://github.com/GeminiLight/FrameLark.git
cd FrameLark
```

Run the remaining commands in this repository directory.

## Unified Codex plugin

```sh
npm run plugin:install
```

The installer builds the plugin, registers the FrameLark marketplace, installs `framelark@framelark`, and prepares local retouching dependencies. The first dependency setup needs an internet connection. Success reports `ok: true`, both skill names, and `retouchDependencies: ready`.

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
