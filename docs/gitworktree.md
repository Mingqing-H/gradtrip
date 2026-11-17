# 四智能体 Git Worktree 并行开发方案

日期：2026-11-18  
状态：任务拆分与执行约定；实际工作树注册情况以 `git worktree list` 为准，开发智能体按各任务书启动。

## 1. 目标与任务入口

将现有 MVP 拆成恰好 4 个开发任务，每个智能体拥有独立分支、项目外工作树和明确文件归属。四条线都负责实现与测试，不单设一个只测不开发的任务。

| 任务 | 职责 | 分支 | 项目外工作树 | 任务书 |
| --- | --- | --- | --- | --- |
| T01 | 基础工程、公共契约、本地存储、外壳、最终集成与发布准备 | feat/foundation | `D:\A_temp-work\gradtrip-worktrees\foundation` | [T01](./tasks/T01-foundation.md) |
| T02 | 小队、方案共识、目的地模板与图片 | feat/planning | `D:\A_temp-work\gradtrip-worktrees\planning` | [T02](./tasks/T02-planning.md) |
| T03 | 日程、费用分摊与结算 | feat/itinerary-ledger | `D:\A_temp-work\gradtrip-worktrees\itinerary-ledger` | [T03](./tasks/T03-itinerary-ledger.md) |
| T04 | 分享、邀请、成员填写、反馈回传、导入备份与恢复 UI | feat/sharing | `D:\A_temp-work\gradtrip-worktrees\sharing` | [T04](./tasks/T04-sharing.md) |

主目录 `D:\A_temp-work\gradtrip` 保留 main，只供协调者提交任务方案、最终接收集成结果和统一发布。四个智能体都在自己的工作树内开发，不能到主目录或其他工作树写代码。

必读：[项目指引](../AGENTS.md)、[实际踩坑](../HANDOFF.MD)、[PRD](./PRD.md)。各任务书另列相关章节；业务规则、页面与架构约定继续有效。

## 2. 启动与依赖交付

### 2.1 先共享方案，再启动工作树

当前仓库已初始化，开发代码尚未建立。创建工作树前，应先把本方案、四份任务书和 AGENTS 索引提交到 main，否则新工作树看不到未提交的任务文档。

准备条件：

- main 的待提交变更已逐项审阅，不混入其他未授权修改。
- 工作树目标均在项目外；目标目录和同名分支尚未被占用。
- 确认 `git worktree list` 和 `git branch --list`，已有目录或分支时先检查，不删除重建或使用 --force。
- 能在项目外工作树写入 `.git` 关联信息和安装依赖；若执行环境限制写入，应为各智能体配置对应工作目录权限。

以下为协调者的准备命令。PowerShell 中每次 Git 命令失败即停止排查，不能忽略错误继续运行：

```powershell
Set-Location 'D:\A_temp-work\gradtrip'
git status --short
git worktree list
git branch --list

# 仅暂存本次拆分文档、索引及实际踩坑记录；先检查上述输出，再执行。
git add -- AGENTS.md HANDOFF.MD docs/gitworktree.md docs/tasks/T01-foundation.md docs/tasks/T02-planning.md docs/tasks/T03-itinerary-ledger.md docs/tasks/T04-sharing.md
git diff --cached --check
git diff --cached --stat
git commit -m "docs: define four parallel worktree tasks"

# 标签必须尚未存在，且本次方案提交已成功；不要强制移动旧标签。
git tag parallel/start-v1
```

该标签指向共同起点。不要硬编码此前的初始化 commit，也不要让四条线分别从不同时间的 main 启动。

### 2.2 创建项目外的四个工作树

