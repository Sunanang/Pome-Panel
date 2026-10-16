# 屏幕顶部任务通知 · 2026-10-16

final result: passed

## 参考与渲染证据

- 视觉准绳：`/Users/lando/Design/pome-notify-bubble-2026-10-16/notify-bubble-design/{overview,spec,motion}.png`，及同目录 14 张独立变体。设计令牌与通用图标直接取自旁边 `pome-notif-design/src-design/bubble.css` 和各变体 HTML。
- 实现截图：`/Users/lando/coding/Pome-Panel/dist.noindex/notification-design/`。`comparison-all.png` 为全部同状态并排对照，`comparison-1.png` 至 `comparison-4.png` 为可读的局部对照；每行左侧参考、右侧实现。已逐页打开检查。
- 原图为 1920×324，长标题 1920×360，Windows 1920×288，均为 2x。裁取通知原生窗口区域：Mac `(560,0)-(1360,184/220)`，Windows `(560,20)-(1360,212)`。实现分别为 800×184、800×220、800×192，均为 2x，对应 CSS/原生窗口 400×92、400×110、400×96；对照不拉伸、不将背景/菜单栏/注释区计为产品偏差。
- Codex、Claude、Cursor、失败、等待确认、长标题、标题回退、真实排队事件时间、悬停暂停、待办，均通过生产 main.js、真实 preload、临时用户目录和随机回环端口实际触发。历史 GPT/通用任务及 Windows 外观使用相同生产 HTML/CSS/JS/preload 的隔离 Electron 窗口，避免增加已移除的 hook endpoint。

## 五项视觉检查

1. 字体：使用设计的系统字体回退链，标题 13.5/18/600/-0.08，副标题 11/16/500，时间 11/500，数量 10/16/600。Mac 用系统 SF/PingFang，设计机用 Inter/Noto 的近似字体；属于预期平台差异。长标题实际两行并省略，窗口增加 18px，时间与首行对齐。
2. 布局：Mac 顶部 32px 全黑；384px 岛体位于 400px 窗口中，左右 8px 肩；内容内边距 10/16/14，图标 32、间距 12，底部圆角 18。Windows 无刘海区，384×64 浮动卡，内边距 12/16/16，距工作区顶部 10；窗口底部留阴影区。没有裁掉标题、时间、数量或关闭按钮。
3. 色彩：背景、发丝边框、文字、数量胶囊及进度条均使用 bubble.css 的中性令牌；只有 14px 状态角标用 #30D978 / #FF9352 / #FF5F57 / #438CFF，2px 同底色环。已去掉旧的彩色光晕、描边与来源标签底色。
4. 资产：按用户要求使用仓库原有 Codex/Claude/Cursor SVG 替换设计的占位品牌标，18px 单色 mask。其他、任务、待办、状态与关闭 glyph 直接复用提供的设计源，不用手绘占位重建。
5. 文案：任务具体摘要为标题，副标题只保留来源及项目；缺项目时无分隔点，缺摘要时为来源兜底。due 显示“将在 1 小时内截止”。待办右上角依用户的真实相对时间要求显示“刚刚/分钟”，与设计示例“18:30 截止”的差异为明确需求覆盖。倒计时截帧进度随真实剩余时长变化，并非固定成样图中的比例。

## 动效、交互与修复记录

- Mac 入场 300ms，内容延迟 110ms 淡入/下落/去模糊，角标延迟 200ms 弹出；退场内容 120ms、岛体延迟 40ms 回缩，最终透明，420ms 兜底。队列切换保持岛体展开，仅内容 120ms 淡出、180ms 淡入。Windows 使用 220ms 入场及 160ms 退场。
- 首轮发现 [P2]：Windows 的 is-visible transform 比 reduced-motion 选择器更具体，导致计算样式仍有 transform。修复 reduced-motion 选择器优先级并在媒体切换后实际读取 transform=none，复验通过。当前只保留 120ms 透明度渐变。
- 主进程在入场确认后开始 6000ms 计时，广播同一时钟给细进度条。悬停真实等待超过 6 秒仍不消失，进度值保持；离开后恢复并自动关闭；右上角时间换成 ×。× 关闭不启动来源软件，卡片主体保留能力开关控制的激活行为。
- awaiting 超过 6000ms 仍显示、无进度条，Escape 不会关闭；点击主体或 × 可关闭。排队后显示事件原始相对时间，+3 与悬停截图均已对照。
- IPC 验证发件窗口与 eventId，只接受当前通知两种合法高度；主面板伪造关闭/调整高度被拒绝。渲染控制台无错误。

