# 同路 · 毕业旅行

纯静态的毕业旅行工作台：小队、方案、日程、账本。数据属于当前浏览器，协作使用静态快照、邀请反馈或备份文件。

当前 T01 公共基础已实现；T02/T03/T04 最终模块尚未集成，不能视为完整 MVP。公共命令和页面契约见 [T01 报告](docs/tasks/reports/T01.md)，实际结果见 [验收记录](docs/ACCEPTANCE.md)。

## 本地开发

使用 Node 24.13.0（与 .nvmrc 和 CI 一致）及 npm。依赖已锁定，不使用运行时远程图库、字体或业务 API。

```powershell
npm.cmd ci
npm.cmd run dev
```

开发默认端口 5173。Windows PowerShell 若阻止 npm.ps1，使用 npm.cmd；其他终端可直接使用 npm。项目缓存 .npm-cache 已忽略，无须修改系统执行策略。

## 检查与生产预览

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test:run
npm.cmd run build
npm.cmd run check:bundle-size
npm.cmd run test:e2e
npm.cmd run preview
```

默认地址 http://127.0.0.1:4173/gradtrip/ 。E2E 使用已安装的 Chrome；新环境先运行 `npx playwright install --with-deps chrome`。检查覆盖 375/768/1440 px 和真正的构建子路径。

`npm run check:integration` 是完整产品发布门槛。它在缺少任何必需页面、领域处理器或完整示例时失败；当前未交付的模块使它按预期失败。普通 test:run 中专用的全模块验收用例会明确跳过，不计作通过。

`check:bundle-size` 同时计算外壳及各个功能页的静态依赖与首屏懒加载依赖，JS/CSS gzip 门槛为 200/40 KiB，所有图片单张不超过 150 KiB。它不能代替真实网络的 LCP/CLS 验收。

运行时依赖许可文本保存在 public/THIRD_PARTY_NOTICES.txt。依赖更新后运行 `node scripts/generate-notices.mjs`，并核对 docs/assets/SOURCES.md。

## 本地数据和恢复

- IndexedDB 数据库名采用固定应用 ID + 规范化 base；普通构建更新不换库。
- 写入在同一事务内校验命令 ID、当前 revision、业务结构和全部已接入的语义校验；事务完成后才显示已保存。
- 其他标签页更新时保留当前表单并阻止旧内容覆盖，重新载入是显式操作。
- 写入失败保留当前内存内容，支持重试同一命令或导出原始 JSON。原始 JSON 是故障恢复资料，与 T04 的标准备份协议分别标识。
- 覆盖导入与旧版恢复副本原子提交，每旅行最多 3 份；最多 10 个旅行，单旅行 900 KiB，总内容 20 MiB。
- IndexedDB 不可用时进入明确的临时模式；刷新后会丢失，必须及时导出。损坏记录保留原始字符串，禁止自动清空或用示例覆盖。
- 不要在仓库提交私人备份、真实成员资料或访问凭据。

## 模块接入

各功能只编辑自己归属的目录，导出约定的 index.ts。页面自动发现并按需加载，领域处理器与校验器在应用组合处注册。领域规则使用公共模型，页面只调用 execute，不直接写数据库。

T01 的 B0 固定提交为 266e2a3a671705fc42ecc38a7f565298f3a5078d。其他工作树应合并同一提交，保留共同祖先；兼容补充与最终接线见 T01 报告。

## 发布与回退

当前没有远程仓库、工作流运行记录或公开地址，未上线。最终由协调者统一将通过验收的 foundation 分支接收至 main，再绑定固定仓库并在 Settings → Pages 选择 GitHub Actions。

生产 base 使用 `VITE_BASE_PATH`，默认 /gradtrip/。例如实际仓库 /graduation/：

```powershell
$env:VITE_BASE_PATH = '/graduation/'
npm.cmd run build
npm.cmd run preview
```

Actions 按实际仓库名设置 base，根站点自动使用 /；可通过仓库变量 PAGES_BASE_PATH 显式指定固定路径。所有链接都保留 base 与 Hash 路由。工作流执行类型、lint、测试、集成门槛、构建、体积和三尺寸浏览器检查，全部通过后才部署。

发布前保留已知可用提交。若需回退，重新部署该提交并保留相同 URL；回退前检查数据 schema 和旧备份兼容，不能用清空用户数据解决问题。
