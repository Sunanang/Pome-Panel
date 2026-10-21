# 额度残留修正与文案统一 · 2026-10-21

final result: passed

本节覆盖下方历史文案：百分比统一为「周 0%」「周 18%」「Other 0%」，额度 UI 的数值说明、摘要、来源与刷新提示不再使用「剩」或「已用完」；金额、积分保留真实单位。布局与此前 final 相同，small 有两行空间时同时显示瓶颈及恢复时间。

- 网络/通用失败与认证失效分开；卡片和 mini 摘要一致，前者提供实际重试动作，后者提供设置入口；认证失效摘要优先。
- 不足一小时的过期年龄显示「不足 1 小时」，未知年龄不编造，不改过期阈值。
- 清理已不生成的 q-summary、q-main-scope、q-horizontal、q-caption 样式；保留有效的明细、基础布局与动画。重连通过可控帧验证 0% 起点与 50% 终点，消除测试 rAF 竞态；原动画实现未重写。
- 38 项额度/动画单测通过；完整 `npm test`：853 pass / 0 fail / 1 platform skip，31 次 Electron、i18n 与语法检查通过。最终 quota-only 副本另验语言资源、领域/动画单测及布局/刷新 Electron，防止混入其他工作区修改。
- 目视与交互：四尺寸中英文矩阵、失败按钮/mini 摘要重试不跳设置、小号 3–4 家双行与 5–6 家单行、近期过期、0% 简写、金额单位、固定轨道及居中图标均通过。证据：`dist.noindex/quota-residual/`，合图 `residual-summary.png`；详见 [验收说明](docs/quota-final-acceptance.md)。

未做 Windows 真机、真实账号在线刷新。原有 UI 简化与 Cursor/NAS messageKey 等未提交改动独立保留。

---

# Final 额度卡片验收 · 2026-10-21

final result: passed

