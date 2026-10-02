# 逐项采纳与已确认效果保护

## 能力与边界

本地 CLI、HTTP 和 Web UI 共用一个受控编辑流程。宿主 Agent 把请求拆成有名称的 JSON 调整条目；用户勾选后从固定基础版本重新编译并预览，一次接受为一个版本。当前运行时不增加模型 API 服务，不执行模型生成代码。

两种保护分别解决不同问题：

- **参数锁**：保存手动参数及风格合成后的有效值。局部锁保存完整局部层及其顺序。其他未锁参数仍可能改变整体观感。
- **画面保护**：复制已保存参考版的最终 RGBA 核心，核心外有限羽化带在直线光和预乘 alpha 中混合。合成发生在全部光色、局部、细节和可选文字之后。

保护期间禁止改变裁剪与拉直；需要先明确解除、检查并接受解除预览。旧批注的 `protect` 继续仅表示“裁剪时保留这处”，不会隐式升级为像素保护。

只支持当前 8 位 sRGB 流程；不新增 RAW、16 位、生成式编辑或语义分割。

## 架构

`engine/edit-plan.js` 负责纯方案规范化、白名单校验、依赖和写入冲突、从基础状态编译选择。`engine/edit-guards.js` 负责有效参数与完整局部锁、显式解除及恢复时合并约束。`engine/protected-regions.js` 负责原片空间仿射形状、硬核心/外侧羽化和最后像素合成。`reference-store.mjs` 负责已保存参考身份、文件校验与依赖复杂度。

`project.mjs` 只编排项目锁、版本与原子持久化；CLI、HTTP 都调用它。`render.mjs` 负责同一输出网格的重放、参考缓存、准确区域裁片与导出。UI 的依赖选择、串行最新写入队列与预览身份逻辑放在独立模块，可脱离 DOM 测试。

实际模型 function calling 是宿主侧集成：运行 `tool-schema` 获取函数定义，宿主解释请求后传 `{name, arguments}` 到 `tool --input`。输入 schema 同步发布在 `skills/guangjian-retouch/schemas/edit-plan.schema.json`。定义不会自动向任何模型提供方注册工具。

## 选择与接受

一个计划最多 24 项，局部层最多 8 处。服务端推导 `writePaths`；同一路径的重复写入拒绝，依赖必须存在且无环。形状/风格/裁剪/文字层数组是原子操作，不提供通用渲染节点重排。

每次勾选都从候选的 `parentId` 读取不可变基础状态。顺序按方案固定，点击顺序不影响状态；空选择回到基础并禁止产生空版本。`selectionHash` 覆盖基础、条目、选择、结果状态、保护及管线。接受必须匹配候选 ID、最新 revision 与已预览组合 hash；接收端在项目锁内重编译和校验后提交。

UI 在勾选事件发生时立即禁用接受并使旧预览失效。短时间输入合并成最新选择，写入串行化；旧图、过期 decode 与倒序响应不能恢复接受资格。渲染队列启动前拒绝已过期 revision，已开始的渲染不会强行终止。

## 区域保护

矩形和径向核心来自当前已保存画面，按实际舍入后的源像素裁剪网格反投影，保存原片坐标中的仿射基底。不会把旋转矩形替换成外接框。`feather` 是局部形状坐标向外扩展 0～0.25；UI 同时显示核心与外界。

参考必须是更早的已保存版本，且绑定源校验、状态 hash、管线和构图。默认 1400 长边保存有字与无字无损参考。相同输出尺寸直接读取校验后的参考；其他尺寸只在保存尺寸重放仍匹配时重放。损坏、缺失、未来/循环引用、源更改或不兼容管线均拒绝受保护输出。

不同参考的区域及外带使用保守外接框检测重叠并拒绝；同参考多个蒙版以最大权重合并，不重复混合。数量上限为 8 个区域，历史参考上限为 4 层/8 个版本，避免无界递归和缓存成本。

锁定或新增保护保存一个不改变当前像素的版本。解除始终生成独立候选；UI 支持在旧预览不可用时解除全部画面保护，保留参数与局部锁。历史恢复恢复目标的保护合成，同时保留当前有效约束；冲突要求先解除，不能悄悄丢掉保护。

## 输出与兼容

`preview --region` 从指定 max-side 的完整最终帧裁取整数像素，返回 `regionPixels` 与 `frameSpec`。它不再把区域单独重新渲染，因此暗角中心和邻域边缘与完整帧一致。区域在当前画幅外时报错；需要更细节的查看应请求更大的完整帧，仍受 8192 长边/1600 万像素限制。

保护承诺只针对**同尺寸、同构图**。PNG 编码后的 RGBA 可以逐字节验收。JPEG 有损编码可能改变保护区解码像素，`renderPixelHash` 仅代表编码前，`fileHash` 代表实际输出文件。保护后不再调整同一输出的尺寸或锐化。

schema 1 只读加载不会修改文件；第一次实际写入先保留 `project.schema-1.backup.json` 原字节，再原子保存 schema 2。旧单组方案映射为一个项目。schema 2 会被旧程序明确拒绝，避免保护被旧版本忽略。

## 验证和剩余检查

运行 `npm run setup`、`npm test` 和 `npm run knowledge:check`。测试覆盖状态、CLI/HTTP、像素保护、旧项目和 UI 纯状态竞态。实际照片 QA 另见 `docs/VALIDATION.md`，技术测试图不代表摄影质量。

本次环境的云浏览器访问本机服务被 `ERR_BLOCKED_BY_CLIENT` 拒绝。因此真实浏览器中的布局、拖动、焦点、移动端、重复点击与断线重连仍需在受支持的本地浏览器复核。已通过的 UI helper/HTTP 测试不能替代这些交互检查。没有为此公开服务、建隧道或绕过限制。

## Upstream candidate refinement

The legacy `candidate` / `lettering` format also accepts `fromCandidate`. It inherits that candidate’s currently selected state, then freezes the result as one `whole-plan` item against the accepted base. The parent candidate is not accepted and can later be changed or discarded without changing the refinement. `fromCandidate` cannot be combined with structured `items`; send a complete structured plan directly on the accepted base instead. An unlock candidate must be inspected and accepted separately.
