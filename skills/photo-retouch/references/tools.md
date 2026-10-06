# 本地工具

执行 `<skill>/scripts/cli.mjs help` 查看全部命令。成功返回 JSON `ok:true`；失败返回 `ok:false`、具体原因与恢复动作，退出码 1。工具无模型请求。

## 候选 JSON

复合编辑优先使用动态工具目录和 `compose`，目标可以是整张、区域、对象范围、批注或前一步生成的蒙版。见 [工具组合](tool-composition.md)。下方旧候选与 `items` 格式继续兼容。

使用 inspect 刚返回的 revision/currentId。用 JSON 文件或 stdin 提交，避免 shell 转义用户文本。

```json
{
  "revision": 3,
  "baseVersion": "inspect 中的 currentId",
  "requestId": "本次请求的唯一编号",
  "name": "自然版",
  "goal": "提高人物可读性，保留暖光关系",
  "tradeoff": "暗部提亮可能更显噪点；检查头发和背景过渡",
  "settings": {"highlights": -10, "shadows": 6},
  "style": null,
  "locals": [{"annotationId":"真实批注 ID","settings":{"exposure":0.25},"feather":0.5,"maskType":"radial"}]
}
```

继续改一份未接受的试片时加 `"fromCandidate":"最新 inspect 返回的候选 ID"`，其余 `revision` / `baseVersion` 仍用最新项目值。工具继承该试片的全部层，再更新指定目标；基础版本、意图或批注改变会拒绝过期试片。原候选保留，可取消或比较；不会自动接受。此兼容入口仅接受旧整组格式，不能与 `items` 混用；它把继承后的完整结果固化为已保存基础版本上的一个 `whole-plan` 项，之后父候选的勾选或删除不会改变它。解除保护试片必须先单独接受，不能用此入口绕过。

值为示例，不是通用修片配方。settings 未出现的参数和未出现的局部保留；style/crop 字段不出现则保持，null 则移除该层。已存在参数设为 0 可清除，局部 `remove:true` 可移除该处效果。requestId 相同且计划相同会返回已有候选，避免重试重复生成；不同计划不得复用同一个 requestId。

裁剪：`crop:{x:0.05,y:0,width:0.9,height:1,angle:0}`。长宽至少 .05，原片内范围，角度 ±15°。保留标记被切到时拒绝方案；用户明确授权该处裁剪后方可 `allowProtectedCrop:true`。

局部渐变：maskType 为 linear，start/end 为原片归一化端点。rectangle/radial 使用批注 rect。enabled:false 暂停该局部效果；所有局部均以版本中的历史范围渲染。

### 逐项方案与宿主工具契约

新方案优先使用 `items`，顶层不再同时放 settings/style/crop/locals/textOverlays。每项的 patch 复用上面的绝对目标语义；style、crop、一个局部层、文字层数组分别是原子操作。项目与依赖 id 唯一，同路径重复写入和依赖环会拒绝，依赖缺失不能接受。

```json
{"revision":12,"baseVersion":"真实当前版本ID","requestId":"trial-12","items":[{"id":"lift-person","title":"人物稍提亮","patch":{"locals":[{"annotationId":"真实批注ID","settings":{"exposure":0.15}}]}},{"id":"blue","title":"降低蓝色饱和度","dependsOn":[],"patch":{"settings":{"blueSaturation":-8}}}],"selectedItemIds":["blue"]}
```

`candidate --input` 返回 items、selectedItemIds、selectionHash、baseRevision 和 noChange。勾选变更使用 `select --input`，输入 `{id,revision,selectionHash,selectedItemIds}`；服务端从不可变 parentId 基础重算，点击顺序不改变合成顺序。全不选回到基础效果，不能接受空修改。

接受使用 `accept --id <candidate> --revision <latest> --selection-hash <preview-hash>`。hash 是组合身份，不证明人看过图；宿主仍须实际检查预览。choices 只记录选中项。旧单组格式仍映射为一个项目，可沿用旧 accept 调用。

