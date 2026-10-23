# Pome Panel

一个常驻 macOS 与 Windows 桌面的本地工作台。默认折叠成顶部居中的短胶囊，收起后可拖动并吸附到屏幕四边，点击从停靠位置展开。包含 **首页 / 待办 / 笔记 / 链接 / 录制 / 密钥 / 设置** 等页面；剪贴板默认关闭，可从菜单栏或「设置 → 显示功能」启用；还可接收 Codex / Claude Code / GPT 的本机完成事件，并按平台能力关联当前窗口。可选配对飞牛 NAS 伴侣，在多台设备之间同步工作区内容。

桌面端为单一 Electron 架构：折叠态、展开工作区、任务完成提醒与 Hover + Space 唤出都在 Electron 主进程和渲染层内实现，`npm start` 是唯一桌面运行路径。官网与飞牛 NAS 伴侣分别位于 `website/` 和 `fnos/`。

> **文档准绳**：产品行为以 [README.md](README.md) 为唯一事实来源。本文与 README 冲突时以 README 为准。

## 技术栈

- 桌面端：Electron 44 + 原生 HTML/CSS/JavaScript，无渲染层构建步骤
- 官网：React 19 + Vinext + 原生 CSS，位于 `website/`
- 本地数据：LocalStorage + 工作区根目录下的 `workspace.json`、`clipboard-images/` 与 `recordings/`；默认根目录为 `userData`，可在设置中更换数据文件夹
- 可选同步：飞牛 NAS 伴侣 + `packages/sync-protocol/` 共用协议；桌面同步存储使用 `node:sqlite`，`sync.db` 固定放在 `userData`，本机工作区仍是数据落点
- 包管理器：npm
- Node：桌面端使用 Node 18+；官网要求 Node 22.13.0+

## 命令

- 桌面开发：`npm install && npm start`
- 桌面检查：`npm test`（Node 单元测试、Electron 集成测试与 JavaScript 语法检查）
- 桌面打包：`npm run build`（只在用户明确确认后执行）
- Windows 打包：`npm run build:win`（只在用户明确确认后执行）
- 官网开发：`cd website && npm install && npm run dev`
- 官网检查：`cd website && npm test && npm run lint && npm run build`

## 改完必验收（代理硬约束，对齐 Codex）

功能、修复或行为改动完成后，按 Codex 闭环验收，不得只靠单测或「脚本 exit 0」收工：

1. 先跑相关单测 / 回归；
2. 拉起 Electron（相关 `*.electron.js` 或当前代码），逐个触发改动相关功能并截图；
3. **截图必须贴回对话**（用户能直接看到），说明每张图验了哪一步；证据不得只留在 `dist.noindex`；
4. 能装 MINI / 真机 / 用实账号则装、则用；做不到时单列未做项，禁止写成已全部验证；
5. 截图或行为不对 → 改代码 → 再跑同一路径，直到合格或写明阻塞。

## 目录结构

```text
.
├── main.js                 # Electron 主进程：窗口、定位、菜单栏、剪贴板、媒体与通知服务
├── main-services.js        # 可单测的纯领域服务（无 Electron 依赖）
├── platform.js             # 主进程与渲染层共享的平台能力、布局几何与便携路径规则
├── platform-adapters/      # macOS / Windows 系统能力实现
├── preload.js              # contextBridge 安全桥接
├── renderer/               # 桌面界面与交互（index.html / styles.css / app.js / workspace.js / notification.*）
├── sync-store.js           # 桌面 SQLite 同步存储与待发送队列
├── todos-sync.js           # 待办与分类双写、推送、拉取及 LocalStorage 投影
├── workspace-sync.js       # 笔记、链接、指令、剪贴板、录音、AI 配置与密钥同步
├── sync-migration.js       # 首次配对的数据迁移与备份恢复
├── sync-settings.js        # 同步地址与连接设置
├── sync-tls-trust.js        # 按主机和端口限定的 HTTPS 证书信任
├── packages/sync-protocol/ # 桌面端与 NAS 伴侣共用的同步协议
├── fnos/                   # 飞牛 NAS 伴侣：服务、网页、安装向导与 FPK 配置
├── build/                  # DMG 打包钩子、entitlements 与应用图标
├── scripts/                # Codex 与 Claude Code 的通知转发脚本
├── tests/                  # Node 单元测试与 Electron 集成测试
├── docs/                   # 设计说明、ADR 与验收图
├── website/                # 官网 React/Vinext 源码
└── package.json
```

