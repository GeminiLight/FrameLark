# 运行与部署 FrameLark

完整工作台、服务端 AI 接口和 Agent Skill 都在本仓库中。完整工作台只使用 Node.js 内置模块；Skill 的图片处理依赖在安装或运行 `npm run setup` 时单独准备。

## 本地启动

需要 Node.js 20.9+。

```sh
git clone https://github.com/GeminiLight/FrameLark.git
cd FrameLark
npm start
```

打开 http://localhost:3177。默认仅监听本机；端口被占用时，关闭之前的服务，或设置 `PORT` 后启动。macOS / Linux 示例：

```sh
PORT=3180 npm start
```

手动调色、风格、裁剪、批注和导出可直接使用。没有配置视觉模型时，界面会说明本地光色统计与视觉审片的区别。

## 接入视觉模型

本地运行时可以在界面中配置模型。连接会用一张小型校验图检查图片识别能力；记住配置时，密钥保存在服务端 `.guangjian/vision.json`，不会写进前端源码。

也可把 `.env.local.example` 复制为 `.env.local`，填写：

| 变量 | 填写内容 |
| --- | --- |
| `OPENAI_API_KEY` | 自己的模型服务密钥 |
| `OPENAI_MODEL` | 服务商提供、具有视觉能力的模型名称 |
| `OPENAI_API_URL` | 完整 `/v1/responses` 或 `/v1/chat/completions` 地址；兼容服务的 `/v1` 基础地址也可使用 |

变量名兼容已有配置，可连接支持相应协议的其他视觉模型服务。环境变量优先于 `.env.local`，其次为界面保存的配置。修改文件配置后重新启动服务。配置了密钥不等于视觉识别已经通过校验，以界面显示的状态为准。

使用 AI 时，分析用图片与相关意图、批注会发送到配置的模型服务。完整工作台的照片草稿保存在浏览器 IndexedDB；同一浏览器地址可以继续编辑。Agent 暗房的文件项目另行保存在用户指定目录。

## 使用本机 Codex 订阅

本机安装支持 App Server 的 Codex CLI（已验证 0.159.2），并运行 `codex login` 使用 ChatGPT 登录。启动工作台后，在视觉接入设置中选择「本机 Codex 订阅」，填写账户可用且支持图片的模型名称，点击「验证并连接」。可勾选记住配置；不会复制或保存 Codex 登录令牌。

服务通过 `codex app-server` 的私有标准输入输出通道复用本机登录，用图片校验通过后才切换配置。模型推理在云端，压缩图片会发送给 Codex，并使用订阅额度。手动修图仍在本地完成。该模式用于本机 Node.js 启动；Vercel 不支持，现有 Docker 镜像也未安装 Codex CLI。

每张照片使用独立的 Codex 会话；服务重启后会恢复同一会话。会话映射保存在 `.guangjian/codex-sessions.json`，不包含登录令牌。请求携带当前预览与编辑状态，通过只读沙箱、禁用的工具及结构化输出返回建议。浏览器显示真实生成进度和正在生成的回复，完整结果通过校验后才可预览或应用。确认了运行编号后，取消会调用 `turn/interrupt`；确认前取消或启动超时会关闭旧进程，等待退出后再重试。视觉请求禁用本机图片读取、终端和环境工具，只接收这次传入的图片。Codex 会按自身会话规则保存对话与图片输入。登录失效时重新运行 `codex login`；额度不足、超时或模型不可用会显示错误，不会伪装成视觉审片成功。

### 模型档位

默认快速档为 `gpt-6.1-sol` / low，标准档为 `gpt-6.1-sol` / medium，深入档为 `gpt-6-astra` / high。设置中可以分别修改每档模型与思考强度，模型列表来自本机 Codex。连接校验用快速档，单张审片、复评和日常对话用标准档，组图用深入档；对话发送前可以手动选择档位。失败重试不会升级模型。已有单模型配置会保留该模型，选择“恢复 Sol / Astra 默认档位”后再验证保存即可切换。

本机 Codex 登录检测只读取登录状态与模型列表，不调用模型；“使用本机 Codex”会沿用已有 Codex 档位进行图片校验，首次连接采用默认档位。快捷连接不自动记住配置；需要长期保存时，在连接设置中明确勾选。照片分析使用订阅额度，不能将 API 价格当作订阅额度的精确换算。

## 网页与 Skill 共享文件项目

先运行 `npm run setup` 安装本地图片依赖，再 `npm start`。网页顶部的“文件项目”可以将当前照片保存到仓库下 `projects/<项目目录>`，或打开已有的 Skill 项目文件夹。原片字节、标准化工作图、版本、批注与导出记录保存在该文件夹中；网页修改会自动保存，保存失败或并发冲突会明确提示。

从 Agent 打开同一个项目：

```sh
node skills/photo-retouch/scripts/cli.mjs studio --project /你的/照片项目
```

CLI 返回完整工作台 URL。网页通过文件变更事件更新批注与候选；Agent 必须继续按最新 revision 操作。过期保存不会覆盖另一边的修改。出现冲突时可以先将当前网页内容另存为文件项目，再重新打开原项目。

