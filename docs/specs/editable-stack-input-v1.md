# FrameLark 可编辑修图栈设计与本地开发规格

版本 1.0 · 2026 年 10 月 5 日 · 供本地开发与验收使用

本文把“自然语言提出修改，用户能继续编辑每一步”的目标，落成可执行的产品、架构、渲染和 UI 规格。建议在现有 FrameLark 工具注册表、候选事务和暗房界面上，补齐持久化的可编辑操作栈。对话、滑杆、蒙版和历史应操作同一份编辑文档，接受建议后仍能定位和修改原来的步骤。

**交付范围：设计文档，不是已实现功能。** 本轮只做产品资料与源码核对；没有修改业务源码，没有提交、推送或创建 PR，也没有部署。实现由本地开发接手。本文中的新模块、接口、数值门槛和示例 JSON 均为建议规格，须按验收门槛验证。

源码基线：私有仓库 `GeminiLight/FrameLark`，`main` 提交 `c0fe54486e3ab798fbf08ce18214f41666364f5e`。核对时间为 2026-10-05 15:50 UTC 附近。仓库仍在持续开发，本地开始前必须重新读取最新源码和差异；路径比本文行号更可靠。

## 阅读路径

- 先看第 1、2、4 节，确认真正缺的能力和必须保持的行为
- 架构与像素实现看第 5 至 11 节
- 界面统一看第 12、13 节
- 按第 14 至 17 节拆任务和验收；第 18 节可直接交给本地 Codex
- 第 19 节记录尚待验证的工程决策，第 20 节列出官方资料

## 1 目标和交付边界

用户需要的是一个可继续修改的修图过程。例如：“整体偏暗，提亮一点，但已经很亮的灯和窗户别再亮。”系统应提出可解释、可预览的曝光步骤及保护蒙版。应用后，用户仍能调曝光、修改保护范围、暂停这一步、删除它，或者说“这一步弱一点”，且保留后续其他调整。

这一能力不等于增加更多聊天动作，也不等于把最终参数显示成一个图层列表。文档必须保存独立步骤的身份、参数、输入关系、范围和执行语义，渲染器必须能按文档重放。

首个完整交付应覆盖：

1. 自然语言生成或修改结构化步骤，先预览再应用
2. 已应用步骤可编辑参数、强度和蒙版，可开关、删除、命名及合法重排
3. 修改早期步骤后重算后续步骤，不靠叠加反向参数抵消
4. 撤销和重做编辑动作；命名版本与当前操作栈保持独立
5. 刷新、重开项目、Web/Skill 交换后仍可继续编辑
6. 同一引擎服务浏览器预览和 Node 导出，保护既有照片与旧项目
7. 视觉和交互沿用当前工作台，避免新的独立编辑器和重复控制入口

首轮不承诺：RAW 显影、16 位源文件全流程、完整 Photoshop 混合模式、自动精准语义分割、生成式增删物体、任意节点图编辑器、多人实时协同合并。未来能力通过明确接口扩展，不通过虚假的当前能力描述占位。

## 2 当前系统已经有什么

### 2.1 已有基础应当复用

| 能力 | 代码证据 | 当前行为 |
| --- | --- | --- |
| 注册工具与严格参数 | `apps/studio/public/photo-tools/registry.js`、`values.js` | 8 类工具；工具版本、目标、参数、依赖校验；方案最多 24 步 |
| 可复用范围 | `photo-tools/targets.js`、`builtins/mask.js` | image、region、object、annotation、output；几何范围与前序输出引用 |
| 工具执行与候选 | `skills/photo-retouch/scripts/photo-tool-runtime.mjs`、`tool-candidates.mjs` | 子进程执行、超时/取消、候选预览与接受；云端有内联降级 |
| 独立来源撤回 | `apps/studio/public/app.js` 的 `renderAdjustmentLayers`、`removeAdjustmentLayer` | 当前调整清单可撤回部分来源；局部已有启用与强度控制 |
| 固定基准重算 | `engine/edit-plan.js`、`project.mjs` | 候选逐项选择从固定基础重新编译，不累加上次预览 |
| 事务和保护 | `project.mjs`、`edit-guards.js`、`reference-store.mjs` | revision、selectionHash、参数锁、最终像素保护、原子写入 |
| 原片和渲染 | `render.mjs`、`photo-rendering.js`、`editor-engine.js` | 保留原片；8 位 sRGB；全局参数后局部；统一像素模块 |
| 草稿和版本 | `draft-store.js`、`project-snapshot.js`、`project-exchange.js` | 浏览器草稿、命名快照、项目交换；工具记录可存档 |

`apps/studio/public` 与 `skills/photo-retouch/scripts/engine` 的共用模块由 `scripts/check-shared-engine.mjs` 检查逐字节一致。本次基线为 28 个共用模块。保留这条分发约束，避免 Web 和独立 Skill 各自实现一套语义。

### 2.2 真正缺口

**当前工具图主要编译编辑状态，不是完整的像素操作栈。** `compileToolPlan` 顺序执行工具，但 `applyToolEffect` 最终写入 settings、style、crop、locals。多个全局设置随后被合成为一次全局渲染。`toolRunCandidate` 把执行结果差分追加到 advisorLayers；保存的 `toolRuns` 明确属于历史记录，不能自动当成可信的可执行编辑文档。

因此，现状虽已支持逐项采纳和部分单独撤回，仍缺少：统一的持久步骤模型、接受后的步骤参数编辑、完整的依赖安全重排、版本化蒙版引用、语言对旧步骤的定向更新，以及真正顺序敏感的像素阶段。

**不能把当前 `renderPixels` 循环调用就称为新栈完成。** 它复制为 `Uint8ClampedArray`，在操作中有色域压缩和输出限幅。逐步骤复用会反复量化，改变旧效果，并让后一步无法使用之前已丢弃的信息。

**不要重建已有保护机制。** 当前“局部排除蒙版”“参数锁”“最终像素保护”是三个不同契约。曝光层的高光保护不是永久锁；调整其他层仍可能改变该处。UI 和模型文案必须保持区分。

### 2.3 当前界面的依据

