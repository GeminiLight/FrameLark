# 可继续编辑的操作栈

新栈保存按序像素步骤与独立蒙版版本，已接受步骤仍可修改。旧配方保持为固定兼容基础，旧工具记录只是来源，不自动转换成新步骤。旧工具语义保持；新工具参数仅作用于各自节点，opacity 混合结果，不等同减半参数。

```sh
node <skill>/scripts/cli.mjs document-tools
node <skill>/scripts/cli.mjs document --project <project>
node <skill>/scripts/cli.mjs document --project <project> --input <plan.json>
```

`document` 的只读调用返回项目 revision、baseVersion 和当前文档（旧项目返回尚未保存的固定兼容基础）。下面示例只说明结构，使用刚读取的实际身份：

```json
{
  "revision": 12,
  "baseVersion": "实际当前版本ID",
  "requestId": "trial-12",
  "name": "让暗处稍亮",
  "documentProposal": {
    "baseRevision": 3,
    "baseHash": "实际文档的SHA256身份",
    "items": [{
      "id": "weaken-light", "title": "减弱原来的提亮", "dependsOn": [],
      "commands": [{"type":"UpdateStepParameters","stepId":"原来的稳定步骤ID","parameters":{"ev":0.2}}]
    }]
  }
}
```

宿主工具 `frameyn_document_tools` 发现能力，`frameyn_propose_document` 生成候选；`tool-schema` 给出契约，静态协议见 `schemas/document-plan.schema.json`。接受、逐项选择、诊断、审核、保护和导出沿用现有入口。不要使用旧 aggregate settings 覆盖已启用的新栈。

步骤命令支持添加、参数修改、强度、启停、名称、范围、合法移动和删除。基础图变化重放后续独立步骤；真实资源依赖不能破坏。删除依赖生产者默认拒绝，显式 cascade 才连带删除。一次命令提案原子采纳，源、文档、项目版本与选择身份分别核对。

亮度范围默认在本步骤输入上采样；`frozen-source` 使用不可变原片并声明 sourceHash。绘制范围是原片坐标，可保存仿射基底。每次修改产生新 mask id+version；默认仅当前步骤，shared=true 才更新同一版本的全部使用者。范围保护、参数锁和最终像素保护保持不同契约。

首个新栈写入将项目升级为 schema 3，并保留旧项目原字节备份；只读不写盘。旧版本的状态和保护参考继续使用旧管线。旧参数/局部锁不能映射时拒绝新的像素变更，先通过既有解除候选预览与接受。禁止通过恢复旧配方绕开锁。

可编辑交换使用 `framelark-photo-exchange/2`，旧交换 /1 继续读取。工具/源/资源不匹配会拒绝导入，不把渲染副本当可编辑项目。带文字或最终保护引用的便携交换仍沿用既有明确边界，继续使用原文件项目，不能删除这些数据来完成交换。

Float32 只改善新节点的中间精度。源解码、构图和旧基础仍有明确的 8 位边界；RAW、完整 16 位、精准语义分割及任意历史外部冻结参考没有实现。输出、内存、蒙版和步骤数量有预算；降尺寸重试不能偷偷替换当前配方。
