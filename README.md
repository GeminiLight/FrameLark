# 帧好 · FrameLark

**[访问官网](https://geminilight.github.io/FrameLark/) · [在线基础修片](https://geminilight.github.io/FrameLark/studio/)**

![帧好 · FrameLark：从看见，到成片。右侧是一只小帧](docs/images/framelark-banner.png)

**你的 AI 摄影伙伴，让小帧陪你找画面、修照片、做组图。**

FrameLark 提供 Codex 插件、独立 Skill 和浏览器工作台，陪你从拍摄想法走到成片。

[English](README.en.md) · [开始使用](#开始使用) · [使用指南](docs/USAGE.md)

## 创作能力

| 想做什么 | 小帧怎么帮你 |
| --- | --- |
| **[找画面 · 摄影眼](#photography-eye-demo)** | 从现场照发现值得拍的画面，给你机位、构图、时机和参数建议。 |
| **[修照片 · 精修台](#photo-retouch-demo)** | 打磨光色、裁剪和局部细节，自定义风格，比较试片后再接受。 |
| **[做组图 · 组图册](#photo-series-demo)** | 先确定主题，再精选照片、逐张精修、安排顺序，让整组互相呼应。 |

人物、大场景和细节都可以放进同一组，靠主题与节奏联系起来。摄影眼由 `photography-eye` Skill 提供；精修台和组图册由 `photo-retouch` Skill 提供。

小帧是一只有「摄影眼」的观察小鸟，也是帧好的摄影伙伴。[认识小帧](docs/WEB_DESIGN.md#品牌与小帧)

<a id="codex-plugin"></a>

## 开始使用

**Codex 用户推荐安装统一插件，一次获得两套 Skill 和本地修图工具。**

需要 **Node.js 20.9+（含 npm）、Git，以及支持插件的 Codex CLI**。先用 `codex plugin --help` 确认；找不到命令时，见[安装准备](docs/INSTALLATION.md#安装准备)。

在终端运行：

```sh
git clone https://github.com/GeminiLight/FrameLark.git
cd FrameLark
npm run plugin:install
```

安装成功后，**开启新对话**，附上现场照，直接说「用 FrameLark 看这里咋拍？」。已有原片可以说「用 FrameLark 精修这张，先给试片」，照片目录可以说「用 FrameLark 先定主题，做朋友圈九宫格」。下一轮直接说编号或指出想调整的地方，见[使用示例](#使用示例)。

插件使用当前 Agent 的看图与对话能力，无需另填模型 API Key。可选 AI 生图与图片编辑会先检查宿主是否支持，不可用时跳过。当前通过仓库插件市场安装，尚未上架 OpenAI 官方通用目录。

### 其他入口

以下命令在上面的仓库目录中运行，选择适合自己的入口即可。

| 入口 | 怎么开始 |
| --- | --- |
| <a id="agent-skill"></a>独立 Skill | 运行 `npm run install:skills`，默认安装到 `~/.codex/skills/`；[单独安装、其他宿主与更新](docs/INSTALLATION.md#独立安装-skill)。 |
| <a id="web-ui"></a>浏览器工作台 | 运行 `npm start`，打开 [localhost:3177](http://localhost:3177)，上传照片后手动精修、比较和导出。 |

网页手动修图无需模型密钥；AI 顾问需在设置中连接视觉模型。现场拍摄辅导目前通过摄影眼 Skill 使用。

## 使用示例

<a id="photography-eye-demo"></a>

### 找画面 · 摄影眼

附上现场照，直接问怎么拍：

> 用 FrameLark 看这个光影楼梯咋拍？

![摄影眼：光影楼梯的层叠空间、暖光与扶手折线等五种取景参考](docs/images/showcase/photography-eye.png)

生图工具可用时，默认给五种拍法的一张参考板与现场动作。这个楼梯示例围绕空间、暖光和折线展开；图为 AI 拍摄目标，需现场试拍。

<a id="photo-retouch-demo"></a>

### 修照片 · 精修台

附上原片，说清想保留与想改善的地方：

> 用 FrameLark 精修这张照片，保留晨光和远山层次，让人物稍微清楚一点，先给我试片。

![精修台：原片与已保存修片版本的真实对照界面](docs/images/showcase/photo-retouch.png)

先审片，再试裁剪、光色与局部调整；对照原片检查细节，满意后接受并导出。上图展示内置示例的原片与已保存修片版本。

<a id="photo-series-demo"></a>

### 做组图 · 组图册

给出照片目录，说明用途、数量与必留照片：

> 用 FrameLark 从这个目录整理朋友圈九宫格，先确定主题，再选片、逐张精修和排序，保留原片。

![组图册：确定表达、调整照片顺序与逐张精调](docs/images/screenshots/series-workspace.png)

得到围绕主题的选片、顺序与成片。上图用猫与咖啡两张样片展示「安静日常」的组图操作。

[示例来源与操作说明](docs/SCREENSHOTS.md#三个能力的使用示例)

## 工作台预览

![帧好工作台：照片预览与小帧顾问](docs/images/screenshots/studio-overview.png)

当前本地工作台的真实截图，使用内置示例照片，未连接视觉模型。[更多界面与截图说明](docs/SCREENSHOTS.md)

## 更多文档

| 想了解什么 | 去哪里看 |
| --- | --- |
| 安装、更新与常见问题 | [安装指南](docs/INSTALLATION.md) · [插件分发](docs/PLUGIN.md) |
| 拍摄、精修、组图与交付 | [使用指南](docs/USAGE.md) |
| 构图、光色与摄影师学习参考 | [摄影知识](docs/USAGE.md#摄影知识) |
| 本地运行、模型配置与部署 | [运行与部署](docs/DEPLOYMENT.md) |
| 开发、测试与贡献 | [项目结构](docs/ARCHITECTURE.md) · [维护指南](CONTRIBUTING.md) · [验证范围](docs/VALIDATION.md) |

## 贡献者

感谢 [Yijie Xu（@yeahjack）](https://github.com/yeahjack) 贡献逐项调整采纳、参数与局部层锁定、画面区域保护，以及渲染和预览响应优化：[#1](https://github.com/GeminiLight/FrameLark/pull/1)、[#2](https://github.com/GeminiLight/FrameLark/pull/2)。

