# 界面截图

## 三个能力的使用示例

README 每项能力各展示一句调用示例、一张图和一段说明。图片对应的用途与来源如下：

| 示例 | 展示内容与来源 |
| --- | --- |
| [找画面 · 摄影眼](images/showcase/photography-eye.png) | 2026-10-05 制作的雨夜拍法参考，精选环境人物、伞面细节、城市灯光三个方向。由内置 imagegen 根据 [Andrey Grushnikov 的原图](https://www.pexels.com/photo/photo-of-a-person-holding-an-umbrella-940034/)制作，来源采用 [Pexels License](https://www.pexels.com/license/)。图内保留作者与 AI 示意标识；这是拍摄与后期目标，会重画伞骨、水珠和灯牌，不能当作准确原片裁剪或现场复拍成果。 |
| [修照片 · 精修台](images/showcase/photo-retouch.png) | 2026-10-06 从已安装的 FrameLark 0.1.1 插件暗房实际截取，视口 1280 × 800。使用内置 `alpine-demo.png` 与已有示例项目，进入「对照」，左侧为原片，右侧为已保存的「晨光 · 轻调人物」。本轮只展示已有版本，没有重新调用模型或生成照片。 |
| [做组图 · 组图册](images/screenshots/series-workspace.png) | 使用下面记录的真实组图空间截图：猫与咖啡两张 CC0 样片，展示「安静日常」的表达、顺序与逐张精调。它是两图操作示例，不是已完成的九宫格交付。 |

截图不含个人照片路径或本地会话令牌。示例说明实际操作与输出类型，不作为摄影质量基准。

## 完整工作台

`docs/images/screenshots/studio-overview.png` 来自 2026-10-06 当前仓库实际运行的 `npm start`，视口 1280 × 800。点击「试用示例照片」后截图，使用内置 `apps/studio/public/assets/alpine-demo.png`，展示「帧好」品牌、照片预览与小帧顾问。未配置视觉模型，页面显示「本地引导」；没有调用模型或将截图称为 AI 修片结果。

## 组图空间

`docs/images/screenshots/series-workspace.png` 来自 2026-10-03 的本地工作台，默认视口 1280 × 720。使用质量检查集中的猫与咖啡静物样张（CC0，来源见 `test/web/fixtures/quality/manifest.json`），展示用途、表达、手动封面顺序及逐张检查入口。未配置云端视觉模型，没有把原片缩略图称为 AI 修片结果。

## Agent 暗房

截图来自本地 Web UI，使用产品内置的 `alpine-demo.png`。截图日期：2026-10-03；视口：1440 × 960。

| 截图 | 内容 |
| --- | --- |
| [手动精调](images/screenshots/darkroom-edit.png) | 原片与光色控制。 |
| [画面批注](images/screenshots/darkroom-annotations.png) | 人物和晨光的独立标记、评论与裁剪保护。 |
| [候选对照](images/screenshots/darkroom-compare.png) | 当前版本与未接受试片，共享范围与倍率。 |
| [成片导出](images/screenshots/darkroom-export.png) | 接受候选后生成的分享 JPEG，1448 × 1086。 |

候选来自宿主 Agent 对演示图的观察，轻抬人物阴影并小幅处理高光。截图展示交互流程，不作为摄影质量基准或在线模型调用证据。原始照片、项目和会话文件未提交。

## 复现

按 [中文启动步骤](../README.md#web-ui) 或 [英文步骤](../README.en.md#web-ui) 打开本地项目：

1. 调整参数或风格，点击「生成试片」。
2. 在原片上圈选范围，保存每处评论。
3. 比较候选，检查细节，再接受或取消。
4. 接受后导出，核对实际尺寸。

可使用浏览器截图工具捕获当前视口。截图和录屏中应避免出现个人路径与本地会话令牌。
