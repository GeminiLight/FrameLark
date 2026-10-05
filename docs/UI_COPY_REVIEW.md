# Web 工作台文案检查（2026-10-03）

检查范围为当前 Web 工作台，不包含独立 Agent 暗房的界面、README 或摄影知识库。完整检查主界面、动态提示、错误信息、预设说明、示例讲解、本地顾问模板及模型提示词。初始清单含 940 行中文来源；一行可能包含多条文案，不能将其当作 940 条独立文案。

使用“说人话”技能。Gemini 3.8 Flash 完成四批复核；Claude Opus 4.6 Thinking 第五批四分钟超时，无可用正文，该批由主执行者逐项审阅。模型建议经过筛选，没有自动整批应用。

## 修改原则

- 操作写明动作，例如浏览风格、保存版本、应用调整。
- 临时预览、应用到当前编辑、保存版本和导出仍严格区分。
- “建议保留原片”是审片判断，不能改成“未修改”这一状态。
- 减少抒情标题、抽象概括、重复提醒；保留摄影术语和预设专名。
- 保留格式、尺寸、数量、存储位置、模型传输与数据恢复限制。
- 修改顾问、审片、复评和组图的写作提示，不改变输出结构、参数范围、画面证据要求及主观性约束。
- 既有用户批注、保存的对话、已生成模型回复不批量改写；新回复使用新提示。

## 已排除的建议

- “已有调整保留”不能改成“已经保存”，否则误报持久化状态。
- “照片本身不存入偏好档案”不能扩写成“照片不会上传或存储”。
- “提亮阴影”不能承诺“找回细节”。
- 参数范围限制不能说成“避免高光溢出”或“安全范围”。
- 近似区域不可改写成精确定位。
- 组图功能包含主题和顺序，不能统称统一滤镜。

## 逐文件覆盖

以下文件均已检查。清晰的错误提示、参数名及内部技术约束保留原文，不以改动数量衡量覆盖率。

- `codex-vision.mjs`
- `apps/studio/public/advisor-candidate.js`
- `apps/studio/public/annotation-attachments.js`
- `apps/studio/public/app.js`
- `apps/studio/public/batch-edits.js`
- `apps/studio/public/control-reference.js`
- `apps/studio/public/creative-intent.js`
- `apps/studio/public/design-agent.js`
- `apps/studio/public/diagnosis-explanation.js`
- `apps/studio/public/diagnostics.js`
- `apps/studio/public/draft-store.js`
- `apps/studio/public/export-files.js`
- `apps/studio/public/export-settings.js`
- `apps/studio/public/index.html`
- `apps/studio/public/local-masks.js`
- `apps/studio/public/photo-import.js`
- `apps/studio/public/photo-metering.js`
- `apps/studio/public/photo-rendering.js`
- `apps/studio/public/photo-series.js`
- `apps/studio/public/photo-viewer.js`
- `apps/studio/public/presets.js`
- `apps/studio/public/review-calibration.js`
- `apps/studio/public/review-context.js`
- `apps/studio/public/review-policy.js`
- `apps/studio/public/select-control.js`
- `apps/studio/public/series-workspace.js`
- `apps/studio/public/service-response.js`
- `apps/studio/public/style-matcher.js`
- `apps/studio/public/task-queue.js`
- `apps/studio/public/taste-memory.js`
- `apps/studio/public/vision-review.js`
- `apps/studio/public/workspace-flow.js`
- `apps/studio/public/workspace-profile.js`
- `apps/studio/server/ai/series.mjs`
- `apps/studio/server/app.mjs`
- `apps/studio/server/ai/vision.mjs`
- `apps/studio/public/response-language.js`：新增共用写作要求。
- `apps/studio/public/*.css`：检查生成文本，主要为图标符号，无需文风调整。

## 验证

`npm run test:web`：190 项全部通过。检查覆盖本地顾问、模型路由、组图、预览、保存与导出。通过浏览器检查主界面、顾问及相关弹窗；真实 Codex 图片对话用于抽查新提示词。修改不回写原片，不自动应用模型建议。
