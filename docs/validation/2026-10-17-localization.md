# 中英双语实施与验证记录

日期：2026-10-17。开发分支：`dev`。代码与安装验证阶段未提交、推送、合并或发布；随后用户另行授权提交、推送至 dev。初次代码验证未打包；随后按用户授权打包并安装 Mac / NAS，见[实机安装记录](2026-10-17-localization-installation.md)。当前版本保持 0.11.0，本轮写入「未发布」。

## 实现

| 范围 | 实现方式 |
| --- | --- |
| 资源 | `localization/locales/zh-CN.json` / `en-US.json` 共 1247 个对齐的语义键，覆盖普通文案、完整错误、安全确认、复数与原生说明。`catalog.json` 是文案审校清单，保留初次提取位置；后续代码行号可能移动。 |
| 生成与校验 | `scripts/localization-resources.js` 拒绝重复 JSON 键、缺键、空文案、占位符不一致及 HTML；生成浏览器脚本、NAS INI、NSIS、macOS 权限资源与官网子集。`npm test` 首先 `--check`，官网测试另校验字典来源。 |
| 语言选择 | 桌面 `app-settings` 保存 System / 简体中文 / English，首次读系统，未支持语言回退英文。语言不进 NAS 同步；preload 下发小快照，主进程统一广播菜单、主窗口及通知。订阅有版本号，拒绝过时响应。 |
| 界面更新 | 静态 data-i18n + 明确的动态字段绑定，按语言切换更新；WeakMap/WeakRef 不保留已移除节点。不扫描或翻译用户 DOM 文本，不增加 MutationObserver 或定时全页翻译。 |
| 识别和命名 | ASR 单独保存 zh/en；开始时冻结、重连沿用，不受界面切换影响。笔记、录音、链接智能命名按内容语言，历史标题和用户正文不改。没有添加未经官方证实的 auto 参数。 |
| 兼容 | 中文同步类型键与时间保持，旧系统结果在展示边界翻译；通知仅对明确的生成回退标题加标记，事件去重身份保持；冲突后缀凭明确元数据展示翻译，底层标题、内容与哈希不变。 |
| NAS 页面 | 使用随包官方 SDK 0.5.0，声明 micro_app=true；仅 getPlatformConfig / 支持环境的 os/language，1.5 秒超时回退浏览器，手动偏好优先。无服务器全局 locale，无凭据 API 调用；保留独立网页与旧宿主回退。SDK 源 README、版本、分发文件 SHA-256 一并保留。 |
| 安装与卸载 | NAS extensionless INI 的 `${section.key}` 覆盖安装、配置、升级、卸载，字段值及保留/删除默认不变。Windows 仅 en_US/zh_CN，无语言选择弹窗，安装与卸载初始化按当前 Windows UI 语言。安装目录/快捷方式行为保留。Mac 在 codesign 前写 en/zh-Hans InfoPlist.strings，无新卸载向导。 |
| 官网与帮助 | `/` 中文、`/en/` 英文；英文使用隔离 Electron 实际截图。元信息、下载状态、分享图、语言链接均随页面语言，修复 Pages 子路径重复前缀与静态导出尾斜杠问题。用户指南、历史 CHANGELOG 和实际 Release notes 提供英文；内部研发文档保留。 |

## 验证

- `npm test`：通过（682 项 Node：681 通过、0 失败、1 项 Windows 专属跳过）。包含生成检查、Node 单元测试、17 个 Electron 集成夹具及 2 次真实 Electron 进程重启、JavaScript 语法检查。Windows 专属原生枚举测试在 Mac 跳过。
- `npm test --prefix website`：22 项通过。
- `npm run lint --prefix website`：通过。
- `NEXT_PUBLIC_BASE_PATH=/Pome-Panel npm run build:pages --prefix website`：通过，输出根中文与 `/en/` 英文静态页面。
- 检查导出英文 HTML 的 lang、canonical、hreflang、实际下载按钮及资源路径；除「简体中文」语言自称外无中文产品文案。分享图使用对应语言的实际 Home 截图，避开旧图内的中文与旧品牌文字。
- `plutil -lint`：中英 InfoPlist.strings 均通过。`git diff --check` 通过。

最终日志保存在 `dist.noindex/localization/`：`desktop-tests.log`、`website-tests.log`、`website-lint.log`、`website-build.log`。末次英文审校将认证“失效”表述为 invalid（涵盖过期与吊销），同步保留 NAS 包描述/更新说明的端口、路径和版本细节；资源检查及末次相关单元测试 33 项通过（`copy-review.log`）。

