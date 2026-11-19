# Design v3 素材来源

日期：2026-11-19。用户选择了设计稿 3、6、9、12，并要求三维小卡通插画和更真实的目的地景观。本轮全部使用内置 image_gen 生成，没有使用外部图库或运行时素材接口。

准确提示词与原始 PNG 均保存在 [generated-v3](./generated-v3/)；每张 PNG 对应同名 .prompt.txt。图片原件留在 docs，不进入 dist。当前 WebP 由 scripts/optimize-images.mjs 使用 Sharp 0.35.5 导出，透明背景保留 Alpha，单图超过 140 KiB 时逐步降低质量，150 KiB 为硬限制。

| 稳定标识 / 文件 | 用途 | 输出 |
| --- | --- | --- |
| asset-travel-kit / travel-kit | 小队紫箱、黄包、地图、图钉 | 480×560；手机 240×280 |
| day-train | 日程火车 | 360×270 |
| day-beach | 日程沙滩伞、躺椅、海星 | 360×270 |
| day-suitcase | 日程箱子与地图 | 360×270 |
| ledger-notebook | 账本笔记本与铅笔 | 280×280 |
| brand-mountains | 紫色双峰品牌与浏览器图标 | 80×60 WebP；32×32 PNG |
| asset-dest-suzhou | 苏州河道、白墙黛瓦、石桥 | 480×270 / 960×540 |
| asset-dest-qingdao | 青岛红瓦老城与海湾 | 480×270 / 960×540 |
| asset-dest-xiamen | 鼓浪屿别墅、榕树与海岸 | 480×270 / 960×540 |
| asset-dest-chengdu | 川西茶院与竹影 | 480×270 / 960×540 |
| asset-dest-xian | 西安城墙与传统城楼 | 480×270 / 960×540 |
| asset-dest-dali | 白族村落、洱海、苍山 | 480×270 / 960×540 |

景观符合对应城市的建筑与自然语言，但均为生成示意图，不能证明某处实景设施或服务。界面保留“示意图”，替代文本明确“生成示意景观”。原有 T02 来源文档作为历史保留，当前文件优先。

当前最大运行时目的地图为 suzhou-960.webp，135490 bytes（132.31 KiB）；透明插画最大 travel-kit.webp，44608 bytes（43.56 KiB）。完整生产资源检查见 ACCEPTANCE。

图标为 lucide-react 0.468.0 具名静态导入（ISC），不使用整包图标映射。中文使用本机字体回退，不分发系统字体文件，不发出远程字体请求。