以基线 `index.html` 为准，右侧已有“审片 / 精修 / 风格 / 顾问”四个页签。部分 `docs/WEB_DESIGN.md` 段落及旧截图记录的是较早的三入口布局，不能照图重做导航。实际视觉基础来自 `atelier.css`、`inspector-flow.css`、`controls.css` 和后续样式覆盖。本规格沿用四入口、同一右侧检查面板和照片主画布。

## 3 相关产品可借鉴什么

| 产品 | 官方行为 | FrameLark 应采用的原则 |
| --- | --- | --- |
| Photoshop 调整层与智能滤镜 | 参数可编辑，支持开关、移除、排序；智能对象的滤镜蒙版有共享语义 | 可编辑效果与原片分离；不要误称 Adobe 智能滤镜天然拥有每步独立蒙版 |
| Lightroom Classic | 蒙版支持明度范围、过渡、反转和加减交；历史与快照分别保存修改过程和状态 | 参数蒙版可视、可修正；历史列表不是任意重排的效果栈 |
| darktable | 模块顺序决定像素处理；历史记录修改；模块可按蒙版和不透明度混合 | 最接近所需核心：顺序模块、输入蒙版、明确混合语义与依赖 |

这些是产品设计参考，不代表复制其内部算法。推荐“小而完整的非破坏性操作栈”，无需先实现 Photoshop 的全部图层系统。资料链接及颜色处理依据见第 20 节。

## 4 需求和不可破坏的约束

| 编号 | 必须满足的要求 | 可观察结果 |
| --- | --- | --- |
| R01 | 原片不可变，编辑文档与像素分离 | 删除全部新步骤后恢复原来的基础渲染；原文件校验不变 |
| R02 | 步骤有稳定 ID 与工具版本 | 重排、重命名不改变身份；“弱一点”能更新原步骤 |
| R03 | 参数、蒙版、强度、开关均可继续编辑 | 重开后控制值和画面可复现 |
| R04 | 顺序语义真实且明确 | 非线性 A 后 B 与 B 后 A 可产生不同结果 |
| R05 | 依赖先校验再变更 | 缺失、循环、向后引用、失效输入不会静默执行 |
| R06 | 栈、撤销日志、命名版本分开 | 单步删除不等同恢复旧版本；撤销删除可恢复整项 |
| R07 | 预览、接受、导出绑定相同身份 | 旧请求、旧图片解码、旧模型回复不能覆盖新状态 |
| R08 | 旧项目不被隐式改画面 | 只读打开不写盘；迁移保留备份与旧引擎身份 |
| R09 | 所有入口共用命令和校验 | UI、HTTP、CLI 不维护三套边界判断 |
| R10 | UI 统一且可访问 | 单一选中步骤、单一属性区；手机与键盘可完成核心流程 |
| R11 | 模型只提出白名单数据补丁 | 不执行生成代码，不接受任意路径、命令或未知工具 |
| R12 | 性能与画质依据可复核 | 同主机基准、黄金样例和真实 UI 检查；不拿单测代替审美验收 |

中性参数、关闭步骤、opacity=0、全零蒙版必须是严格旁路。几何不变且没有其他编辑时，RGBA 包括透明像素应保持字节相同；JPEG 文件字节不在此保证内。多步效果不能每次从上一张 JPEG 继续处理。

## 5 目标架构与模块边界

### 5.1 一份文档驱动所有入口

建议把 PhotoDocument 作为“当前是什么”的唯一事实来源。它包含不可变源引用、固定位置的构图配置、兼容基础、按序步骤、蒙版版本、引擎版本和文档 revision。UI 选择、面板展开、蒙版显示模式等属于 viewState，不进入图像内容哈希。

IntentPlanner 只产出 DocumentPatch；DocumentCommands 校验并生成新文档；Renderer 消费已验证的不可变 RenderPlan；ProjectStore 做持久事务；UI 订阅文档与任务状态。模块不直接修改对方内部数组。

建议接口：

- `validateDocument(document, capabilities) -> ValidDocument`
- `applyCommands(document, commands, expectedRevision) -> {next, transaction, invalidation}`
- `compileRenderPlan(document, sourceIdentity, frameSpec) -> RenderPlan`
- `render(plan, pixels, {signal, onProgress}) -> RenderResult`
- `commit(projectId, transaction, expectedRevision, requestId) -> CommitReceipt`

校验层不做 I/O 或模型调用；渲染层不保存项目；存储层不理解滑杆；顾问不直接写像素。复用现有注册表的参数目录，但把 v1 状态编译与 v2 像素工具的语义分开。

### 5.2 建议的处理顺序

1. 校验不可变源，解码、统一方向与 sRGB 输入身份
2. 固定 GeometryStage 按当前裁剪、旋转、尺寸采样到输出网格
3. LegacyBase 按旧引擎精确重放现有光色和局部状态
4. 转换为声明的线性工作 RGB，依次执行 v2 调整节点
5. 显示编码与必要的文字合成
6. 沿用最后的已确认画面保护合成
7. 一次最终文件编码或画布显示

GeometryStage 是构图控制，不是可任意拖入色彩节点之间的图层。这样能与当前“先取样构图，再处理光色”的基线衔接。用户可编辑或重置构图，但首轮不支持任意插入几何变换。不能在 UI 显示一个看似可拖动、实际上会被偷偷挪回固定位置的裁剪节点。

裁剪、分辨率和旋转变化可能影响细节、颗粒、暗角和实时输入蒙版。系统按实际网格重算，不承诺“先全图处理再裁剪”与现有路径等价。未来引入源平面处理或局部 ROI 时，应作为新 pipeline 版本迁移并验证。

### 5.3 高内聚而不过度拆分

建议新增一个 `edit-stack/` 领域目录，内部按文档、命令、编译、蒙版、渲染身份组织；避免把一个校验函数拆成十几个只有转发的文件。应用层只保留少量适配器。第一轮不引入大型前端框架、不增加新数据库，也不为每个工具制造独立 HTTP 路由。

## 6 数据模型与版本语义

### 6.1 文档结构

以下为示意结构，不是已经可执行的当前协议：

