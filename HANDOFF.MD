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
## T03：B0 实际契约与文档约定不一致

- 现象：按 gitworktree §4 文档桩写的领域代码，合并 B0 后 typecheck 报 `isValidDateOnly/diffDays` 不存在，且 CommandPayload、Result、CommandContext 形状全部不符。
- 原因：B0 实际导出 `isDateOnly/daysBetween`；payload 是扁平实体而非 `{type,payload}` 包装；`Result` 用 `value` 而非 `trip`；ID 由 `context.ids` 预分配而非 `allocateId` 回调；`buildTemplateItinerary` 是注入式 builder。
- 处理：领域内部保留纯函数签名与细粒度错误码；新增 `b0Adapter.ts`/`errorMapping.ts` 做形状与错误码转换；日期工具用别名导入；适配器统一捕获 allocateId 的 RangeError 转结构化 VALIDATION，不向应用层抛异常。
- 避免：并行阶段可用文档桩提前写纯算法，但合并 B0 后必须以真实导出的 TS 类型为准做适配层校验，不能假定文档桩即最终签名。

## T03：空金额经 parseMoney/formatMoney 抛 RangeError 触发错误边界

- 现象：浏览器打开"记一笔"弹层即崩溃到"页面暂时无法显示"，控制台 `RangeError: 金额必须为安全整数分`。
- 原因：金额输入框为空时 `parseMoney('')` 抛错得 NaN，`summarizeCustomAllocations` 累加得 NaN，`formatMoney(NaN)` 再抛；useMemo 内的 try/catch 只覆盖了 parseMoney 本身，没覆盖后续派生渲染。
- 处理：金额无效（null/NaN/非安全整数）时不生成分配预览；自定义金额非法保留 NaN 仅用于提交校验，但预览前用 `Number.isSafeInteger` 拦截；确保传入 formatMoney 的都是安全整数。
- 避免：B0 `formatMoney/assertCents` 对非法输入是抛错而非返回占位；任何由 UI 文本派生的金额，在传入格式化/求和前先判断 `Number.isSafeInteger`，不要依赖上游 try/catch。
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

## T01：跨模块示例与模板时长必须做真实集成测试

- 现象：三天方案满足共识条件却无法确认；手工预算摘要也一直缺少方案基准。
- 原因：目的地模板同时包含第 2～5 天安排，构建器把全部天数交给三天方案校验；日程页仍注入全 null 的占位估算。
- 处理：模板构建按 dayOffset < plan.days 筛选；日程通过真实 planning 服务计算每人成本，并验证替换活动分项、不重复计算已含费用。
- 避免：类型通过后仍须用真实种子、真实 handler、真实模板和仓库走完确认与日程预算，不能只测试各域的隔离桩。

## T01：空输入的失焦和分摊预览不能形成业务写入或渲染异常

- 现象：打开方案详情后点击代录意向，其他有效意向突然失效；费用表单清空参与人后进入错误边界。
- 原因：自动聚焦的空交通输入失焦时把缺省覆盖值写成 null，误增约束版本；均摊预览把空参与人传给要求非空的领域算法。
- 处理：空交通输入无实际覆盖值时不提交，领域比较把缺省键与 null 视为等价；均摊预览先处理空参与人和非法金额，提交时仍由领域校验拦截。
- 避免：回归应覆盖“打开后直接操作其他按钮”和“清空后逐个选择”，不能只从预填合法表单直接提交。

## T01：邀请与反馈必须使用同一登记标识和正确的目标旅行

- 现象：生成邀请链接后反馈被判未登记；打开另一旅行时导入反馈可能交给错误工作区的 execute。
- 原因：登记和展示分别构建了两份邀请，payloadId 不同；共享应用直接使用绑定当前工作区的命令入口。
- 处理：只构建一次邀请，再登记其 payloadId 并展示同一 envelope；反馈在事务前读取 response.tripId，向该旅行提交版本检查命令。重复反馈在事务内返回原值。
- 避免：用隔离浏览器走完邀请→填写→预览→应用，并测试打开其他旅行和同反馈重复导入，不能把共享存储当作多人协作。

## T01：全量方案评估重复校验与扫描历史导致冷计算超标

- 现象：20 人、20 方案、200 费用的 4 倍 CPU 测试首轮超过 100 ms，热运行正常。
- 原因：逐方案重复合并成员日期、校验资料；逐成员反复筛选排序全部意向历史；单方案共识还建立其他方案的索引。
- 处理：请求内预计算成员日期与资料，意向用一次扫描的局部索引，单方案索引先按绑定版本筛选；不保留可变全局缓存，不跳过冷轮。
- 避免：同时报告 20 次的中位数与最大值，不能只看热轮或用基础空页面的数值代替完整产品。