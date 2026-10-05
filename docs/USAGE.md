# 使用 FrameLark

从现场拍摄到单张精修，再到一组照片的整理，按你想完成的事情选择入口。摄影眼由 `photography-eye` 提供；精修台和组图册共用 `photo-retouch`，不需要再安装第三套 Skill。

[返回主页](../README.md) · [English](USAGE.en.md) · [安装指南](INSTALLATION.md)

## 找画面 · 摄影眼

附一张现场照，告诉小帧你想拍什么、使用什么设备，以及能否换位置：

> 用 $photography-eye 看这里能拍什么。我用手机，可以走动。给我不同拍法，告诉我站哪、相机多高、怎么取景、用什么参数，以及拍完怎么调色精修。

摄影眼给出机位、角度、时机、参数和后期成片目标，完整图板默认一张主推加四个候选。选定方向后可以复拍，再继续比较构图与光线。

现场拍摄辅导目前通过 Skill 使用，网站尚未接入这套流程。拍好的照片需要实际精修时，交给照片精修 Skill。完整入口见 [摄影眼](../skills/photography-eye/SKILL.md)。

## 修照片 · 精修台

附上原片，说明用途、想留下的感觉和必须保留的内容：

> 用 $photo-retouch 精修这张照片，准备发朋友圈。保留真实肤色和自然光线，可以调整裁剪、背景明暗和色彩。先审片，再给我能比较的试片。

一次精修通常按以下顺序进行：

1. 看原片，判断主体、光线、构图关系和干扰，说明值得保留与需要调整的地方。
2. 确定成片方向，先试裁剪、影调、色彩和局部处理。
3. 对照原片与候选，打开单图检查细节，按批注继续调整。
4. 接受满意的候选，保存版本，按用途导出。

风格预设可以调强度，也可以自定义参数。候选支持逐项勾选、组合预览与一次接受；参数和局部层可以锁定。画面区域保护可以保留已接受的像素核心，保护期间裁剪与拉直会锁定，解除保护先试片。详见 [受控编辑](CONTROLLED_EDITS.md)。

网页工作台可以直接手动修图；使用 Agent 时，可圈选范围并留下评论。Agent 继续前需要读取当前版本、意图和全部最新批注。完整流程见 [照片精修](../skills/photo-retouch/SKILL.md)。

## 做组图 · 组图册

先说用途，再说数量、主题倾向和必留照片：

> 用 $photo-retouch 从这个目录整理朋友圈九宫格。先确定主题，挑有变化又互相呼应的九张，逐张精修。第二张合照一定留下。保留原片，把入选副本和成片分别放好，给我整组预览。

组图先确定主题，再从联系表筛选，打开候选单图复看，逐张精修，最后检查整组顺序与节奏。人物、大场景和细节可以互相呼应；选片同时考虑内容变化、光色关系与重复程度。

旅行分享、人物交付、活动记录、商品展示、作品集和归档各有不同的取舍，不要求每种用途都编一个故事，也不强制套同一预设。

| 入口 | 适合处理什么 |
| --- | --- |
| Skill | 从照片目录筛选，每批最多 500 个文件；联系表每页 20 张，记录入选、备选、不入选的理由，逐张检查后按顺序导出。 |
| 网页组图空间 | 2–12 张已选照片，设置用途、表达与排序依据，逐张审片、试片和顺序导出，也可以保持自己的顺序。 |

主题、已保存照片或批注更新后，旧组选片会标为过期，需要复看。导出失败可以逐张重试。原片保留，不自动发布。

[主题驱动的组图](../skills/photo-retouch/references/theme-led-series.md) · [选片与排序](../skills/photo-retouch/references/collection-craft.md) · [组图工具](../skills/photo-retouch/references/collection-tools.md)

## 可选 AI 精修

Skill 会先检查宿主是否提供可用的生图或图片编辑工具；没有时跳过 AI 环节，继续原片精修。

可用时，可以按所需数量一次生成多图试片或综合精修板，处理裁剪、光影、局部与质感。每格都要检查细节与像素质量，再决定用作参考或交付。生成板不保证每格都有独立高分辨率，也不能替代对原片与成片的验收。

原片像素处理与生成式图片编辑是两种处理方式，交付时要说明用了哪一种。[AI 多图试片与完整精修](../skills/photo-retouch/references/generated-reference.md)

## 批注、版本与协作

可以在照片上圈选范围、写评论，比较当前版本与候选，再接受或取消。命名版本可用于保存、对照和恢复；导出记录留在项目中。

本机网页可与 Skill 共享文件项目。先在仓库中运行 `npm run setup`，再通过网页「文件项目」保存当前照片或打开已有项目。也可从 Agent 打开同一个项目：

