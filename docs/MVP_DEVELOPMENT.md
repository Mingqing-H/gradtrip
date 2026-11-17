# 同路 · 毕业旅行 MVP 开发文档

版本：MVP v1.0  
日期：2026-11-17  
状态：实施规格，尚未创建应用代码或执行部署  
需求：[PRD](./PRD.md)  
规则：[BUSINESS_RULES.md](./BUSINESS_RULES.md)

## 1. 交付目标与边界

实现一个纯静态、可公开访问的毕业旅行工作台，完成 PRD 中 F01～F06 的全部 P0 功能。采用 GitHub Pages 发布，不配置业务服务器、数据库服务、在线 AI 或支付接口。

成功验收同时满足：核心路径可操作、业务计算正确、本地持久化可恢复、跨浏览器反馈闭环可演示、匿名访问正常、资源与性能达标。文档中的命令和门槛为待实现要求，不能当作已完成记录。

## 2. 技术选择

| 层面 | 选择 | 原因与限制 |
| --- | --- | --- |
| 前端 | React + TypeScript + Vite | 静态构建，类型约束明确 |
| 路由 | Hash 路由 | 页面刷新只请求站点入口，避免 Pages 深层路径 404 |
| 状态 | React reducer/context，按领域拆分 | 不先引入全局状态框架；计算独立于组件 |
| 持久化 | IndexedDB，本地事务存储 | 支持旅行、恢复副本和版本检查原子提交；不等同于云端数据库 |
| 校验 | 共用运行时 schema，建议 Zod | 表单、导入、存储恢复复用校验；TypeScript 本身不能校验外部 JSON |
| 样式 | CSS variables + 普通 CSS/CSS Modules | 控制依赖与首屏成本 |
| 单元测试 | Vitest | 覆盖日期、金额、状态与导入规则 |
| 浏览器测试 | 优先 Codex 内置浏览器；自动回归可用 Playwright | 同时检查生产构建和 repo 子路径 |
| 发布 | GitHub Actions → GitHub Pages | 从固定仓库发布到固定地址 |

依赖在初始化时选择相互兼容的稳定版本，提交 package-lock.json，CI 使用 npm ci。Node 使用初始化时选定的受支持 LTS，并在本地配置和 Actions 中保持一致；不得依赖未经锁定的 latest。

## 3. 代码边界与建议目录

```text
src/
  app/               # 路由、旅行选择、错误边界、上下文
  features/
    squad/           # 成员表单、邀请与反馈入口
    plans/           # 候选卡片、明细、意向、确认
    itinerary/       # 按天列表和活动编辑
    ledger/          # 费用、余额、结算
    sharing/         # 只读快照、成员填写页、导入预览
  domain/
    types.ts
    schema.ts
    money.ts         # 文本金额解析、分配、统计
    dates.ts         # 区间规范化与共同日期
    matching.ts      # 估算、匹配、确定性排序
    consensus.ts     # 意向与确认状态
    settlement.ts    # 余额与转账建议
    commands.ts      # 业务命令、版本变更和去重
  data/
    destinations.ts
    transport.ts
    demo.ts
  infrastructure/
    repository.ts    # IndexedDB 事务、预期版本比较
    migrations.ts
    transfer.ts      # 分享协议编解码及白名单转换
  components/        # 复用表单、弹层、反馈等基础 UI
  styles/
tests/
  domain/
  integration/
  e2e/
public/
docs/
.github/workflows/
```

- domain 只接收数据和显式参数，不直接访问浏览器存储、当前时间或 React。
- 当前日期、时区语义、ID 生成器通过参数注入，测试可固定输入。
- schema 和 domain 同时供 UI、导入和持久化恢复使用；不要维护多套金额规则。
- 不持久化可重新推导的匹配分数、余额和“已确认”布尔值，避免派生数据过期。

## 4. 数据结构

以下为核心结构草案，实施时补全字段类型并建立运行时 schema。字段和版本语义以业务规则为准。

