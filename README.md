# 同路 · 毕业旅行

React + TypeScript strict + Vite 的纯静态应用。数据保存在当前浏览器，通过快照、邀请反馈或备份文件协作。

当前为 T01 基础工程；业务模块接入状态见 [T01 报告](docs/tasks/reports/T01.md)。

使用 Node 24.13.0，执行 `npm ci`、`npm run dev`。Windows PowerShell 若阻止 npm.ps1，使用 `npm.cmd`。npm 缓存位于被忽略的 .npm-cache。

检查：`npm run typecheck`、`npm run lint`、`npm run test:run`、`npm run build`、`npm run check:bundle-size`。全业务集成时另外执行 `npm run check:integration` 与浏览器回归。

默认 base 为 /gradtrip/。正式仓库名确定后使用 VITE_BASE_PATH（如 /repo/）构建，不能在迭代中随意更换正式地址。预览：`npm run preview`，打开 http://127.0.0.1:4173/gradtrip/ 。

当前未绑定远程仓库，未部署。配置发布流程与真实公开上线是不同状态。
