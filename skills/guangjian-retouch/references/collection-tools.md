# 组图本地工具

## 导入、意图与联系表

`<collection>` 是新建组图目录，不是单图项目；`<skill>` 是 Skill 目录。所有调用返回 JSON，工具不调用模型。先 setup，然后：

```text
node <skill>/scripts/cli.mjs collection-init --project <collection> --input <import.json>
node <skill>/scripts/cli.mjs collection-inspect --project <collection>
node <skill>/scripts/cli.mjs collection-sheet --project <collection> --page 1 --view current
```

导入 JSON，二选一 images 或 directory：

```json
{"images":["/absolute/path/a.jpg","/absolute/path/b.jpg"],"brief":{"purpose":"travel","theme":"海边两天的松弛感","targetCount":6,"sequence":"visual","constraints":["保留夕阳暖色，人物肤色自然"]}}
```

目录不递归，最多 500 个文件；原片存入各单图项目，导入错误逐个写进 imports。静态 JPEG/PNG/WebP/AVIF 可用；HEIC/RAW/TIFF 会提示先转换。不会删除或写回输入文件。完全相同字节的文件只标 duplicateOf，不自动排除。每页 20 张，可切 original；实际打开返回的 PNG，再按返回的单图 project 路径 inspect/preview 深看。

`collection-brief --input` 使用 `{"revision":1,"brief":{"mustKeep":["P0002"],"theme":"保留这次旅行的安静"}}`。部分字段更新，其余保留。用途 purpose：story/travel/portrait/event/catalog/portfolio/archive；sequence：visual/chronological/emotional/manual；targetCount 可为 null；mustKeep 只用导入成功的 ID。所有变更需最新组图 revision。

## 选片、顺序与整组导出

宿主看图后提交 `collection-plan --input`。使用 inspect 返回的 revision 和 snapshotHash；后者绑定当前 brief、原片信息、已保存版本、意图和批注。浏览未接受候选或导出记录不会使组图过期。

```json
{"revision":2,"snapshotHash":"inspect 返回的真实 hash","title":"海边随记","rationale":"从环境进入人物，细节作停顿；保留晚霞和夜色差异。","anchorId":"P0002","order":["P0002"],"decisions":[{"id":"P0001","decision":"reserve","observations":"与 P0002 同视角，表情略拘谨。","reason":"信息重复，留作备选。","preserve":"原片仍保留。","role":"备选"},{"id":"P0002","decision":"select","observations":"人物与海面有层次，侧光清楚。","reason":"更符合放松的主题。","preserve":"自然肤色与海面亮暗关系。","role":"封面"}]}
```

decision 只有 select/reserve/exclude。取舍必须包含可见观察和理由；未看照片不填，inspect 的 unreviewed 明确列出。order 恰好包含全部 select，各一次；必留图不能被排除。数量不符只提示，不自动补图。anchorId 可为空。方案不改变单图像素、不接受修片候选、不删除文件。最近 5 个方案保留在记录中；更早方案在 plans 目录可查。

`collection-sheet --selected true --view planned` 按方案顺序看已选版本；过期方案不能生成该视图。精修使用每张的 `photos/P0002` 项目路径，遵循单图候选、批注、保护与接受流程。接受新版本后重看最终组图，更新取舍方案，再导出：

```json
{"revision":3,"snapshotHash":"最新 inspect hash","preset":"share","format":"jpeg"}
```

```text
node <skill>/scripts/cli.mjs collection-export --project <collection> --input <export.json>
```

每次新任务写到 exports 下的独立目录，用 `001-P0002.jpg` 等顺序名，manifest.json 记录主题、顺序、具体版本、尺寸、文件 hash 和每张状态。原片也是已保存版本，可保留原片直接交付；未接受候选不能导出。成功文件不覆盖。失败项恢复后，用最新 revision、同一 snapshotHash、原 preset/format 加 `retryJob` 任务 ID 重试。版本或主题变了，先重新检查和保存组图方案，再发起新任务。导出期间中断可从已保存队列继续；已写出但尚未登记的文件不会被自动覆盖，应另起新任务。

宿主结构化工具：`tool-schema` 增加六个 frameyn_collection_* 函数，通过 `tool --project <collection> --input <call.json>` 执行。原来的三个修片函数仍使用单图目录；九个函数不自动注册模型、不执行模型生成的代码。

Web UI 的组图空间用于 2–12 张已选照片的整组审片、试片和顺序导出；这套 Skill 工具负责更大的导入与选片清单。两者项目记录目前不自动同步，不能把 Skill 的 500 张批次限制描述成浏览器组图限制。
