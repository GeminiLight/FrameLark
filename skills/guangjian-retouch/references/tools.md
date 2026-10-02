# 本地工具

执行 `<skill>/scripts/cli.mjs help` 查看全部命令。成功返回 JSON `ok:true`；失败返回 `ok:false`、具体原因与恢复动作，退出码 1。工具无模型请求。

## 候选 JSON

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

继续改一份未接受的试片时加 `"fromCandidate":"最新 inspect 返回的候选 ID"`，其余 `revision` / `baseVersion` 仍用最新项目值。工具继承该试片的全部层，再更新指定目标；基础版本、意图或批注改变会拒绝过期试片。原候选保留，可取消或比较；不会自动接受。

值为示例，不是通用修片配方。settings 未出现的参数和未出现的局部保留；style/crop 字段不出现则保持，null 则移除该层。已存在参数设为 0 可清除，局部 `remove:true` 可移除该处效果。requestId 相同且计划相同会返回已有候选，避免重试重复生成；不同计划不得复用同一个 requestId。

裁剪：`crop:{x:0.05,y:0,width:0.9,height:1,angle:0}`。长宽至少 .05，原片内范围，角度 ±15°。保留标记被切到时拒绝方案；用户明确授权该处裁剪后方可 `allowProtectedCrop:true`。

局部渐变：maskType 为 linear，start/end 为原片归一化端点。rectangle/radial 使用批注 rect。enabled:false 暂停该局部效果；所有局部均以版本中的历史范围渲染。

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

```text
node <skill>/scripts/cli.mjs inspect --project <project>
node <skill>/scripts/cli.mjs controls
node <skill>/scripts/cli.mjs preview --project <project> --version original
node <skill>/scripts/cli.mjs compare --project <project> --a <base-id> --b <candidate-id>
node <skill>/scripts/cli.mjs preview --project <project> --version <id> --region '{"x":0.3,"y":0.1,"width":0.2,"height":0.3}' --max-side 1600
```

compare 两侧使用 B 版相同裁剪范围和倍率；另外查看 original 才能评价完整原构图。region 是原片范围，裁剪后仍可检查源图上的这处；拉直时返回包含该范围的外接框。区域结果不会做语义分割。

## 版本与导出

accept/discard/restore 使用 --id，带 --revision 可防止竞态。accept 还核对候选基础照片、意图和批注是否改变。参数渲染不写回原片；接受时记录选择，导出记录版本与实际输出尺寸。

share：JPEG 90%、2048 px、96 ppi；print：JPEG 98%、6000 px、300 ppi；original：PNG、8192 px、300 ppi。最长边上限 8192，总输出最多 1600 万像素，不能把「原尺寸」理解为无限尺寸。工具不放大，不复制源 EXIF/GPS。

```text
node <skill>/scripts/cli.mjs export --project <project> --version <accepted-id> --preset original
node <skill>/scripts/cli.mjs serve --project <project> --port 0 --session-file <private-session.json>
```

服务仅绑定本机；新启动会生成新预览会话。页面刷新保留项目，服务关闭后重新启动恢复项目。单张输入最多 30 MB / 5000 万像素 / 最长边 16384；支持静态 JPEG/PNG/WebP/AVIF。HEIC、RAW、TIFF 转换后加入。


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