```json
{
  "schema": 3,
  "documentId": "photo-001",
  "revision": 12,
  "source": {"assetId": "asset-001", "contentHash": "sha256:..."},
  "pipeline": {"id": "recipe-v2", "colorSpace": "linear-srgb"},
  "geometry": {"crop": null, "angle": 0},
  "base": {"kind": "legacy-v1", "versionId": "version-009"},
  "steps": [
    {
      "id": "step-exposure-01",
      "tool": "exposure",
      "toolVersion": 2,
      "title": "提亮暗部并保护高光",
      "parameters": {"ev": 0.6, "headroomPolicy": "limit-positive-gain"},
      "enabled": true,
      "opacity": 1,
      "maskRef": {"id": "mask-highlight-01", "version": 1},
      "dependsOn": [],
      "groupId": "intent-07"
    }
  ],
  "masks": [
    {
      "id": "mask-highlight-01", "version": 1,
      "reference": {"kind": "live-input"},
      "expression": {
        "kind": "luminance", "mode": "exclude-highlights",
        "start": 0.55, "end": 0.80
      }
    }
  ],
  "groups": [{"id": "intent-07", "title": "让画面更明亮"}]
}
```

源尺寸、方向、ICC/规范化身份、源文件与标准化文件校验应由资产记录保存，不能仅信任一个名称或路径。`base.versionId` 必须是同项目、不可变且有序更早的兼容基础；禁止循环，禁止默认引用其他项目。新照片的 base 可以是明确的 original。

### 6.2 字段约定

| 对象 | 权威字段 | 语义 |
| --- | --- | --- |
| Step | id、tool、toolVersion、parameters | 身份稳定；参数契约由该工具版本决定 |
| Step | enabled、opacity、maskRef | enabled=false 为旁路；opacity 限 0 到 1；蒙版单独版本化 |
| Mask | id、version、expression、reference | 描述式范围；版本不可变，修改产生新版本 |
| Group | id、title | 组员由 step.groupId 唯一决定；首轮不提供组不透明度 |
| Transaction | id、beforeHash、afterHash、commands | 一次撤销单位；与当前处理顺序不同 |
| Snapshot | id、documentHash、label | 命名的完整配方；不把临时渲染任务存成版本 |

数组顺序就是处理顺序。`dependsOn` 只表达真正的资源或语义依赖，不为普通串行像素输入制造冗余的全链硬依赖，否则关闭任何一步都会关闭所有后续节点。

普通后继会接收新的上游像素。只有显式引用某个蒙版输出、冻结参考或资源的节点，才需要该生产者保持可用。首轮 UI 显示顺序列表和依赖提示，不开放任意连线图。

### 6.3 delta 和 absolute 必须重新定义

现有 v1 `mode=delta/absolute` 是“相对或覆盖最终参数”的状态语义，不能直接解释为顺序滤镜的像素语义。注册表须按 `(toolId, toolVersion)` 查找；当前仅按 tool.id 唯一注册的实现不足以同时承载 v1/v2。工具语义版本与 kernel 实现版本分别记录，稳定规范化后的内容才可计算哈希。执行时不得静默拓扑重排用户的列表。

新 v2 `exposure.ev` 表示本步骤的曝光量；“改成 +0.3 EV”就是更新该节点参数，“再提亮 +0.3 EV”才新增步骤。其他工具同样定义局部于步骤的参数。

旧 v1 工具保留原契约，作为 LegacyBase/旧候选执行。不能悄悄改变工具 version=1 的意义，也不能用“新值减去旧值”假装所有非线性工具可逆。需要把旧配方拆解成新步骤时，做显式、可比较的转换候选。

首轮建议限制：单次方案最多 24 项；整份文档最多 64 个步骤；蒙版表达式深度最多 8；几何画笔点数先沿用现有 600 点。后两个新上限需基准验证，不能直接作为已支持规模宣传。

## 7 渲染与颜色精度契约

### 7.1 v2 节点的统一数学语义

对不改变几何和 alpha 的调整节点：取输入 I，工具计算 F(I, p)，蒙版覆盖 M，强度 o，输出为 I + o × M × (F(I, p) - I)。在线性工作 RGB 中混合；M 是 0 到 1 的覆盖数据，不做 sRGB 解码。工具必须声明工作空间、输入/输出范围、邻域半径、是否保留 alpha，以及中性参数是什么。

opacity 缩放结果差异，不等价于把参数乘上强度。旧 localAmount 的 0 到 150% 会缩放参数，不能直接迁移成新 opacity。界面上“强度 50%”与“曝光减半”不能混为一谈。组不透明度也不等于逐个子步骤 opacity 同时减半，因此首轮只提供分组、折叠和整组开关事务。

### 7.2 精度路线

新顺序光色节点使用 Float32 工作缓冲，源边界解码、显示/导出边界编码。保持 alpha 独立；透明像素不得制造颜色污染，零权重和旁路节点直接保留输入。需要字节级无变化承诺时，保留原始 RGBA 快路径，避免不必要的“解码再编码”舍入。

Float32 仅改善后续工作精度，不恢复已经在源图或旧 8 位归一化中丢失的动态范围。新工具还须定义负值/超白、非有限数拒绝、随机 seed、边界采样和最终色域映射；这些都是 kernel 契约的一部分。

当前 `editor-engine.js` 继续服务 legacy-v1。不能仅将数组类型改为 Float32 就认定算法已经升级：tone curve、色域压缩、detail、grain、vignette 的数值域和顺序均要审计。按工具族逐步增加 v2；尚未移植的工具要如实显示为兼容基础或不可用，不能在新栈内暗中回退为多次 8 位处理。

**工具完成的最低范围：** 曝光、影调、色彩、细节、颗粒/暗角、风格的每类能力都要有明确的可编辑表示或显式兼容边界。仅曝光可编辑的里程碑可以先交付，但不能宣称整套需求完成。风格建议保存展开后的参数配方与预设版本；修改一个风格子步骤不应被下次读取新预设覆盖。

### 7.3 Sharp 和 Canvas 的职责

基线依赖为 Sharp 0.35.4 与 `@napi-rs/canvas` 0.1.100。首轮不必先更换库。Sharp 负责受控 I/O、方向、色彩配置、缩放及编码；共享内核负责语义节点顺序。官方文档说明 Sharp 单流水线旋转、组合顺序等有约束，不能把任意节点直接连成方法链。