```ts
type Id = string;
type Cents = number; // 运行时要求非负安全整数；余额使用有符号安全整数
type DateOnly = string; // schema 校验真实 YYYY-MM-DD
type Range = { start: DateOnly; end: DateOnly };
type IntentValue = 'approve' | 'acceptable' | 'decline';

interface Member {
  id: Id;
  name: string;
  originCity: string | null;
  budgetCap: Cents | null;
  availability: Range[];
  preferences: string[];
}

interface Plan {
  id: Id;
  version: number;
  destinationId: Id;
  templateVersion: number;
  startDate: DateOnly;
  days: 2 | 3 | 4 | 5;
  estimate: {
    transportByMember: Record<Id, { originCity: string; amount: Cents } | null>;
    lodgingPerNight: Cents;
    foodPerDay: Cents;
    activities: Cents;
    reserve: Cents;
  };
}

interface Intent {
  memberId: Id;
  planId: Id;
  planVersion: number;
  constraintRevision: number;
  value: IntentValue;
  source: 'organizer' | 'feedback' | 'demo';
  recordedAt: string;
}

interface Confirmation {
  planId: Id;
  planVersion: number;
  constraintRevision: number;
  confirmedAt: string;
}

interface Activity {
  id: Id;
  date: DateOnly;
  startTime: string | null;
  endTime: string | null;
  title: string;
  category: string;
  budgetBucket: 'activities' | 'included';
  perPersonEstimate: Cents | null;
  note: string;
  order: number;
}

interface Expense {
  id: Id;
  title: string;
  date: DateOnly;
  category: string;
  amount: Cents;
  payerId: Id;
  splitMode: 'equal' | 'custom';
  allocations: { memberId: Id; amount: Cents }[];
  createdAt: string;
}

interface Settlement {
  id: Id;
  commandId: Id;
  fromId: Id;
  toId: Id;
  amount: Cents;
  recordedAt: string;
  voidedAt: string | null;
}

interface InvitationRecord {
  id: Id;
  memberId: Id;
  constraintRevision: number;
  planVersions: Record<Id, number>;
  createdAt: string;
}

interface Trip {
  schemaVersion: 1;
  id: Id;
  name: string;
  revision: number;
  constraintRevision: number;
  searchWindow: Range;
  duration: 2 | 3 | 4 | 5;
  members: Member[];
  plans: Plan[];
  intents: Intent[]; // 包括失效历史，计算时按版本筛选
  confirmation: Confirmation | null;
  itinerary: {
    sourcePlanId: Id | null;
    sourcePlanVersion: number | null;
    dateRange: Range | null;
    activities: Activity[];
  };
  expenses: Expense[];
  settlements: Settlement[];
  invitations: InvitationRecord[];
  appliedResponses: { id: Id; invitationId: Id; appliedAt: string }[];
  appliedCommandIds: Id[];
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
}
```

补充约束：

- duration 改变时统一更新候选 days，并增加对应方案版本；单个候选日期可不同，搜索窗口一致。
- transportByMember 仅存手工覆盖值，只允许当前成员 ID；null 表示按当前城市查模板版本对应的交通表，不代表零费用。覆盖值的 originCity 必须与成员当前城市相同，否则失效。新增成员补 null，删除成员同时删除未引用候选参数与意向。
- invitation 附带 templateVersion 和共用参数；只在明确确认分享范围时附带目标成员自己的手工交通覆盖值。接收端使用同版表计算，不能带入完整成员映射或默默采用另一版估算。
- 活动超出新确认日期时标记为待调整，不自动搬移；source 字段记录原模板来源，确认记录独立保存。
- 内置模板作为代码常量，不随备份整体重复导出；导出的实例必须包含完整可重算估算。
- 设旅行意向历史最多 2000 条、邀请与已应用反馈各最多 1000 条、命令 ID 最多 5000 条。达到上限时阻止相应新操作并提示导出，不静默截断去重历史。
- isDemo 仅用于示例展示与重置范围，不能赋予跳过金额校验的权限。
- 导入进行结构和语义两层验证：ID 唯一、引用存在、日期合法、金额不变量成立、集合上限与版本合法。

