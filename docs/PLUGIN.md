# FrameLark 插件

独立摄影眼插件提供现场拍法指导；统一插件同时提供「摄影眼」和「照片精修」，带上修图 CLI、知识、批注与预览工具。摄影判断使用当前宿主的视觉 Agent。

## 独立摄影眼插件

[快速安装页](https://tianfuwang.tech/FrameLark/install.html)提供本地 Codex 预填请求、无需克隆的终端命令，以及已添加市场后的插件页入口。详见[快速安装](INSTALLATION.md#终端快速安装无需克隆)。公共目录发布步骤见[发布流程](PUBLISHING.md)；完成实际发布前不提供假定的公共安装卡。

只需要现场拍法时，选择 **FrameLark 摄影眼**（`framelark-eye`）。它只有 `photography-eye`、拍摄与后期方向参考、小帧素材及无额外依赖的辅助脚本，不包含照片精修、组图工具或它们的图片处理依赖。看图和可选生图使用当前宿主能力。

让支持插件的本地 Codex 代装：

> 帮我从 https://github.com/GeminiLight/FrameLark 注册或更新插件市场，只安装 FrameLark 摄影眼插件 framelark-eye@framelark。确认只包含 photography-eye；开启新对话后，我会发一张现场照问「这里咋拍？」。

高级开发路径：直接从 GitHub 仓库市场安装（仍会下载仓库）：

```sh
codex plugin marketplace add GeminiLight/FrameLark
codex plugin add framelark-eye@framelark
```

市场已注册时先确认它指向本仓库并刷新来源，再安装独立插件。已克隆仓库时也可运行 `npm run plugin:install:local:photography-eye`；这个入口安装本地构建，不准备修图依赖。安装后开启新对话，选择摄影眼，附照片问「这里咋拍？」。

`skills/photography-eye/` 是唯一维护的 Skill 内容。`plugins/framelark-eye/` 是 GitHub 安装所需的完整插件目录，其中的 Skill 副本由同步命令生成；原生插件清单在 `plugins/framelark-eye/.codex-plugin/plugin.json`。修改原始 Skill 或独立插件清单后，同步生成，再校验发布包：

```sh
npm run plugin:sync:photography-eye
npm run plugin:check:photography-eye
npm run plugin:build:photography-eye
```

输出为 `dist/framelark-eye/framelark-eye-0.1.0.zip`，其中只含一个 Skill。生成的发布副本不手动修改；CI 对比完整文件列表与逐文件内容，防止 GitHub 安装副本落后于维护来源。

## ChatGPT 工作区与手机

仓库市场同时提供 `framelark-eye` 和 `framelark`。有权限的工作区管理员可进入 ChatGPT 管理后台的 Plugins → Add → Import marketplace，Source 填 `https://github.com/GeminiLight/FrameLark`，Path 留空，导入后配置独立摄影眼插件的成员安装策略。管理员也可上传构建生成的独立 ZIP。账号、权限、插件导入结果和手机中的可用性需要实际验证。

这不等于普通个人账号在手机聊天中发送 GitHub 链接就能直接安装。两种插件尚未上架 OpenAI 通用公共目录，当前没有已验证的公共手机安装卡或安装链接。

官方依据：[GitHub 市场导入](https://help.openai.com/en/articles/20001504-importing-and-syncing-plugin-marketplaces-from-github)、[插件安装与手机可用范围](https://learn.chatgpt.com/docs/plugins)。

## Release 安装（默认）

两种插件从正式版本 ZIP 安装，不克隆仓库。统一插件首次安装会准备 Sharp/Canvas 原生依赖并带上全部案例图；摄影眼保留独立轻量安装。用法与更新见 [版本安装](INSTALLATION.md#统一-codex-插件)。没有公开 Release 时明确报错，不将开发分支伪装成已发布版本。

版本包、独立安装脚本、文件校验清单和 SHA256SUMS 由 `npm run release:build` 生成；维护者在校验通过后推送与插件版本一致的 `vX.Y.Z` 标签，由 Release 工作流发布。GitHub Release 与 OpenAI 公共目录是不同分发渠道。

## 源码安装（开发入口）

还未下载仓库时，先运行：

```sh
git clone https://github.com/GeminiLight/FrameLark.git
cd FrameLark
```


已安装支持插件的 Codex CLI 时，在 FrameLark 仓库中运行：

```sh
npm run plugin:install:local
```

这一个命令会构建干净的插件包、将 FrameLark 市场指向这份本地构建、安装插件，再准备固定版本的本地图片依赖。此前配置过其他 FrameLark 来源时会切换到本次构建；其他插件市场与独立 Skill 保持原样。需要 Node.js 20.9+ 和 Git，并在克隆的仓库中运行；首次准备图片依赖需要联网。它不会覆盖 `~/.codex/skills/` 中已有的独立 Skill。

高级开发路径也可直接从 GitHub 注册和安装；这条路径仍会下载仓库：

```sh
codex plugin marketplace add GeminiLight/FrameLark
codex plugin add framelark@framelark
```

用 `codex plugin list --marketplace framelark --json` 检查 `installed` 与 `enabled` 均为 `true`。安装后开启新对话；插件中的修图 Skill 在第一次需要像素处理时会检查并准备自身依赖。可直接对 Agent 说：

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

发布 ZIP 位于 `dist/framelark/framelark-0.1.8.zip`。包中只有两套 Skill、插件清单和小帧图标，不包含本机配置、密钥、照片项目、草稿、导出文件或原生 `node_modules`。图像依赖在用户的执行环境中准备，不把 macOS 的二进制依赖分发到其他系统。

`skills/` 是唯一维护来源；构建只读取 Git 已跟踪的 Skill、图标和清单，校验发布副本与工作区源码。未跟踪的本地文件不会进入发布包；误跟踪的配置、照片项目或符号链接会在生成 ZIP 前报错，保留上一次有效包。新增发布资源需先加入 Git。根目录 `plugin.json` 提供 portable 格式，`.codex-plugin/plugin.json` 提供 Codex 兼容格式，`.agents/plugins/marketplace.json` 提供仓库安装入口。二者使用同一名称、版本与展示信息。

当前发布路径是仓库插件市场和 ZIP，尚未上架 OpenAI 的通用插件目录。要让 ChatGPT 云端或管理后台从官方目录发现它，还需要使用开发者身份上传、验证并发布插件；安装本地插件本身不会部署云端修图服务。

官方依据：[插件打包与安装](https://developers.openai.com/plugins/build/plugins)、[插件架构](https://developers.openai.com/plugins/concepts/plugins)、[上传与发布](https://developers.openai.com/plugins/deploy/submission)。

## 0.1.5：可编辑配方的同步升级

完整工作台、CLI 和两套 Skill 必须使用同一份新代码。新项目在首次写入可编辑配方时升级到 schema 3，升级前会保存逐字节的旧项目备份。旧客户端拒绝打开 schema 3，避免把新步骤丢掉后覆盖项目。

更新仓库后重新运行 `npm run plugin:install:local`，并开启新对话；独立 Skill 使用原来的安装命令更新。正在运行的本地工作台也需要重启。只更新网页不会更新已经安装到 Agent 中的 Skill。

色彩和细节的新步骤使用内核 2：色彩覆盖完整六段色相，细节范围按同一原片位置缩放。已经保存的内核 1 步骤保持原有重放方式；升级插件不会偷偷改变旧版本的画面。风格试片不会占用编辑步骤，超过容量时可预览但不能接受，整理步骤后再应用。
