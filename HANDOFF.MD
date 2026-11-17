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

## T01：PowerShell 与 npm 缓存权限

- 现象：直接运行 npm 被 ExecutionPolicy 拦截；npm.cmd 又因默认缓存 D:\npm-cache 不可写而报 EPERM。
- 原因：PowerShell 解析到了 npm.ps1，且缓存位于工作树可写范围外。
- 处理：使用 npm.cmd；项目 .npmrc 将缓存设为 .npm-cache 并忽略该目录。
- 避免：不修改系统执行策略、不提权安装依赖；Windows 中先核对 npm 入口与缓存路径。

## T01：嵌套原生 dialog 的焦点返回

- 现象：修改旅行名称后按 Escape、选择继续编辑，焦点停在关闭按钮，键盘无法直接继续输入。
- 原因：原生 dialog 的默认焦点恢复与 React effect 清理时机叠加，依赖当时的 activeElement 无法表达继续编辑应返回的字段。
- 处理：Dialog/Drawer 支持可选 returnFocusRef；Input 支持 inputRef。关闭确认框后在下一帧聚焦仍连接且可见的目标字段。
- 避免：嵌套危险确认显式指定返回字段，并验证 Escape→继续编辑的键盘路径；不要只测试对话框是否关闭。

## T01：关联工作树的只读 Git 检查也可能受所有权限制

- 现象：沙箱中对其他工作树执行 git -C status 报 dubious ownership。
- 原因：其他工作树文件属于宿主用户，与沙箱身份不同。
- 处理：本次通过当前工作树的 git show 分支:path 与 git branch 检查已提交交付，不改系统级 Git 信任设置。
- 避免：跨线集成以提交与专属报告为准，不为读取状态修改全局 safe.directory，也不直接接管其他工作区的未提交文件。

## T01：仅有模块发现代码不代表外壳已接入

- 现象：B0 后功能分支的 bundle 数值仍与纯外壳一致，页面代码虽通过类型检查却没有进入构建入口。
- 原因：B0 外壳尚未实际消费 featureExports；单独声明 glob 发现函数不足以构成可访问页面。
- 处理：第二批将工作台、独立分享路由和面板接入真实模块发现；第三批增加实际导入出口/handler/validator/示例的集成门槛，并把首屏懒加载依赖计入体积预算。
- 避免：功能线浏览器验收前合并已接线的 e9b1fd7 及后续兼容提交；不要用不含业务代码的外壳 bundle 数值声称整产品达标。