## 5. 本地保存与并发

建议 IndexedDB stores：`trips`（以 tripId 为键的 JSON 数据及 revision）、`recovery`（覆盖前版本）、`settings`（最近访问旅行和工作区）。业务事务不依赖 settings 成功。

单次提交过程：

1. 在内存构造业务命令，附 commandId 与 expectedRevision。
2. 在同一个 readwrite transaction 内读取当前旅行，校验 expectedRevision 与 commandId。
3. 应用纯函数命令，执行完整 schema 和业务不变量检查。
4. 更新 revision/updatedAt，写入完整新版本；覆盖导入时同时写 recovery。
5. transaction complete 后才显示已保存，并通知其他标签页。

- 单次事务内的读取和写入均使用同一事务，不跨事务进行“先检查后写入”。不要在事务中等待网络或无关异步任务。
- BroadcastChannel 用于快速提示；再次聚焦时检查版本。即使通知丢失，提交时的事务版本检查仍须阻止旧内容覆盖。
- 保存失败保留内存草稿并显示未保存；提供重试和直接从内存导出，不创建空旅行覆盖原数据。
- 若 IndexedDB 不可用，允许临时内存体验，醒目标明无法持久保存，仍可导出文件；禁止显示刷新后会保留。
- 解析损坏内容时保留原始 JSON；恢复页面允许下载原始内容或用户明确重置。
- 每旅行序列化上限 900 KiB，为备份 envelope 留出空间；完整导出文件和导入上限均为 1 MiB，写入和导出前分别验证，保证可导出的有效数据能被重新导入。全应用自定存储上限 20 MiB，含恢复副本；实际浏览器配额仍可能更小，必须捕获事务失败。
- 同一旅行覆盖前最多保留最近 3 份恢复副本，按明确保留策略淘汰更旧恢复副本，不删除主旅行。超过总上限则要求用户管理备份，不静默覆盖。

## 6. 页面、路由与分享协议

建议路由：

```text
#/trip/<tripId>/squad
#/trip/<tripId>/plans
#/trip/<tripId>/itinerary
#/trip/<tripId>/ledger
#/share?data=<snapshot>
#/join?data=<invitation>
#/response?data=<response>
```

- 所有路径都位于 fragment，仓库子路径仍由 Vite base 处理。未知 tripId 给出恢复/选择入口，未知路由返回旅行入口。
- response 页面展示反馈摘要和“复制回传链接 / 导出反馈文件”；组织者通过导入入口粘贴链接或选文件。若当前设备存在目标旅行，仍先预览差异，不能自动应用。
- JSON 文件均使用统一 envelope：`{schemaVersion:1,type,payloadId,createdAt,body}`；backup.body 包含完整 Trip。分享类型使用各自白名单 schema。
- 编码流程：白名单对象 → JSON → TextEncoder UTF-8 → Base64URL；解码过程相反，不能对中文直接 btoa。
- 生成完整 URL 时用当前站点 origin 和部署 base，禁止写死 `/` 或 localhost。检查完整链接 UTF-8 长度 <= 8000。
- 解码前先限制编码长度，解码后再校验 1 MiB 上限；捕获非法 Base64、UTF-8、JSON、schema 和语义错误。
- 导入链接只接受本应用相同 origin 与 base 的受支持 fragment 路由，不访问链接目标，不跟随外部 URL。
- Clipboard API 失败时保留可选中文本。下载使用 Blob 和临时 Object URL，用后释放。
- 活动分享白名单不包含 note；完整备份单独说明隐私范围。
- 不在 URL、源码或仓库中放 GitHub token、云服务密钥或用户真实资料。

## 7. 示例与估算数据

