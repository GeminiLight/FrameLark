# 安装 FrameLark

推荐 Codex 用户安装统一插件；其他支持 Skill 和本地工具的 Agent 可独立安装 Skill。只想在浏览器手动修图时，直接启动工作台即可。选择一种入口即可。

[返回主页](../README.md) · [English](INSTALLATION.en.md) · [使用指南](USAGE.md)

## 安装准备

本地修图需要 **Node.js 20.9+（含 npm）**；克隆仓库需要 Git。以下命令使用 macOS / Linux shell。

插件方式还需要支持 `codex plugin` 的 Codex CLI。已有桌面应用不代表终端一定能找到 `codex`；先检查：

```sh
node --version
npm --version
git --version
codex plugin --help
```

未识别 `codex` 或没有插件命令时，按[官方 CLI 说明](https://learn.chatgpt.com/docs/codex/cli)安装或更新，也可以选择下面的独立 Skill 方式。

插件和 Skill 使用宿主 Agent 的看图、对话能力，无需另填模型 API Key。修图还需要宿主能执行本地工具、访问所选照片；可选生图和图片编辑以宿主实际提供的能力为准。

先下载仓库：

```sh
git clone https://github.com/GeminiLight/FrameLark.git
cd FrameLark
```

下面的命令均在这个仓库目录中运行。

## 统一 Codex 插件

```sh
npm run plugin:install
```

安装器会构建插件、注册 FrameLark 市场、安装 `framelark@framelark`，再准备本地修图依赖。首次准备依赖需要联网。成功时输出 `ok: true`、两套 Skill 名称和 `retouchDependencies: ready`。 成功后还会给出三种任务的起手句和继续追问的例子；只装一套 Skill 时只展示相应入口。看图和可选生图仍需在当前会话确认，不因安装成功就称生图已就绪。

**开启一个新对话**，确认插件已启用，附上照片开始：

> 用 FrameLark 看这里怎么拍，给我不同机位、构图、参数和后期方向。

> 用 FrameLark 精修这张照片。保留我喜欢的感觉，先审片，再给能比较的试片。

也可以在已有 Codex 对话中直接说：

> 从 GeminiLight/FrameLark 注册 FrameLark 插件市场，安装 framelark@framelark，确认摄影眼和照片精修两套 Skill 都已包含。

Agent 会按当前环境安装。直接市场命令、启用状态检查、ZIP 分发和发布范围见 [插件说明](PLUGIN.md)。当前通过仓库插件市场安装，尚未上架 OpenAI 官方通用目录。

### 更新插件

在下载仓库时所用的 FrameLark 目录中运行：

```sh
git pull --ff-only
npm run plugin:install
```

安装器会将 FrameLark 市场指向这份本地构建，再安装对应版本；其他插件市场与已有独立 Skill 不受影响。完成后开启新对话。

## 独立安装 Skill

统一插件已经包含两套 Skill。想独立使用，或宿主不支持插件时，再选择此方式。

| 安装内容 | 命令 |
| --- | --- |
| 摄影眼与照片精修 | `npm run install:skills` |
| 仅照片精修 | `npm run install:skill` |
| 仅摄影眼 | `npm run install:photography-eye` |

默认分别安装到 `~/.codex/skills/photography-eye` 和 `~/.codex/skills/photo-retouch`。摄影眼无需额外图片依赖；照片精修会准备固定版本的图片依赖。

安装后刷新 Skill 列表或开启新对话，附图使用：

> 用 $photography-eye 看这里有哪些值得拍的画面，告诉我站哪、怎么取景和设置参数。

> 用 $photo-retouch 修这张照片。先说明值得保留的关系，再给可预览的调整方案。

### 更新与旧版迁移

```sh
git pull --ff-only
npm run install:skills -- --update
```

更新前会备份已有 Skill。只更新一个时，用对应安装命令加 `-- --update`。旧版 `guangjian-retouch` 可用 `npm run install:skill -- --update` 备份并迁移。

### 其他兼容 Agent

把其 **skills 根目录**替换到下面的命令中：

```sh
npm run install:skills -- /你的/agent/skills
```

只安装单个 Skill 时，指定的是该 Skill 的目标目录：

```sh
node scripts/install-photo-skill.mjs /你的/agent/skills/photo-retouch
node scripts/install-photo-skill.mjs --skill photography-eye /你的/agent/skills/photography-eye
```

其他宿主如何发现、启用 Skill，以宿主说明为准。

## 浏览器工作台

```sh
npm start
```

打开 [localhost:3177](http://localhost:3177)。手动调色、裁剪、风格和导出无需模型密钥，也无需先安装图片依赖。

想启用看图审片与 AI 顾问，在网页「AI 模型设置」中连接视觉模型。使用 AI 时，分析图片与相关意图、批注会发送到配置的模型服务。与 Skill 共享本机文件项目时，再运行 `npm run setup` 准备图片依赖。

模型接入、本机 Codex 订阅、端口、Docker 与 Vercel 见 [运行与部署](DEPLOYMENT.md)。[在线演示](https://ai-photography-preview-geminilights-projects.vercel.app/) 当前需要 Vercel 访问权限；无法进入时可使用本地工作台。

## 常见问题

| 遇到什么 | 怎么处理 |
| --- | --- |
| 找不到 `codex`，或没有 `plugin` 命令 | 安装 / 更新 CLI，或独立安装 Skill；网页手动修图不需要 Codex。 |
| 提示 Skill 已安装 | 更新时加 `--update`，安装器会保留旧版备份。 |
| 插件 / Skill 列表没有新条目 | 开启新对话，或按宿主要求刷新 / 重启应用。 |
| 图片依赖下载失败 | 检查 Node 版本及 npm 网络连接后重试；独立安装器在依赖准备完成前保留旧 Skill。 |
| 网页端口被占用 | 停止之前的工作台，或用 `PORT=3180 npm start` 换端口。 |
| 没有生图工具 | 跳过可选 AI 生图 / 编辑，继续可用的原片精修流程。 |
| 没有视觉模型 | 先连接能看图的模型；网页仍可手动编辑，光色统计不能替代看图审片。 |