Canvas 作为显示和既有文字适配器，不作为配方真相或每步中间存储。其预乘 alpha 往返可能损失透明颜色。新内核与 Node/浏览器统一，文字产生的兼容量化边界要显式记录。RAW、HDR 显示、广色域工作流和 16 位交付属于另行验证的扩展。

### 7.4 几何和邻域

所有渲染请求携带 `frameSpec`：原片实际整数取样矩形、输出宽高、旋转、像素中心规则、缩放核及颜色/pipeline 版本。蒙版按此映射。默认蒙版控制输出混合，不截断空间滤波输入；不能在边界外把输入当成空白。细节工具声明 halo 和边界策略；瓦片/ROI 必须保留邻域，不能对小裁片独立锐化后假称与整帧一致。

同一已解码输入、内核和 frameSpec 下要求确定性一致。浏览器/Node 的解码、ICC 和重采样可能不同；共享 JS 不能单独证明跨环境逐像素相同。端到端跨环境比较应先固定输入缓冲和取样适配器，再单独测量解码差异。预览与导出在可比输入和相同 frameSpec 下要求确定性一致；不同尺寸只能要求经过验证的视觉/数值容差，不能承诺逐字节相同。最终保护像素沿用同尺寸、同构图约束，导出 JPEG 只保证编码前的保护结果。

## 8 蒙版是独立的可编辑数据

### 8.1 类型与组合

复用矩形、径向、线性、画笔和排除区；新增亮度范围蒙版。建议统一 MaskExpression，可表达 union、subtract、intersect、invert，运算定义为：union=max(A,B)，subtract=A×(1-B)，intersect=A×B，invert=1-A。不要只用名称而不固定软边相交的数学行为。

蒙版引用采用 id+version。修改范围生成新版本，并显式选择“仅当前步骤复制后修改”或“更新全部使用此蒙版的步骤”。默认仅当前步骤，避免用户改一层时无意改掉多个效果。共享引用需显示使用者数量和影响步骤。讨论批注的 noteId 只作来源记录；删除批注不删除已接受的蒙版，删除步骤也不顺带删除讨论。

### 8.2 参考和坐标

- drawn：保存于已定向原片坐标；shape、仿射基底或完整点集可重放
- live-input：参数蒙版在当前步骤的输入上采样；上游修改后自动重算
- frozen-reference：固定在某个源/版本/网格身份上；必须有哈希与可读取资源

默认 live-input。不能用本步骤已经提亮后的图来生成保护本步骤的蒙版，否则阈值产生反馈和不稳定。冻结参考与实时输入要在高级说明中可见。

现有 view→original 的矩形转外接框逻辑不能被当作精确旋转蒙版。新的几何契约应保留四角/仿射基底或逆变换逐点求覆盖；裁剪不改变蒙版定义，只改变可见区域。无法精确重映射的变换应阻止并说明原因，不能静默扩大范围。

### 8.3 UI 可见的蒙版状态

提供“照片 / 覆盖范围 / 黑白蒙版”三个显示状态；显示模式属于 viewState。显示某蒙版不自动启用该步骤，不改变当前照片。暂停步骤仍可查看和编辑范围，界面同时标明“此步骤已暂停”。

对象名称、来源与置信度延续现有契约。几何框或亮度范围只能说是近似选择，不得标为已识别人像/天空。若引入分割模型，新增受控 Adapter、来源版本、质量验证及隐私边界后再开放。

## 9 核心示例提亮而保留高光

### 9.1 可执行的方案表达

用户意图：提升暗处可见性，同时尽量不改变已明亮区域。建议产生一个曝光步骤，绑定“排除高光”的参数蒙版；用户指明灯头时，再与手工排除范围相交。无需先全局提亮，再叠一个无法保证还原的负曝光层。

建议初始候选：曝光 +0.6 EV；保护从线性明度 0.55 开始，到 0.80 完全保护；opacity=1。这里的数值仅用于说明与合成测试，不是自动适合任意照片的默认美学判断。实际推荐需结合照片和温和初值。

### 9.2 明确公式与边界

1. 从本步骤输入计算线性明度 Y = 0.2126R + 0.7152G + 0.0722B
2. h = smoothstep(0.55, 0.80, Y)
3. M = 1 - h；如有绘制范围，再按约定组合
4. g = 2^EV，F = g×I
5. 在线性工作缓冲混合输出，最终显示/编码时再限幅

Y≥0.80 时 M=0，这一步对这些输入像素严格旁路；Y≤0.55 时完整应用；中间平滑过渡。阈值的单位是线性明度，UI 可用易懂滑杆，但说明不得混淆为 sRGB 灰度百分比。

**单独明度保护仍可能使高饱和单通道溢出。** 建议曝光工具额外支持 `headroomPolicy=limit-positive-gain`：正曝光时限制有效混合权重，避免任何原本不超界的正通道超过 1。对通道 c>0，权重上限为 (1-c)/(c×(g-1))，再夹到 0..1 并取各通道最小值；g≤1 时无需此限制。该策略会牺牲部分像素的目标提亮幅度，必须在工具说明和测试中明确。已有超过范围的 HDR 值需独立策略，不能用此式宣称自动正确。

### 9.3 用户可继续修改的内容

曝光 EV、效果强度、保护起点、过渡宽度、手工增减范围、蒙版反转/显示；调整工具与蒙版分别重置。用户说“灯还是亮了”，应检查是本层、后续层，还是显示/编码变化，而不是盲目继续压高光。用户要求“以后所有修改都不能动这里”时，才转入既有最终像素保护流程。

验收至少使用：暗底+亮块合成图、灰阶坡、饱和红蓝色块、半透明边缘、真实夜景灯源。检查暗部提升、高光硬保护、过渡连续、alpha 保持和色边；已烧白的 JPEG 不存在可恢复纹理，不作恢复承诺。

## 10 命令事务和自然语言规划

### 10.1 有限命令代替任意 JSON 写入