## 当前产品约束

- 双平台：macOS 13+ arm64 与 Windows 10/11 x64 共用代码及版本。Windows 使用 `npm run build:win` 生成 NSIS EXE；发布必须两个平台检查通过后汇总至同一 Release。
- Windows：布局与 macOS 共用四边吸附规则，以工作区避开任务栏；汽水音乐组件永久隐藏（D4）。当前窗口、剪贴板自动粘贴与通知点击聚焦由 koffi 原生绑定实现（`platform-adapters/win32-user32.js`），受设置 `winNative` 控制，`WIN_NATIVE_DEFAULT = false`（D16 杀软关卡未过）：默认关闭时不加载 koffi（适配器在开关打开时才 `activateNative()`），当前窗口组件隐藏、剪贴板只复制、通知点击仅关闭，且不修改用户保存的显隐偏好；`POME_DISABLE_WIN_NATIVE=1` 强制不加载。Mac 包必须排除 `koffi` 与 `@koromix`。
- 便携媒体路径：LocalStorage / workspace.json 中新写入的录音与剪贴板图片使用 `/` 分隔的相对路径，系统加密密钥不保证跨电脑迁移。

- 折叠态：上下边为 `85 × 9` 逻辑像素胶囊，左右边为 `9 × 85`；仅收起时可拖动，松手按指针离四边的远近吸附，位置保存在本机设置。默认顶部居中：macOS 在菜单栏正下方，Windows 在工作区顶部。设置可「重置到顶部」
- 展开态：从停靠边展开，靠近边的两端约 120 逻辑像素时向对应角对齐，否则沿该边居中；各页内容区统一 `1240 × 540`，默认窗口总高为 `98 + 540 = 638`，切换页面不改窗口大小，窄屏与矮屏保留 24px 安全距。布局几何以 `platform.js` 为准
- 首页：Bento 组件支持显隐、大小与布局调整，至少保留一个当前平台可用的组件；隐藏后其余格子重新铺满。首页布局只保存在本机，不参与 NAS 同步
- 待办：默认 2 × 2 四列，可增删至 1–8 列（内部键 `P0`–`P7`，投影与同步始终带齐这 8 个键；可见顺序存 `notch-todo-category-order-v1`）。显示名默认可改（`notch-todo-category-names-v1`）；各列列表可滚动；截止时间默认当天 23:30，到期前一小时提醒
- 剪贴板：默认关闭（`DEFAULT_FEATURES.clip = false`），可从菜单栏或「设置 → 显示功能」启用。历史记录由主进程轮询采集，不占用任何全局快捷键（见 `clipboardServicePolicy`），跳过密码管理器标记为敏感的内容
- 链接：只允许公开 http/https；主进程抓取标题时必须阻止本机、内网与不安全重定向
- 录制：音频写入工作区根目录下的 `recordings/`，转写与元数据保存在 LocalStorage；可选百炼 Qwen3-ASR 实时转写，API Key 必须经 `safeStorage` 加密或环境变量读取
- 镜子：首页组件随 Bento 布局调整，支持自定义封面；只有主动点击才开启，离开首页或收起时立即释放摄像头 track
- 当前窗口：macOS 通过辅助功能枚举和聚焦，Windows 仅在原生能力启用且可用时提供；使用系统应用图标，同应用多窗口编号，隐藏项保存在 LocalStorage；聚焦 IPC 只接受最近扫描缓存中的窗口 ID
- 笔记：首页随笔记保存后进入独立笔记页，可搜索、重命名、编辑和删除
- 动效：窗口边界变更不使用系统动画；视觉动效由渲染层完成，并支持 `prefers-reduced-motion`
- 通知：独立 `400 × 96` 无焦点窗口；HTTP 只监听 `127.0.0.1:43821` 的 `/notify/<source>`，来源白名单以 `aiProviderCatalog` 的 HTTP notify 列表为准（含 `codex` / `claude` / `cursor` 等）；Codex / Claude / Cursor 完成分别由 `scripts/*-notify.js` 转发，子代理结束与云端会话不弹提醒。Cursor MCP 需要 OAuth 时，代理须先跑 `node scripts/cursor-mcp-auth-notify.js --service "<名>"`，用 `awaiting` + `authorization` 在顶部气泡提示用户回 Cursor 授权
- NAS 同步：在「设置 → NAS 同步」填写地址与一次性配对码，同步待办、笔记、链接、常用指令、剪贴板、录音（含音频）、AI 配置和密钥；首页布局不同步。设备令牌经 `safeStorage` 加密，不写入 LocalStorage；密钥与 AI Key 使用账号同步密钥的 AES-GCM 加密盒传输。明文 HTTP 默认关闭（回环地址除外），HTTPS 证书信任仅限用户确认的主机、端口和证书，不得全局关闭证书校验

