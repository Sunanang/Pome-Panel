# AI 完成来源接入与收件箱修复交付

2026-10-13，在 Mac mini `/Users/lando/coding/Pome-Panel` 的 main 原地修改。未提交、未推送、未打包。真实 Codex、Claude Code、Cursor 配置修改前后哈希一致；所有安装、断开、修复测试仅在临时 HOME 中执行。

## 完成内容

- 本机来源白名单 codex / claude / cursor；不接入 Grok Bot，不接受新 GPT 事件。旧 GPT 记录保留，界面显示“其他”，不触发格式损坏。
- 主进程 aiSourceHooks 管理四类状态：未检测到、未接入、已接入、配置异常。根据工具本机配置目录检测，校验 Pome 项、当前脚本位置与 Electron Node 运行时；搬动应用后通过确认修复。
- 每次修改先预览文件、新增/移除内容、同目录备份位置。确认令牌五分钟过期，外部修改也使预览失效。先原子保存并校验原始备份，再原子写配置；损坏配置或无法运行时拒绝安装。
- TOML 用兼容 Node 18 的 toml-eslint-parser 语法树定位 notify，保留其它文本和注释。JSON 用 jsonc-parser 节点编辑，保持缩进及紧凑格式。精确识别 Pome 标记；修复保留原 matcher，断开不误删相似前缀的用户钩子。
- Codex 将原 notify 编码保留在 Pome 命令参数内，真实完成继续转发原 argv 和原 JSON；转发不泄漏 Pome 的 ELECTRON_RUN_AS_NODE 模式。断开还原原 notify，原来没有则删除 Pome notify。提示重启 Codex 生效。
- Claude Code 仅追加 hooks.Stop；Cursor 使用 hooks.json v1 的 hooks.stop。测试走相同脚本和接收器，用主进程短期令牌识别，送达后显示“测试通知已送达”；不产生历史、未读或真实完成提醒。
- 首页提供未接入、等待第一条、接入失效三种空状态，迷你/小号精简。首次检测在空态或已有历史时都提供接入/以后再说；偏好仅本机保留。可修复错误直接打开确认预览，损坏配置引导设置查看原因。
- 设置分区位于 API 配置与 AI 剩余额度之间，显示本机 N/3。左栏保持独立滚动，确认在顶层 dialog 中向上定位，边界限制在视口内。

## Bug A / B / C 与 UI

- A：旧事件缺少身份仍接收；补充完成/接收时间与 payload 内容摘要进入身份。明确 ID 或回合的去重规则保持稳定。无原始身份的旧事件无法跨时间精确区分重投与真实新完成。无效 JSON、非法对象、超限请求在控制台及界面显示错误，保留已有记录。
- B：Claude 读取本轮最新主线助手消息，即使只有 tool_use 也采用当前 UUID；不回退上一轮的文本 UUID。显式 Stop/回合 ID 优先。
- C：迁移延迟媒体推送使用迁移已确认的 serverRev；expired 后实际拉取全量快照并重新定基，仅重试一次。测试包含真实 NAS 持久化检查点截断和原远端笔记保持不变。
- N1：关闭收件箱在原空位显示淡色“添加模块”，不扩大或改写其它模块；重新开启还原原布局。
- N2：最近列表与全部分页按尺寸一致：mini 1（最近仍为计数/来源）、small 3、medium 5、large 10；大号摘要保留。
- N3：空态隐藏全部已读。N4：! 与 9+ 同一宽度、位置，避免遮字；首页选中隐藏，关闭模块显示小点。
- 保留规则使用 text-3/caption；损坏正文使用 text-2 加红色正式图标，只展示文件名，title 悬停完整路径。

## 改动文件（39 个）

- **主进程与存储**：`aiSourceHooks.js`、`main.js`、`main-services.js`、`taskInbox.js`、`preload.js`、`workspace-sync.js`、`package.json`、`package-lock.json`。
- **转发与验证脚本**：`scripts/codex-notify.js`、`scripts/claude-notify.js`、`scripts/cursor-notify.js`、`scripts/pome-hook-runtime.ps1`、`scripts/test-desktop.js`、`scripts/check-work-hub-baseline.js`、`scripts/smoke-app.js`。
- **渲染层**：`renderer/index.html`、`renderer/styles.css`、`renderer/app.js`、`renderer/task-inbox.js`、`renderer/ai-sources.js`、`renderer/notification.js`、`renderer/notification.css`。
- **图标与许可**：`renderer/assets/inbox/cursor.svg`、`renderer/assets/inbox/circle-alert.svg`、`renderer/assets/inbox/LICENSE-alert`、`renderer/assets/inbox/README.md`。
- **测试**：`tests/ai-source-hooks.test.js`、`tests/ai-sources.electron.js`、`tests/capacity-and-inbox.test.js`、`tests/task-inbox.test.js`、`tests/main-services.test.js`、`tests/work-hub.electron.js`、`tests/work-hub-restart.electron.js`、`tests/inbox-bento.electron.js`、`tests/work-hub-baseline.electron.js`。
- **文档**：`README.md`、`CHANGELOG.md`、`design-qa.md`、`docs/plans/2026-10-13-ai-source-hooks.md`。

