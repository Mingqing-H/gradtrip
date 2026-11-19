# 毕业合照背景来源

2026-11-19，使用内置image_gen生成一张虚构毕业生合照，按用户要求采用自然人物比例、开心的毕业氛围和柔和绘画质感，介于照片与插画之间。没有使用真实成员照片、外部图库或可识别的大学标识。

原始图片：[graduation-group.png](./generated-backgrounds/graduation-group.png)。准确生成提示词：[graduation-group.prompt.txt](./generated-backgrounds/graduation-group.prompt.txt)。人物与校园均为生成内容，背景只作毕业旅行主题装饰，不代表真实小队的照片。

| 稳定素材ID | 运行时文件 | 尺寸 | 体积 |
| --- | --- | --- | --- |
| asset-graduation-group | [graduation-group-960.webp](../../src/assets/backgrounds/graduation-group-960.webp) | 960×540 | 35522bytes，34.69KiB |
| asset-graduation-group-mobile | [graduation-group-480.webp](../../src/assets/backgrounds/graduation-group-480.webp) | 480×270 | 13338bytes，13.03KiB |

使用项目已有Sharp，通过 [optimize-backgrounds.mjs](../../scripts/optimize-backgrounds.mjs)导出，无新增依赖。源PNG保存在docs，不进入dist；运行时使用同源、带内容哈希的WebP，不依赖在线素材服务。

四个工作区共享同一装饰层，桌面显示480×270px，手机为内容宽度×220px；CSS强度opacity=0.22，径向柔边遮罩淡出，不参与布局、读屏或点击。标题数据行与灰色页头操作使用更深的现有墨色，卡片仍保持原来的不透明底色。图片不可用时保留浅紫画布，功能不受影响。
