# Codex 修复提示词 · AI 额度 layout-variant 回归（基于 dev `8a97c06`）

分支只用 `dev`，仓库 `/Users/lando/coding/Pome-Panel`（Mac mini）。改完跑测试再提交到 dev，不要动 main。

## 现象（Lando 实机截图，M3，AI 额度 wide 拉伸态，3 个来源 Cursor/Codex/Grok Bot）
截图：`docs/plans/bug-ai-wide-8a97c06.png`
1. 进度环缩成十几 px 的小圆点，环里的百分比数字没了。
2. 环下面又冒出横向进度条（`Oth ▬▬ 80%`、`周 ▬▬ 95%`）：同一个卡里环和条同时出现，重复。
3. 每个格子大片空白，内容都挤在中间一行；Grok Bot 只剩个小点。
4. 环分色只体现在小点和条上，看不出来。

## 根因方向（先读代码确认，不要照抄）
`8a97c06` 在 `renderer/ai-usage.js` 加了 `layoutForVariant`（wide：N 列，tall：≤2 列放大环），又在 `renderer/styles.css` / `renderer/ai-usage-final.css` 加了 variant 规则。很可能：
- 新 variant 规则把环尺寸（`--ring-size` 或 svg width/height）算成了极小值，或者 `aspect-ratio` / `min()` 用的父尺寸取错了；
- 现网某档本来是「环」或「条」二选一，新规则把两种都显示出来了；
- 和现网 small/medium/large 原有的 AI 卡规则冲突（选择器优先级）。

## 要求
1. **先回到可用状态**：在没有 `data-layout-variant`（或 variant 为 compact/mini）时，AI 额度卡要和 `8a97c06` 之前（`a8623c8`）一模一样。可以 `git diff a8623c8 8a97c06 -- renderer/ai-usage.js renderer/ai-usage-final.css renderer/styles.css` 对照。
2. **wide**：N 个来源横排均分；每格：图标+名称在上 → **一个大环**居中（直径约取格子 min(宽, 高-上下文字) 的 60–70%，下限 56px），环中间显示剩余百分比 → 底部重置时间。**环和横条只能二选一，wide 用环，不要条**。
3. **tall**：≤2 列网格，同样只用环，环更大；N=1 时单格居中。
4. **环分色**：保留按 `data-provider` 的品牌色（这是 Lando 要的），但颜色画在环的进度弧上；warn/critical 仍覆盖。图标不改色。
5. 没数据 / 失败的来源（如 Grok Bot 无进度）：不画空环占位，按现网已有的失败态文案显示，并在格子里垂直居中（沿用 v9 规则：没进度条的格子不留隐形行）。
6. 不改面板三档尺寸、容量、铺满算法；其他三个模块（黄历/日出/收件箱）这次不要碰，除非是同一处共享 CSS 引起的回归。

## 验收
- Electron 截图自测：适中档 AI 额度 wide（3 来源、4 来源）、tall（2、4 来源）、以及非拉伸 small/medium/large 各一张，保存到 `docs/plans/ai-usage-fix-shots/`。
- 截图里：环直径 ≥56px、百分比可读、同一格没有环+条重复、没有大片空白、三种品牌色能区分。
- 补测试：wide/tall 下 `.ai-usage-provider` 不同时显示环和条；环尺寸 ≥56px。
- `node --test tests/*.test.js` 全过；`git diff --check` 干净；CHANGELOG 未发布里改一条说明。