支持 AddStep、UpdateStepParameters、SetStepEnabled、SetStepOpacity、ReplaceStepMask、MoveStep、RemoveStep、RenameStep、UpdateGeometry、ToggleGroup。批量命令全成功或全失败，先在副本校验再提交。每个命令仅允许明确字段，不开放任意 JSON Pointer、文件路径或代码。

删除生产者时返回受影响的步骤列表。默认拒绝破坏依赖；用户可明确选择“连同依赖步骤删除”或先解除/复制范围。关闭组同样需要检查组外消费者，不能悄悄关闭无关修改。重排只允许满足依赖且属于同一可重排阶段的位置。

### 10.2 三种不同历史

- 操作栈：当前有哪些效果，按什么顺序计算
- 撤销/重做：用户刚做过哪些文档修改；一次拖动或一次采纳是一笔事务
- 命名版本：可恢复、可比较的完整文档快照

删除中间步骤不删除后续独立效果；撤销删除恢复同一 ID、参数和蒙版版本。撤销后再编辑清空 redo 分支，但不删除既有命名版本。面板展开、蒙版显示、画布缩放不污染修图撤销历史。

### 10.3 Planner 协议

请求带 sourceHash、documentRevision、documentHash、intentRevision、能力目录、selectedStepId、当前意图、必要的步骤摘要和蒙版来源。只发送任务所需信息，不能因为新增栈而自动扩大图像上传或接入付费服务。

模型返回 Proposal：baseRevision、baseHash、目标步骤、有限命令、理由、范围依据、置信度、主要取舍和待确认项。执行器独立验证，模型给出的成功文字不能改变状态。

“再弱一点”优先作用于用户当前选中的步骤，或最近明确讨论的单一步骤；若多个目标都合理，询问或给可比较选择。UI 选中不自动授权把任何新对话当作改单步请求；提供可移除的“修改此步骤”标签，明确当前照片、步骤或批注作用域。选择不清楚时不能把旧步骤保留再追加负向补偿。模型响应过期时保留文本与建议供查看，但不自动重放到新照片。

### 10.4 预览与采纳

Proposal 进入 disposable candidate；用户勾选的是提案命令，不是偷偷删除文档已有层。预览完成后才能采纳。部分采纳需要完整依赖闭包，且 Update/Remove 必须指向仍存在的原步骤。

PreviewReceipt 至少含 sourceHash、baseRevision、candidateHash、selectionHash、frameSpecHash、pipeline/toolVersions、renderPixelHash。接受时在项目事务内重新验证全部身份。发生冲突，保留候选与用户输入，提示重新预览；不最后写入者覆盖。

## 11 保存迁移和多端一致性

### 11.1 schema 3 的安全迁移

1. schema 1/2 只读打开不改文件
2. 原版本 state、ID、引用及哈希不原地改写；把当前旧状态引用为不可变 LegacyBase
3. schema3 容器以判别联合容纳旧 state 与新 recipe；第一次实际编辑时，在原子事务前保留原始项目字节备份，再写 schema 3
4. 旧 `toolRuns` 保留为 provenance-only，不能因记录里有 operations 就自动拆出新像素层
5. 旧版本继续按其原 pipeline 分发；新文档保存新 pipeline，不全局替换版本字符串。旧预设、蒙版、detail、字体等实际依赖也须保留或拒绝不兼容重放；只保存一个版本字符串不等于真正固定实现
6. 旧程序对 schema 3 明确拒绝编辑，不能忽略新字段后覆盖保存

“兼容基础”可以折叠显示，并允许进入原有控制方式编辑或显式创建转换候选。编辑兼容基础必须创建新的不可变 legacy 版本，再以显式命令替换当前 base 引用并重新预览后续步骤，不能回写原历史版本。不得伪造旧历史中不存在的步骤。转换新栈时要比较同网格像素和真实照片；有差异就让用户预览，不声称无损。

### 11.2 现有 guards 和文字

保护引用检查依赖源校验、状态 hash、pipeline、构图及参考文件。给所有旧版本增加字段或统一升级 pipeline，可能使历史保护全部失效。必须提供版本级渲染分发与旧参考重放验证。

新的调整节点必须位于最终文字/保护合成之前。已经锁定的参数或局部不能因新节点绕过原规则：对于无法映射到旧参数锁的 v2 能力，应拒绝涉及该受保护域的编辑，并要求显式解锁/转换。初始里程碑可把复杂受保护项目标为只读或兼容模式，但完整交付必须保留可预测的解锁、预览、重放和导出路径。

### 11.3 文件项目与浏览器草稿

文件项目继续复用项目锁、revision 比较、临时文件+原子替换、幂等 requestId。准备重渲染等耗时工作在锁外进行，提交前检查 revision、源与参考身份。失败留下上一个完整文档，清理仅限本任务新建且未被引用的缓存。

浏览器 IndexedDB 也要引入 document revision 和事务内 compare-and-swap。BroadcastChannel 或 Web Locks 可以改善跨标签通知与排队，但通知不是一致性保证；最终写入仍需比较 revision。离线、存储配额不足、页面关闭时，未确认保存不能显示为“已保存”。

Web/Skill 交换格式升级必须携带 recipe、源身份、蒙版、版本化能力和必要资源。遇到不支持工具或缺失资源时拒绝可编辑导入，并保留已有照片；可额外提供明确标为渲染副本的导出，不能把它冒充可继续编辑的项目。

### 11.4 旧快照接口的边界

`workspacePatch`、`snapshotFromProject`、`photoSnapshot`、`workspaceSnapshot` 目前都围绕 settings/annotations。升级后不能一边写 recipe，一边继续让旧快照覆盖它。定义 single writer：文档命令生成权威 recipe，旧状态仅用于兼容展示或 LegacyBase，不允许从“最终合成参数”反向推导配方。

## 12 UI 协调与统一

### 12.1 信息架构

保留“审片 / 精修 / 风格 / 顾问”四页签与现有主画布。把“当前调整”来源列表升级为“编辑步骤”，放在精修的同一内容流中。选择一个步骤时，下方原有精修控件位置显示该步骤属性；没有选择时显示添加调整和整体构图入口。