提交推送前整合远程 dev 的 `edfcee5` 悬停倒计时修复，并补齐其英文指南/更新日志。重新运行完整 `npm test`（682 项 Node、17 个 Electron 夹具、2 次真实重启及语法检查）、官网 22 项测试与 lint，均通过；对应日志为 `pre-push-desktop-tests.log`、`pre-push-website-tests.log`、`pre-push-website-lint.log`。版本与 NAS manifest 一致性检查通过；仓库当前没有正式 Release，下载按钮仍按平台从 `releases/latest` 解析，不为本次 dev 推送创建 Release。

## Mac 上实际运行过的验证（隔离资料，不连接真实 NAS）

- 生产 main/preload/renderer 英文首次启动，切中文、英文，保存其他设置后语言仍在；非法语言值被拒绝。
- 切换保留未保存的 Token 草稿，用户中文笔记、实际 AI 摘要保持原文；扫描英文各页可见标签。
- 独立英文识别设置在切换后保留；模拟 WebSocket 验证英文 session.update 与断线重连语言一致、非法 auto 不发请求。
- 旧中文同步结果仍为 9 行，各自原时间不变，无时间显示 —；暂停 recovery 与令牌丢失提示可见。
- awaiting 通知切换语言后事件 ID、实际标题、可见状态不变，不重开倒计时。
- NAS 真实 HTML/JS 在隔离本机 HTTP 夹具中运行：当前用户语言、手动覆盖、已登录状态、端口警告、CSRF 过期错误热切换、中文用户笔记原文。
- 完整既有测试继续覆盖 HTTP/证书确认、schema/迁移、暂停覆盖预览/校验/回退、分页、媒体权限释放、通知队列与悬停、收件箱损坏/重建等路径。

## 实机边界与后续验收

初次代码验证没有构建安装包或发布官网。后续已按用户授权构建并安装新 DMG / FPK，Mac 与 NAS 的启动和语言切换结果见[实机安装记录](2026-10-17-localization-installation.md)。Windows 安装/卸载语言、国际 NAS 英文原生向导，以及 Mac 摄像头/麦克风等完整原生授权弹窗仍未实机验收。

发版前需要在 Windows 中文/英文/不支持语言系统验证 setup 与 uninstall（包括安装后换系统语言），在国际 NAS 验证官方 SDK 初始化及中英向导、卸载保留/删除默认；在已打包 Mac 继续验收完整原生权限弹窗（签名和系统本地化资源解析已通过）。还需用用户自己的已配置账号自愿验证英文转写效果；本轮没有发送真实音频、调用在线翻译或改 API 区域/Key。

真实 Codex/Cursor/Claude 配置不作为演示目标，测试接入仅使用临时 HOME。未读取、写入或输出真实 NAS 密码/token。

## 如何查看

在 dev 开发版打开「设置 → 语言」切换；录音识别在「API 配置」单独选择。官网开发访问 `/` 或 `/en/`；静态站需保留 `/Pome-Panel` 基路径。

截图位于 `dist.noindex/localization/`：

- `english-home.png`、`english-todo.png`、`english-notes.png`、`english-links.png`、`english-recordings.png`、`english-credentials.png`、`english-settings.png`
- `english-nas-paused.png`、`english-nas-lost-token.png`、`english-awaiting.png`
- `english-nas-web.png`、`chinese-nas-web.png`

官网随源码保存的英文截图：`website/public/product-captures/en/`。常规测试不改官网素材，只有显式 `POME_CAPTURE_ENGLISH_ASSETS=1` 的隔离夹具生成。

## 改动文件清单

以下列出本轮工作区文件；包含新增资源与测试，不含被忽略的测试产物、node_modules 或安装包。