```powershell
$projectPath = [IO.Path]::GetFullPath('D:\A_temp-work\gradtrip').TrimEnd('\')
$taskWorktreeRoot = [IO.Path]::GetFullPath('D:\A_temp-work\gradtrip-worktrees').TrimEnd('\')
if ($taskWorktreeRoot.Equals($projectPath, [StringComparison]::OrdinalIgnoreCase) -or
    $taskWorktreeRoot.StartsWith($projectPath + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw '工作树不能放在主项目中'
}

# 目标目录、分支和标签已按准备条件核实后执行。
git -C $projectPath worktree add -b feat/foundation "$taskWorktreeRoot\foundation" parallel/start-v1
git -C $projectPath worktree add -b feat/planning "$taskWorktreeRoot\planning" parallel/start-v1
git -C $projectPath worktree add -b feat/itinerary-ledger "$taskWorktreeRoot\itinerary-ledger" parallel/start-v1
git -C $projectPath worktree add -b feat/sharing "$taskWorktreeRoot\sharing" parallel/start-v1
git -C $projectPath worktree list
```

这些是关联同一 Git 仓库的工作树，不是四次 git init 或四份互不关联的复制。每个工作树只能占用自己的分支。[Git Worktree 官方说明](https://git-scm.com/docs/git-worktree)

### 2.3 B0 基础提交：T01 的首个交付，不是第五个任务

T01 必须先交付一个独立、可运行的 B0 commit，再继续完整存储与集成工作。B0 至少包含：

1. Vite/React/TS、依赖锁文件、检查脚本与基础测试环境。
2. 公共模型、运行时结构 schema、命令联合类型、页面 props、仓库/分享服务接口。
3. CSS tokens、外壳、可访问的基础表单/弹层，以及路由占位。
4. 通用日期/金额基础工具、空旅行工厂、内存仓库测试替身。
5. 开放缺口列表：尚未实现的能力必须明确报错，不返回伪成功。

B0 不创建 T02～T04 归属目录下的页面占位文件。占位组件放在 `src/app/placeholders/`，避免后续出现相同文件的并行新增冲突。

B0 同时提供无需修改共享路由/dispatcher 即可接入本线页面与 handler 的受控扩展点，例如按固定入口和导出名进行模块发现。其他线添加自己的 index.ts 后应能在本工作树访问自身页面并执行本域命令；未实现的其他模块明确显示开发占位。最终集成必须检查所有必需模块均已注册，不能让开发 fallback 掩盖漏接线。

B0 之前，T02～T04 同时开工：梳理规则、编写本域纯函数与测试用例、准备素材及各自报告；只在自己的文件范围工作。可以按本方案约定接口写代码，但不能复制工程脚手架、包文件或另建模型。需要运行依赖时等待 B0，不能把未运行的测试称为通过。

T01 在自己的任务报告和交接消息中提供 B0 完整 commit hash、实际导出列表、命令 payload、基础组件 API 和已通过检查。T02～T04 先提交自己的安全改动，工作区干净后分别合并同一个 B0：

```powershell
# 在各自工作树执行；先将变量替换为 T01 交付的真实完整哈希。
$baselineCommit = '替换为B0完整提交哈希'
if ($baselineCommit -notmatch '^[0-9a-f]{40}$') { throw '请填写真实 B0 哈希' }
git status --short
git merge --no-edit $baselineCommit
npm ci
```

使用 merge 保留同一 B0 的共同祖先，不对每条线分别 cherry-pick B0，也不复制文件来同步。B0 后公共契约冻结；必要变更由 T01 统一提交小型兼容变更，各线合并对应 commit 后继续。

## 3. 文件所有权

“独占”指只有对应任务可直接编辑；需要改其他归属文件时向所有者提出接口需求。所有者提交后通过 Git 合并获取，不直接进入其目录修文件。

| 归属 | 路径范围 |
| --- | --- |
| T01 工程与公共层 | package.json、package-lock.json、index.html、所有根工程配置、`.github/**`、`scripts/**`、`src/main.tsx`、`src/contracts/**`、`src/components/**`、`src/styles/**` |
| T01 应用与持久化 | `src/app/**`（排除下述 T04 文件）、`src/infrastructure/repository.ts`、`migrations.ts`、`notifications.ts`、`src/domain/types.ts`、`schema.ts`、`commands.ts`、`money.ts`、`dates.ts` |
| T01 汇总与交付 | `src/data/demo.ts`、`src/data/assetManifest.ts`、`public/**`、`README.md`、`docs/ACCEPTANCE.md`、`docs/assets/SOURCES.md`、`tests/helpers/**`、基础/存储/全流程测试 |
| T02 小队与方案 | `src/features/squad/**`、`src/features/plans/**`、`src/domain/planning/**`、`src/data/destinations.ts`、`transport.ts`、`templates/**`、`demoPlanning.ts`、`assetsPlanning.ts`、`src/assets/destinations/**` |
| T03 日程与财务 | `src/features/itinerary/**`、`src/features/ledger/**`、`src/domain/itinerary/**`、`src/domain/ledger/**`、`src/data/demoLedger.ts` |
| T04 分享与导入 | `src/features/sharing/**`、`src/domain/sharing/**`、`src/infrastructure/transfer.ts`、`src/app/application/sharing.ts` |
| 各任务专属文档/测试 | T01～T04 各自的报告、`tests/domain/<领域>/**`、`tests/integration/<领域>/**`、`tests/e2e/<领域>/**`；见任务书具体路径 |

上述领域子目录是为并行隔离细化现有建议目录；不得同时在根目录新建 matching/consensus/settlement 的另一套重复实现。通用 money.ts 只放金额解析、格式化和安全整数基础能力，财务分摊/结算算法归 T03。

共享文件处理：

- package 与锁文件只有 T01 修改；其他线提出依赖请求，不独自 npm install 或提交锁文件。
- 全局路由、CSS tokens、图标适配、聚合 schema/命令、统一验收报告只有 T01 修改。
- 各模块用 CSS Modules，不写全局 reset 或 body 样式；Lucide 通过 B0 约定方式按需使用。
- 现有 PRD、规则、架构、pages 和 AGENTS 不由四条线并行重写。设计变更提交给 T01 集中核对。
- `HANDOFF.MD` 是例外：各任务可追加真实踩坑，用 `T0N：问题` 标题，不修改原有段落。集成时 T01 保留所有有效条目，人工处理并发追加冲突。
- 任务报告分别写 `docs/tasks/reports/T01.md`～`T04.md`，不多人改一张进度表。

## 4. B0 公共接口约定

以下规定接口语义；T01 在 B0 中落实实际 TypeScript 类型并记录导出路径，其他线不得擅自创建平行类型。

### 4.1 业务类型与命令

- 公共实体以开发文档的 Trip、Member、Plan、Intent、Activity、Expense、Settlement 等为基础，唯一来源为 `src/domain/types.ts`，`src/contracts/` 只引用/导出，不重复定义实体。
- 公共结构 schema 归 T01；领域语义校验分别归任务所有者，最终由 T01 聚合执行。T04 自己维护传递 envelope 和白名单 schema。
- 命令包含 commandId、tripId、expectedRevision 和带判别字段的 payload；字段类型不能退化为 any 或任意 JSON。
- 业务 handler 输入 Trip、对应命令、显式 today/now/预分配 ID，返回新的 Trip 或结构化业务错误，不直接持久化，不隐式读时钟/生成随机数。
- T01 负责幂等、expectedRevision、事务与 revision 加一；T02 负责约束版本和共识失效辅助函数。T04 更新成员反馈时复用该辅助函数，不能自行复制失效逻辑。
- 删除旅行、覆盖备份和恢复副本作为仓库级操作单独定义，不用不存在的 Trip 假装普通更新。

| 命令族 | 业务实现归属 |
| --- | --- |
| trip.create / rename / delete / resetDemo | T01 |
| member.add / update / remove | T02 |
| plan.generate / update / recordIntent / confirm | T02 |
| itinerary.add / update / remove / move / replaceFromTemplate | T03 |
| ledger.addExpense / updateExpense / removeExpense / recordSettlement / voidAllSettlements | T03 |
| sharing.registerInvitation / applyResponse，以及备份导入应用 | T04；事务由 T01 仓库执行 |

### 4.2 页面与服务接口

工作区页面接收统一 WorkspaceProps：当前 Trip、绑定当前旅行的异步 execute(payload)、保存状态，以及 openInvite(memberId)、openImport()、openShare(planId?) 等 UI 回调。

- 页面只调用 execute 或服务接口，不操作 IndexedDB；错误包含 code/message/字段问题，不能仅返回 boolean。
- 保存状态至少覆盖 saved、saving、unsaved、conflict、memoryOnly；T01 管理，其他页如实呈现。
- T02 的成员邀请按钮通过 openInvite 回调触发 T04，不能直接 import T04 私有 UI。
- T04 的备份恢复 UI 通过 T01 仓库服务列出恢复副本、预览和覆盖；不能直接另开数据库。
- 最终页面出口统一为各 feature 的 `index.ts`：SquadPage、PlansPage、ItineraryPage、LedgerPage、SnapshotPage、JoinPage、ResponsePage。T04 另导出集中分享/导入面板入口，具体 props 在 B0 确定。
- 首次确认的模板日程由 T03 提供纯构建函数。T02 通过 B0 定义的构建器依赖调用，T01 在应用组合处注入；不能在 T02 再写一套模板日程。
- T02 对外的规划查询/约束变更能力在 B0 定义为公共服务接口。T03/T04 通过注入使用，测试以各自 fixture 替代；不在尚未合并的功能分支硬 import 另一分支才存在的文件，不形成循环依赖。

### 4.3 跨模块交付

| 提供方 | 对其他线的交付 |
| --- | --- |
| T01 → 全部 | B0、类型/命令、基础组件、仓库接口、内存替身、公共 tokens |
| T02 → T03/T04/T01 | 候选模板及版本、匹配/共识查询、成员约束变更辅助函数、计划示例种子 |
| T03 → T02/T01 | 模板日程构建器、财务与日程 handler、预算查询、示例费用种子 |
| T04 → T01/T02 | 分享服务入口、独立页面、导入预览与应用、公开载荷白名单 |

接口未到齐时使用本任务 tests/fixtures 下的测试替身。生产实现不能把 fixture 或 NOT_IMPLEMENTED 分支当作最终功能；等待依赖的检查要明确报告。

## 5. 四线执行与测试环境

### 5.1 同时开工安排

| 阶段 | T01 | T02 | T03 | T04 |
| --- | --- | --- | --- | --- |
| 第一阶段 | 优先交付 B0 | 规划纯函数/用例、目的地与素材 | 分摊/结算/日程纯函数与用例 | 传递协议、白名单、编解码与用例 |
| 第二阶段 | 真实存储、外壳、公共服务 | 合入 B0，完成小队与方案 | 合入 B0，完成日程与账本 | 合入 B0，完成分享及外部页面 |
| 第三阶段 | 依次集成其他三线 | 修复本域集成问题 | 修复本域集成问题 | 修复本域集成问题 |
| 第四阶段 | 全流程、性能、Pages 发布准备 | 支持本域验收 | 支持本域验收 | 支持跨设备静态反馈验收 |

### 5.2 各自环境

| 任务 | dev 端口 | preview 端口 |
| --- | --- | --- |
| T01 | 5173 | 4173 |
| T02 | 5174 | 4174 |
| T03 | 5175 | 4175 |
| T04 | 5176 | 4176 |

- 每个工作树单独 npm ci，不能共享可写 node_modules；package-lock 是同一 B0 的受控版本。
- dev/preview 使用 --strictPort，端口冲突直接报告，避免自动切换后看错页面。
- 例如 T02：`npm run dev -- --host 127.0.0.1 --port 5174 --strictPort`；浏览器访问路径带实际 Vite base。
- 统一使用 127.0.0.1，端口区分 origin，避免工作树测试误读其他线的 IndexedDB。E2E 再用隔离上下文控制状态。
- 数据库名继续按 app + 部署 base 命名，不按分支名命名；最终部署不能沿用测试专属 namespace。
- 优先 Codex 内置浏览器，备选 Chrome。每线检查 375/768/1440 px，关键逻辑有独立测试。
- 每线提交前运行其可执行的 typecheck、lint、领域/集成测试和 build；不存在的脚本、未到齐的接口不能记为通过。全项目绿灯与性能统一由 T01 最终验证。

## 6. 集成、交付与完成定义

### 6.1 分支交付

各线分小步提交自己的文件，提供分支头 hash、B0 hash、实现清单、实际运行的命令与结果、剩余问题。先用 `git diff --name-only parallel/start-v1...HEAD` 检查越界；合入 B0 的公共文件变化需按其来源解释，不能把共享基线误当越界。

任务报告放各自 reports 文件，不把状态、预想风险或普通进度写进 HANDOFF。任务未完成不能只提交一张静态展示页结束。

### 6.2 合并顺序与责任

T01 在自己的 foundation 工作树执行集成，顺序为 T02 → T03 → T04，每次合并后检查；这仍属于 T01，不增加第五个开发任务。

```powershell
# 先确保三个分支各自已提交、已交付且暂停写入，再在 foundation 中执行。
Set-Location 'D:\A_temp-work\gradtrip-worktrees\foundation'
git status --short
git merge --no-ff --no-edit feat/planning
git merge --no-ff --no-edit feat/itinerary-ledger
git merge --no-ff --no-edit feat/sharing
```

- 先完成本线模块交付再合并；不要在 T01 和各功能分支之间持续互相整支合并。
- T01 处理应用接线、注册所有 handler/validator、合成示例、资源与许可汇总、全局视觉一致性。
- 涉及本域行为的问题由所属任务修复并提交，T01 再合并新 commit；接线问题由 T01 修复。
- 同一冲突文件不由两个智能体同时处理；不得用 --ours/--theirs 全覆盖或删除测试来获得绿灯。
- 集成后移除开发占位和测试替身入口；所有 P0 必须真实可用，不能留假成功。

最终由协调者在主目录 main 检查并接收集成结果：

```powershell
Set-Location 'D:\A_temp-work\gradtrip'
git status --short
git merge --ff-only feat/foundation
```

主目录若有新提交导致无法快进，应先核对并完成正常集成，不能 reset 或强推覆盖。四个任务不各自推送 main、不各自部署；协调者按已授权范围统一推送与发布。当前尚无远程仓库配置，不能声称已上线。

### 6.3 全项目完成条件

1. PRD F01～F06 全覆盖，pages.md P01～P08 和必要弹层可达。
2. 修改约束→方案变化→确认→日程→记账→结算完整通过。
3. 两个隔离上下文验证邀请/填写/回传/导入，验证备份恢复与错误路径。
4. 所有 handler、语义校验和路由已接入真实实现；全项目 typecheck/lint/test/build/体积检查通过。
5. JS/CSS gzip <= 200/40 KiB，首屏传输 <= 700 KiB，图片 <= 150 KiB，LCP <= 2.5 s、CLS <= 0.1、领域计算最大 <= 50 ms；环境按开发文档，不能叠加四份首屏预算。
6. Pages 的 base、匿名访问、刷新、固定地址及发布后性能按开发文档验证；未实际发布的部分如实列为未完成。
7. T01 汇总 `docs/ACCEPTANCE.md`；各任务报告有实际证据，无虚构测试、素材来源与部署记录。

### 6.4 工作树收尾

统一集成验收后检查各工作树干净、分支提交可达，再用 `git worktree remove <项目外工作树路径>` 逐个移除。不要直接用文件管理器删除，也不要使用 --force 或递归删除；有未提交内容先交接。保留分支直到确认不再需要，标签和历史不随工作树一起删除。

本方案采用的 worktree 与 merge 操作见 [Git Worktree](https://git-scm.com/docs/git-worktree)、[Git Merge](https://git-scm.com/docs/git-merge) 官方文档。