- 至少 6 个目的地模板，提供模板 ID、名称、标签、支持时长、估算参数和日程种子。
- 交通表至少覆盖示例使用的 3 个出发城市与全部目的地；真实输入的其他城市进入待手工估算状态。
- 示例使用 6 名虚构成员。按首次初始化当天向后选择日期，设计一个全员可行方案和至少两个可解释冲突方案。
- 示例首次打开是筹备状态，设置大部分意向已反馈，保留一个待操作成员，方便展示确认路径。
- 示例费用同时包含全员均摊、部分人均摊和自定义分摊，不预置真实结算。
- 修改预算后能直接定位超预算成员；至少一个模板可通过真实修改估算或改选方案达到全员可行。
- 示例种子有独立版本，普通应用更新不覆盖已编辑示例；“重置示例”单独触发，并提示将丢弃示例修改。

## 8. UI 实施要求

- 工作台优先，主内容围绕任务；每个区域只有必要的主操作，避免堆叠说明卡和重复副标题。
- 方案卡片显示实际人数、金额和状态；冲突展开后提供逐人原因，不能仅靠颜色表达。
- 表单错误靠近字段，错误时保留原输入。无效提交定位首个错误；不能仅用禁用按钮让用户猜原因。
- 保存、未保存、临时内存模式、演示视角和只读快照应在相关位置可辨认，不重复全屏提示。
- 弹层支持键盘操作、Escape 关闭和焦点返回；危险操作显示具体影响。
- 手机使用单列候选与按成员排列的结算信息，宽表格不能成为操作障碍；触控目标至少 44 CSS px。
- 375、768、1440 px 宽度完成检查；375 px 无横向页面溢出。
- 正文对比度至少 4.5:1；表单有程序可识别的标签；状态变化有可访问提示。
- 动效以轻量过渡为主，支持 prefers-reduced-motion；不让大动画阻塞表单或路由。

## 9. 开发阶段与完成门槛

按依赖顺序实施，每阶段检查通过再进入下一阶段。不要以页面都已出现替代功能完成。

| 阶段 | 交付内容 | 进入下一阶段的条件 |
| --- | --- | --- |
| M0 工程骨架 | Vite、TS、hash 路由、npm scripts、锁文件、子路径配置 | build/typecheck/lint 可执行，生产构建在仓库子路径可预览 |
| M1 领域与存储 | 日期/金额/匹配/结算纯函数、schema、命令、事务仓库 | 关键不变量测试通过，刷新恢复、失败恢复、版本冲突有验证 |
| M2 小队与方案 | F01/F02、成员表单、估算明细、意向、确认与示例 | 修改约束能正确重排/失效，存在完整全员确认路径 |
| M3 日程与账本 | F03/F04、模板日程、编辑、分摊、结算更正 | 金额验算通过，日程不重复、不覆盖，结算锁有完整更正路径 |
| M4 分享与备份 | F05、邀请登记、成员填写、回传、导入预览、完整恢复 | 两个隔离浏览器上下文完成反馈与备份闭环，异常不写入 |
| M5 视觉与发布 | 响应式、可访问性、资源压缩、Actions 发布 | 全部 P0、性能和公开访问验收通过，形成验收记录 |

## 10. 测试计划

### 10.1 领域单元测试

围绕规则验证结果与边界，不为每个静态组件写镜像测试。

| 领域 | 必测内容 |
| --- | --- |
| 日期 | 区间合并、闰年/月末、无交集、含端点、跨空白不可连用、过去日期不可新确认 |
| 金额 | 十进制解析、两位精度、拒绝异常值、100 元三人尾差、自定义差额、安全整数 |
| 匹配 | 缺资料、未知交通、刚好预算、双重冲突去重、偏好中性、相同输入排序稳定 |
| 共识 | 未反馈/拒绝阻止确认、版本改变失效、当前拒绝撤销确认、保留日程 |
| 日程 | 模板不重复、区间外活动、相邻时间不算重叠、估算替换活动分项而非叠加 |
| 账本 | 仅参与人承担、垫付人与参与人分离、余额守恒、转账后方向、全结清、撤销记录 |
| 分享 | 中文往返、白名单隐私、长链接回退、损坏/跨源链接、未知 schema、重复/过期反馈 |
| 导入 | 非法 ID 引用、重复 ID、超限、原子失败、ID 重映射、保留恢复版本 |