不新增第五个“图层”工作区，不在画布旁另起一套常驻窄栏，不保留两组都能写同一曝光的滑杆。风格页和顾问页应用后定位同一个步骤/分组；可提供“在精修中查看”，但不要强制跳走打断对话。

桌面结构建议：左侧空间导航，中央照片，右侧现有检查面板。面板内为页签、步骤概览/列表、选中属性、固定动作区。步骤列表先显示摘要，按需展开；长列表和属性共用受控滚动，不让多个嵌套滚动区争抢滚轮。

### 12.2 步骤行和属性区

步骤行包含：开关、名称、工具图标、范围缩略图、简短参数摘要、更多菜单。选择行、开关和显示蒙版是三个独立动作。名称以摄影意图优先，如“提亮暗处”，工具名“曝光”作为辅助；技术 ID 只在详情中出现。

属性区固定分为“效果”和“范围”：效果显示该工具支持的参数与 opacity；范围显示蒙版类型、实时/冻结参考、增减范围和显示模式。每组只重置自己的数据。删除、复制、命名和移动放入同一更多菜单；提供上移/下移作为拖拽的键盘/触屏替代。

依赖阻止重排时立即显示原因和关联步骤，原顺序不变。删除可恢复时使用现有撤销反馈，不增加无意义确认；删除连带消费者时需要明确说明影响列表。暂停只隐藏效果，不删除范围和参数。

### 12.3 预览状态与手势

手动拖动参数：pointerdown/键盘开始记录一份 before；input 只更新临时文档与最新预览；pointerup/change 提交一个撤销事务。Esc 取消本次手势回到 before。网络/保存失败时保留当前未保存状态及重试，不静默回滚成旧照片。

顾问方案：沿用现有比较预览；步骤选择、参数微调和蒙版查看采用同一组件，不再做一套简版。候选未应用时明确写“预览”；取消回到原文档，采纳一次提交。预览任务取消与关闭显示窗口不能误取消已采纳文档。

异步状态区分“正在生成预览 / 预览失败 / 正在保存 / 保存失败”。失败提示紧邻操作，并保留上一张有效画面；旧画面需标注不是最新结果，不能允许误导出或误采纳。

### 12.4 视觉约束

沿用现有 token：画布 `#202426`、面板 `#292d30`、正文 `#eceeea`、辅助字 `#b5babc`、结构线 `#414649`、香槟强调 `#dfd2c1`。具体值以本地最新最终样式为准，不另造新主题。

系统字体、现有滑杆、数字输入、按钮、页签和图标一致；图标保持 1.6 线宽；普通控制圆角约 4px，内容约 8px，弹窗约 12px。主动作只在当前任务底部突出。蒙版覆盖色只作画面临时提示，不染色整套侧栏；同时提供黑白模式，避免仅靠颜色辨认。

使用作用域样式如 `.edit-stack` 与已有 tokens，避免继续追加全局 `.panel-tab`、`.slider-row` 覆盖。先检查 CSS 加载顺序和实际 computed style，再调整样式归属；本任务不要求一次清理所有历史 CSS。

### 12.5 手机与可访问性

手机保持照片和既有检查面板的稳定关系，步骤详情在同一面板内前进/返回，避免叠加第二个独立编辑器。触控目标至少 44px；底部确认/返回不被键盘遮挡；长名称截断时提供完整可访问名称。

列表使用可访问按钮和明确选中状态；不要用一整行带嵌套按钮的无效 button。键盘可选中步骤、切换开关、上下移动、调整参数和退出蒙版。焦点在删除后落到邻近行；关闭对话框回到触发控件。拖动重绘不得夺走输入焦点。尊重 reduced-motion，不把每次像素进度都作为读屏播报。

## 13 代码落点与职责调整

下列路径是建议落点，可以按本地最新结构微调；不要求为命名本身重构。

| 领域 | 复用位置 | 建议新增或调整 |
| --- | --- | --- |
| 文档与命令 | `photo-tools/registry.js`、`values.js` | `public/edit-stack/document.js`、`commands.js`；验证和事务纯函数 |
| 编译与身份 | `edit-plan.js`、`edit-identity.js` | `edit-stack/compile.js`、`identity.js`；版本分发、前缀身份与失效 |
| 蒙版 | `local-masks.js`、`photo-geometry.js`、`targets.js` | `edit-stack/masks.js`；版本、组合与仿射坐标，不复制旧数学 |
| 像素 | `editor-engine.js`、`tone-processing.js`、`detail-processing.js` | `edit-stack/render.js` 与按工具族内核；legacy 和 v2 明确边界 |
| Worker | `photo-render-worker.js`、`photo-tool-worker.mjs` | 执行不可变 RenderPlan；支持 revision、取消和资源上限 |
| 项目 | `project.mjs`、`reference-store.mjs`、`render.mjs` | `document-store.mjs` 或同域模块；迁移、提交和版本级渲染 |
| HTTP/CLI | `server/tools/routes.mjs`、`projects/routes.mjs`、`cli.mjs`、`tool-contract.mjs` | 共用 document patch/candidate 接口；错误和能力目录统一 |
| 浏览器状态 | `project-snapshot.js`、`batch-edits.js`、`draft-store.js` | 保存文档 ID/hash/revision；旧快照只做兼容，不双写 |
| UI | `app.js`、`index.html`、`controls.css` | `edit-stack-view.js`、`step-inspector.js`、`edit-stack-controller.js`；app 仅协调 |
| 规划器 | `apps/studio/server/app.mjs` 的顾问 schema/prompt | v2 proposal 与目标步骤更新；能力协商、明确不支持路径 |

共享 `edit-stack` 纯模块必须同步分发给 Skill，并扩展 `check-shared-engine.mjs` 的发现/检查规则。独立 Skill 安装脱离仓库后仍须运行；不能以引用 `apps/studio` 的相对路径偷渡共享依赖。

批量编辑也要采用命令：同步某个工具/配方需显式范围，不从 aggregate settings 猜还原。来自不同照片的几何蒙版默认不复制；要复制时，说明坐标与主体差异并分别预览。旧批量撤销保护后续独立编辑的行为保留。

## 14 分阶段本地开发任务

### P0 规格冻结与基线