`tool-schema` 返回提供给宿主 Agent 的 provider-neutral function 定义；修片输入 schema 在 `schemas/edit-plan.schema.json`。`tool --project <project> --input <call.json>` 接受 `{name,arguments}`，修片操作为 `frameyn_propose_edits`、`frameyn_select_edits`、`frameyn_change_guards`，只读比较为 `frameyn_compare_looks`；另有六个组图函数，参见 [组图工具](collection-tools.md)。修片用单图目录，组图用 collection 目录。自然语言解析和模型 function calling 由宿主完成；这些定义不会自动注册到模型，也不会启动新的模型服务。不传代码，不使用 eval，不将模型文字拼成 shell。

## 批注 JSON

```json
{"revision":2,"rect":{"x":0.3,"y":0.1,"width":0.2,"height":0.3},"note":"这里偏暗，希望轮廓清楚一点","protect":true}
```

新增不填 id；修改填 inspect 的标记 id。最多 8 处，文字最多 600 字。`note --input file.json` 保存后重新 inspect。已发送/已接受的版本局部范围不会随当前批注改变。

## 审片记录 JSON

```json
{"revision":1,"summary":"基于实际画面给出观察，区分依据、意图和不确定性。","preserve":["具体值得保留的关系"],"model":"仅填写已知的当前宿主模型，否则省略"}
```

由当前 Agent 自己看图后写入。来源固定 host-agent，工具不把基础测光标成视觉判断。

## 查看与比较

`result-audit --input` 保存针对已实际查看预览的宿主审核，核对 versionId、revision、maxSide、pixelHash、frameSpecHash 和 selectionHash；ready/revise/reject、检查范围、问题与下一步会随项目保留。JSON 与返修流程见 [成片审核](result-audit.md)。工具不自动评美；Agent 交付保存用 `accept --by agent --require-audit true`，要求同一组合最新审核为 ready，阻止未审核、待返修或旧组合的审核被沿用。

光色与构图方向比较使用 `look-sheet --input`；2～6 个固定版本，同一 revision。color 共用 referenceVersion 的裁剪与倍率，composition 各自保留画幅并显示保留面积；不会接受试片或写入编辑历史。JSON 及验收方法见 [光色定调](look-development.md)。

```text
node <skill>/scripts/cli.mjs inspect --project <project>
node <skill>/scripts/cli.mjs controls
node <skill>/scripts/cli.mjs preview --project <project> --version original
node <skill>/scripts/cli.mjs compare --project <project> --a <base-id> --b <candidate-id>
node <skill>/scripts/cli.mjs preview --project <project> --version <id> --region '{"x":0.3,"y":0.1,"width":0.2,"height":0.3}' --max-side 1600
```

compare 两侧使用 B 版相同裁剪范围和倍率；另外查看 original 才能评价完整原构图。region 是原片范围；先渲染指定 max-side 的完整最终帧，再提取与当前画幅相交的整像素区域。返回 regionPixels（left/top/width/height）、frameSpec 和 regionMode: crop-final-frame。拉直时取投影外接框，不做语义分割；在当前裁剪外的范围报 REGION_OUTSIDE。区域图不会重新居中暗角或重跑边缘滤镜。

## 版本与导出

accept/discard/restore 使用 --id，带 --revision 可防止竞态。accept 还核对候选基础照片、意图和批注是否改变。参数渲染不写回原片；接受时记录选择，导出记录版本与实际输出尺寸。

Agent 自行保存试片用 `accept --by agent`；默认 by:user 对应用户明确接受。`feedback --input` 记录用户对已保存版本的明确 reject/prefer/neutral；不改像素或删除历史。后续个人偏好用 `preferenceChoices`，排除拒绝或中性试片。Agent 试修被用户明确 prefer 后，才会成为偏好证据。

share：JPEG 90%、2048 px、96 ppi；print：JPEG 98%、6000 px、300 ppi；original：PNG、8192 px、300 ppi。普通显示输出最长边上限8192、最多1600万像素，不放大。RAW项目另有 `master`：按当前裁剪从高精度缓存输出原尺寸16位sRGB TIFF，不使用预览代理；普通栅格项目不能冒用此精度。输出不复制源EXIF/GPS。

