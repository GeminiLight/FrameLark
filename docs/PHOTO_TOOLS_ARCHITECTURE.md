# 可组合的照片工具

照片编辑保存为工具操作的有向依赖图。每项操作只有稳定 ID、说明、工具与版本、目标、参数和依赖；Web 顾问、文件项目与 Skill 使用同一个注册表和编译器。新增工具无需在对话界面增加一个 `action.kind` 分支。

## 操作、目标与执行

`public/photo-tools/registry.js` 是核心 Module，Interface 包含 `register`、`describe`、`normalize`、`execute` 和 `run`。其 Implementation 集中处理参数校验、工具版本、依赖排序、目标解析和效果合成，减少调用方重复维护的规则。

目前的 Adapter 包括光色、细节、颗粒与暗角、风格、旋转、裁剪和蒙版。目录与模型 Schema 从注册定义生成；参数和目标类型以 `photo-tools` 返回的目录为准。Web 与 Skill 的引擎文件保持逐字节一致，由 `npm run engine:check` 核对。

目标可指向整张照片、明确的区域、带几何蒙版的对象、已有批注，或前一工具输出的可复用范围。对象必须包含名称、来源、可信度和蒙版，只有“天空”或“人物”名称不能执行。当前蒙版支持矩形、径向、渐变、画笔及矩形排除区，属于近似几何范围；精准语义分割需要另行实现 Adapter。

输入预览坐标在方案生成时转换为原片坐标，后续旋转不会再次转换。批注范围从固定基础版本读取。局部光色与已有局部合计最多 8 处，一份工具方案最多 24 项。

## 注册新工具

可信源码中的工具定义声明 `id`、`version`、`title`、`description`、`targets` 和严格的参数 Schema，并返回可保存、可重放的 `effect` 与可选 `outputs`。

```js
const customTool = {
  id: 'custom-tone', version: 1, title: '自定义光线',
  description: '使用项目中的光线策略', targets: ['image'],
  parameters: {type: 'object', properties: {}, required: [], additionalProperties: false},
  prepare(operation, context) {
    return {effect: {settings: {exposure: context.state.settings.exposure + 0.1}}};
  },
  async execute(operation, context) {
    // 可在这里执行耗时工作；返回效果必须与 prepare 一致。
    return context.prepared;
  },
};
```

同步工具可只提供 `execute`；异步工具用 `prepare` 声明确定的编辑结果，`execute` 完成实际工作。将定义注册到共享注册表并镜像至 Skill 后，目录、模型 Schema、编译和执行自动使用新工具。新增工具的原生候选行为仍需验证；扩展到现有效果类型以外时，还需实现对应渲染支持。模型不能上传代码、指定 shell 命令、模块路径或任意可执行文件。

## 编译与独立进程

依赖图在执行前校验。输出目标自动要求其生产步骤；缺失、循环、重复 ID 和未选中的依赖会拒绝。同一写入路径存在多个操作时，必须明确先后依赖，否则拒绝。改变勾选始终从固定基础版本重算；增量参数不会在前次预览上累加。

本机运行 `npm run setup` 后，每个被选中的工具由固定 Node worker 在独立子进程执行，通过私有 IPC 接收已校验的数据。父进程记录真实 PID、工具版本和输入哈希，核对结果与注册定义，并等待子进程退出。单步默认 30 秒、整组 120 秒，输入与返回大小分别限制为 8 MiB 与 4 MiB；取消或超时会终止当前子进程。这个执行 Seam 隔离任务生命周期与错误，不是运行不可信代码的操作系统沙箱。

子进程生成实际的中间 PNG、像素身份和帧身份。文件项目保存中间预览到 `previews/tools/`；对话预览在浏览器使用同一引擎重新渲染。网页只允许完成且通过校验的结果成为可应用候选，流式文字与工具运行状态不能直接修改当前照片。

Vercel 与未携带 Skill 运行时的 Docker 使用内联 Adapter 编译，界面如实记录 `inline`，最终像素预览由浏览器生成。云端不承诺本机独立进程或文件项目能力。

## 文件项目与历史

工具执行后仍通过现有候选事务：版本、revision、批注、参数锁、画面保护、审核与 selectionHash 校验继续生效。候选不会自动接受；取消保留当前版本。执行过程中项目变化会拒绝过期候选。

接受版本保留规范化操作、原片坐标、工具版本、选择项与执行记录。浏览器草稿和文件项目保留结构化建议，重开后可查看已应用方案。历史仅作为记录读取，重新执行必须经过当前目录、版本和目标校验。原片字节不写回。

Web 使用 `GET /api/photo-tools` 发现目录，`POST /api/photo-tools/run` 执行临时方案；文件项目使用其工具候选入口。Skill 使用 `photo-tools`、`compose`，或函数工具 `frameyn_photo_tools` 与 `frameyn_compose_tools`。详情见 [工具组合用法](../skills/photo-retouch/references/tool-composition.md)。

模型结构化输出引用本地 `$defs`，执行器仍独立进行严格校验。该 Schema 组织方式符合 [OpenAI Structured Outputs 文档](https://developers.openai.com/api/docs/guides/structured-outputs)。

## 验证范围

回归检查覆盖自定义工具注册、异步 Adapter、真实子进程与取消、输出目标复用、冲突与依赖、对象范围要求、颜色方向、排除区像素、Web/Skill 一致性，以及原片字节和候选接受。浏览器验证使用仓库示例照片：实际 Sol 请求、逐项选择、应用、重开项目和保存的执行记录。工具成功与像素哈希不代表审美审核通过。