本节覆盖下方历史布局结论；产品行为以 README 为准。对照 [final 总览](https://drive.google.com/file/d/1Fo8qYllnPckfS0vYs5zpv9YRkvBrZnul/view) 与 [开发标注](https://drive.google.com/file/d/19PMfK9-qEOW3kr_VLunr26gRmTdwViMT/view)，逐项验收 mini/small/medium/large 的 3–6 家、正常/偏低/告急/用完/多家用完/全部用完/失效/过期。

## 对照方法与结论

- 同画面对照在 `dist.noindex/quota-final/comparisons/compare-{size}-{count}ai-{state}.png`，左为原设计卡片裁切，右为同密度、同状态实现；统一到原图 @2x 比较，没有拉伸局部部件。
- 标注外框 mini 189×126、small 189×264、medium 389×264、large 782×480；另拍实机 196×118、196×248、404×248、404×510。参考图本地副本在 `dist.noindex/quota-final/references/`，实现 64 张状态截图与 16 张英文实机图在 `after/`。
- 结构：名字/图标在上，角标居中且按行留位；同卡等格、等环径，未标角标行把空白分到环上下。small 两列；中/大号 3–4 家单排、5–6 家 3×2；空格保持空白。
- 视觉：字号/环径/间距按开发标注设 token，实机空间不足统一适配。金额与 100% 均位于内圈；用完只一条横线、灰环淡红轨。标题单行缩字或省略，窗口标题左对齐、数值等宽右对齐，短标题 Other/Week 不裁切，轨道在 0/8/100% 与动画中宽度不变。
- 状态：失效优先且叹号居中，非 mini 底部与同行说明对齐；mini 只留环下失效及一条可打开设置的摘要。过期为灰色时钟/真实年龄及 45% 透明度，保留原阈值和紧急优先级。瓶颈恢复时间来自窗口真实数据；缺失时不虚构。
- 素材与文案：复用现有品牌素材及液态玻璃背景；Grok Bot 使用现有头像，未复用源图旧 Grok 字形。时钟取 Lucide 官方素材。时间、家数、部分来源与设计示意不同，按测试夹具与真实接口元数据渲染；失效排序按本次用户文字要求。

## 发现与复验

P2：英文 Other/Week 列宽不足 → 按实际字体测量标题并适配窄大卡数值列；mini 失效脚注重复 → 修正局部选择器；mini 紧急摘要被灰色覆盖 → 补充等级色；+N 垂直偏移 → 与品牌环顶部对齐；large 说明向右及英文长日期折行裁切 → 居中成组，窄实机用真实星期时间并移除重复窗口名。逐条复拍及几何/完整行高断言通过。

另修复来源全部断开后的 ResizeObserver 空态保护，旧节点不再读取空环几何。现有动画模块未重写；布局适配复用同一 value store，尺寸/来源顺序变更时取消位置补间，避免缩放期间环飞出卡片；同布局角标变化继续平滑移动。

## 测试与动态验收

- 35 项额度领域与既有动画单测通过；完整工作区 `npm test`：850 pass / 0 fail / 1 platform skip，31 次 Electron 检查和 i18n/语法检查通过。
- 最终矩阵检查角标间距、等环等格、失效无占位百分比、同行底部对齐、mini 设置入口及图标中心、英文完整说明和固定轨道；既有额度与刷新 Electron 通过。
- 改前 `before/panel-refresh.webm` 与改后 `animation-after/panel-refresh.webm` 均保留；录屏解码并查看抽帧，验证展开先缓存、后台结果后环/数字/条同步过渡，中途刷新续接、用完样式延后切换。帧时间采样中位数约 16.7ms；该指标只代表本机隔离场景。
- 待提交文件在 `/private/tmp/pome-final-commit-check` 独立副本再次完整运行 `npm test`：847 pass / 0 fail / 1 platform skip，31 次 Electron、i18n 与语法检查通过；排除了对工作区其它未提交设置/NAS/全局报错修改的依赖。最终结果见 [本轮验收说明](docs/quota-final-acceptance.md)。

实机四尺寸合图：`dist.noindex/quota-final/four-sizes-real.png`。超过 6 家沿用中/大号内滚动；实机窄 large 的字与列适配、small 短格压缩留白属于记录过的空间适配。无未解决的 P0/P1/P2。未做 Windows 真机、真实账号在线刷新或 MINI 安装；未打包、发布或改动 main。

---

# 最新补充验收 · 2026-10-21 · 长周期瓶颈与刷新动画

当前规则更新为：最短窗口决定环长与大数字；所有窗口的最小剩余决定颜色、紧急排序和过期判断。旧的“主窗口同时决定颜色”说明属于历史。small 用两行说明，medium/large 显示窗口条；medium 超过 6 家时内部滚动。用完状态灰环、淡红轨与划线延后至过渡结束。唤出先用缓存并后台刷新，30 秒防抖，手动刷新即时；720ms ease-out，条目错开 60ms，中途从当前帧继续，减少动态效果时直接应用。

本轮设计链接、回归与图像记录见 [额度瓶颈与刷新动画验收](docs/quota-bottleneck-acceptance.md)。以下记录保留为历史验收证据。

---

## UI 简化全套 · 2026-10-20

final result: passed

源图：`dist.noindex/ui-simplify/references/`（设置 v2，其余 v1），尺寸在 `image-manifest.json`；实现为 macOS 实际 Electron 的 `settings/`、`flows/`、`quota/` 截图。主窗口 1240×638 CSS、2480×1276 像素（2x），额度额外按现有四档组件及设计尺寸捕获；整页独立滚动拼接，不拉长生产窗口。

对照输入：`comparisons/` 同时展示源图与实现，涵盖整页 A、Token E、欢迎 D、确认 H、额度 I。原图是含标注与样本状态的复合画布，未强行拉伸匹配；当前保留八家来源，不使用四家样例或占位地址代替真实能力。用户硬约束覆盖图中蓝色主按钮、三列网格和旧标题：实现磨砂白/深字主按钮、两列网格及新命名。

迭代记录：

1. [P2，已修复] 紧凑速记新增入口挤压预览/编辑：工具栏允许换行，增加实际按钮几何回归。证据 `flows/home-dual-entry.png`。
2. [P2，已修复] 小号双来源纵排：按 I 改双列，保留三家折叠、币值和积分单位。证据 `quota/small-2ai.png` 与完整明细截图。
3. [P2，已修复] Windows 入口开放会改变旧布局：区分可添加能力与主动选择，保留原隐式隐藏和保存偏好；Windows/Mac 默认与用户布局回归通过。
4. 采集纠正：等待展开/切页动效结束，强制刷新帧；滚动采用 instant，避免残影和重复拼接；详情截图不再重复切回首页而关闭浮层。这些未改生产导航与窗口几何。

字体、间距、颜色、按钮与开关沿用系统字体和当前 liquid-glass 样式。多窗口额度明细使用浮层，保持窄卡可读且不撑开其他格；源图格内条的查看行为由此实现。全浮层在 `*-details-full.png`，不以裁切组件图假装完整明细。

最终封板：828 项 Node 检查中 827 通过、1 项平台专属跳过，29 次 Electron 场景/重启及语法/语言资源检查通过。导航 DOM、54 元素标准计算样式和几何相同，像素差异为空。真实工具配置前后哈希一致。无待修 P0/P1/P2。窄卡来源名采用既有省略行为，完整名称保留在 title/aria；不为匹配复合样图改动首页格子几何。未做真实 Windows/DPI、多屏、实账号和实体 NAS；Windows 图为明确标注的能力分支模拟。

---

以下是此前任务验收历史。

# 首页 AI 剩余额度 · B 仪表盘 · 2026-10-20

final result: passed

2026-10-20 审查修复：紧凑排序恢复为 critical → warn → error → ok（最低剩余优先）→ stale → 未检测到。mini 四来源完整展示，五来源起为三环 +N；small 最多三来源；large 仅五来源放第六格摘要，六来源恢复 2×3。Grok/Manus 零余额或积分耗尽以红色虚线环、告急图标和红色金额展示，双语提示明确耗尽，不伪造百分比；五来源摘要的需处理数量也包含耗尽来源。

macOS Electron 专项已覆盖以上边界、恢复正余额、双语和四尺寸无溢出。新截图位于 `dist.noindex/review-fixes/quota/`，包括 `mini-4ai.png`、`mini-5ai.png`、`large-6ai.png`、`depleted-{mini,small,medium,large}.png` 和 `depleted-large-5ai.png`。本轮仍使用隔离数据，不把样本截图当作真实账号联网或 Windows 真机验收。

修复后的完整 `npm test` 通过：824 项 Node 测试中 823 通过、1 项平台专属跳过；27 次 Electron 场景/重启运行及全部语法、语言资源检查通过。日志 `dist.noindex/review-fixes/npm-test.log`。

## 视觉准绳与证据

- 定稿：[Drive 文件夹](https://drive.google.com/drive/folders/1tjUIGrq6q2FyRJ0fSDCSej36KLXE46lv)。只实现 B 仪表盘，未使用 A 列表方向。源码与品牌 SVG 取自用户指定的 ai-quota-final-src.zip。
- 原图：`dist.noindex/ai-quota-dashboard/original/`，包含用户指定的十张独立尺寸/来源截图。源文件保存在 `/private/tmp/pome-ai-quota-reference/`，不作为产品运行依赖。
- 实现：生产 `renderer/index.html`、CSS、JS 在 macOS Electron 中运行；使用隔离 userData 和明确的额度样本，无真实账号凭据。`tests/ai-usage.electron.js` 触发刷新、切尺寸、异常、设置跳转和语言切换。
- 截图：`dist.noindex/ai-quota-dashboard/`。`acceptance-overview.png` 展示四尺寸 × 2/3 来源和 large × 5；`comparisons/` 为十组左参考/右实现的逐张对照。每组比较过完整卡片及圆环/图标/细条/文字的局部区域。
- 像素和密度：原图为 520×436（mini）、520×712（small）、874×712（medium）、874×1264（large）；按源 HTML 的 24px 留白裁切。对应卡片 378×252、378×528、778×528、778×1080，均为 2x，CSS 尺寸分别为 189×126、189×264、389×264、389×540；实现以同尺寸同密度采集，不拉伸。额外验证现有首页 196×118、196×248、404×248、404×510，保留现有首页格子和窗口布局。
- 采集最终从完整页面裁切，避免隐藏窗口局部 capturePage 的绘制残影；`*-full.png` 与同名 JSON 留存完整页面/裁切坐标。普通外观与定稿对照；玻璃外观另存 `medium-3ai-glass.png`，保留用户原有外观选项。

## 逐张检查

| 尺寸 | 已检查实现与对照图 | 结果 |
| --- | --- | --- |
| mini | mini-2ai.png、mini-3ai.png；另验 mini-4ai / mini-5ai | 32px 环、中心品牌图标、最低剩余；5 家为 3 环 +2 |
| small | small-2ai.png、small-3ai.png；另验 small-5ai | 46/36px 环；3 家折叠窗口细节；超过 3 家为 +N 个来源 |
| medium | medium-2ai.png、medium-3ai.png、medium-5ai.png | 64/52/40px 环，2/3 列，五家折行且在现有首页尺寸也同屏可见 |
| large | large-2ai.png、large-3ai.png、large-5ai.png | 84/66/50px 环；五家 2×3，第六格最低剩余摘要 |

大尺寸按设置中的 catalog 顺序，所以五来源样本中 Claude Code 在 Grok Bot 前；来源名保留现有 catalog 的 Claude Code / GitHub Copilot，不为匹配静态样图缩写。额度、来源标签、账期及重置时间使用实际样本；不会把样图中的固定时间当成真实数据。mini/small 按产品明确的紧急度顺序排序，底部写“按紧急度排序”。

## 五项视觉检查与迭代

1. 字体：与面板共用系统字体栈（不再单独挂载 Inter VF，约 875KB）；中文沿用系统回退。标题 11/500，来源 11.5–12.5/620，百分比 650/等宽数字，窗口文字 9.5–10.5；百分号为 0.62em。
2. 间距：格间 8px，格圆角 12px；保持原模块 18px 外壳、ECG 背景和尺寸。中号五来源减少格内间距，保证现有较矮首页也完整展示；超过六家时中号采用更紧凑的横向格，大号三列，不使用 Tab。
3. 色彩：轨道、格底、渐变均按定稿；≤20% 偏低、≤10% 告急，按原始未取整值判断。过期环/细条半透明并直接标“数据过期”；Token 错误红色虚线，网络错误不会要求替换有效凭据。零剩余不画圆头小点。
4. 图标：Cursor/Codex/Claude 复用仓库 SVG；Grok/Grok Bot 使用源包真标，Grok Bot 增强方底并按要求写注释；Manus 使用源包官方白色字形。图标为本地静态资源，无运行时请求。
5. 文案：标题固定 AI 剩余额度；源标签、更新时间、账期/重置时间、Credits/套餐仍可查。余额、积分、无限额度不换算百分比。长文单行截断，可通过整格/窗口 tooltip 和 aria-description 查看完整信息。中英文即时切换，包括来源数量单复数。

首轮 P2：五来源中号过密、长归属标签挤压来源名、过期状态只变淡而缺少可见提示；分别压紧格内间距、使用短来源标签并限制 chip、增加可见过期说明，复拍通过。第二轮恢复启动凭据流程依赖的更新时间，并修复没有本机用量样本时错误声称“已改用本机”的标签。设置跳转后的截图显式切回首页，避免将设置页当成组件截图。最终十组对照无待修 P0/P1/P2。

## 交互与验证

- 自动覆盖无 Tab、来源同屏、4/5/8 来源边界、+N、状态排序和新阈值、多窗口最低值、未知值、单 Cursor/单 Codex、空态、Token 设置入口、网络回退与失效清理、真实更新时间、无限/金额/积分、超多窗口格内滚动、HTML 转义、语言切换、手动刷新。
- 本轮 Node 相关测试：39 项通过。额度专项 Electron 与启动凭据专项通过，渲染控制台无错误。
- 完整 npm test：823 项 Node 测试中 822 通过、1 项平台专属跳过、0 失败；26 次 Electron 场景/重启运行及全部 JS 语法、本地化检查通过。日志 `/private/tmp/pome-quota-full.log`；额度专项日志 `/private/tmp/pome-quota-ui.log`。
- 未做：真实 AI 账号联网验收、Windows 真机/DPI；本轮为 macOS 实际 Electron + 隔离 API 样本，不将样本当成真实接入凭据或 Windows 实机证据。没有运行打包、发布或 main 合并。

## 本轮文件范围

- 界面与规则：renderer/ai-usage.js、renderer/ai-usage-domain.js、renderer/styles.css、renderer/index.html。
- 资产：renderer/assets/inbox/{grok,grokbot,manus}.svg、图标 README。
- 回归：tests/ai-usage.test.js、tests/ai-usage.electron.js、tests/provider-credentials.electron.js、tests/startup.electron.js。
- 说明与中英文：README、CHANGELOG、localization/locales、桌面/NAS 自动生成资源、本报告。

---

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
