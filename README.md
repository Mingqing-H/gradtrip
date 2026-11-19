# 同路 · 毕业旅行

帮助毕业旅行小队完成：成员意向收集 → 方案共识 → 日程安排 → 费用分摊与结算。

**公开地址：[同路 · 毕业旅行](https://mingqing-h.github.io/gradtrip/)** · [源码](https://github.com/Mingqing-H/gradtrip) · [最终版本 final-20261119](https://github.com/Mingqing-H/gradtrip/tree/final-20261119)

四个工作区“小队、方案、日程、账本”，包含可操作示例、三维卡通头像、英文衬线标题和浅色毕业合照背景。纯静态运行，数据保存在当前浏览器；协作通过快照、邀请反馈与备份文件完成。无登录、实时同步、预订、支付或在线模型接口。

## 本地运行

Node24.13.0（与.nvmrc和CI一致），使用npm及已提交的锁文件：

```powershell
npm.cmd ci
npm.cmd run dev
```

开发地址 http://127.0.0.1:5173/gradtrip/ 。生产预览：

```powershell
npm.cmd run build
npm.cmd run preview
```

默认生产预览地址 http://127.0.0.1:4173/gradtrip/ 。Windows使用npm.cmd可避免执行策略阻止npm.ps1；其他系统可直接使用npm。

## 项目目录

| 目录 | 内容 |
| --- | --- |
| src/app、src/infrastructure | 应用编排、本地存储、恢复与版本冲突处理 |
| src/domain | 与DOM及存储解耦的业务规则 |
| src/features | 四个工作区及分享反馈界面 |
| src/components、src/styles | 共用控件与视觉令牌 |
| src/assets、src/data | 发布用图片、模板与静态数据 |
| tests、scripts | 回归、性能检查与可复现的素材压缩 |
| docs | [产品范围](docs/PRD.md)、[业务规则](docs/BUSINESS_RULES.md)、[设计规范](docs/design.md)、[验收记录](docs/ACCEPTANCE.md) |
| docs/assets、docs/design-references | [素材来源](docs/assets/SOURCES.md)、原始生成素材与提示词、[四张已选设计稿](docs/design-references/README.md) |
| docs/validation | 历史实测与最终本地验收数据 |

node_modules是本地依赖，dist是最新构建，均不提交；.cache、.npm-cache和test-results等临时目录已忽略，可重新生成。旧设计备选、完整图库和历史文件可从Git历史找回。

## 验证

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test:run
npm.cmd run check:integration
npm.cmd run build
npm.cmd run check:bundle-size
npm.cmd run test:e2e
```

E2E使用已安装的Chrome，覆盖375/768/1440px与实际/gradtrip/子路径；新环境可运行`npx playwright install --with-deps chrome`。专用集成用例在普通test:run中明确跳过，由check:integration独立执行。

体积门槛为首屏JS/CSS gzip 200/40KiB、单图150KiB。性能脚本为benchmark:browser与benchmark:domain；浏览器测量默认访问生产preview，PERFORMANCE_URL可指定公开地址。原始输出在.cache，实际环境、结果与未达标项见[验收记录](docs/ACCEPTANCE.md)。

## 数据与素材

IndexedDB使用固定应用ID和base作为数据库名称，普通更新不换库。写入在事务内校验命令ID、revision与业务不变量，事务完成后才显示已保存；旧标签页冲突、配额失败和损坏数据均提供明确恢复入口。备份覆盖保留恢复副本，快照只读，邀请反馈先预览后应用。详见[架构](docs/architecture.md)与[交接注意事项](HANDOFF.MD)。

图片随站发布，无远程图库或字体请求。可复现的压缩脚本为optimize-images.mjs、optimize-avatars.mjs和optimize-backgrounds.mjs，原图与准确提示词保存在docs/assets。生成景观明确标识示意图，毕业合照只作虚构主题装饰。

运行时开源许可见public/THIRD_PARTY_NOTICES.txt。依赖更新后可运行`node scripts/generate-notices.mjs`重新生成。仓库不保存私人备份、真实成员资料或凭据。

## 发布与回退

固定仓库为Mingqing-H/gradtrip，推送main后由[GitHub Actions](https://github.com/Mingqing-H/gradtrip/actions/workflows/deploy.yml)验证并部署GitHub Pages，地址不变。工作流固定Ubuntu24.04、Node24.13.0，按仓库名设置VITE_BASE_PATH；默认base为/gradtrip/，全部路由使用HashRouter。

最终交付标签为final-20261119；本次更新前版本保留为pre-final-20261119，早期基线为v0.1.0。回退应还原相应版本并通过同一工作流发布，先核对数据与备份兼容，不能清空用户数据。历史并行开发任务和报告保存在docs/tasks，不作为当前完成状态的依据。