- `.github/workflows/pages.yml`
- `CHANGELOG.en.md`
- `CHANGELOG.md`
- `README.en.md`
- `README.md`
- `aiSourceHooks.js`
- `build/afterPack.js`
- `build/i18n/en.lproj/InfoPlist.strings`
- `build/i18n/messages.nsh`
- `build/i18n/zh-Hans.lproj/InfoPlist.strings`
- `build/installer.nsh`
- `codex-usage-remote.js`
- `docs/plans/2026-10-17-english-localization-technical-review.md`
- `docs/plans/2026-10-17-english-localization.md`
- `docs/release-notes.md`
- `docs/validation/2026-10-17-localization.md`
- `fnos/app/ui/i18n/browser.js`
- `fnos/app/ui/i18n/host.js`
- `fnos/app/ui/i18n/resources.js`
- `fnos/app/ui/i18n/runtime.js`
- `fnos/app/ui/index.html`
- `fnos/app/ui/pair.js`
- `fnos/app/ui/panel.js`
- `fnos/app/ui/styles.css`
- `fnos/app/ui/vendor/trimjs/README.md`
- `fnos/app/ui/vendor/trimjs/UPSTREAM-README.md`
- `fnos/app/ui/vendor/trimjs/web-app-0.5.0.js`
- `fnos/cmd/save-device-port.sh`
- `fnos/i18n/en-US`
- `fnos/i18n/zh-CN`
- `fnos/manifest`
- `fnos/wizard/config`
- `fnos/wizard/index.html`
- `fnos/wizard/install`
- `fnos/wizard/uninstall`
- `fnos/wizard/upgrade`
- `localization/catalog.json`
- `localization/compatibility-exceptions.json`
- `localization/locales/en-US.json`
- `localization/locales/zh-CN.json`
- `localization/resources.js`
- `localization/runtime.js`
- `main-services.js`
- `main.js`
- `package.json`
- `platform-adapters/darwin.js`
- `platform-adapters/task-apps.js`
- `platform.js`
- `preload.js`
- `renderer/ai-sources.js`
- `renderer/ai-usage-domain.js`
- `renderer/ai-usage.js`
- `renderer/app.js`
- `renderer/domain.js`
- `renderer/index.html`
- `renderer/localization.js`
- `renderer/nas-sync-migration.js`
- `renderer/nas-sync-pair.js`
- `renderer/nas-sync-settings.js`
- `renderer/notification-domain.js`
- `renderer/notification.html`
- `renderer/notification.js`
- `renderer/styles.css`
- `renderer/sun-widget.js`
- `renderer/sun.js`
- `renderer/task-inbox-domain.js`
- `renderer/task-inbox.js`
- `renderer/workspace.js`
- `scripts/localization-resources.js`
- `scripts/test-desktop.js`
- `taskInbox.js`
- `tests/ai-sources.electron.js`
- `tests/audit-fixes.test.js`
- `tests/fnos-device-port.test.js`
- `tests/helpers/localized-copy.cjs`
- `tests/localization.electron.js`
- `tests/localization.test.js`
- `tests/renderer-structure.test.js`
- `tests/sun.test.js`
- `tests/transcription.test.js`
- `tests/tray-menu.test.js`
- `tests/ui-migration.test.js`
- `tests/ui-nas-sync-backup.test.js`
- `tests/ui-nas-sync-http-toggle.test.js`
- `tests/ui-nas-sync-settings.test.js`
- `website/README.md`
- `website/app/(chinese)/layout.tsx`
- `website/app/(chinese)/page.tsx`
- `website/app/(english)/en/page.tsx`
- `website/app/(english)/layout.tsx`
- `website/app/CapabilitiesSection.tsx`
- `website/app/EndingSection.tsx`
- `website/app/HeroSection.tsx`
- `website/app/LandingPage.tsx`
- `website/app/OperationMarquee.tsx`
- `website/app/ProductStory.tsx`
- `website/app/RealProductMedia.tsx`
- `website/app/SiteLayout.tsx`
- `website/app/SiteLocale.tsx`
- `website/app/TabStack.tsx`
- `website/app/globals.css`
- `website/app/landingContent.ts`
- `website/app/layout.tsx`
- `website/app/page.tsx`
- `website/app/siteI18n.ts`
- `website/app/translations.json`
- `website/next.config.ts`
- `website/public/product-captures/en/clipboard.jpg`
- `website/public/product-captures/en/credentials.jpg`
- `website/public/product-captures/en/home.jpg`
- `website/public/product-captures/en/links.jpg`
- `website/public/product-captures/en/notes.jpg`
- `website/public/product-captures/en/recordings.jpg`
- `website/public/product-captures/en/settings.jpg`
- `website/public/product-captures/en/todo.jpg`
- `website/scripts/prepare-pages-output.mjs`
- `website/tests/localization.test.tsx`
- `workspaceBackup.js`