核对最新 main 和本地未提交改动；盘点所有渲染入口、草稿/交换格式、保护引用及 CSS 最终来源。建立 legacy 同网格 PNG 黄金样例和源 hash，运行现有检查。交付 ADR、能力矩阵和基准记录。没有这个基线，不开始改变旧引擎。

### P1 文档与事务核心

实现 schema3、Step/Mask/Group、有限命令、依赖验证、幂等性、revision 比较、撤销/重做、只读迁移。先用纯数据测试，不改变现有照片渲染。验收：中间步骤修改/删除不丢独立后继；跨客户端冲突拒绝；未知版本拒绝。

### P2 像素纵切与高光保护

实现 version-dispatched RenderPlan、兼容基础、Float32 曝光、输入明度蒙版、线性混合和 headroom 策略。接通预览和 PNG 导出。验收第 9 节样例及严格 no-op/alpha 测试。这是可演示里程碑，不是全部工具完成。

### P3 统一步骤界面

升级当前调整列表，复用精修属性、顾问候选和蒙版编辑器；完成手势事务、合法排序、删除/撤销、暂停和手机流程。先用本地确定性候选测试，无需真实付费模型调用。验收同一参数只有一个权威控制来源。

### P4 自然语言定向修改

升级能力目录和 proposal schema，让“弱一点/撤掉这一步/只保留背景”作用于明确 stepId。完成过期响应、歧义、部分接受和依赖提示。每一种动作都经过同一 DocumentCommands，不靠 prompt 约定绕开校验。

### P5 全工具与存储闭环

逐族移植现有光色、细节、风格、氛围；构图维持固定阶段。完成 file project、IndexedDB、CLI、独立 Skill、交换与命名版本；覆盖 guards 和 lettering 兼容。不得用“已有工具支持”掩盖新栈中仍不可编辑的类目。

### P6 质量与性能验收

运行全套回归与新测试，实际浏览器检查桌面/手机和重复中断流程；核对真实照片细节与跨端输出。记录代表性冷/热渲染、早期/末尾节点修改、导出内存和取消延迟。达到门槛后再标记功能完成；发布、合并和部署分别处理。

每阶段形成小而可复查的提交。不要在 P1 顺便重写 app.js、整套 CSS 或换库；若发现必要的基础重构，先给出影响范围和独立验证。

## 15 需求到测试的追踪

| 测试组 | 对应需求 | 必须覆盖 |
| --- | --- | --- |
| T01 文档纯函数 | R02 R05 R06 R09 | 稳定 ID、重复 ID、未知工具、循环、合法/非法移动、事务原子性 |
| T02 像素身份 | R01 R03 R04 | disabled、opacity 0、mask 0/1、中性参数、删除恢复、非线性逆序差异 |
| T03 高光保护 | R03 R04 | 暗底亮块、阈值端点、平滑过渡、饱和通道、负 EV、透明边缘 |
| T04 蒙版几何 | R03 R05 | 裁剪、±15°、径向、画笔、排除、羽化、共享复制、失效生产者 |
| T05 旧项目 | R01 R08 | schema1/2 原字节不变、首写备份、旧像素基线、旧保护引用不失效 |
| T06 并发与失败 | R07 R09 | 两标签/两客户端、倒序响应/解码、取消、断连、磁盘满、丢失响应重试 |
| T07 完整流程 | R03 R06 R07 | 生成→预览→部分接受→改中间层→删除→撤销→刷新→重开→导出 |
| T08 入口一致 | R08 R09 | Web/Node 同网格、CLI/HTTP 同校验、独立 Skill 安装、交换 round trip |
| T09 交互与视觉 | R10 | 四页签稳定、无重复控件、焦点、Esc、触控、窄屏、缩放、长名称 |
| T10 安全边界 | R11 | 未知字段、过深 mask、非有限数、路径/代码注入、资源上限、源篡改 |
| T11 性能和画质 | R12 | 同机基准、缓存正确性、邻域边缘、真实照片对照、未支持项目拒绝 |

属性测试可生成受限合法栈与命令序列，检查序列化重放确定性、撤销恢复、单个修改只使所需后缀缓存失效。不要给所有命令设“往返像素必完全相同”的不成立断言；应比较恢复的文档和其确定性重渲染。

现有测试入口：`npm test`、`npm run test:web`、`npm run test:skill`、`npm run engine:check`、`npm run architecture:check`、`npm run test:navigation`、`npm run test:collaboration`、`npm run plugin:check`、`npm run knowledge:check`。依赖准备按仓库 `npm run setup`。本轮文档工作未重新执行这些测试，不引用过去的通过数量作为未来变更的验收结果。

## 16 性能和缓存设计

缓存键必须包含源内容哈希、方向/色彩配置、pipeline/工具版本、frameSpec、按序前缀、参数、enabled/opacity、蒙版版本与采样参考。上游参数变更使后缀失效；仅改标题不失效；mask view 缓存不混入正式导出。跨项目不能仅凭 stepId 命中缓存。

首轮以两个工作缓冲和受限前缀缓存为目标，不默认保存每一步完整大图。16 MP 的 Float32 RGBA 单帧约 256 MB，三个缓冲约 768 MB，尚未计算原片、蒙版和显示副本。这是容量计算，不是实测内存；足以说明不能无界并行。保留现有导出像素上限，增加像素×通道×缓冲数预算和任务队列约束。

浏览器预览采用 latest-wins 调度：新意图到达就使旧预览失效；可取消 Worker 则取消，否则丢弃结果。轻量预览与最终预览有不同质量标识，采纳/导出仅绑定满足要求的版本。后续瓦片化须先通过 halo、暗角/颗粒定位和蒙版变换一致性测试。

基准应固定同一机器、Node/浏览器版本、素材、尺寸、操作栈和输出：

- 1400 长边预览：无栈、1/8/24 步，首次与热缓存
- 修改第一个、中间和最后一个步骤
- 3 个共享蒙版、复杂画笔及亮度范围
- 16 MP 导出：墙钟、CPU、峰值 RSS/可用堆、失败行为
- 取消和快速滑动：最终帧正确率、旧帧提交次数必须为 0

