# UI 简化全套 · 验收记录

分支：dev。未修改或合并 main，未打包、发布或推送。实现遵守当前 liquid-glass 和顶部导航结构；主按钮磨砂白、深色字，显示卡两节均为两列。

## 设计依据

- 设置 v2：[定稿文件夹](https://drive.google.com/drive/folders/1jrQolCy1YyzdtIRZkgeYRhlZAt7-pyvu)，A / B / C / E / H。
- 非设置 v1：[定稿文件夹](https://drive.google.com/drive/folders/1BUJEkt7No3c_mw6mpCsasOCJuy6G_55l)，D / F / G / I / J / K / L。
- 本地原图：`dist.noindex/ui-simplify/references/`；总览 `reference-sheet.jpg`。原图的旧标题和蓝色主按钮由用户明确的命名、材质约束覆盖。实际来源保留全部八家，未缩减成图中的四家，也未引入占位地址。

## 逐项实现

| 项目 | 行为与验证 |
| --- | --- |
| A 命名 | 录音转写与命名、AI、AI 额度、AI 完成提醒；中英文同步，内部数据键保留。 |
| B NAS | 默认状态、一句说明和主按钮；配对、端点、HTTP、迁移、回退、备份原控件收进故障处理，全部原处理器保留。 |
| C 连接 | 区分网络失败和需要处理；主按钮重试或展开排查。省略协议补 HTTPS；HTTPS 指向纯 HTTP 时仅修正草稿，再次提交仍必须确认明文，不自动发凭据或绕过证书信任。 |
| D 欢迎 | 扩展原 first-run 判断，仅全新安装有三步欢迎。默认四个首页组件；选择、跳过、可选 NAS/AI、保存及进程重启验证。旧资料且无首次标记也不会重置布局。 |
| E Token | Cursor/Codex 主动点击后读取并加密保存，输入框不短暂暴露凭据；六家手填控件折叠，Grok 团队 ID、Manus 开关/连接保留。按实际额度响应显示生效来源，失败不声称已生效或仍在获取。 |
| F 报错 | 通用报错条给原因、修复入口、复制脱敏诊断；技术信息在详情。诊断剥离 Bearer、密码、Key、Token 和 URL 身份/查询信息。布局错误保留具体原因。 |
| G 资料库入口 | 随笔记保留预览、编辑和保存，通过顶栏「笔记」进入资料库；快录保留录音资料库入口。对应工作区关闭时，顶栏 tab 和快录入口一起隐藏，开关仍走现有 IPC。2026-10-22 移除首页「在笔记中打开」按钮。 |
| H 确认 | 来源接入和 NAS 确认默认短摘要，原文件/钩子/备份/证书信息可展开。NAS 覆盖主摘要含增改删数量；取消不执行，后端 preview 身份、校验和备份保护不变。 |
| I 额度 | 默认每家一个剩余值；点击、悬停展开原额度窗口条，Esc/离开/切页/收起关闭。保留排序、折叠、阈值、错误、本机回退、刷新和币值/积分单位。 |
| J 预设 | 设置与首页编辑入口提供精简/均衡/全部。按可用来源过滤，容量不足先缩小，布局由原验证器验证；录音期间拒绝换预设。 |
| K 胶囊 | 前三次唤出显示提示，可关闭；收起或离开首页立即关闭，计数保留。提示放在现有展开窗口内，不改变胶囊和停靠几何。 |
| L Windows | 当前窗口可主动添加，并在原生能力关闭时内联开启；成功重新读取窗口，失败显示可修复错误。旧用户不会因入口开放突然多出组件，也不改写原显隐偏好。强制关闭仍有效。 |

Grok Bot 说明按代码核对：`grokbot-usage.js` 调用 `api2.cursor.sh` 的 `GetSandUsageStatus`，读取本机 Cursor 凭据或已保存的 Cursor Token；这不是 xAI Grok 独立账户余额。文案说明当前实现的数据来源，没有声称已核实真实账户订阅归属。

## 测试与证据

后续交互回归修复：Esc 暂时关闭欢迎向导，重新展开回到原步骤；仅跳过/完成才保存完成状态。保存返回失败或 IPC 异常均在向导内显示重试、详情和复制诊断，不在遮罩背后报错。Cursor/Codex Token、NAS 配对与来源接入失败使用单一报错入口；未关闭的报错在收起后保留，同类操作成功或用户关闭后清除，其他来源成功不会误清。首页预设选中态随实际布局变动更新；Token 来源缓存只接收六家 Token 来源字段。设置顶栏回归仅比较固定结构，工作区 tab 显隐另外等待并检查，避免把异步徽章当作结构变更。语言绑定机制保持不变。

新增回归截图：`dist.noindex/ui-simplify/flows/welcome-save-failed.png`。

本轮完整 `npm test` 通过：827 项 Node 测试通过、1 项平台专属跳过，29 次 Electron 场景/重启及语法、语言资源检查通过。最后补强 NAS 报错关闭行为后，欢迎完整流程与重启、NAS 卡、设置页连续两次回归均通过。日志：`dist.noindex/ui-simplify/bugfix-npm-test.log`、`bugfix-regression.log`。真实 Codex/Claude/Cursor 配置在测试前后哈希一致。

本轮修改文件：`renderer/ui-simplify.js`、`renderer/workspace.js`、`renderer/ai-sources.js`、`renderer/app.js`、`renderer/styles.css`；`localization/locales/{zh-CN,en-US}.json` 及生成资源 `localization/resources.js`、`fnos/app/ui/i18n/resources.js`；`tests/{ui-simplify,settings-slim,startup,ai-sources,nas-settings-card}.electron.js`；本验收记录。后端、IPC 和顶部导航结构没有改动。

- 完整 `npm test`：828 项 Node 检查中 827 通过、1 项平台专属跳过；29 次 Electron 场景/重启及 JavaScript、语言资源检查通过。日志：`dist.noindex/ui-simplify/npm-test.log`。
- 专项：`unit.log`、`hooks.log`、`startup.log`、`nas.log`、`quota.log`、`flows.log`、`sun.log`。
- 隔离临时 HOME/userData 和模拟远端响应；真实 Codex/Claude/Cursor 配置前后 SHA-256 一致（`real-config-before.json` / `real-config-after.json`），不连接真实 NAS。
- 新增 Electron 流程涵盖欢迎、升级重启、一步保存与失败保留、诊断复制、双入口、关 tab、确认取消、三种预设、前三次提示和 Windows 分支模拟。
- 修复测试自身的一个竞态：Codex 转发夹具先原子写入结果，避免父进程读到刚创建的半截 JSON；实际钩子转发实现未改变。

## 截图路径

根目录 `dist.noindex/ui-simplify/`：

- `settings/settings-viewport.png`、`settings/settings-full.png`：实际固定窗口、完整正文滚动拼接。
- `flows/token-default.png`、`flows/token-manual.png`：默认与手动 Token。
- `flows/welcome-{1,2,3}.png`、`flows/home-simple.png`：欢迎和四模块首页。
- `flows/error-bar.png`、`flows/confirmation.png`、`flows/confirmation-details.png`：诊断与确认。
- `flows/home-dual-entry.png`、`flows/presets.png`、`flows/capsule-hint.png`。
- `flows/windows-inline-{off,on}.png`：macOS 上运行 Windows 能力分支的独立 Electron 渲染器，不是真实 Windows 截图。
- `quota/{small,medium,large}-2ai-details.png`：点击明细；同目录各尺寸默认、错误、余额与空态。
- `comparisons/`：设计与实现同屏对照；设计中的示例来源数、状态和现有八来源不同，不声称整张复合原图逐像素一致。
- `header-before-after.png`、`header-comparison.json`：原有与当前导航的 54 个元素、几何和像素对照；导航 DOM 及标准计算样式保持。
- NAS 专项位于 `dist.noindex/nas-settings-card/`：unpaired、paired、paused、overwrite-summary、details、migration-failed 等。

## 平台边界

已在 macOS 运行生产主进程、preload 和真实 Electron 界面。Windows 能力分支与布局有模拟回归；未执行 Windows 实机/DPI、真实 AI 账号联网或真实 NAS 安装验证，不把夹具数据描述为真实账户与硬件验收。

## 文件清单

- `CHANGELOG.en.md`
- `CHANGELOG.md`
- `README.en.md`
- `README.md`
- `design-qa.md`
- `docs/design/ui-simplification/acceptance.md`
- `fnos/app/ui/i18n/resources.js`
- `localization/locales/en-US.json`
- `localization/locales/zh-CN.json`
- `localization/resources.js`
- `main.js`
- `platform.js`
- `preload.js`
- `renderer/ai-sources.js`
- `renderer/ai-usage-domain.js`
- `renderer/ai-usage.js`
- `renderer/app.js`
- `renderer/index.html`
- `renderer/nas-sync-pair.js`
- `renderer/styles.css`
- `renderer/ui-simplify-domain.js`
- `renderer/ui-simplify.js`
- `renderer/workspace.js`
- `scripts/test-desktop.js`
- `tests/ai-source-hooks.test.js`
- `tests/ai-usage.electron.js`
- `tests/ai-usage.test.js`
- `tests/home-layout-swap.electron.js`
- `tests/nas-settings-card.electron.js`
- `tests/platform.test.js`
- `tests/provider-usage-fixtures.cjs`
- `tests/settings-slim.electron.js`
- `tests/startup.electron.js`
- `tests/ui-simplify.electron.js`
- `tests/ui-simplify.test.js`

## 2026-10-22 首页笔记按钮调整

移除「在笔记中打开」按钮及其功能显隐逻辑、中英文专用文案，保留预览、编辑和保存。保存后仍停留首页，从顶栏「笔记」可以读取刚保存的内容。修改涉及 `renderer/ui-simplify.js`、两份语言字典及生成的桌面/NAS资源、README 中英文说明和 `tests/ui-simplify.electron.js`。

相关领域单测 6 项、语言资源生成/检查、JavaScript 语法检查、Electron UI 流程回归通过；本次未重跑整套 `npm test`。截图为 `dist.noindex/ui-simplify/flows/home-note-without-open-crop.png`，验证只保留模式切换和保存按钮。使用隔离 userData，未改用户真实笔记数据。
