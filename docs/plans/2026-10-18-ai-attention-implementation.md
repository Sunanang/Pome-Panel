# AI 待操作提醒实施与验收

日期：2026-10-18；基线 dev / aa44fef / 0.11.0。只在 dev 实施，本次不推送、不打包、不发布。技术输入为同目录的 ai-notification-events 方案；视觉以 [B 蓝色定稿](../design/ai-attention-reminders/final/README.md) 和本次用户指令为准，替代方案中的 R1/R2、176px 与 6 秒设计：采用 macOS 400×146、Windows 384×114、等待时隙 8 秒。

## 已实现

- `aiEventPolicy.js`：v2 envelope 校验，分离会话/回合/请求身份；输入、选择、授权映射独立于来源。未知 kind/action/reason 拒收；子代理、云端和非终态不进入完成链。旧 Codex 空 suggestions/exclude 的完整对象窄规则过滤，不能用未经验证的 final:true 绕过。
- `aiAttentionStore.js`：本机 userData/ai-attention.json 原子持久化；pending/resolved/cancelled/unverified，hidden/viewed 独立；请求键含 source/surface/sessionId/turnId/requestId。重复请求不重弹，精确解决，有序回合收敛，24 小时 tombstone 防止迟到 required 复活；重启/明确断开来源后降为待确认，不以超时宣布完成。
- `aiNotificationScheduler.js` 与 main 通知生命周期：等待集合与完成 FIFO 仲裁；新等待优先但悬停/键盘访问不被打断，完成保留实际剩余倒计时。单等待常驻，竞争时公平轮换；新增等待不连续重复当前条目、不饿死完成。待处理入口可选择立即显示指定请求。每次展示生成独立 ID，旧 hover/dismiss/resize 不影响新项。
- notification 界面：三行 B 蓝色布局、统一白色 SVG 来源图标、单行问题、蓝色返回按钮、相对时间与额外待处理数量，悬停显示暂停标记与 ×。等待无倒计时；× 只隐藏，来源聚焦成功也不判为解决；失败保留并可重试。Windows 原生能力关闭时灰色手动返回按钮，只隐藏不聚焦。减少动态效果时关闭呼吸/涟漪并淡入淡出。
- 敏感摘要在落盘前隐藏；不会保留原始 command、answers、Token、环境变量等额外载荷。授权涉及敏感参数时仅允许固定安全命令名 npm install 配合 ••••，其他机密内容用通用提醒。界面不执行载荷命令、URL 或授权决定。
- 首页紧凑待处理入口和设置列表：隐藏首页组件后仍可从设置查看、返回来源、恢复隐藏提醒。待处理不增加完成历史或未读。损坏/外部修改拒收并提供确认、备份、重建路径。
- `taskInbox.js`：旧噪声记录统一可见性投影，分页、总数、未读、最新条目一致，保留磁盘原文与去重身份；旧 awaiting 历史仍可读。
- Claude 专用观察脚本和主进程适配器：AskUserQuestion 精确 tool-use 身份、PostToolUse/Failure 精确解决，Notification 的 permission_prompt/elicitation_dialog，以及 UserPromptSubmit/Stop/SessionEnd 边界。观察脚本 stdout 为空、失败静默，不输出权限决定或答案；idle_prompt 忽略。来源预览、备份、修复、断开覆盖所有新 Pome hook，保留其他 hook、matcher、顺序、超时；重复接入不会改写配置。
- 来源设置逐项显示完成、输入、选择、授权、自动撤销能力及客户端范围，全部保守标为 partial/unsupported；未把 fixture 结果升级为真实客户端 verified。
- 中英字典、生成资源、README/CHANGELOG 和打包白名单均已更新；未执行任何打包命令。

## 来源支持边界

| 来源 / surface | 现场证据 | 本次交付状态 |
| --- | --- | --- |
| Pome macOS 消费端 | macOS 27.0.1 arm64，隔离 Electron，通过真实 HTTP/IPC/持久化流程触发三状态 | 消费端、窗口、调度与撤销已验证；来源发送为 fixture，聚焦动作有隔离替身 |
| Claude Code CLI | 本机未安装 Claude Code；原生 schema 对照官方文档，hook 命令在隔离 HOME 中执行与重放 | 观察接入实现，partial；尚未完成真实 Claude 提问/授权/回答/取消验收 |
| Codex desktop / app-server | 检测到 ChatGPT 宿主 26.1013.40934 (20770)、codex-cli 0.163.0-alpha.10.2；文档提供 app-server 请求与解决事件 | notify 完成过滤已实现；没有合法接入现有会话传输，等待 watcher/bridge 未启用，unsupported |
| Cursor IDE | 已安装 3.25.6；未取得现有 IDE 的真实提问开始/解决事件样本 | 保留 stop/afterAgentResponse 完成通道；没有把工具 hook 的存在当作内置提问 UI 可达的证明，等待监听未启用，unsupported |
| Windows x64 | 在 Mac 上使用实际 HTML/preload 渲染 Windows capability fixture，检查卡片、按钮和回退路径 | 消费端回退已验证；Windows 实机、多屏/DPI、原生聚焦与安装未验证 |

