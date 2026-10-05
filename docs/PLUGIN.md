# FrameLark 统一插件

一个插件同时提供「摄影眼」和「照片精修」。插件包还带上修图 CLI、知识、批注与预览工具；摄影判断仍使用当前宿主的视觉 Agent。

## 安装

已安装支持插件的 Codex CLI 时，在 FrameLark 仓库中运行：

```sh
npm run plugin:install
```

这一个命令会构建干净的插件包、注册 FrameLark 插件市场、安装插件，再准备固定版本的本地图片依赖。需要 Node.js 20.9+；首次准备图片依赖需要联网。它不会覆盖 `~/.codex/skills/` 中已有的独立 Skill。

也可以让 Codex 直接从 GitHub 注册和安装：

```sh
codex plugin marketplace add GeminiLight/FrameLark
codex plugin add framelark@framelark
```

安装后开启新对话；插件中的修图 Skill 在第一次需要像素处理时会检查并准备自身依赖。可直接对 Agent 说：

> 从 GeminiLight/FrameLark 注册 FrameLark 插件市场，安装 framelark@framelark，确认摄影眼和照片精修两套 Skill 都已包含。

在支持插件的桌面端，也可在插件目录中选择 FrameLark 来源、打开插件详情并安装。仓库市场首次添加后若尚未出现在界面，按宿主要求刷新或重启应用。不同客户端的入口和本地执行能力以其实际支持为准。

## 安装后的使用

- 附上现场照，说「用 FrameLark 看这里怎么拍，给我不同的机位、参数和后期方向」。
- 附上照片，说「用 FrameLark 精修，先说明画面依据，再给我能比较的试片」。
- 提供目录，说「先确定主题，选出互相呼应的照片，逐张精修后整理九宫格」。

`photography-eye` 负责找画面与拍法，`photo-retouch` 负责审片、选片、试片、精修与交付。宿主有生图或图片编辑工具时按任务使用；没有时继续可用的原片流程。可按宿主显示的名称选择插件中的 Skill。

## 分发与维护

```sh
npm run plugin:check
npm run plugin:build
```

发布 ZIP 位于 `dist/framelark/framelark-0.1.0.zip`。包中只有两套 Skill、插件清单和小帧图标，不包含本机配置、密钥、照片项目、草稿、导出文件或原生 `node_modules`。图像依赖在用户的执行环境中准备，不把 macOS 的二进制依赖分发到其他系统。

`skills/` 是唯一维护来源；构建直接复制它，校验会核对发布副本与源文件。根目录 `plugin.json` 提供 portable 格式，`.codex-plugin/plugin.json` 提供 Codex 兼容格式，`.agents/plugins/marketplace.json` 提供仓库安装入口。二者使用同一名称、版本与展示信息。

当前发布路径是仓库插件市场和 ZIP，尚未上架 OpenAI 的通用插件目录。要让 ChatGPT 云端或管理后台从官方目录发现它，还需要使用开发者身份上传、验证并发布插件；安装本地插件本身不会部署云端修图服务。

官方依据：[插件打包与安装](https://developers.openai.com/plugins/build/plugins)、[插件架构](https://developers.openai.com/plugins/concepts/plugins)、[上传与发布](https://developers.openai.com/plugins/deploy/submission)。
