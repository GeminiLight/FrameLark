# Frameyn · 帧映

![Frameyn — An eye for every frame.](assets/frameyn-cover.svg)

**给你的 Agent，一双懂摄影的眼睛。**

Frameyn 是一个摄影审美与精修 Skill。安装到已有的视觉 Agent 中，让它围绕你的创作意图审片，解释画面的光色与构图，再用本地工具做出可预览、可继续精调的候选。你可以圈出不满意的地方、留下评论，和 Agent 一起修到满意。

[English](README.en.md) · [快速开始](#快速开始) · [摄影知识](#摄影知识) · [工具参考](skills/guangjian-retouch/references/tools.md)

## 从看懂照片，到留下满意版本

| 环节 | 你能做什么 |
| --- | --- |
| **审片** | 看主体、背景、光线、构图、视觉秩序与情绪；先说明值得保留的关系。已经合适的照片可以得到“建议保留”。 |
| **试片** | 围绕“肤色真实”“保留清晨的安静”等意图创建候选，查看实际处理效果和主要取舍。 |
| **精调** | 在本地暗房对照原片、100% 查看、缩放和平移，手动调参或圈选评论；让 Agent 读取最新批注继续调整。 |
| **定稿** | 接受或取消候选，保存“自然版”“胶片版”等命名版本，随时恢复，再导出成片。 |

每个候选都从当前版本出发。光色、风格与局部调整有独立的处理层，原片字节保存在项目中；预览和取消不会覆盖已接受的版本。

## 快速开始

需要 **Node.js 20.9+**，以及能读取图片、运行本地工具并加载 Skill 的 Agent，例如 Codex。

### 1. 安装

```sh
git clone https://github.com/GeminiLight/frameyn.git
cd frameyn
npm run install:skill
```

首次安装会准备固定版本的 Sharp 与原生 Canvas 图片依赖。默认安装到 `~/.codex/skills/guangjian-retouch`。如果宿主尚未显示新 Skill，重新加载 Skill 列表或打开新任务。

> **安装标识**：品牌与仓库名已改为 Frameyn；Skill 暂时保留 `guangjian-retouch`，兼容已有安装和调用。下方示例使用这个实际可用的名称。

### 2. 给一张照片，说清想保留什么

在 Agent 中发送，把路径换成你的照片：

```text
用 $guangjian-retouch 帮我修这张照片：/照片/清晨.jpg。
保留清晨的安静和自然色彩。先审片，说明哪些地方值得保留；
只有在有明确收益时才调整，先给我看候选预览。
```

Agent 会读取原片与摄影知识，创建本地照片项目，再提供审片观察或候选。请它打开本地暗房，就可以查看、批注和继续精调。

### 3. 用批注继续对话

圈选画面后保存评论，再回到 Agent：

```text
读取我刚保存的全部批注。
人物稍微清楚一点，背景仍然保持安静；保留我标记的暖光。
基于当前版本试片，解释变化和代价，先让我对比。
```

对话在宿主 Agent 中进行，本地暗房负责查看、批注和精调。Agent 会在继续处理时重新读取批注；页面本身没有独立聊天模型。

<details>
<summary>更新已有 Skill，或安装到其他宿主</summary>

更新会先备份旧版本：

```sh
npm run install:skill -- --update
```

指定其他兼容宿主的 Skill 目录：

```sh
node scripts/install-photo-skill.mjs /你的/skills/guangjian-retouch
```

仓库包含可独立安装的 Skill 和本地工具，无需部署 Web 应用或配置另一套模型服务。私有仓库的克隆需要有访问权限的 GitHub 账号。

</details>

## 摄影知识

Frameyn 按当前题材和问题读取相关知识：**79 个章节、10 类题材与场景、14 款风格预设，以及 10 位摄影师的学习线索**。

知识关注处理的条件与取舍。例如，逆光人像要检查人物可读性，也要保留逆光关系；风格选择要看原有光线、题材和意图。滨田英明、Saul Leiter、川内伦子等摄影师的作品用于学习观看方式，大师名称不代表官方滤镜、授权配方或精确复刻。

<details>
<summary>打开知识地图</summary>

| 想解决的问题 | 参考 |
| --- | --- |
| 什么值得修改，什么值得保留 | [审美判断](skills/guangjian-retouch/references/aesthetic-judgment.md) |
| 人像、风景、夜景、街头等场景 | [题材策略](skills/guangjian-retouch/references/subject-playbooks.md) |
| 主次、留白、空间与拍摄练习 | [构图与拍摄](skills/guangjian-retouch/references/composition-craft.md) |
| 曝光、肤色、白平衡、曲线与 HSL | [光线与色彩](skills/guangjian-retouch/references/light-color.md) |
| 锐化、降噪、局部、裁剪与输出 | [处理工艺](skills/guangjian-retouch/references/detail-local-crop.md) |
| 风格选择、适用条件与摄影师参考 | [风格图谱](skills/guangjian-retouch/references/style-atlas.md) |
| 视频色彩、镜头匹配、剪辑与声音 | [视频工艺](skills/guangjian-retouch/references/video-craft.md) |
| 已接受选择与反馈如何留下记录 | [学习与记忆](skills/guangjian-retouch/references/learning-memory.md) |
| 实际案例、推理练习与过度处理反例 | [案例手册](skills/guangjian-retouch/references/casebook.md) |
| 作者、厂商与真实引擎依据 | [来源](skills/guangjian-retouch/references/sources.md) |

本地关键词检索示例，在仓库目录运行：

```sh
node skills/guangjian-retouch/scripts/knowledge.mjs search --query '滨田英明 柔光人像 肤色'
node skills/guangjian-retouch/scripts/knowledge.mjs read --id style-daily-soft
```

检索不调用模型；实际审片仍需要 Agent 读取画面。

</details>

## Agent 与本地工具如何配合

| 部分 | 负责什么 |
| --- | --- |
| **你的视觉 Agent** | 看图、理解意图、说明依据、制定候选、读取最新批注并继续对话。 |
| **Frameyn Skill** | 提供摄影知识、审片流程、工具用法和处理检查点。 |
| **本地像素工具与暗房** | 调整已有像素，保存项目与版本，提供对照、批注、手动精调和导出。 |

本地工具不请求模型 API，无需额外模型 Key。图片提供给宿主视觉模型时，遵循宿主的数据处理规则与额度。预览服务只监听 `127.0.0.1`，项目保存照片、参数、裁剪、批注和版本，重新启动同一项目即可继续。

偏好记录来自实际接受的选择，当前仅限同一个照片项目。试片、浏览或取消不会被记录为认可；当前创作意图优先。

## 当前能力范围

| 项目 | 支持范围 |
| --- | --- |
| 光色与风格 | 31 项全局控制、独立风格层与强度调整。 |
| 构图与局部 | 裁剪、拉直，矩形 / 径向 / 渐变范围与羽化。局部范围是几何蒙版。 |
| 输入 | 静态 JPEG、PNG、WebP、AVIF；8 位 sRGB。最大 30 MB、5000 万像素、最长边 16384 px。 |
| 输出 | PNG / JPEG；分享、打印与原尺寸用途预设。最长边不超过 8192 px，总量不超过 1600 万像素，不放大。 |

HEIC、RAW、TIFF 需要先转换。当前没有 RAW 显影、16 位工作流、语义主体分割或生成式增删物体；“原尺寸”预设也受上述输出上限约束。

视频部分提供调色与剪辑判断知识；实际视频执行需要宿主另有媒体工具，本照片 CLI 没有视频时间线或视频导出。

## 开发与验证

```sh
npm run setup
npm run knowledge:check
npm test
```

现有 **15 项测试**覆盖原片保护、方向、候选冲突、参数与局部快照、命名版本、PNG 预览与导出的像素一致性、本地会话及知识检索。技术测试使用生成图；实际照片案例另有观察记录，摄影质量仍需按题材和输出尺寸逐一检查。

[验证范围](docs/VALIDATION.md) · [参与维护](CONTRIBUTING.md) · [Skill 入口](skills/guangjian-retouch/SKILL.md) · [工具命令与 JSON](skills/guangjian-retouch/references/tools.md)