官方依据：[Claude Hooks](https://code.claude.com/docs/en/hooks) 支持观察 hook，但 permission_prompt 可延迟约 6 秒，通知无稳定请求 ID；[Codex App Server](https://learn.chatgpt.com/docs/app-server) 的请求和 serverRequest/resolved 属于宿主传输，不能通过另起 app-server 旁听现有桌面会话；[Cursor Hooks](https://cursor.com/docs/hooks) 不能单凭通用工具 hook 的存在证明所有提问 UI 已接通。Notification 无请求 ID 时只在明确的继续/结束边界收敛，不用无关工具返回猜测已解决。

明确缺口：用户要求的「在实际来源工具中把每种状态真实触发一遍」尚未完成；本次截图不能作为三家工具端到端已接通的证明。未读取登录凭据、修改真实来源配置，或安装新的全局 CLI 来绕过该边界。

## 验证结果

- 完整 `npm test`：692 项 Node 测试，691 通过、1 项 Windows 专属跳过、0 失败；18 个 Electron 场景和 2 次实际进程重启检查通过，随后全部语法检查通过。
- 最终增量专项：`tests/ai-attention.electron.js` 覆盖三状态、来源与状态交叉组合、脱敏、自动撤销、× 保留请求、重投不重弹、恢复与指定请求、+N、真实 8 秒轮换、悬停/返回后暂停、旧 hover token、完成抢占与恢复、聚焦失败重试、Windows 手动返回、减少动态效果、语言切换、待处理入口、损坏文件取消与确认备份重建。
- 最终相关 Node 专项：33 项通过；`i18n:generate` / `i18n:check`、`git diff --check` 通过。
- 真实 ~/.codex/config.toml、~/.claude/settings.json、~/.cursor/hooks.json 在验证前后哈希一致；测试只写隔离 profile/HOME。NAS 数据、设备配对、端口、服务器身份与加密配置未做真实安装修改。
- 首轮全量遇到一项 NAS 启动探针超时，单独重跑与后续完整测试均通过；未修改 NAS 产品实现来规避测试。旧损坏收件箱 fixture 补上真实完成正文，使其测试持久化失败，而非被新的空消息过滤提前忽略。

## 截图与视觉核验

最终截图在 [docs/acceptance/ai-attention-reminders/](../acceptance/ai-attention-reminders/)，均为本机隔离 Electron 实际绘制（Retina PNG 为逻辑像素的 2 倍）。参考图在 [final/](../design/ai-attention-reminders/final/)。逐张核对了 32px 黑顶帽、114px 内容、12/16/14 内边距、20px 状态行、15/21 问题行、28px 按钮、颜色、截断、Claude 白色图标、× 和队列状态。

| 截图 | 对照与结果 |
| --- | --- |
| input-codex.png | 等待输入；与 final/input-codex.png 和 spec.png 核对尺寸、行距、颜色、图标与按钮 |
| select-cursor.png | 等待选择；与 final/choice-cursor.png 核对同一 B 结构 |
| approve-claude.png | 等待授权；与 final/auth-claude.png 核对，按钮按本次用户要求为「返回 Claude 查看授权」 |
| input-claude.png、approve-cursor.png | 证明状态未和来源写死绑定；所有来源使用 inbox SVG |
| authorization-masked.png | 对照 final/auth-masked-claude.png；只保留安全命令名及遮蔽占位，原敏感参数未落盘；返回按钮和提示沿用本次用户文字要求 |
| queue-hover.png | 对照 final/hover.png；相对时间、暂停符号、+N 和悬停 ×，悬停不轮换 |
| windows.png、windows-native-off.png | 对照 final/windows.png、windows-fallback.png；384×114、无 Mac 顶帽、蓝顶线与灰色回退按钮 |
| windows-reduced-motion.png、windows-native-off-reduced-motion.png | 呼吸/涟漪关闭，来源图标与内容完整，回退不改变权限开关 |
| input-english.png | 系统标签和按钮为英文，问题原文与请求 ID 不变 |
| completion-*.png | Mac/Windows 既有完成通知、+N 和悬停状态对照保留 |

与原画面截图不同的背景来自透明原生窗口，未重建壁纸/菜单栏；相对时间沿用现有「分钟前」格式。参考稿较短的授权按钮和提示以用户最新明确文案为准，不视为偏差。没有请求/答案代填界面或自动授权行为。