保留仓库此前的其它未提交修改。新增的主要实现为 aiSourceHooks.js、renderer/ai-sources.js、Cursor 转发和 Windows 参数桥接；打包清单已包含，未实际打包。

## 新增测试与结果

新增 23 个单元用例及一个生产 Electron 夹具，覆盖三来源接入/断开/重复/路径修复、格式损坏、外部修改/过期预览、精确标记、原钩子保留、原 notify 转发及还原、真实安装命令的空格/引号路径、发送测试、历史 GPT、A/B/C。Windows 仅验证配置结构与还原。

Electron 补齐三个空态、首次检测取消后实际重载不重复、确认前不写与取消、首页直接修复、设置滚动及确认边界、测试不入历史、N1–N4、旧 GPT 显示。另模拟延迟的原生切页 IPC，验证输入在主进程确认前已可点击。

- **npm test**：580 个单元测试，**579 通过、1 跳过、0 失败**；**12 个 Electron 夹具、2 次进程重启、全部语法检查通过**。
- **npm run check:work-hub**：普通 20 次 P95 **188.33ms**；后台同步 20 次 P95 **209.21ms**。45 次展开收起（含预热）几何全部稳定，没有失败样本或诊断。
- **git diff --check** 通过。真实工具配置哈希未变，证明见 dist.noindex/ai-sources/validation/real-config-check.txt。
- 完整日志、截图与 UI result.json：dist.noindex/ai-sources/。Node 传输拒绝、无效 JSON 与损坏文件警告是有意注入的失败场景，不代表测试失败。

## 性能排查与原始留档

内容进入前固定等待由 70ms 减为 20ms，保留防闪烁的安全帧及岛体形变；唤出过程不重复检查来源。首轮因此正常组降至 188ms，但发现后台同步两次 input not hittable：切页在等待原生 IPC 时旧页仍截获点击。各页面同一画布，现在立即更新页面，再等待主进程确认。新增延迟 IPC 回归，最终所有样本有效。

**没有修改 scripts/work-hub-statistics.js 的阈值**（既有脚本为 300ms）；本次同时核对用户提出的 250ms 目标，后台 P95 留出 **40.79ms** 余量。上一轮为 249.57ms。

最终原始目录：`dist.noindex/iteration-validation/2026-10-13T11-12-13-705Z/`，含机器型号/系统/应用和 Electron 版本、数据量、源码哈希、逐次样本、几何与日志。应用版本元数据修正为 package.json 的 0.11.0。
首轮未通过记录保留：dist.noindex/iteration-validation/2026-10-13T10-55-30-049Z/；修复后的中间通过记录：2026-10-13T11-04-49-882Z/。

## 设计与限制

参考：[设置页](https://drive.google.com/file/d/1qicm30SgHjSWF73toUmF1zTenMfddDQB/view)、[首页空状态](https://drive.google.com/file/d/1FGx1VLTl8IrqsknNnxxI123wA1nM5-Ge/view)。设计中的 GPT 行/图标按用户说明移除，计数改为 N/3。使用正式本地品牌图标；路径、状态、标题与窗口内容为实际/测试数据。

按说明选择测试不入历史，设计稿中的“收到 1 条测试记录”不复刻。首页其它模块沿用原布局与用户尺寸，未按空状态设计稿重新排列音乐、番茄钟、指令；AI 完成仍默认右上。确认显示真实完整路径，因此源码/临时 HOME 环境比设计示意更高，可内部滚动且不出视口。

[Cursor 官方 hooks 文档](https://cursor.com/docs/hooks)核对了用户 hooks.json、stop、conversation_id/generation_id；[Claude 官方文档](https://code.claude.com/docs/en/hooks)核对了 Stop 与现有钩子保留。没有 Windows 真机、实体屏幕/DPI 或三种真实 AI 工具的现场完成录屏；本轮在 Mac 对配置与实际转发脚本做了端到端隔离验证，不修改真实配置。
