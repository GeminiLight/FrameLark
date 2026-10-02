# Guangjian · 光间

**让你的视觉 Agent 审片，与你一起精调原片。**

Guangjian 是一个可安装的摄影 Skill，配有本地像素工具与暗房界面。已有 Agent 负责看图、理解意图和对话；本地工具负责光色、风格、裁剪与局部处理。无需连接另一套模型服务。

## 它怎样工作

1. **看原片**：判断主体、背景、光线、构图、视觉秩序和情绪，说明值得保留的关系。
2. **试片**：围绕当前意图提供独立候选，实际查看结果；可以给出零条建议。
3. **继续精调**：打开本地暗房，比较、缩放、圈选评论或手动调参；Agent 重新读取最新批注后继续。
4. **留下满意版本**：接受、取消、命名、恢复，再导出实际成片。原片字节独立保留。

处理已有像素，不重新生成两张照片。大师名称是学习线索，不代表官方滤镜、授权配方或精确复刻。

## 安装

需要 Node.js **20.9+**。在仓库目录运行：

```sh
npm run install:skill
```

默认安装到 `~/.codex/skills/guangjian-retouch`。首次安装下载固定版本的 Sharp 与原生 Canvas 图片依赖；不要求模型 API Key。已有版本用：

```sh
npm run install:skill -- --update
```

更新会先备份旧 Skill。安装到其他兼容宿主目录：

```sh
node scripts/install-photo-skill.mjs /你的/skills/guangjian-retouch
```

仓库只包含 Skill 和本地工具，不需要部署原来的 Web 应用。如果宿主尚未刷新 Skill 列表，重新载入 Skill 列表或打开新任务。

## 使用

在你的视觉 Agent 中：

> 用 $guangjian-retouch 帮我修这张照片：/照片/人像.jpg。肤色真实，保留柔和光线，先审片并给候选预览。

继续精调：

> 读取我刚保存的批注，只改善人物的可读性，保留夜景暗部。

对话在宿主 Agent 中进行。本地页面提供查看、批注和精调，没有独立聊天模型；模型的图片传输、额度和数据规则由宿主管理。

[Skill 入口](skills/guangjian-retouch/SKILL.md) · [工具命令与 JSON](skills/guangjian-retouch/references/tools.md)

## 摄影知识

按任务加载知识，避免每次都读整本手册：

| 内容 | 参考 |
| --- | --- |
| 判断、意图、保留与取舍 | [审美判断](skills/guangjian-retouch/references/aesthetic-judgment.md) |
| 10 类题材与场景 | [题材策略](skills/guangjian-retouch/references/subject-playbooks.md) |
| 观看路径、空间与拍摄练习 | [构图与拍摄](skills/guangjian-retouch/references/composition-craft.md) |
| 曝光、肤色、白平衡、曲线与 HSL | [光线与色彩](skills/guangjian-retouch/references/light-color.md) |
| 锐化、降噪、局部、裁剪与输出 | [处理工艺](skills/guangjian-retouch/references/detail-local-crop.md) |
| 14 款风格、10 位摄影师学习线索 | [风格图谱](skills/guangjian-retouch/references/style-atlas.md) |
| 视频色彩管理、镜头匹配、剪辑与声音 | [视频工艺](skills/guangjian-retouch/references/video-craft.md) |
| 接受/回退记录与知识沉淀 | [学习与记忆](skills/guangjian-retouch/references/learning-memory.md) |
| 已运行案例、推理反例与适用边界 | [案例手册](skills/guangjian-retouch/references/casebook.md) |
| 作者、厂商与真实引擎依据 | [来源](skills/guangjian-retouch/references/sources.md) |

79 个章节支持本地关键词检索：

```sh
node skills/guangjian-retouch/scripts/knowledge.mjs search --query '滨田英明 柔光人像 肤色'
node skills/guangjian-retouch/scripts/knowledge.mjs read --id style-daily-soft
```

检索不调用模型，不能代替实际看图。偏好来自明确接受与反馈，不把浏览、试片或取消当作认可；当前只在单照片项目内记录。

## 工具范围

- 静态 JPEG、PNG、WebP、AVIF 输入；8 位 sRGB；PNG / JPEG 输出。
- 31 项全局控制，独立风格层，矩形 / 径向 / 渐变局部，裁剪与拉直。
- 本地项目保存意图、批注、候选、版本与导出记录；预览只监听 127.0.0.1。
- 输入最多 30 MB / 5000 万像素 / 最长边 16384；输出最多 8192 px / 1600 万像素，不放大。
- 没有 RAW 显影、16 位工作流、语义分割或生成式增删物体。HEIC / RAW / TIFF 先转换。
- 视频工艺知识可用于判断与方案；视频实际执行需要宿主另有可用媒体工具，本照片 CLI 没有视频时间线或导出。

## 开发与检查

```sh
npm run setup
npm run knowledge:check
npm test
```

测试覆盖原片保护、方向、候选冲突、绝对参数、批注范围、版本、预览/导出像素一致性、本地会话和知识检索。测试图由程序生成，不包含个人照片；技术测试不能证明摄影审美质量。

[验证范围](docs/VALIDATION.md) · [参与维护](CONTRIBUTING.md)