```sh
npm run photo -- studio --project /你的/照片项目
```

文件项目共享批注、候选、版本与导出记录，并检查并发修改；原片单独保存，候选接受后才成为当前版本。浏览器草稿独立保存，未选择的草稿不会自动迁移。

「交给 Agent 继续」会保存当前意图和批注，记录待接手请求。Agent 领取后处理并返回真实候选；包含诊断、复审、文字或保护的项目会在主工作台的「协作精修」中打开。模型执行与看图判断由宿主 Agent 完成。完整操作见 [共享文件项目](DEPLOYMENT.md#网页与-skill-共享文件项目) 和 [接续请求](DEPLOYMENT.md#给-agent-留下可接续的请求)。

## 工具与文件范围

| 功能 | 支持内容 |
| --- | --- |
| 光色与风格 | 31 项全局控制、14 款预设、独立风格层与强度调整。 |
| 裁剪与局部 | 裁剪、拉直，矩形 / 径向 / 渐变几何蒙版与羽化。 |
| 查看与比较 | 原片和版本对照、相同位置与倍率、100% 查看、缩放和平移。 |
| 批注与协作 | 圈选范围、评论，读取最新版本与批注后继续。 |
| 项目与版本 | 候选预览、接受 / 取消、命名版本、恢复与导出记录。 |
| 审核与继续 | 结构化诊断、对应组合的复评、调整来源与项目交换。 |
| 文字点缀 | 按要求添加短句、贴纸或小标题，独立文字层，分别导出有字 / 无字版本；默认修图不加字。[文字指南](../skills/photo-retouch/references/lettering.md) |

**输入**支持静态 JPEG、PNG、WebP、AVIF，使用 8 位 sRGB；单张最多 30 MB、5000 万像素、最长边 16384 px。网页最多 12 张、总量不超过 1 亿像素。

**输出**为 PNG / JPEG，支持分享、打印与原尺寸预设，最多 8192 px / 1600 万像素，不放大；原尺寸预设也受此限制。

macOS 本地版可转换静态 HEIC / HEIF，并保留原文件。其他环境及 RAW、TIFF 需先转换。本地像素工具不支持 RAW 显影、16 位工作流、自动主体分割或生成式增删物体；可选宿主图片编辑的范围以实际工具为准。

本地图片工具不请求模型 API，预览只监听 `127.0.0.1`。使用宿主视觉或图片编辑能力时，图片处理遵循宿主工具的规则。网页 AI 会把分析图片与相关意图、批注发送到你配置的模型服务。用户明确选择保存在照片项目中，可按要求整理为本地偏好档案，不会自动训练或上传偏好。

## 摄影知识

知识覆盖判断与构图、题材、光色、局部、选片、整组交付和摄影师学习参考。摄影师参考用于学习观察方法与风格，不代表官方滤镜或精确复刻。

| 内容 | 文档 |
| --- | --- |
| 判断与构图 | [审美判断](../skills/photo-retouch/references/aesthetic-judgment.md) · [构图与拍摄](../skills/photo-retouch/references/composition-craft.md) |
| 题材与场景 | [题材策略](../skills/photo-retouch/references/subject-playbooks.md) |
| 选片与组图 | [用途、取舍与排序](../skills/photo-retouch/references/collection-craft.md) · [联系表与工具](../skills/photo-retouch/references/collection-tools.md) |
| 光色与细节 | [光线与色彩](../skills/photo-retouch/references/light-color.md) · [局部与输出](../skills/photo-retouch/references/detail-local-crop.md) |
| 风格与来源 | [风格图谱](../skills/photo-retouch/references/style-atlas.md) · [来源](../skills/photo-retouch/references/sources.md) |
| 案例与反馈 | [案例手册](../skills/photo-retouch/references/casebook.md) · [学习记录](../skills/photo-retouch/references/learning-memory.md) |
| 校准与交付 | [真实视觉案例](../skills/photo-retouch/references/visual-examples.md) · [诊断、复审与交换](../skills/photo-retouch/references/reviewed-workflow.md) |
| 视频 | [调色与剪辑知识](../skills/photo-retouch/references/video-craft.md) |

在仓库目录中检索：

```sh
node skills/photo-retouch/scripts/knowledge.mjs search --query '滨田英明 柔光人像 肤色'
node skills/photo-retouch/scripts/knowledge.mjs read --id style-daily-soft
```

本地关键词检索不调用模型，审片仍需 Agent 实际看图。视频知识用于方案判断；执行需要宿主另有媒体工具，本照片 CLI 不支持视频导入或导出。

[更多界面](SCREENSHOTS.md) · [项目结构](ARCHITECTURE.md) · [开发与检查](../CONTRIBUTING.md) · [验证范围](VALIDATION.md)
