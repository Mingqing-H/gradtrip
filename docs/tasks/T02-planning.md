# T02：小队、候选方案与共识

分支：`feat/planning`  
工作树：`D:\A_temp-work\gradtrip-worktrees\planning`  
开发/预览端口：5174 / 4174

## 1. 任务目标

实现从录入成员约束到比较方案、表达意向和全员确认的真实闭环，完成 PRD F01、F02 及本域 F06。不要只做目的地展示卡片。

必读：[AGENTS](../../AGENTS.md)、[HANDOFF](../../HANDOFF.MD)、[并行总约定](../gitworktree.md)、[PRD](../PRD.md)。重点：[业务规则](../BUSINESS_RULES.md) BR-01～BR-07、[页面设计](../pages.md) P01/P02、[架构](../architecture.md) 图片与图标、[开发文档](../MVP_DEVELOPMENT.md) 数据模型和测试。

## 2. 文件边界

- `src/features/squad/**`、`src/features/plans/**`。
- `src/domain/planning/**`，匹配、日期可用性、约束与共识逻辑放在本目录。
- `src/data/destinations.ts`、`transport.ts`、`templates/**`、`demoPlanning.ts`、`assetsPlanning.ts`。
- `src/assets/destinations/**`；素材来源写 `docs/assets/SOURCES-planning.md`，由 T01 汇总。
- `tests/domain/planning/**`、`tests/integration/planning/**`、`tests/e2e/planning/**`。
- 报告 `docs/tasks/reports/T02.md`。

不要编辑 package/锁文件、公共模型/schema/command、全局组件/样式/路由或统一 demo。需要共享能力时请求 T01 交付。

## 3. 并行开始与依赖

- B0 之前先做日期/匹配/共识规则、测试用例与目的地素材；按总约定使用待交付类型，不另造一份 Trip。
- B0 到达后在干净工作区合并同一 commit 并 npm ci，再实现 UI 与真实命令接线。
- 通用日期/金额工具来自 T01。确认后模板日程由 T03 构建器提供，通过注入调用；未到齐时写测试替身，不将其作为生产实现。
- 邀请/反馈 UI 归 T04；成员行只调用统一 openInvite/openImport 回调。

## 4. 必须交付

### 4.1 小队

- 成员添加/编辑/删除，城市、预算、最多 5 段可用日期、偏好和资料完整度。
- 空值与零预算区分，重复昵称以 ID 识别，账目引用成员不可删除并能定位相关内容。
- 桌面列表、手机信息块、空状态、上限与字段错误；资料变化正确使共识失效。

### 4.2 方案与共识

- 自然日连续区间、共同出发日、2～5 天、搜索窗口与无交集冲突详情。
- 至少 6 个目的地模板、交通表与不可变模板版本；未知交通必须待补充。
- 按人计算交通与人均分项，卡片显示实际个人估算范围；排序遵循业务规则，不用臆造百分比。
- 逐人时间/预算适配、冲突差额与估算编辑；变更提交后刷新，而非只改界面数字。
- 赞成/可接受/不参加、代录来源、示例成员视角、旧意向失效历史。
- 全员硬约束和意向共同控制确认；确认失效保留日程，不以多数票跳过成员。
- 首次确认调用注入的 T03 构建器，已有日程默认保留，替换需明确确认。

### 4.3 示例与素材

- 提供 6 位虚构成员的规划种子、相对未来日期、全员可行与有冲突的候选；不写入真实用户数据。
- 提供至少 6 张与模板目的地匹配的已优化横图，可搜集或生成；记录具体来源许可或生成工具/提示词。
- 真实城市照片核对地点，合成景观标为示意；按架构要求尺寸变体、单图 <=150 KiB、图片失败降级。
- 示例不要依赖手工硬编码“匹配 6 人”，应由真实规则算出；未确认与示例标识正确。

## 5. 对外接口

按 B0 契约导出，若函数签名需调整先与 T01 协商：

- 页面：`SquadPage`、`PlansPage`，通过各 feature 的 index.ts 导出。
- `src/domain/planning/index.ts`：`applyPlanningCommand`、`validatePlanningTrip`、`getPlanEvaluations`、`getConsensusStatus`、`findCommonDepartures`、`updateMemberConstraints`。
- updateMemberConstraints 是共识失效与约束版本变化的唯一公共入口，供 T04 应用成员反馈复用；相同值不增加版本。
- 向 T03 提供模板类型对应的数据实例；向 T04 提供基于邀请白名单输入的个人估算与候选查询，不依赖其他成员私有信息才能运行。
- 提供 `createPlanningDemo` 种子工厂，由 T01 合成统一示例；素材映射供 T01 汇总，不直接修改公共 manifest。

## 6. 验收

- 缺资料、边界相等预算、日期跨空白、多人冲突去重、未知交通、确定性排序均有测试。
- 修改一人预算 ¥1,500→¥1,100，可看到对应方案冲突与差额；实际调整参数或方案后才能恢复可行。
- 未反馈/明确拒绝/过期意向不能确认；新约束版本后旧确认失效，手工日程保留。
- 生产构建下小队→方案→确认路径可操作，375/768/1440 px 可用，无整页横向溢出。
- 执行可运行的类型、lint、相关测试和 build；跨线依赖未到齐的检查如实记录，最终须补测。
- 不私自部署、不创建第二份图标库或全局样式，不突破总性能预算。

交付实际分支 hash、接口清单、素材记录、测试结果与依赖缺口。真实踩坑记 HANDOFF 的 T02 条目，其他状态写专属报告。
