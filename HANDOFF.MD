# 实际踩坑记录

## Markdown 换行被 Git 误报为空白错误

- 现象：首次提交前，`git diff --cached --check` 将文档元信息行末的两个空格报告为 trailing whitespace。
- 原因：Markdown 使用末尾双空格表达硬换行，Git 默认将其视为多余空白。
- 处理：在 `.gitattributes` 为 `*.md` 设置 `whitespace=-blank-at-eol`，保留原有排版，其他文件仍执行默认空白检查。
- 避免：不要对所有 Markdown 文件批量清除行末空格；检查 Git 属性后再判断是否为格式问题。

## PowerShell 校验可能报错后仍输出通过

- 现象：检查文档链接时，根目录相对文件的 `Split-Path -Parent` 返回空字符串，`Join-Path` 报错后脚本仍继续输出 PASS。
- 原因：路径未转为绝对路径，且 PowerShell 部分错误默认不终止执行。
- 处理：先 Resolve-Path，再取得父目录；校验脚本设置 `$ErrorActionPreference = 'Stop'`。Git 等外部命令仍需单独检查 `$LASTEXITCODE`。
- 避免：只有全部检查正常完成才报告通过，不能只凭最后一个命令的退出码或 PASS 文本判断。

## T02：公历天数转换漏掉纪元偏移

- 现象：自写的 `toDayNumber` 把 2026-07-01 转成 3996 年的日期，所有日期加减/共同出发日结果错位。
- 原因：抄 Hinnant civil 算法时，`days_from_civil` 末尾少了 `- 719468`（与 `civil_from_days` 开头的 `+ 719468` 配对），导致天数编号整体偏移一个纪元。
- 处理：补上 `- 719468`，并用 1970-01-01/闰年/月末的互逆用例回归。
- 避免：移植成熟历法算法后必须用已知锚点做双向互逆测试，不能只测相对差值。

## T02：B0 模块发现只识别 index.ts

- 现象：页面写在 `src/features/squad/index.tsx`，`npm run check:integration` 仍报入口缺失，`src/app/modules.ts` 的 `import.meta.glob('../features/*/index.ts')` 找不到页面。
- 原因：B0 约定的模块出口固定为 `index.ts`，glob 不匹配 `.tsx`；纯用文本检查的验收脚本也按 `index.ts` 找导出名。
- 处理：组件移到 `XxxPage.tsx`，`index.ts` 只做 `export { XxxPage } from './XxxPage'`。
- 避免：新增 feature/domain 模块时先按 B0 约定的确切文件名与导出名落地，不用同义的扩展名替代。
