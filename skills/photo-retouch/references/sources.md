# 来源与证据边界

核对日期：2026-10-02。优先使用作者本人、基金会、厂商文档与工具代码。链接目录是继续学习入口，不表示已逐张看过全站作品或完整读完所有教材；具体参考图比较必须实际读取图像。

## 摄影师与作品入口

以下入口支持身份、作品/系列和学习背景。风格图谱中的适配、取舍与工具映射是本 Skill 的解释，不是作者公布的处理参数。

| 学习线索 | 首选来源 | 本 Skill 关注的关系 |
| --- | --- | --- |
| 滨田英明 | [本人作品](https://hideakihamada.com/works/) | 日常与家庭题材、自然光和人物环境 |
| 川内伦子 | [本人作品](https://rinkokawauchi.com/en/works/) | 细小事物、系列联系与观看节奏 |
| Saul Leiter | [基金会彩色作品](https://www.saulleiterfoundation.org/color) | 遮挡、反射与颜色焦点 |
| Alex Webb | [Magnum 官方介绍](https://www.magnumphotos.com/event/photographers/alex-webb/) | 复杂彩色画面、多层关系 |
| 何藩 | [家属维护官方站点](https://fanho-forgetmenot.com/) | 光影、人物尺度与几何空间 |
| 森山大道 | [基金会](https://www.moriyamadaido.com/) | 粗粝表达、都市片段与观看张力 |
| Michael Kenna | [本人访谈](https://www.michaelkenna.com/phorevu.php) | 长曝光、夜间与简洁空间 |
| Steve McCurry | [本人肖像](https://www.stevemccurry.com/portraits) | 人物、环境与色彩焦点 |
| William Eggleston | [艺术基金会](https://egglestonartfoundation.org/) | 平等观看普通景物、颜色关系 |
| Stephen Shore | [本人作品目录](https://stephenshore.net/photographs.php) | 日常场所、信息组织与系列 |

## 工艺与视频

- [Adobe Camera Raw：锐化与降噪](https://helpx.adobe.com/ca/camera-raw/desktop/using/sharpening-noise-reduction-camera-raw.html)：细节观察、100% 检查、噪声类型。本工具不拥有该软件全部控制。
- [Blackmagic Design 官方训练](https://www.blackmagicdesign.com/products/davinciresolve/training)：剪辑、调色与声音课程入口。外部软件的能力不自动成为本地 CLI 的能力。
- [FFmpeg 官方过滤器文档](https://ffmpeg.org/ffmpeg-filters.html#tonemap)：色彩转换、线性光与色调映射。实际命令必须核对已安装版本和输入配置。

## 工具事实与案例

`scripts/engine/editor-engine.js`、`tone-processing.js`、`detail-processing.js`、`local-masks.js`、`region-edits.js` 和 `presets.js` 是随包的真实实现；`controls` 提供当前范围与实际灰卡响应。参数名、范围、叠加和局部边界以它们为准，而非凭别的软件记忆换算。

案例标为“已运行”或“推理”；样本条件、是否人为构造、是否真实播放、是否导出检查分别写清。通过一个案例不能证明一般人像、所有噪声或完整视频质量。

未来更新需要新软件/格式/平台规范时，再读当前官方说明。不要把本页日期当作所有动态规范永久有效的证据。

## 审美校准的理论来源与视觉覆盖

2026-10-04 实际读取 [MoMA 1964 年《The Photographer's Eye》展览说明](https://assets.moma.org/documents/moma_press-release_326341.pdf)三页文字；其对象、细节、边界、时间、视点的讨论支持从题材标签转向画面关系。未通读同名书籍。本 Skill 的比较流程为独立迁移，不是作者的修片教程。

同日实际读取 [MoMA 1976 年 Eggleston 展览说明](https://www.moma.org/documents/moma_press-release_326994.pdf)三页文字，其中颜色参与内容与结构的阐释支持关系性的调色思路。未从这份文字读取到作品像素，不据此宣称已看完展览或获得配方。

本次核对 [滨田英明 Haru and Mina, 2015–2016 的本人页面](https://hideakihamada.com/works/6918/)文字及作品图像入口；页面截图/作品像素未成功读取，仍属于来源核对，不记为视觉学习。搜索工具生成的图片描述也不能替代读图。以后作具体参考时继续实际打开作品。

本次实际看过的公开案例与被否定九格，及其未覆盖的判断能力，见 [审美校准](aesthetic-calibration.md#已实际看过的案例与覆盖不足)。没有取得外部大师作品像素，因此本轮没有新增标为“已视觉审核”的大师样图。未把私人照片或外部作品图片加入通用 Skill。
