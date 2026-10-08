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

目录不递归，最多500个文件；原片存入各单图项目，导入错误逐个写进imports。静态JPEG/PNG/WebP/AVIF可用；macOS静态HEIC/HEIF可由系统解码，其他平台先转换；RAW由实际后端判断是否可读，普通TIFF输入仍不支持。当前目录枚举只覆盖部分RAW扩展名；RAF等请用明确的 `images` 列表导入，不能假定目录模式已经纳入它们。大批同帧JPG/RAW可先以JPG浏览，再对入选帧使用RAW，避免重复占组图名额和无必要的大批显影。

不会删除或写回输入文件。完全相同字节的文件只标duplicateOf，不自动排除；JPG/RAW内容对应不能靠字节hash判断，须按同帧实际核对。每页20张，可切original；实际打开返回的PNG，再按单图project路径inspect/preview深看。

`collection-brief --input` 使用 `{"revision":1,"brief":{"mustKeep":["P0002"],"theme":"保留这次旅行的安静"}}`。部分字段更新，其余保留。用途 purpose：story/travel/portrait/event/catalog/portfolio/archive；sequence：visual/chronological/emotional/manual；targetCount 可为 null；mustKeep 只用导入成功的 ID。所有变更需最新组图 revision。

## 选片、顺序与整组导出

宿主看图后提交 `collection-plan --input`。使用 inspect 返回的 revision 和 snapshotHash；后者绑定当前 brief、原片信息、已保存版本、意图和批注。浏览未接受候选或导出记录不会使组图过期。

```json
{"revision":2,"snapshotHash":"inspect 返回的真实 hash","title":"海边随记","rationale":"从环境进入人物，细节作停顿；保留晚霞和夜色差异。","anchorId":"P0002","order":["P0002"],"decisions":[{"id":"P0001","decision":"reserve","observations":"与 P0002 同视角，表情略拘谨。","reason":"信息重复，留作备选。","preserve":"原片仍保留。","role":"备选"},{"id":"P0002","decision":"select","observations":"人物与海面有层次，侧光清楚。","reason":"更符合放松的主题。","preserve":"自然肤色与海面亮暗关系。","role":"封面"}]}
```

decision 只有 select/reserve/exclude。取舍必须包含可见观察和理由；未看照片不填，inspect 的 unreviewed 明确列出。order 恰好包含全部 select，各一次；必留图不能被排除。数量不符只提示，不自动补图。anchorId 可为空。方案不改变单图像素、不接受修片候选、不删除文件。最近 5 个方案保留在记录中；更早方案在 plans 目录可查。

`collection-sheet --selected true --view planned` 按方案顺序看已选版本；过期方案不能生成该视图。该联系表固定四列，用于初选，不能称为最终三行三列。精修使用每张的 `photos/P0002` 项目路径，先 inspect，按 editProtocol 选择旧候选或文档命令，遵循批注、保护与接受流程。接受新版本后重看最终组图，更新取舍方案，再导出：

```json
{"revision":3,"snapshotHash":"最新 inspect hash","preset":"share","format":"jpeg"}
```

```text
node <skill>/scripts/cli.mjs collection-export --project <collection> --input <export.json>
```

每次新任务写到 exports 下的独立目录，用 `001-P0002.jpg` 等顺序名，manifest.json 记录主题、顺序、具体版本、尺寸、文件 hash 和每张状态。原片也是已保存版本，可保留原片直接交付；未接受候选不能导出。成功文件不覆盖。失败项恢复后，用最新 revision、同一 snapshotHash、原 preset/format 加 `retryJob` 任务 ID 重试。版本或主题变了，先重新检查和保存组图方案，再发起新任务。导出期间中断可从已保存队列继续。已写出但尚未登记的文件保留；同一任务重试时，未完成项使用新名称，manifest 记录本次实际文件名；已完成项按记录的路径与 hash 核验后复用。

### 实际版本的三行三列预览

最终九格使用真实版本，沿用方案或导出 manifest 的顺序。无需生图工具：

1. 导出前，按当前方案 `plan.order` 读取每张的单图项目，对应 `plan.decisions[].versionId` 运行 `preview --project <单图项目> --version <已保存版本ID> --max-side 2048`。将各返回的真实 path 按该顺序写入下面的 `images`。未接受候选、原始输入路径或 AI 板不能替代准备交付的版本。
2. 保存 `preview-images.json`：`{"images":[{"id":"P0002","path":"/实际版本的预览.png"},{"id":"P0001","path":"/另一实际版本的预览.png"}]}`。九格必须恰好九条，ID 与顺序和方案一致，示例两条不代表九格已齐。
3. 输出目录须是新目录，运行：

```text
node <skill>/scripts/image-input-board.mjs --input <preview-images.json> --output <new-grid-directory> --columns 3 --cell-size 768
```

返回 contact.jpg 和来源对应表。九张时为 2304×2304、三行三列；它按原始画幅完整缩小放格，留白不是平台实际方格裁切，也不加字、不裁剪、不放大。实际打开这张预览并深看单张；再 collection-inspect 核对 snapshotHash，图像版本或取舍变化时重做方案和排列。脚本本身的 retouched:false 表示它只制作缩略表，没有再次修图，不否定输入所对应的已保存精修版本。

导出后仅在 `job.status=done` 且 `job.stale=false` 时，按 `job.items` 的 position/order 将每张 `result.path` 写成同样的 images 列表，在另一个新目录重做排列；核对版本、实际格式和编码后观感，再交付这些独立照片。partial 或过期任务不能冒充完整九格，保留成功文件并先恢复未完成项。排列预览不是九张高清单图，独立成片仍使用各自导出文件。

宿主结构化工具：`tool-schema` 中 frameyn_collection_* 函数通过 `tool --project <collection> --input <call.json>` 执行；修片、文档命令和审核函数使用单图目录。函数目录以当前 tool-schema 为准，不自动注册模型、不执行模型生成的代码。

浏览器本地“组图”用于 2–12 张已选照片的视觉审片、试片和顺序导出，使用浏览器草稿。完整本机工作台新增“共享组图”：打开已有含 collection.json 的真实目录，或从原片目录建立新组图；其主题、取舍、顺序和导出任务与这里的 Skill 工具共用同一份磁盘记录。共享界面分页浏览批次；进入单图精修时沿用 photos/P0002 的真实版本和批注。CLI 接受新版后旧选片会过期，重新看图再保存。未保存网页输入与远端变更冲突时先保留草稿备份，不覆盖另一处更新。

只安装独立 Skill、未运行完整工作台时，继续使用 CLI、联系表与真实三列预览；不声称插件自带完整 Studio 或云端能访问本机目录。浏览器本地组图的 12 张限制不外推到 Skill/共享文件批次的 500 张上限。
