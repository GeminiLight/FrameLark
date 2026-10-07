# 工具组合

先 `inspect` 当前项目。本页是 editProtocol.mode=legacy 的工具组合；document 模式或当前版本有 recipe 时，改读 [可编辑操作栈](editable-stack.md)，用 document-tools 和文档命令。目录包含工具版本、支持的目标与严格参数 Schema；不要凭旧示例假设目录只有固定几个工具。

```sh
node <skill>/scripts/cli.mjs photo-tools
node <skill>/scripts/cli.mjs compose --project <project> --input <plan.json>
```

宿主函数入口分别是 `frameyn_photo_tools` 与 `frameyn_compose_tools`，由 `tool-schema` 发现，通过 `tool --input` 分派。运行时本身不调用模型。

方案顶层沿用候选的 revision、baseVersion、requestId、名称、目标与取舍，用 `operations` 代替 `items` 或旧整组 patch：

```json
{
  "revision": 12,
  "baseVersion": "刚读取的当前版本ID",
  "requestId": "trial-12",
  "name": "天空外轻抬曝光",
  "goal": "保留天空亮度，提高前景可读性",
  "tradeoff": "几何排除范围可能覆盖山尖，请查看边缘",
  "operations": [
    {"id":"foreground","title":"建立天空外范围","tool":"mask","version":1,
     "target":{"kind":"region","coordinateSpace":"original","mask":{"shape":"rectangle","rect":{"x":0,"y":0,"width":1,"height":1},"feather":0.02,"exclude":[{"x":0,"y":0,"width":1,"height":0.22}]}},
     "parameters":{},"dependsOn":[]},
    {"id":"lift","title":"前景曝光 +0.1 EV","tool":"tone","version":1,
     "target":{"kind":"output","operationId":"foreground"},
     "parameters":{"mode":"delta","changes":[{"key":"exposure","value":0.1}]},"dependsOn":["foreground"]}
  ],
  "selectedItemIds": ["foreground", "lift"]
}
```

参数与位置只是结构示例，不是通用配方。`delta` 相对固定基础和此前选中步骤执行；`set` 是目标值。依赖排序决定执行顺序，同一参数多次写入须声明依赖；选择重算不反复叠加。

目标支持整张 `image`、明确 `region`、带范围的 `object`、已有批注 `annotation` 和输出 `output`。对象需要 `name`、`source: vision|user`、`confidence: high|medium|low`、坐标空间与蒙版。名称本身不执行分割；模型估计范围要如实说明并检查实际蒙版。`view` 坐标属于请求的基础预览，编译后保存为原片坐标。

`compose` 为每个被选中步骤启动独立子进程，返回候选、执行记录与实际中间 PNG 路径。先用宿主看图工具检查这些图片，再用常规 `preview`/`compare` 查看完整候选。取消、超时或过期不会接受版本；原片不修改。子进程是可信工具的运行方式，模型不能指定代码、shell 或可执行文件。

`select`、`accept`、`discard`、审核、保护和导出沿用 [工具参考](tools.md)。选择必须包含依赖；接受仍核对最新 revision 和 selectionHash。reviewed 项目仍需对应组合的审核。接受版本保存规范化工具配方与执行记录，供重开或项目交换读取；历史不是绕过校验的执行授权。

扩展方式与运行限制见插件内的 [工具运行契约](photo-tools-architecture.md)。