```text
node <skill>/scripts/cli.mjs export --project <project> --version <accepted-id> --preset original
node <skill>/scripts/cli.mjs serve --project <project> --port 0 --session-file <private-session.json>
```

服务仅绑定本机；新启动会生成新预览会话。页面刷新保留项目，服务关闭后重新启动恢复项目。普通栅格输入支持静态JPEG/PNG/WebP/AVIF；macOS静态HEIC/HEIF可由系统解码，其他平台先转换；普通TIFF输入仍不支持。

相机RAW首次可运行 `node <skill>/scripts/raw/setup.mjs` 准备rawpy/LibRaw；macOS优先Apple CIRAWFilter（需Xcode Command Line Tools），实际失败再按工具支持回退。`init --image <RAW> --project <new-folder> [--raw-backend auto|apple|rawpy]` 保留原片、显影记录和线性高精度缓存。RAW输入上限512MiB / 9600万像素 / 16384px，机型和压缩方式依实际后端；指定后端不可用时会报错。项目后续编辑保持已选后端，不自动重新显影旧项目。RAW项目目前不能以单文件快照交换，需保留整个项目。


### 参数锁与画面保护

`guards --input <JSON>` 与 HTTP `POST /api/guards` 共用实现。每次使用最新 revision。

```json
{"revision":15,"operation":"lock","parameters":["exposure","warmth"],"localIds":[]}
```

参数锁同时保存手动值和 style 合成后的有效值；会改变有效值的风格也拒绝。局部锁保存整层参数、蒙版、位置、强度、启用状态、层顺序，不能删除/换层绕过。参数锁不保证这块画面像素不变。

```json
{"revision":16,"operation":"protect","name":"保留人物效果","coordinateSpace":"view","rect":{"x":0.25,"y":0.2,"width":0.3,"height":0.4},"maskType":"radial","feather":0.12}
```

先查看已保存画面，再选择核心。view 坐标相对当前实际裁剪画面；original 相对正向原片（默认）。形状为 rectangle/radial，feather 为核心局部坐标向外扩展的 0～0.25，实线内 RGBA 完整复制参考，外带线性光/alpha 混合。保护绑定不可变参考版、源校验、管线、构图及独立仿射蒙版，与讨论批注无关。参考 PNG 保存在项目 references 目录；移动项目时须一起保留。

存在区域保护时禁止改变 crop/angle；不同参考版本的区域或外带不能重叠（使用保守外接框判断）。最多 8 个区域，参考依赖最多 4 层/8 个历史版本，以限制重放成本。新增锁或保护保存不改变像素的版本。

```json
{"revision":17,"operation":"unlock","parameterKeys":[],"localIds":[],"regionIds":["真实保护ID"]}
```

解除返回候选，检查预览并用 selectionHash 接受后生效。解除区域可能显露原来被覆盖的光色；取消解除试片会保留原保护。CLI/HTTP 允许一起解除多项。历史恢复合并目标保护与当前有效约束，冲突拒绝；不会静默丢掉最终保护合成。

同尺寸同构图的 PNG 最终像素可与参考逐字节验收；JPEG 的 renderPixelHash 是编码前 hash，fileHash 是实际文件 hash，不能据前者声称 JPEG 解码零差异。文字点缀后才做最终保护；无字输出使用无字参考。更换管线或字体无法复现旧参考时拒绝保护输出；inspect 保留项目上下文与预览错误，可显式解除并重建保护。

schema 1 只读时不改文件，第一次实际写入前将原字节备份到 project.schema-1.backup.json，再原子保存 schema 2。旧程序会拒绝 schema 2，避免忽略保护继续写入。

## 文字点缀

先运行 `node <skill>/scripts/cli.mjs lettering` 查看真实样式、字体与范围。文字模式独立于 `controls` 的修片参数，不需要额外模型服务。

