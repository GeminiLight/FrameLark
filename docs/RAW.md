# 相机 RAW

RAW 编辑在完整本地工作台和独立修片 Skill 中运行。在线静态工作台不提供 RAW 解码。

## 安装与导入

先运行 `npm run setup`，再运行 `npm run setup:raw`。后者将 rawpy/LibRaw 安装到 Skill 独立 Python 环境，需要 Python 3.9+。可用 `FRAMELARK_RAW_PYTHON` 指向已有兼容 Python 环境。

macOS 优先探测 Apple CIRAWFilter，需要 Xcode Command Line Tools 来编译小型本地适配器。Apple 无法解码的文件回退到 rawpy；其他平台使用 rawpy。项目记录实际使用的后端、系统/库版本、解码器版本和显影设置，以后编辑不会切换后端。CLI 可使用 `--raw-backend apple` 或 `--raw-backend rawpy` 指定后端，指定后端不可用时明确报错。

在本地网页添加相机 RAW，会自动创建文件项目并打开后端编辑器。原片保持不变，步骤可继续修改、关闭、排序和撤销。CLI 示例：

```sh
npm run photo -- init --image /path/photo.NEF --project /path/new-project
npm run photo -- preview --project /path/new-project
npm run photo -- export --project /path/new-project --preset share
npm run photo -- export --project /path/new-project --preset master
```

## 预览与导出

导入时只显影一次，生成磁盘上的线性 Float32 工作数据和最长边 2048px 的线性代理。调参数只处理代理，保留上一次完成的画面，快速连续输入会延后请求并丢弃过期结果。再次查看同一版本复用渲染缓存。后端工作线程处理像素，浏览器只接收普通 PNG 预览。

| 用途 | 输出 |
| --- | --- |
| 日常分享（默认） | 2048px、质量 90 的 sRGB JPEG |
| 打印 | 最长边 6000px、质量 98 的 sRGB JPEG |
| 无损图片 | PNG，最多 8192px / 1600 万像素 |
| 继续精修（RAW） | 当前裁剪的原尺寸 16 位 RGB TIFF，sRGB ICC，Deflate 无损压缩 |

全部 RAW 成片从高精度工作数据重新取样。TIFF 不经过 8 位预览，也不把 8 位数据扩展成假 16 位。导出大图分块处理，细节工具保留必要邻域。输出仍是 sRGB 显示色域，超出显示范围的值会在最后编码时裁切。此版不提供广色域 TIFF、相机风格匹配或色温显影控制。

## 支持范围

识别常见 DNG、Canon CR2/CR3、Nikon NEF/NRW、Sony ARW、Fujifilm RAF、OM/Olympus ORF、Panasonic RW2、Pentax PEF 等扩展名。能否读取取决于具体机型、压缩方式和实际后端版本，扩展名本身不是兼容保证。本轮用公开 Nikon NEF 验证两套真实后端，用生成的 DNG 验证 rawpy。Apple 对同一 NEF 的有效画幅与 LibRaw 略有区别，因此固定每个项目的显影结果，不混用两套缓存。

上限：512 MiB 文件、9600 万像素、最长边 16384px；同一服务串行解码，最多 8 个排队任务。代理内存缓存 64 MiB，派生预览磁盘缓存 256 MiB/项目。大文件首次显影和母版导出需要等待，速度取决于相机文件、机器和步骤数量。每次解码最多 180 秒；网页导入另留 30 分钟覆盖排队、上传和代理生成，取消或超时会中止请求。累计细节邻域超过预算时明确报错。

请保留整个项目文件夹，包括原片、显影记录、高精度数据、保护参考和编辑方案。RAW 项目暂不支持 `.frameyn.json` 单文件交换；不会将 RAW 转换成 JPEG 后交换。重装或升级系统不会自动重新显影旧项目。高精度缓存丢失或改变时停止输出，先恢复完整备份。

开发规格见 [RAW_PIPELINE.md](specs/RAW_PIPELINE.md)，验收记录见 [RAW_VALIDATION.md](RAW_VALIDATION.md)。