## 截图索引

`codex-completed.png`、`claude-completed.png`、`cursor-completed.png`、`gpt-completed-no-project.png`、`task-completed.png`、`todo-due-soon.png`、`codex-failed.png`、`claude-awaiting-confirmation.png`、`claude-completed-long-title.png`、`codex-completed-fallback.png`、`codex-completed-queue.png`、`codex-completed-hover.png`、`windows-codex-completed.png`、`windows-codex-completed-hover.png`。

额外生命周期证据：`queued-event-relative-time.png`、`production-hover-paused.png`。

## 验证与范围

- `npm test`：643 项 Node 测试，642 通过、1 项既有跳过、0 失败；全部 Electron 集成、重启回归及 JS 语法检查通过。日志：`/tmp/pome-notification-full-tests.log`。
- 本机 `~/.codex/config.toml`、`~/.claude/settings.json`、`~/.cursor/hooks.json` 前后 SHA-256 一致，真实收件箱和账号未使用。测试启动应用/窗口的系统动作均替换为 fixture，未激活用户的工具窗口。
- Windows 外观和能力开关兼容性在 Mac 上验证；未声称完成 Windows 真机/DPI 验证。原生窗口阴影超出捕获边缘的部分不计作卡片内容差异。
- 无待修复 P0/P1/P2，无额外 P3 设计迭代项。所有源码修改仅在 dev；本次提交只含通知相关内容，工作区已有 Windows 安装器/日出日落修改保留，不打包、不推送、不合并 main。

---

# 先前设置页验收记录（保留）

# AI 完成来源 · 视觉与交互验收

final result: passed

本轮参考：用户提供的设置页与首页空状态 Google Drive PNG。原图已通过 Google Drive 插件读取，保存在 dist.noindex/ai-sources/design-settings.png、design-empty.png。界面捕获来自生产 Electron、真实 preload 和主进程，用临时 HOME，不用缺少原生桥接的浏览器替代。

## 同状态对比

两张原图首帧均裁取 (18,94)-(946,571)，归一到 1240×638；实际捕获 2480×1276（2x），归一后横向合成 comparison-settings.png 与 comparison-empty.png。对比前已查看原图和最终捕获。设计 PNG 是复合示例，不声称逐像素完全一致。

- 设置混合状态：Codex 已接入 / Claude 未接入 / Cursor 配置异常，与参考对应；按说明删除 GPT，N/4 变 N/3。新卡片位于 API 与额度之间，其它卡片不被压缩，左栏滚动保留。
- 使用原有字体、颜色、圆角与共享按钮；正式 Codex/Claude/Cursor 图标均为本地品牌资产。配置路径省略显示、title 保留全路径。
- 确认浮层使用顶层 dialog，右对齐点击位置并向上弹出，宽度/高度按视口限制；已确认、取消、路径变化与过期均由生产流程验证。真实运行时/备份路径更长，浮层比示例更高，文字可折行及内部滚动。
- 首页未接入、等待、失效（橙色光晕）、首次提示四种状态均有捕获。mini/small 已检查无卡片溢出。首页可修复失效直接打开备份确认；主操作复用共享胶囊按钮。
- 关闭时淡色添加占位保持原格子，重新开启不会修改其他卡片。小/中/大号 3/5/10 条按最新需求实现；空态全部已读隐藏，! 与 9+ 边界完全一致且不遮字。
- 损坏正文使用 text-2 与正式红色图标；文件名及完整路径悬停分离。保留期文案用 text-3/caption。

## 证据

settings-mixed-states.png、settings-all-connected.png、settings-confirm.png、settings-test-delivered.png；empty-none.png、empty-waiting.png、empty-source-error.png、first-detection.png、empty-mini.png、empty-small.png、home-repair-confirm.png、hidden-inbox-placeholder.png；comparison-settings.png、comparison-empty.png。均位于 dist.noindex/ai-sources/。既有四尺寸、空态/损坏及角标截图在 dist.noindex/inbox-bento/ 已重捕获。

生产 Electron 夹具 result.json 中 consoleErrors 为空。完整测试与性能结果见 docs/plans/2026-10-13-ai-source-hooks.md。

## 说明

设计中的 GPT 行/图标删除；测试不入历史；其它首页模块保持用户原布局，未照新示例重排。实际工具状态、数据、路径和窗口数量不固定成设计样例。Windows 真机与实体多屏/DPI 未验证；不把隔离配置测试描述为已接入真实用户工具。
