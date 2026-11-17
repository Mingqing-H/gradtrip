# 规划域素材来源（T02）

本文件记录 T02 目的地示意图的制作信息，由 T01 汇总到 `docs/assets/SOURCES.md` / `public/THIRD_PARTY_NOTICES.txt`。

## 生成图片

6 张目的地横图均为**合成艺术示意图**，不是实拍照片，界面标注“示意图”。它们仅用于帮助识别旅行方向与营造氛围，不承载按钮、金额或正文，也不用于证明景点、酒店或服务真实状况。

- 生成工具：Magpie 图像生成（codex/gpt-image-2）
- 生成日期：2026-11-18
- 风格约束：扁平现代编辑插画；16:9 构图；不含文字、水印、Logo、真人特写；明确要求“illustration, not photograph”
- 后期处理：Pillow 10.3.0，居中偏上裁切为 16:9，LANCZOS 缩放为 480px / 960px 宽，WebP quality=82、method=6
- 单图最大：约 122 KiB（chengdu-960.webp），全部低于 150 KiB
- 资源 ID 与运行时引用：`src/data/assetsPlanning.ts`；模板引用见 `src/data/templates/v1.ts`

| assetId | 目的地 | 生成提示要点 | 交付文件 |
| --- | --- | --- | --- |
| asset-dest-qingdao | 青岛 | 海滨城市、木栈道、红顶老城、帆船、暖色午后 | source-qingdao.png → qingdao-480/960.webp |
| asset-dest-suzhou | 苏州 | 白墙黑瓦、运河石桥、园林亭台、薄雾清晨 | source-suzhou.png → suzhou-480/960.webp |
| asset-dest-xiamen | 厦门 | 环岛骑行路、灯塔小岛、棕榈与海湾、晴朗天空 | source-xiamen.png → xiamen-480/960.webp |
| asset-dest-chengdu | 成都 | 茶馆庭院、竹林、熊猫意象、火锅热气、老街与现代天际线 | source-chengdu.png → chengdu-480/960.webp |
| asset-dest-xian | 西安 | 城墙城楼、兵马俑剪影、古塔、日落暖色对称构图 | source-xian.png → xian-480/960.webp |
| asset-dest-dali | 大理 | 高原湖泊、雪山、白族村落、环湖骑行道、流云 | source-dali.png → dali-480/960.webp |

源大图 `source-*.png` 仅作处理输入，不打包进 Pages 产物；浏览器仅加载 WebP 变体。卡片使用 480px，详情使用 960px，通过 `srcset`/`sizes` 选择；图片加载失败时以固定 16:9 纯色底和目的地名称降级，不影响方案阅读与操作。

## 图标

功能图标使用 B0 统一引入的 `lucide-react`（具名静态导入），本任务不新增图标库，也不复制图标资源。许可随 B0 的第三方声明统一交付。
