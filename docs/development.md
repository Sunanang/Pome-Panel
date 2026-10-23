# 开发与验证

[返回首页](../README.md) · [使用指南](user-guide.md)

## 从源码运行

桌面端要求 Node.js 18 及以上：

```bash
git clone https://github.com/Sunanang/Pome-Panel.git
cd Pome-Panel
git switch dev
npm install
npm run setup:hooks
npm test
npm start
```

没有渲染层构建步骤。`npm start` 就是完整的桌面运行路径。

`dev` 是长期开发分支，开发、修复、测试和版本准备都在此完成。`main` 只用于发布，禁止直接开发或提交修改，只接收 `dev → main` 的 PR 合并。合并后 GitHub Actions 自动测试并构建 Mac、Windows 和 NAS 安装包；正式 Release 继续通过 `main` 上与版本一致的 `v*.*.*` 标签发布。合并后将 `main` 同步回 `dev`，后续继续在 `dev` 开发。

每次新克隆后执行 `npm run setup:hooks` 启用本地保护：拒绝在 `main` 提交，拒绝直接推送、强推或删除远程 `main`（包括 `dev:main`）。安装脚本将 hook 存放在 Git 公共目录中，因此切换分支后保护仍生效。`dev` 推送和版本标签不受此保护限制。本地 hook 不替代 GitHub 远端分支保护。

| 命令 | 用途 |
| --- | --- |
| `npm test` | 语言资源检查、单元测试、Electron 集成测试与 JavaScript 语法检查 |
| `npm run i18n:generate` / `npm run i18n:check` | 生成 / 校验桌面、NAS、安装器与官网语言资源 |
| `npm start` | 启动 Electron 开发版 |
| `npm run pack` | 生成本地未打包目录 |
| `npm run build` | 在 macOS 上构建 Apple Silicon 产物 |
| `npm run build:win` | 在 Windows 上构建 x64 产物 |
| `npm run build:zip` | 构建 ZIP 产物 |
| `node scripts/build-fpk.js` | 使用已安装的官方 fnpack，在临时目录构建 NAS 通用 FPK 与 SHA-256，输出到 `dist.noindex/` |

GitHub Actions 的「Release macOS, Windows and NAS」会在推送 `main` / `feat/**`、提交 PR 或手动运行时测试并构建 DMG、Windows EXE 和 NAS FPK，产物可从该次运行的 Artifacts 下载。只有推送与桌面端及两份 NAS manifest 版本一致的 `v*.*.*` 标签，且三个构建任务都成功，才会把三种安装包及校验文件发布到同一个 Release。NAS 使用固定版本、校验 SHA-256 的[官方 fnpack](https://developer.fnnas.com/docs/cli/fnpack/)，无需连接 NAS 或提供设备凭据；真实 NAS 安装验证仍需另做。`scripts/pack-fpk.sh` 保持仅刷新协议副本和图标，不生成安装包。

官网在 `website/`，要求 Node.js 22.13.0 及以上，技术栈是 React 19 与 Vinext：

```bash
cd website
npm install
npm run dev
```

检查官网时使用 `npm run lint` 与 `npm run build`。

## 项目结构

```text
.
├── main.js                  # Electron 主进程：窗口、定位、菜单栏、剪贴板、媒体与通知
├── main-services.js         # 可单测的纯领域服务
├── preload.js               # contextBridge 安全桥
├── renderer/                # 桌面界面与交互
├── packages/sync-protocol/  # 桌面端与飞牛伴侣共用的同步协议
├── fnos/                    # 飞牛 NAS 伴侣 Pome Panel
├── scripts/                 # Codex / Claude Code 通知转发
├── tests/                   # Node 单元测试
├── build/                   # 图标与打包资源
├── docs/                    # 设计说明与 ADR
└── website/                 # React 19 + Vinext 官网
```

工作中枢回归可运行 `npm run check:work-hub`：隔离夹具固定为 250 条笔记、200 条待办、100 个链接、20 条录音及 50 条完成记录，测量普通唤出与隔离 NAS 同步负载各 20 次。环境、原始耗时、P95、几何与同步结果留在 `dist.noindex/iteration-validation/<run-id>/`，不提交生成文件；Windows 真机和实体显示器/DPI 检查需要单独执行。
