# 维护 帧好 · FrameLark

## 工作台与 Skill

完整工作台位于 `apps/studio/`，服务端按 AI、文件项目与工具接口分组；`api/` 仅保留 Vercel 适配入口。使用 `npm start` 运行。Agent Skill 位于 `skills/photo-retouch/`；安装器直接安装该目录。

目录归属与依赖关系见 [项目结构](docs/ARCHITECTURE.md)。新增业务源码放入所属应用或 Skill；根目录保留项目入口文档与平台配置。迁移路径后先运行 `npm run architecture:check`，检查模块引用、文档资源与部署目录。

Web 测试放在 `test/web/`，Skill 测试保留在 `test/`。两组都进入 `npm test`，也可分别运行 `npm run test:web` 和 `npm run test:skill`。Web 的授权照片不与 Skill 的生成测试图混用。

修改共用像素模块时同步检查 `apps/studio/public/` 与 Skill 内分发副本，运行 `npm run engine:check` 和两组测试；渲染变化还需检查保护参考的管线兼容性。部署说明见 [运行与部署](docs/DEPLOYMENT.md)。

## 知识与工具保持对应

修改知识后运行 `npm run knowledge:check`。新增章节同时更新 `references/knowledge-index.json`；风格 id 与参数必须来自真实引擎。运行 `npm test` 验证项目与检索行为。

新增方法写清：条件、意图、可见证据、实际处理、对照结果、接受/回退原因和适用边界。单个案例保持案例结论；推理练习不要标成实测。摄影师学习线索使用本人或正式机构来源，不编造官方配方。

图片引擎位于 `skills/photo-retouch/scripts/engine`。处理保持原片字节、绝对参数、独立风格层及当前版本/意图/批注冲突检查。变更局部范围、缩放或输出管线时，需要检查实际照片与成片。

不提交个人照片、草稿、项目目录、API Key 或本地会话文件。可复现质量案例说明来源、观看尺寸、是否人为压力变体；测试图与真实审片证据分开。

README 的界面截图应来自实际运行的 Web UI。更新截图时同步维护 [截图说明](docs/SCREENSHOTS.md)，记录来源、实际操作和导出尺寸，检查画面中是否包含个人文件名、绝对路径或会话令牌。

修改插件元数据或 Skill 分发内容后运行 `npm run plugin:check`，核对打包路径、可安装清单和独立 Skill 的完整性。发布包只从维护中的 `skills/` 与插件资源构建，不提交构建目录。
