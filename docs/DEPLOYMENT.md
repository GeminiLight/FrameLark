# 运行与部署 Frameyn

完整工作台、服务端 AI 接口和 Agent Skill 都在本仓库中。完整工作台只使用 Node.js 内置模块；Skill 的图片处理依赖在安装或运行 `npm run setup` 时单独准备。

## 本地启动

需要 Node.js 20.9+。

```sh
git clone https://github.com/GeminiLight/frameyn.git
cd frameyn
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

[部署到 Vercel](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FGeminiLight%2Fframeyn)

也可以在 Vercel 导入 GitHub 的 `GeminiLight/frameyn`：

| 设置 | 值 |
| --- | --- |
| Root Directory | 仓库根目录 |
| Framework Preset | Other |
| Output Directory | `public`，由 `vercel.json` 指定 |
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

Skill 运行时以 `skills/guangjian-retouch/scripts/` 为准。安装器直接安装该目录，不会用另一份旧运行时重新覆盖项目、保护或界面实现。

## 目录与验证

| 目录或文件 | 内容 |
| --- | --- |
| `public/` | 完整工作台的前端与浏览器图片处理 |
| `api/` | Vercel 函数入口 |
| `server.mjs` | 本地静态服务和 AI 路由 |
| `vision-service.mjs`、`series-review.mjs` | 模型协议、连接校验、组图审阅 |
| `skills/guangjian-retouch/` | 可独立安装的 Skill、CLI 与 Agent 暗房 |
| `test/web/` | 工作台测试、授权照片和导入样张 |
| `test/*.test.mjs` | Skill、逐项选择、保护和性能测试 |

```sh
npm run engine:check
npm run test:web
npm run setup
npm run test:skill
```

`npm test` 执行两组测试。`engine:check` 检查两端共用的 14 个图片处理模块，防止代码在分发过程中漂移；输出文件名称等界面差异不参与像素模块检查。修改处理管线时，同时检查 Skill 的历史参考兼容性。

Web 测试集的图片来源与许可保留在 `test/web/fixtures/*/README.md` 和质量集 manifest 中。原 Skill 技术测试仍使用独立生成图，不覆盖这些真实照片。重新制作质量样张时，`scripts/prepare-quality-set.py --wheel /path/to/scikit-image.whl` 接受官方 wheel 的路径，正常启动和测试不依赖这个准备步骤。