## 代码规范

- 主进程文件 camelCase，常量大写下划线
- 渲染逻辑放在 `renderer/`，与主进程隔离
- IPC 必须通过 `preload.js` 的 contextBridge 暴露
- 平台能力与布局规则集中在 `platform.js`，系统操作放在 `platform-adapters/`；渲染层使用主进程下发的 `notchAPI.capabilities`
- 视觉取值集中在 CSS 自定义属性中

## GitHub 推送与发布联动

- `dev` 是长期开发分支。所有开发、修复、测试和版本准备都在 `dev` 完成；开始工作前先确认当前分支，不得直接在 `main` 开发或提交修改。
- `main` 是发布分支，只接收 `dev` 的合并。发版前在 `dev` 完成检查，再通过 `dev → main` 的 PR 合并；合并后 GitHub Actions 自动测试并构建 macOS DMG、Windows EXE、NAS FPK。不要从其它分支直接合入 `main`。
- 合并发布后切回 `dev`，将 `main` 的合并结果同步回 `dev` 再继续开发；保留长期 `dev` 分支。正式 GitHub Release 仍由 `main` 上与版本一致的 `v*.*.*` 标签触发。
- 本地分支保护：执行 `npm run setup:hooks`，将版本管理中的 `.githooks` 安装到此仓库 Git 公共目录的 `pome-hooks/`，并配置本地 `core.hooksPath`；切换到尚未包含这些文件的 `main` 后仍生效，新克隆也必须执行。`pre-commit` 拒绝在 `main` 提交，`pre-push` 拒绝任何目标为远程 `main` 的推送（含强推和删除）。不得用 `--no-verify` 或覆盖 hook 配置绕过保护；本地 hook 不替代 GitHub 远端分支保护。
- 任何产品更新推送到 GitHub 前，必须联动检查版本号、`CHANGELOG.md`、README 当前稳定版本与下载入口、GitHub Pages 下载按钮。
- 正式发布必须保证 `package.json` 与 `package-lock.json` 版本一致，推送匹配的 `v*.*.*` 标签，并在 GitHub Actions 完成后验证同一 Release 的 DMG、Windows EXE 及各自 SHA-256 资产与 Pages 实际下载指向。
- 官网下载按钮分别从 GitHub `releases/latest` 动态解析当前版本的 `arm64.dmg` 与 `windows-x64-setup.exe`，不得留下过期固定链接或跨平台误下载。验证两个安装包及各自 SHA-256。

## NEVER

- NEVER 在渲染进程直接 `require('electron')`
- NEVER 让面板脱离屏幕边缘停靠或在展开状态下自由拖动；显示与模式切换必须遵循已保存的停靠边、对齐和屏幕边界，默认位置为顶部居中
- NEVER 让摄像头常驻；离开首页或收起时立即释放 track
- NEVER 在用户未主动点击时启动麦克风；结束录音或退出应用时必须释放音频 track
- NEVER 把剪贴板图片 dataURL 存入 LocalStorage
- NEVER 提交 `node_modules` 或 `dist`
- NEVER 在没有用户确认时打包或发布桌面应用

## 压缩指令

执行 `/compact` 时必须保留：

- 当前窗口行为与样式细节
- 面板停靠边、对齐、展开收起与多屏定位规则
- LocalStorage 数据结构
- NAS 配对、同步存储、迁移状态与密钥边界
- 已知 macOS、多屏、菜单栏与摄像头适配问题
