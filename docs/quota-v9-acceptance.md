# AI 额度 v9 验收 · 2026-10-22

## 范围与设计

只修改首页额度模块，不改顶部导航。mini 保留样式和既有简写（此前用户要求额度文案去掉「剩」/「已用完」）。最终参考顺序为 v9 → v8，基础颜色与间距来自 v5。

- [v9 总览](https://drive.google.com/file/d/1kJxwgT9A6uK3RsFMT2M5xnY8PzjKMDGt/view)、[v9 标注](https://drive.google.com/file/d/1vhxP-XUYllUEmLviT9TrHea2HHLZj7qU/view)
- [v8 总览](https://drive.google.com/file/d/1sgrbeZtXL1U0eEckYWTbwba37QL2n8fz/view)、[v8 标注](https://drive.google.com/file/d/1-WJTrtglJaJDme2ASOpx3Hps27Z6NWCC/view)
- [v5 标注](https://drive.google.com/file/d/1Gtv9uLwRiVNuKpygEEmj93SJ9sLss9aS/view)
- 29 张原图与 Drive 文件 ID 清单：`dist.noindex/quota-v9/references/sources.json`。

## 实现

- 最短窗口继续决定环长与主数字；跨所有窗口的最小额度决定等级、紧急排序和重置过期；未改旧过期阈值。
- small 上限 4 家，优先紧急来源；隐藏家数显示在刷新按钮左侧。medium/large 保持设置顺序。
- 非 mini 去掉气泡和预留行。small/medium 的条不重复主窗口；Grok Bot 单窗口无条，环独立居中；large 保留真实周条，与相邻多窗口首条对齐。
- 按设计指定环径，实机空间不足时统一缩小，不改变组件外框。设计尺寸为 small 189×264、medium 389×264、large 782×480；现有实机对应 196×248、404×248、404×510。
- 每家独立测量标题列，数值列按 100% 固定；标题/条/数值间距 3/4px。同格所有条等宽，动画中不随数字变化。
- 底部只显示接口提供的真实时间，缺失则空白；日期字段不补造时分。网络失败显示失败/重试，认证失效显示失效/去设置。
- `grokbot-usage.js` 实际读取 Cursor 的 GetSandUsageStatus，先尝试已保存 Cursor Token，再读取本机登录；来源 tooltip 明确为 Cursor Sand 会话池与实际凭据方式，而非 xAI Grok 余额。

## 对照与修正

实际截图与对应原图按外框归一后左右合成；每张左侧原图、右侧实现，路径前缀 `dist.noindex/quota-v9/comparisons/`。

| 状态 | small | medium | large |
| --- | --- | --- | --- |
| 正常 3 家 | 通过：`small-3ai-normal.png` | 通过：`medium-3ai-normal.png` | 通过：`large-3ai-normal.png` |
| 偏低 4 家 | 通过：`small-4ai-warn.png` | 通过：`medium-4ai-warn.png` | 通过：`large-4ai-warn.png` |
| 告急 5 家 | 通过：`small-5ai-critical.png` | 通过：`medium-5ai-critical.png` | 通过：`large-5ai-critical.png` |
| 周用完 4 家 | 通过：`small-4ai-out.png` | 通过：`medium-4ai-out.png` | 通过：`large-4ai-out.png` |
| 多家用完 5 家 | 通过：`small-5ai-multi-out.png` | 通过：`medium-5ai-multi-out.png` | 通过：`large-5ai-multi-out.png` |
| 全部用完 4 家 | 通过：`small-4ai-all-out.png` | 通过：`medium-4ai-all-out.png` | 通过：`large-4ai-all-out.png` |
| 失效 6 家 | 通过：`small-6ai-error.png` | 通过：`medium-6ai-error.png` | 通过：`large-6ai-error.png` |
| 过期 3 家 | 通过：`small-3ai-stale.png` | 通过：`medium-3ai-stale.png` | 通过：`large-3ai-stale.png` |

首轮发现并修复：small 名称测量未考虑粗体导致提前截断；额度内部头部过高挤占内容；large 条组偏高、网格隐式列导致轨道未拉满。修正后复查系统字体、字号、留白、环/条对齐、颜色与图标。正常/偏低/告急/用完语义保持一致；过期按用户要求约 45% 灰化，原状态图未完全灰化的部分以文字规格为准。品牌资源直接复用仓库。工作区已有的 Grok Bot 头像修正独立保留未提交；quota-only 副本使用 dev 原已提交图标，因此该副本图标与当前工作区可能不同，不属于本次布局改动。示例时间不同，均来自隔离夹具的真实字段；不硬编码设计图时间。

mini 改前/改后对照：`dist.noindex/quota-v9/mini-before-after.png`。同一夹具的内容区像素一致，动态时间不同。medium/large 悬停、点击、键盘开关详情、失效去设置、网络重试、长英文、未知时间、余额/积分、超过 6 家滚动均回归。

## 动画

`renderer/ai-usage-animation.js` 与开始时 SHA-256 完全相同：`1ce31412ccd39aa11ad2142dceec17b68f00bc51e9d980714f34e01067a06aae`。沿用现有 720ms ease-out、逐行 60ms、缓存、显示刷新、30 秒防抖、首次从 0、失败/相同值不重播、当前帧续接、减少动态效果与结束后划线，仅适配新 DOM。

- 改前录像：`dist.noindex/quota-v9/before/panel-refresh.webm`
- quota-only 副本截图/录像：`dist.noindex/quota-v9/delivery-after/`、`dist.noindex/quota-v9/delivery-animation/`
- 改后录像：`dist.noindex/quota-v9/animation-after/panel-refresh.webm`
- 两段录像均解码检查 4 个时间点，包含展开和手动刷新；同目录有帧图及 `recording-frames.json`。
- 最终采样前/后 rAF 帧数为 221/221，中位数均约 16.7ms，P95 为 17.6/18.1ms；指标见 `dist.noindex/quota-v9/performance-review.json`。为本机隔离 Electron 采样，不代表 Windows 或所有显示器的性能。

## 验证与边界

相关领域/动画单测 40 项通过；工作区全量 `npm test`：855 pass / 0 fail / 1 platform skip，31 次 Electron 运行、语言与语法检查通过；quota-only 拟提交副本完整 `npm test`：852 pass / 0 fail / 1 platform skip，同样完成 31 次 Electron 运行、语言与语法检查。四尺寸×8 状态在设计尺寸与现有实机尺寸均检查，另验英文、失败、缺失时间、近期过期；轨道在 0%、8%、100% 及过渡帧中宽度一致。截图目录 `dist.noindex/quota-v9/after/`，每个 `-real` 为现有实机尺寸。

使用隔离 userData 与额度夹具，不读取真实账号凭据。未做 Windows 真机、安装包安装或真实账号联网刷新；本次未打包、推送或合并 main。开始时已有的 UI 简化、凭据错误映射、NAS、图标等未提交栈独立保留。

## 文件清单

- `renderer/ai-usage-domain.js`：四家上限、环径及 inline 窗口选择。
- `renderer/ai-usage.js`：新 DOM 挂载、时间说明、来源说明、独立轨道测量及隐藏家数入口；复用旧动画。
- `renderer/ai-usage-final.css`：v9 排布、尺寸、无条居中、灰化与固定轨道。
- `tests/ai-usage.test.js`、`tests/ai-usage-final.electron.js`、`tests/ai-usage.electron.js`、`tests/quota-refresh.electron.js`：状态/排序/尺寸/轨道/动画与交互回归。
- `tests/startup.electron.js`：仅更新失效底部按钮文案断言。
- `localization/locales/zh-CN.json`、`localization/locales/en-US.json`：仅 quota.repair 调整为「去设置」/「Settings」。
- `localization/resources.js`、`fnos/app/ui/i18n/resources.js`：对应生成资源。
- `README.md`、`README.en.md`、`design-qa.md`、本文件：行为准绳与验收记录。

动画模块、顶栏代码、其他模块、用户已有图标改动均不在本次提交中。

## small 四家圆环独立居中补充 · 2026-10-22

按最新反馈覆盖上文 small 固定 8px 环条间距：原来居中的是「环＋条」整组，有条时圆环被向上推。现在环独立对齐名称与底部时间之间的中线，进度条单独放在环下方，按可用空间将间距收紧到 1–8px。保留 38px 目标环径、原动画与固定轨道；多窗口高度确实不足时才按最小必要量避让，避免覆盖底部，不隐藏任何已有池。

- 修改 `renderer/ai-usage-final.css`、`renderer/ai-usage.js`、`tests/ai-usage-final.electron.js`，同步 README 中英文与本验收说明、design-qa。
- 40 项领域/动画单测通过；四尺寸×状态矩阵、原额度交互回归通过。新增四家增删周窗口前后环中心差 <0.6px、两条 Copilot 池不遮挡底部、轨道等长且不随动画数字变化的断言。
- 改前/改后实机对照：`dist.noindex/quota-small-center/before-after.png`；无条与多池边界截图也在同目录。实际时间字段不同，不影响布局比较。mini、medium、large 布局规则不变。
- 刷新动画模块未修改。首次无录屏回归在 large 的每帧数字差断言有一次失败；录屏与原无录屏配置复测均通过，截图和动画证据在 `dist.noindex/quota-small-center/animation/`。首次失败的原因尚未确认，不将其直接归因于本次 small 布局。

## 三档卡片按剩余空间居中 · 2026-10-22（最终确认）

本节覆盖上文 small「独立对齐绝对中线／1–8px 自适应间距」补充。用户明确确认：有进度条时，圆环在名称下方、进度条上方的剩余空间居中；没有进度条时，区域延伸到底部说明上方。

small、medium、large 共用同一套网格：先给名称、实际进度条与脚注留位，圆环占可伸缩的剩余行并居中。移除 small 的绝对偏移、环条距离补偿，以及 medium 原先固定环条间距；large 原有排布符合该定义，合并到共用规则并保留脚注前留白。mini 无进度条，现有排布与动画保留。

- 几何验收直接比较圆环到「名称下沿」和「进度条上沿」的留白；无条则比较至脚注上沿，误差 <0.6px，覆盖三档的全部状态与设计/实机尺寸。
- 四家增删窗口时，释放的条高重新分配给圆环区域，圆环中线随剩余空间变化；同格轨道仍等宽，多池不覆盖底部。38px 等目标环径与全卡统一缩放规则保留。
- 修改 `renderer/ai-usage-final.css`、`renderer/ai-usage.js`、`tests/ai-usage-final.electron.js` 以及中英文 README、design-qa 与本记录。动画模块文件未改。
- 原截图与当前 Electron 截图合成：`dist.noindex/quota-remaining-space/before-after.png`（small/medium，左改前右改后）；large 与各状态原图同目录。截图中的时间来自当次夹具，时间不同不作为布局差异。
- 40 项领域/动画单测和四尺寸状态矩阵通过；完整 `npm test` 为 855 pass / 0 fail / 1 Windows-only skip，31 次 Electron 运行、语言及语法检查通过。日志在 `dist.noindex/quota-remaining-space/full-test.log`。

使用隔离 userData 与额度夹具；未做 Windows 真机、真实账号联网或安装包验证。main 不动，原有未提交栈保留。
