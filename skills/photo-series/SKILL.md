---
name: photo-series
description: FrameLark 组图册：从一批照片按用途确定主题、精选与排序，协调逐张精修后交付完整组图或朋友圈九宫格。适用于目录选片、连拍取舍、旅行分享、组图节奏和整组返修；实际像素处理共享 photo-retouch 引擎，单张修图用 photo-retouch，现场问怎么拍用 photography-eye。
---

# 做组图 · 组图册

负责整组照片成立：主题、选片、观看距离与信息变化、排列、完整交付。数量按用户要求，九宫格是三行三列的一种用途，不能把所有任务固定成九张。人物、建筑、生活细节与日夜可以同组；共同表达不要求照片拍同一种东西。

选片被否定、九格缺少审美或需要专家参考时，读 [编辑取舍](references/editorial-decisions.md) 与精修台的 [作品精读](../photo-retouch/references/expert-visual-studies.md)。在相近原片中比较动作、空间和颜色关系，再看换片或排序后的真实组图；留远、收近、保留复杂性或减少信息，都由当前画面决定。不把每种题材占一格、统一淡色或同一套框景当成成组方法。

统一插件同时提供本 Skill、[精修台](../photo-retouch/SKILL.md) 和摄影眼。组图使用精修台中同一份本地引擎、照片项目与审核机制，不重复开发修图工具。本 Skill 所在目录记为 `<series>`，共享引擎目录为相邻的 `<series>/../photo-retouch`，下文记为 `<retouch>`。独立安装组图册时，安装器也会准备该依赖；缺少时说明具体依赖，保留已经完成的观察和取舍，不虚构像素处理。

## 从现有照片开始

1. 先判断用户要精选还是全部交付，以及用途、数量、必留人物和内容。已有信息直接用；不要把纪念或活动交付擅自变成作品集淘汰。读 [组图创作](../photo-retouch/references/collection-craft.md)。
2. 新目录先建立联系表，实际浏览全部待审范围，再打开候选原片与细节。统计、文件名和缩略均值不代替看图。已有 collection 或单图项目先读取，沿用已保存版本、批注与用户认可，不从原片重新覆盖。
3. 创作型精选先读 [编辑取舍](references/editorial-decisions.md)，再按 [主题驱动的组图](../photo-retouch/references/theme-led-series.md) 定表达、观看感受与纳入/退出依据，再正式选片。地点、题材清单或统一色相不算主题。用户交给 Agent 决定时自行推进，不增加审批。

目录同时包含同一帧 JPG 与 RAW 时，先按 JPG 浏览，每帧只占一个候选；为入选图需要高精度显影时再检查 RAW 后端。用明确 `images` 列表避免把两种格式重复导入或超过 500 个输入上限；更大批次分段审阅，未看的范围标为未审。

## 让每张与整组一起成立

按 [成片执行卡](../photo-retouch/references/finishing-workflow.md) 记录每张值得留下的关系、实际成片目标和保护内容。初选就试排，以发现重复与缺口；不能为凑满九张保留无作用的弱片，也不能用“角色齐全”替代照片好看。用户要求完整九张时继续比较备选，不把三张定调试片交成最终九格。

对入选照片调用精修台，传递真实单图项目路径、目标、共同光色方向、逐张适配与保护内容。单图先 inspect 并按 editProtocol 分流；新栈和 RAW 使用 document-tools/document，旧配方才用 settings/items/compose。精修台负责裁剪、调色、局部、试片、返修、审核和保存，原片已成立时可以保留。协调多个 Skill 不意味着必须新建对话或子代理；当前 Agent 可以顺序执行。

宿主有图片编辑且确实有益时，按 [AI 多图试片](../photo-retouch/references/generated-reference.md) 一次制作所需数量的方向板，逐格绑定原片。用户要原片实修时继续将可实现的关系落实到精修项目；直接采用 AI 编辑的选择仍尊重用户。没有生图能力就继续原片流程，不索要额外 Key，不用生成测试图探测。AI 板与实际原片成片分别标明。

正式排列使用实际准备交付的版本。检查观看入口、明暗重量、色彩面积、远近、疏密、动作方向与信息变化；昼夜保留各自光感。按 [真实九格预览](../photo-retouch/references/collection-tools.md#实际版本的三行三列预览) 从最新方案的已保存版本路径、按计划顺序用 image-input-board --columns 3 生成三行三列；四列联系表只用于初选。分别看完整单张、真实九格与参考板设计，标题、IP 或漂亮边框不能替照片过关。换片或修片后复看真实排列，用最新 snapshotHash 保存方案。

## 执行与交付

读 [组图工具](../photo-retouch/references/collection-tools.md)，其中 `<skill>` 替换为 `<retouch>`。所有修图与组选片复用同一份引擎与原片；输出放在新的目录。

```text
node <retouch>/scripts/setup.mjs
node <retouch>/scripts/cli.mjs collection-init --project <new-folder> --input <images.json>
node <retouch>/scripts/cli.mjs collection-inspect --project <collection-folder>
node <retouch>/scripts/cli.mjs collection-sheet --project <collection-folder> --page 1 --view original
```

在实际看图之后保存 `collection-brief` 与 `collection-plan`；通过返回的单图项目进入精修台。导出前核对最新版本、取舍和实际三行三列排列，再用 `collection-export` 按顺序导出已保存的照片及 manifest。全部导出完成且未过期后，按 manifest/结果中 position 顺序，用各自真实 result.path 在新目录重做九格，复看编码后的输出。排列预览完整缩小放格，含留白，不模拟平台裁切；独立照片仍交付各自成片。不把联系表、低像素生成板或组图计划当成已修好的九张照片。

交付主题、整组预览、独立照片、顺序与备选理由、原片与可继续编辑的项目位置。明确已审范围、完成数量和未完成处；收到换图、改排序或单张返修时沿用现有项目，并重新检查受影响的相邻关系。用户认可、Agent 审核与工具成功分别记录。

已有完整本机工作台时，可点“共享组图”打开当前 collection 目录，与用户共同修改主题、取舍和顺序；单图按钮沿用原项目继续精修。CLI 更新和已接受版本会同步显示，过期方案须复看后重新保存。只装 Skill 时继续 CLI 与联系表，不假定完整 Studio 已安装或启动。
