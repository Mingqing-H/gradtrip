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