可以把轻量曝光预览 p95 低于 150ms 作为待校准体验目标，但必须指定参考硬件和是否命中缓存；不作为未经实测的产品承诺。空间滤波、保护参考和大图导出单独报告。

## 17 安全错误和验收出口

模型、导入文件、历史记录均不构成执行权限。只允许注册工具与受限 JSON；禁止 eval、动态模块路径、任意 shell、任意写文件目标。源与参考在执行前校验；图片、蒙版、表达式深度、步骤数和任务时间有上限。引入新库必须核对官方来源、许可、维护状况和打包体积。

建议统一错误码：STALE_REVISION、STALE_PREVIEW、TOOL_VERSION_UNSUPPORTED、DEPENDENCY_REQUIRED、INVALID_ORDER、MASK_REFERENCE_MISSING、SOURCE_CHANGED、RENDER_CANCELLED、RENDER_BUDGET_EXCEEDED、SAVE_FAILED。错误返回可读原因、受影响步骤和可执行下一步，不泄露路径、密钥或模型内部日志。

完成标准是用户能走完第 15 节 T07，且在真实 UI 中保持一致操作。技术检查通过、文档写完、曝光样例成功，都不能单独代表整体需求完成。实际 UI 或跨端验证未运行时必须标为未验证，不把截图或纯函数测试当成浏览器交互验收。

## 18 可交给本地 Codex 的任务说明

```text
请基于本地最新 FrameLark 代码实施这份规格。先读取仓库说明、相关 AGENTS.md
和技能，检查 git status 与最新 main，保护所有未提交改动。

目标是把现有部分模块化能力升级成可持久化、可继续编辑的非破坏性步骤栈。
复用工具注册表、候选事务、保护机制和现有四页签暗房 UI。
不要重写完整应用，不要引入第二套 UI 或未经验证的渲染捷径。

先按文档 P0 输出当前差异、ADR 和测试基线，再依 P1 至 P6 分阶段实现。
明确区分 v1 参数状态工具和 v2 像素步骤；旧 toolRuns 仅为来源记录。
保持旧源图、历史版本和保护引用不变，按版本分发渲染，迁移首次写入留备份。

每阶段先写可观察验收，再实现；完成后报告源码落点、通过/失败/未运行检查、
像素或交互证据和剩余限制。不要仅以测试数量或工具成功宣称画质提升。

首先完成“暗处提亮且高光受保护”的端到端纵切，然后扩展全部工具族。
新增节点必须能改参数、改蒙版、开关、删除、合法移动和撤销；刷新、重开、
项目交换与导出保持可编辑语义。自然语言定向修改已有 stepId，不追加反向抵消。

只执行当前授权的本地开发和验证。提交、推送、PR、合并、部署分别遵循
当前用户指令；本规格本身不授权发布、付费调用或上传私人照片。
```

## 19 需要保留的工程决策门槛

**已建议固定：** 原片不可变；栈/撤销/版本分离；v1 不静默变义；新节点顺序渲染；蒙版版本化；几何固定阶段；最终保护在最后；同一引擎多入口；四页签同一检查面板。

**P0/P2 必须实测后定稿：** Float32 内核的细节算法和 gamut 策略；Sharp 实际颜色/alpha round trip；浏览器/Node 一致性容差；全尺寸内存预算；兼容文字边界；已有复杂保护项目的升级路径。对这些点，先做小型黄金样例实验，再选实现，不能只根据库宣传决定。

**后续扩展，不阻塞首轮：** 语义分割 Adapter、源平面工作流、瓦片化、多用户实时协同、更多混合模式和 RAW。新能力必须进入同一 capability/版本/测试体系，不旁路核心文档。

## 20 官方资料和源码索引

以下链接支撑产品行为和库边界；本文的字段、模块拆分、阶段和 UI 排布是针对 FrameLark 的设计建议。

1. Adobe Photoshop 调整层概览
   https://helpx.adobe.com/uk/photoshop/desktop/create-manage-layers/color-adjustment-fill-layers/adjustment-and-fill-layers-overview.html
2. Adobe Photoshop 智能滤镜及蒙版
   https://helpx.adobe.com/photoshop/using/applying-smart-filters.html
3. Lightroom Classic 蒙版
   https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/masking.html
4. Lightroom Classic 历史与快照
   https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/develop-module-options.html
5. darktable 历史栈
   https://darktable-org.github.io/dtdocs/en/darkroom/pixelpipe/history-stack/
6. darktable 蒙版与混合
   https://darktable-org.github.io/dtdocs/en/darkroom/masking-and-blending/overview/
7. darktable 参数蒙版
   https://darktable-org.github.io/dtdocs/en/darkroom/masking-and-blending/masks/parametric/
8. darktable 绘制蒙版坐标说明
   https://github.com/darktable-org/dtdocs/blob/master/content/darkroom/masking-and-blending/masks/drawn.md
9. darktable 栅格蒙版依赖
   https://darktable-org.github.io/dtdocs/en/darkroom/masking-and-blending/masks/raster/
10. Sharp 操作与组合顺序
    https://sharp.pixelplumbing.com/api-operation/
    https://sharp.pixelplumbing.com/api-composite/
11. Sharp 工作颜色空间与 raw 输出
    https://sharp.pixelplumbing.com/api-colour/#pipelinecolourspace
    https://sharp.pixelplumbing.com/api-output/#raw
12. Sharp 官方 operation 实现
    https://github.com/lovell/sharp/blob/main/lib/operation.js
13. HTML Canvas 预乘 alpha 规范
    https://html.spec.whatwg.org/multipage/canvas.html#premultiplied-alpha-and-the-2d-rendering-context
14. darktable pixelpipe 架构
    https://github.com/darktable-org/darktable/blob/master/dev-doc/pixelpipe_architecture.md

仓库原文优先索引：`docs/ARCHITECTURE.md`、`docs/PHOTO_TOOLS_ARCHITECTURE.md`、`docs/CONTROLLED_EDITS.md`、`docs/PERFORMANCE.md`、`docs/VALIDATION.md`、`docs/WEB_DESIGN.md`。当前行为判断以第 2、13 节代码与基线提交为准；文档和旧截图相互矛盾时先核对源码。
