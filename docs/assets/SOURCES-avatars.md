# 小队卡通头像来源

2026-11-19，按用户“人物头像换成卡通图片”的要求，使用内置 image_gen 分别生成6张虚构青年三维卡通肖像。没有使用真实人物照片、外部图库或在线头像服务。

原始PNG与每张的准确提示词保存在 [generated-avatars](./generated-avatars/)：avatar-01至avatar-06，依次为浅紫短发、浅蓝卷发眼镜、浅黄短发、浅粉马尾、浅绿卷发、浅桃丸子头。六位示例成员按固定ID对应，新增成员由固定ID选择；不依据姓名或资料猜测真实长相。

运行时仅使用 [squad-portraits.webp](../../src/assets/avatars/squad-portraits.webp)：768×128，13304bytes（12.99KiB），包含6格128×128肖像。由 [optimize-avatars.mjs](../../scripts/optimize-avatars.mjs) 使用项目既有Sharp生成，无新增依赖。六张头像共用一次图片请求，原始PNG不进入dist。

头像在52px桌面和34px手机圆形容器内裁切；图片失败时恢复姓名首字，姓名及编辑按钮始终可用。仅改小队卡片，不改成员数据、备份协议或其他工作区头像。