对均摊和结算增加一组固定种子生成用例：始终验证分摊和为账单金额、余额和为零、建议全部应用后余额为零。失败输出种子便于复现。

### 10.2 存储集成测试

- 成功提交 revision 只加一次；同 commandId 再次提交不产生变更。
- 两个页面从相同 expectedRevision 修改，先提交成功，后提交出现版本冲突。
- 模拟事务中止、配额失败、损坏 JSON，检查不覆盖原数据，仍可导出内存内容。
- 覆盖导入同时保存 recovery，任一步失败应整体回滚。

### 10.3 浏览器验收

优先使用 Codex 内置浏览器，备选 Chrome。自动回归工具不能代替最终人工可见的公开站点检查。

1. 在生产构建下完成 PRD 的完整演示脚本，刷新与返回/前进保持预期状态。
2. 从空白旅行创建至少 2 位成员，完成方案确认、日程、实际费用、结算。
3. 两个隔离浏览器上下文完成邀请、填写、回传和导入；确认不是共享同一份本地存储产生的假同步。
4. 导出备份，在干净上下文恢复，并核对账本和确认状态。
5. 在部署 repo 子路径直接打开所有 hash 路由并刷新，资源全部成功加载。
6. 检查手机尺寸、键盘导航、弹层焦点、保存失败及未知路由。
7. 使用匿名窗口打开公开部署链接，无 GitHub 登录或其他账号要求。

## 11. 性能预算与验收

纯静态部署仍需控制首屏网络、解析开销和本地计算，不引入远程字体、大型地图 SDK、整包图标库或背景视频。

| 指标 | 发布门槛 | 测量方式 |
| --- | --- | --- |
| 首屏必要 JS | gzip 合计 <= 200 KiB | 对实际入口及首屏依赖产物逐个压缩求和；包含路由与示例数据 |
| 首屏必要 CSS | gzip 合计 <= 40 KiB | 对首屏样式产物压缩求和 |
| 首屏全部资源 | 冷加载传输 <= 700 KiB | 浏览器 Network，禁用缓存，记录转移大小 |
| 首屏图片 | 单张 <= 150 KiB | 产物检查；下方图片懒加载；优先本地 WebP/AVIF |
| LCP | <= 2.5 s | 公开站点同一 Chrome 版本，移动设备模拟、CPU 4 倍减速、下载 1.6 Mbps/上传 750 Kbps/RTT 150 ms，3 次冷加载取中位数 |
| CLS | <= 0.1 | 同上 3 次，取最差值；图片和骨架保留尺寸 |
| 领域计算 | <= 50 ms | 20 人、20 方案、200 费用固定数据，在上述 CPU 模拟下运行 20 次，报告中位数与最大值，最大值达标 |
| 操作反馈 | 下一帧显示提交/加载状态 | 性能录制检查成员保存、费用保存；不得长时间无反馈 |

这些是本项目的验收门槛，不宣称代表所有用户的真实网络体验。若 Pages 网络造成超标，保留测量证据，先检查静态体积与本地生产构建；最终公开站点结果仍需如实记录，不能以本地结果替代上线结果。

- 方案计算在相关输入变化时触发，账本更改不重算目的地集合。
- 预计计算量为 O(成员×方案×日期窗口) 和 O(费用×参与人数)，按文档上限有界；不预先引入 Worker。
- 图片懒加载，导入预览等非首屏功能可按路由拆包。控制拆包数量，避免为少量代码制造过多请求。
- MVP 不注册 Service Worker，避免旧缓存长期遮蔽同域名迭代；若后续加入需另写更新策略。

