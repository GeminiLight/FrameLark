# 界面截图

截图来自本地 Web UI，使用产品内置的 `alpine-demo.png`。截图日期：2026-10-03；视口：1440 × 960。

| 截图 | 内容 |
| --- | --- |
| [手动精调](../assets/screenshots/darkroom-edit.png) | 原片与光色控制。 |
| [画面批注](../assets/screenshots/darkroom-annotations.png) | 人物和晨光的独立标记、评论与裁剪保护。 |
| [候选对照](../assets/screenshots/darkroom-compare.png) | 当前版本与未接受试片，共享范围与倍率。 |
| [成片导出](../assets/screenshots/darkroom-export.png) | 接受候选后生成的分享 JPEG，1448 × 1086。 |

候选来自宿主 Agent 对演示图的观察，轻抬人物阴影并小幅处理高光。截图展示交互流程，不作为摄影质量基准或在线模型调用证据。原始照片、项目和会话文件未提交。

## 复现

按 [中文启动步骤](../README.md#web-ui) 或 [英文步骤](../README.en.md#web-ui) 打开本地项目：

1. 调整参数或风格，点击「生成试片」。
2. 在原片上圈选范围，保存每处评论。
3. 比较候选，检查细节，再接受或取消。
4. 接受后导出，核对实际尺寸。

可使用浏览器截图工具捕获当前视口。截图和录屏中应避免出现个人路径与本地会话令牌。
