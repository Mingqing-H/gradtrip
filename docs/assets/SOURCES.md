# 素材与许可

当前公共层仅使用本地 favicon.svg（项目自绘几何图形）与 lucide-react 0.468.0 的具名图标（ISC License）。没有远程图片、远程字体或运行时素材接口。

目的地素材为 T02 生成的 6 组城市示意插画（非实拍），详见 [制作、来源与提示记录](./SOURCES-planning.md)。12 张本地 WebP 变体由 `src/data/assetManifest.ts` 汇总稳定 ID、尺寸与替代文本；单张最大 122.11 KiB。源 PNG 不进入发布产物。

运行时依赖许可证：React / React DOM（MIT）、React Router（MIT）、Zod（MIT）、idb（ISC）、Lucide（ISC）。准确许可文本按 package-lock.json 对应版本从 node_modules 的 LICENSE 文件生成 public/THIRD_PARTY_NOTICES.txt。
