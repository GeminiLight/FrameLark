# 发布独立摄影眼到公共插件目录

GitHub 快速安装已面向本地 Codex；公共目录是普通 ChatGPT 账号的分发入口。两条路径独立维护。公共目录发布完成前，官网不能把本地安装按钮写成手机一键安装。

## 准备只含摄影眼的包

在仓库根目录运行：

```sh
npm run plugin:check:photography-eye
npm run plugin:build:photography-eye
```

使用构建输出中的 `zipPath`，当前是 `dist/framelark-eye/framelark-eye-0.1.0.zip`。包只含 `photography-eye`、参考资料、无额外依赖的辅助脚本与小帧素材。不上传仓库整包，不添加精修工具、MCP 服务或本机照片。

## 提交到 OpenAI 公共目录

1. 打开 [OpenAI Platform Plugins](https://platform.openai.com/plugins)，选择发布主体所属的组织和项目。组织所有者可提交，其他成员需要 Apps Management Write。
2. 在组织设置中完成个人或企业开发者身份验证。此步骤由账号所有者完成，不能以 GitHub 作者信息代替。
3. 选择 Upload new or existing plugin，再选择已验证的 Developer identity，以 Skills only 路径上传摄影眼 ZIP。
4. 检查 Metadata & Skills 的扫描结果。按公共目录要求准备英文基础展示文案，保留清晰品牌名、用途、图标与起手句；更新元数据时同步版本并重新构建 ZIP。
5. 修复检查项后提交审核。Skill 包装校验通过不等于公共目录批准；只含 Skill 的插件也有目录资格与质量要求。
6. 审核批准后发布，并记录平台返回的真实插件 ID 和分享入口。

Skills-only 插件不需要为了提交额外搭建 MCP 服务，也不需要 MCP 审核的工具测试案例或演示录像。若未来确实需要 MCP，应按届时平台支持的发布流程处理，不能假设可以直接加到已有 Skills-only 插件上。

## 发布后再更换官网入口

- 将 `apps/website/public/install.html` 中的账号说明换成真实公共目录安装入口，保留本地 Codex 路径。
- 先用一个没有注册 FrameLark 市场的普通账号测试安装，再测试新对话中附现场照问这里咋拍。
- 分别检查网页、桌面和手机中的账号可用性，以及看图和可选生图能力。记录实际结果，再声称支持对应入口。
- 验证不用显式写插件名也能匹配摄影眼；若宿主没有加载 Skill 元数据，先解决安装和加载范围，不把模型的一般摄影回答当作插件测试成功。

更新 Skill 或插件元数据时重新上传 ZIP；GitHub 市场更新不会自动更新公共目录版本。

官方说明（核对日期：2026-10-06）：[打包与分发](https://developers.openai.com/plugins/build/plugins)、[上传与发布](https://developers.openai.com/plugins/deploy/submission)、[插件要求](https://developers.openai.com/plugins/plugin-guidelines)、[插件使用范围](https://learn.chatgpt.com/docs/plugins)。
