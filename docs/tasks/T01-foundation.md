# T01：基础工程、公共能力与最终集成

分支：`feat/foundation`  
工作树：`D:\A_temp-work\gradtrip-worktrees\foundation`  
开发/预览端口：5173 / 4173

## 1. 任务目标

你是四条开发线中的基础工程所有者，同时负责最终集成。先交付其他三线可以共同依赖的 B0，再完成真实存储、工作台外壳与组合接线；不能把所有时间用于单独完善基础设施而迟迟不交付 B0。

必读：[AGENTS](../../AGENTS.md)、[HANDOFF](../../HANDOFF.MD)、[并行总约定](../gitworktree.md)、[PRD](../PRD.md)、[架构](../architecture.md)、[开发文档](../MVP_DEVELOPMENT.md)。外壳和错误恢复参考 [页面设计](../pages.md) 第 3、11、12 节。

## 2. 文件边界

独占公共工程配置、包与锁文件、scripts、.github、src/main.tsx、src/contracts、src/components、src/styles；src/app 除 `application/sharing.ts` 外均归本任务。

独占根 domain 的 types/schema/commands/money/dates；基础设施 repository/migrations/notifications；统一 demo 与 assetManifest、public、README、ACCEPTANCE 及最终素材来源清单。

测试归属：`tests/domain/core/**`、`tests/integration/storage/**`、`tests/e2e/full-flow/**`。报告：`docs/tasks/reports/T01.md`。不直接编辑 T02～T04 的业务文件；集成发现问题请对应所有者修复。

## 3. 首个交付 B0

按总约定提供单独可识别的 B0 commit，优先包含：

1. 可安装、可启动、可 build 的 React/Vite/TS strict 工程与 Hash 路由；公开所有检查脚本。
2. 统一依赖：React、Router、Zod、idb、Lucide；测试/图片工具在工程中按需正确分类，Node 与锁文件一致。
3. 唯一公共实体类型、结构 schema 和带判别字段的命令联合类型；列明每个 payload、错误类型、公共导出和模块接口。
4. WorkspaceProps、异步命令入口、UI 回调、仓库接口、分享服务接口和最终组合依赖形状。
5. token、工作台外壳与基础 Button/Input/Select/Dialog/Drawer/Menu/Status 等必需能力，具备键盘与焦点行为；受控模块扩展点让其他线添加自己的入口即可加载页面/handler，无须改共享文件。
6. 金额文本解析/格式化/安全整数、自然日基础工具、空旅行构建器、仅供测试的内存仓库。
7. 本线基础测试通过，真实未实现能力明确报错；路由占位在 app/placeholders，不写其他任务目录。

B0 必须附具体 API，不仅是一条“已搭好工程”的消息。其他线依赖的是同一个真实 commit；不要后续 amend/rebase 改写已交付 B0。

## 4. 后续必须实现

- IndexedDB 真实事务仓库，读取校验、命令幂等、expectedRevision、revision、原子恢复副本、容量限制、损坏内容保留与内存模式。
- 数据库/通知按稳定 app + base 命名；多标签页通知与提交版本检查配套，dbVersion 显式迁移与旧连接关闭。
- 创建/切换/重命名/删除旅行、最近工作区、首次示例与单独重置示例；支持局部失败恢复。
- 页面外壳、旅行选择、统一保存状态、P08 错误与恢复状态，所有功能页和共享面板接线。
- 组合三线的纯命令 handler 和语义校验；结构校验不能替代财务与共识不变量。
- 组合 T02 计划示例种子与 T03 日程/财务种子生成统一示例；使用相对未来日期与稳定引用。
- 注入 T03 日程构建器给 T02 确认流程；注入仓库给 T04，不能重复实现业务算法。
- 汇总素材 manifest、来源和依赖许可；B0 图标适配使用 Lucide，禁止全量图标集合。
- GitHub Pages workflow、base、bundle 检查脚本、README 和实际验收记录；配置好发布能力不等于已经公开上线。

## 5. 与其他任务协作

- 接受依赖、公共组件、类型或服务缺口请求，由你修改共享文件，提供小型兼容 commit；避免重写已稳定 API。
- B0 后其他线合并指定 commit，不要求它们持续合并 foundation 整个开发中的分支。
- T04 的 `src/app/application/sharing.ts` 由其独占；你只负责入口注入和调用。
- 各线就绪后在本工作树按 T02→T03→T04 集成，协调者最后在原目录将 main 快进到你的集成分支。
- 冻结被集成分支的交付点；后续修复另提交并通知，不自己进入其工作树修改。

## 6. 验收

- B0 在其交付点可独立 typecheck/lint/test/build，API 清单与任务所需能力一致。
- 仓库测试覆盖重复命令、旧版本提交、事务中止、解析损坏、覆盖导入恢复与多标签页更新。
- 所有 feature 接入后移除开发占位，没有假成功或静默丢弃的命令。
- 三尺寸检查与 PRD 全流程、隔离上下文反馈、备份恢复、实际 repo 子路径验证完成。
- 执行全项目 typecheck、lint、test:run、build、check:bundle-size，性能按开发文档测量。
- 已获发布执行范围内，由协调者统一发布并检查匿名访问；尚未绑定远程或实际发布时明确列为未完成，不伪造地址。

## 7. 交付报告

在专属报告记录：B0 与最终 hash、公共接口目录、真实命令结果、集成分支来源、性能测量、已知问题及部署状态。真实踩坑追加根 HANDOFF 的 T01 条目，普通进度留在报告。

交接时明确下一位协调者应执行的实际操作，不将“已合并”“已部署”与“已准备配置”混写。