`lettering --project <project> --input <plan.json>`：创建文字候选，命令只接受文字变更，保留当前光色、风格、局部和裁剪。也可填写 `fromCandidate`，把文字放到未接受的修片试片上，保留那份试片的实际效果。`candidate` 中若包含 `textOverlays`，也必须明确 `mode: lettering`。

```json
{
  "revision": 8,
  "baseVersion": "inspect 返回的 currentId",
  "mode": "lettering",
  "name": "小确幸 · 文字版",
  "goal": "把一句短句放在左下留白，保留已修好的照片",
  "tradeoff": "检查贴纸是否遮挡主体，以及手机上的可读性",
  "textOverlays": [
    {
      "id": "little-note",
      "text": "把今天，慢慢收藏",
      "style": "sticker",
      "x": 0.07,
      "y": 0.78,
      "width": 0.6,
      "size": 0.045,
      "color": "#594539",
      "background": "#FFF1DD",
      "decoration": "heart",
      "rotation": -2
    }
  ]
}
```

`revision` 和 `baseVersion` 用最新真实值替换。`textOverlays` 为整个文字数组的绝对目标，最多 4 处；`[]` 移除文字，省略保留当前文字。每处最多 120 字、6 个显式换行行数；过长或超出最终画幅会明确报错，当前已接受版本不变。

| 字段 | 含义 |
| --- | --- |
| `x` / `y` / `width` | 最终裁剪画幅的归一化位置和宽度；位置 0.02～0.94，宽度 0.08～0.96，右边保留 2%；贴纸底色按实际文字收拢 |
| `size` | 字号占最终画幅短边比例，0.018～0.12 |
| `style` | `airy` 留白短句、`sticker` 奶油贴纸、`editorial` 小标题 |
| `font` / `weight` | 可选 `sans`、`rounded`、`serif`，字重 400 或 600；样式已有默认值 |
| `color` / `background` | `#RRGGBB`；底色仅用于贴纸 |
| `align` / `rotation` | 可选 left / center / right，倾斜 -12°～12° |
| `opacity` / `decoration` | 不透明度 0.2～1，装饰 none / heart / sparkle |

预览和 PNG/JPEG 导出通过同一排版流程。`preview --without-text true` 临时看无字版；`export --without-text true` 导出仅保留修片的成片，不改变项目。`serve` 的「文字点缀」入口可手动改文字、样式、位置与大小，再试片、接受或取消。导出窗口也可取消「包含文字点缀」。

字体来自本机；中文字体缺失会要求安装后重试。工具不自动下载字体；本机不同字体可能改变字形和换行。最后应在用户使用的本机复看实际成片。


## 接续请求

网页和 Skill 共用接续记录。所有写入须使用最新 revision；actorId 由宿主声明。

```sh
node <skill>/scripts/cli.mjs handoff --project <project> --input <handoff.json>
node <skill>/scripts/cli.mjs watch --project <project> --after-revision 12 --timeout 60
```

请求 JSON 示例，编号和版本取自当前 inspect：

```json
{"action":"claim","revision":12,"id":"请求编号","actorId":"当前宿主标识"}
```

- request：`revision`、`message` 和可选 `requestId`；重复 requestId 不新增请求。网页先同步当前修改，再提交。
- claim：`revision`、`id`、`actorId`；一个请求由一位 Agent 接手。
- progress：加上实际 `summary`。不会调用模型或改动像素。
- complete：`summary` 和 `candidateIds`；候选须由同一 Agent 基于此请求生成。方案中填写 `handoffId` 和 `actorId`。空结果需说明保留原片的依据，不等于接受或审核。
- fail：`summary`，明确实际失败原因。
- cancel：`revision`、`id`；不删除已保存照片或已有候选，禁止旧接续再次提交。

watch 返回一次文件事件：handoff 为待接手请求，project-updated 为版本变化，timeout 为等待结束。随后由宿主重新 inspect、看图并按授权继续。最长等待 600 秒；没有用户要求持续协作时不循环等待。不要把 queued 当成 Agent 正在运行。对话、审美判断和独立身份仍由宿主负责。