候选可以逐项选择并比较后应用。网页与文件项目共用命名版本面板，可保存、重命名、A/B 比较与恢复；保存命名版本不改变当前画面，也不记录成接受 AI 建议。转换文件项目时，已有命名版本与当前编辑一起保存，等待期间的新修改继续同步。文件项目导出的成片同时写入项目的 `exports/` 并提供浏览器下载，具体路径见项目面板。共享项目从项目列表或 CLI URL 重新打开。同步成功后不复制浏览器草稿；尚未同步或保存失败的修改保留浏览器恢复副本，恢复副本不会覆盖原文件项目。

第一版共享范围为单张照片的全局调整、风格、裁剪、常规局部、批注、候选、版本和导出。启用诊断与复审流程的项目、保护设置、文字图层以及无法一致映射的标记/局部关系仍使用独立 Agent 暗房；网页会阻止不完整的编辑。另存时如历史版本包含这些效果，也会拒绝转换，并保留原项目与网页编辑；可在 Skill 中复制完整项目。不会自动迁移未选择的浏览器草稿。

macOS 本地版使用系统 `sips` 转换静态 HEIC/HEIF，保留原文件；转换前检查文件大小、像素和边长限制。其他平台及云端没有此转换器时明确提示先转换。RAW/TIFF 支持范围不变。

## Docker 本地部署

需要 Docker 和 Docker Compose：

```sh
docker compose up -d --build
```

打开 http://localhost:3177，在界面配置模型即可。端口仅绑定本机，服务端模型配置写入 `frameyn-settings` 数据卷。浏览器草稿仍保存在当前浏览器中。

```sh
docker compose logs -f frameyn
docker compose down
```

`down` 会停止服务并保留设置卷。镜像只包含运行完整工作台所需的源码和公开演示素材，不包含 Skill、测试照片、API Key 或本机草稿。

需要其他端口时，可以设置 `FRAMEYN_PORT`。如果当前网络无法访问 Docker Hub，可使用 Docker 在 AWS ECR Public 发布的同一官方 Node 镜像。macOS / Linux 示例：

```sh
FRAMEYN_PORT=3180 FRAMEYN_NODE_IMAGE=public.ecr.aws/docker/library/node:24-alpine docker compose up -d --build
```

镜像来源见 [Docker Official Images on ECR Public](https://aws.amazon.com/blogs/containers/docker-official-images-now-available-on-amazon-elastic-container-registry-public/)。这两个配置均为可选项。

## Vercel 部署

[部署到 Vercel](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FGeminiLight%2FFrameLark)

也可以在 Vercel 导入 GitHub 的 `GeminiLight/frameyn`：

| 设置 | 值 |
| --- | --- |
| Root Directory | 仓库根目录 |
| Framework Preset | Other |
| Output Directory | `apps/studio/public`，由 `vercel.json` 指定 |
| Build / Install Command | 留空，运行时代码不需要依赖安装 |
| 模型环境变量 | `OPENAI_API_KEY`、`OPENAI_MODEL`、`OPENAI_API_URL` |

没有模型变量时，工作台可用于手动编辑。需要 AI 时，在自己的 Vercel 项目中填入变量并重新部署。云端模型配置由部署者管理，访问者不能通过界面改写共享配置。

仓库为私有时，需要对应 GitHub 访问权限来导入。面向所有用户的 Deploy Button 需有可公开访问的源码仓库；参考 [Vercel 官方 Deploy Button 文档](https://vercel.com/docs/deploy-button)。将现有 Vercel 项目连接到这个 GitHub 仓库后，提交可触发后续部署；本次源码整合不修改既有项目的访问策略。

## Agent Skill

```sh
npm run install:skill
```

已经安装过时，使用 `npm run install:skill -- --update`，安装器会备份旧版本。Skill 使用宿主 Agent 的视觉能力，不需要以上服务端模型配置。

如需先在仓库内使用 CLI：

```sh
npm run setup
npm run photo -- help
```

Skill 运行时以 `skills/photo-retouch/scripts/` 为准。安装器直接安装该目录，不会用另一份旧运行时重新覆盖项目、保护或界面实现。

## 目录与验证

| 目录或文件 | 内容 |
| --- | --- |
| `apps/studio/` | 完整工作台，分为浏览器端 `public/` 与服务端 `server/` |
| `api/` | Vercel 函数入口 |
| `apps/studio/server/index.mjs` | 本地启动入口，管理监听和关闭 |
| `apps/studio/server/app.mjs` | 本地与 Vercel 共用的 HTTP 请求处理 |
| `apps/studio/server/ai/`、`projects/`、`tools/` | 模型接入、文件项目桥接与工具执行 |
| `skills/photo-retouch/` | 可独立安装的 Skill、CLI 与 Agent 暗房 |
| `test/web/` | 工作台测试、授权照片和导入样张 |
| `test/*.test.mjs` | Skill、逐项选择、保护和性能测试 |

```sh
npm run architecture:check
npm run engine:check
npm run test:web
npm run setup
npm run test:skill
```

`npm test` 执行两组测试。`engine:check` 检查两端共用的 15 个图片处理模块，防止代码在分发过程中漂移；输出文件名称等界面差异不参与像素模块检查。修改处理管线时，同时检查 Skill 的历史参考兼容性。

Web 测试集的图片来源与许可保留在 `test/web/fixtures/*/README.md` 和质量集 manifest 中。原 Skill 技术测试仍使用独立生成图，不覆盖这些真实照片。重新制作质量样张时，`scripts/prepare-quality-set.py --wheel /path/to/scikit-image.whl` 接受官方 wheel 的路径，正常启动和测试不依赖这个准备步骤。