## 12. GitHub Pages 发布

### 12.1 固定地址

- 默认使用固定仓库的项目站点：`https://<owner>.github.io/<repo>/`。
- 仓库名和 owner 在首次发布前确定；不要为了更新作品删除重建仓库或改名。
- Vite 项目站点 base 设为 `/<repo>/`；用户根站点或自定义域名使用 `/`。本地验收要覆盖实际 base。
- 所有资源使用模块导入或 BASE_URL 生成，不写 `/assets/...` 这类忽略仓库路径的绝对地址。
- 所有本地数据仅存客户端，公开仓库只包含代码、虚构种子与模板。

### 12.2 自动化流程

准备 `.github/workflows/deploy.yml`，包含 main 分支 push 与 workflow_dispatch 触发；只对成功通过检查的构建部署。

```text
checkout
  → setup-node（与项目一致的 LTS，启用 npm cache）
  → npm ci
  → npm run typecheck
  → npm run lint
  → npm run test:run
  → npm run build
  → 产物体积检查
  → configure-pages
  → upload-pages-artifact（dist）
  → deploy-pages
```

- 在仓库 Settings → Pages 选择 GitHub Actions 发布源。
- build 与 deploy 可拆为 jobs，deploy 必须 needs build；部署最小权限为 contents: read、pages: write、id-token: write，使用 github-pages environment。
- Actions 版本采用官方当前可用版本，实施时核对；本规格不复制可能过期的整份 workflow。
- 配置 concurrency，避免旧提交晚于新提交完成发布；构建检查失败不执行部署。
- npm scripts 至少提供 dev、typecheck、lint、test:run、build、preview、check:bundle-size；脚本未建立前不要声称命令通过。
- `vite preview` 只用于本地检查产物，不是生产服务器。

### 12.3 上线检查与回退

1. 本地完成检查、核心浏览器验收与性能测试，整理可审查的构建产物。
2. 推送固定仓库并触发工作流，检查 Pages 发布实际完成。
3. 在公开 URL 再测资源路径、分享、刷新、匿名访问和性能。
4. 记录 commit、工作流运行链接、部署 URL、浏览器版本、测量环境、实际结果及未解决问题。
5. 若新版破坏核心路径，重新部署已知可用提交，保留同一 URL。
6. schema 改动须向前兼容或提供显式迁移；发布前用旧备份验证。保留旧代码并不等于新数据可安全降级，回退前必须检查数据兼容性。

GitHub Pages 不能保证永久不变的服务可用性；项目要求落实为固定地址、持续保留仓库与发布配置、验证公开访问，不使用临时分享地址交付。

## 13. 最终完成清单

- [ ] PRD F01～F06 全部完成，无仅展示的假按钮。
- [ ] 业务规则 R01～R14 及关键版本/财务不变量通过。
- [ ] 静态邀请反馈和备份闭环在隔离浏览器中通过。
- [ ] 本地保存、失败恢复、重复提交、多标签页冲突均有证据。
- [ ] 375/768/1440 px、键盘操作、错误提示验收通过。
- [ ] 生产产物与公开站点性能达到门槛，记录真实结果。
- [ ] Pages workflow 成功，公开 URL 匿名可访问，子路径刷新正常。
- [ ] 提交地址固定，README 提供启动/检查/发布方法，新增 docs/ACCEPTANCE.md 记录实际验收。
- [ ] 如开发中确实踩坑，仅把坑的现象、原因和避免方式写入根目录 HANDOFF.MD；不把一般进度写进去。

## 14. 官方依据

以下资料于 2026-11-17 核对。产品规则与性能门槛属于本项目决策，不是平台承诺。

- [GitHub Pages 的静态托管能力与站点地址](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [Vite 静态部署、base 配置与 GitHub Pages 流程](https://vite.dev/guide/static-deploy.html#github-pages)
- [GitHub Pages 自定义工作流、构建产物与部署权限](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
