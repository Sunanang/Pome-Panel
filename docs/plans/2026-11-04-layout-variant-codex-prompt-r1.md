# Codex 实现提示词 · 首页 layout-variant 适配 r1（黄历 / 日出日落 / AI 用量 / 收件箱）+ AI 环分色

**分支：只在 `dev` 改，禁止改 `main`、禁止直接推 main。**  
**机器：在 Mac mini 仓库 `/Users/lando/coding/Pome-Panel` 原地改；改完跑相关测试，不要打包安装（安装由后续流程做）。**

## 已拍板

- 设计文件夹：[layout-variant 适配](https://drive.google.com/drive/folders/1x3m-P22vk9k974Dm21M4-DF39tl0WGxa)  
  NOTES：`1rLTDMMocS69PvEwTHYq7kV9qbjYbT0Xa`；overview 拼图 `1dCHPb_HrvxPvD3E9Eg8h6SPhqvs2wmeX`
- Lando 认可方向；额外要求：**AI 用量每个来源的仪表盘（进度环 / 条）用不同品牌色；图标 / mask icon 保持现网，不要换成设计图里的彩色方块 icon。**
- 尺寸档仍是 `mini|small|medium|large`；**只写 / 消费 `data-layout-variant`**（`mini|compact|wide|tall|full`，由现有 `layoutVariantForPlacement` 产生）。禁止发明第五档足迹。
- 对齐现网 liquid-glass、背景图规则、字号气质；参考已有适配：音乐 / 番茄钟 / 录音 / 窗口 / 笔记 / 镜子 / 指令（`renderer/styles.css` 约 5849+）。

## 范围（只做这四块 + 环分色）

| 模块 | 选择器根 | wide | tall |
|------|----------|------|------|
| 黄历 | `.home-bento > .home-almanac` | 左右分栏（近 medium）：左日号+农历干支，右节气/宜忌/冲煞 meta | 纵向 space-between；更大日号；宜忌展开；背景切 `almanac-bg-tall.webp` |
| 日出日落 | `.home-bento > .home-sun` | 弧/时刻拉满；hero 两端；times 可扩到均分 | head→hero→arc→list→stats（stats `margin-top:auto`） |
| AI 用量 | `#home-cursor` / `.home-cursor` | providers 按 **实际可见 N** 横排 `repeat(N,1fr)`，环+名竖排居中 | `1fr 1fr` 的 2×2（或按 N），环更大 |
| 收件箱 | `.home-bento > .home-inbox` | 标题\|摘要两列；时间靠右；勿锁死窄列表宽 | 列表 `flex:1` 多露几行；footer `margin-top:auto` |

`full`：可与 `tall` 同组或略放大，不要空白方案。`compact`：若拉伸不严重可保持现网四档 DOM，只需不崩。

## 硬约束

1. **不要改** `HOME_SIZE_FOOTPRINTS` / `HOME_SIZE_DEFAULTS` 语义；不要为了好看偷偷把 small 改成 medium 足迹。
2. **不要改** `fitHomeWidgetView` 的铺满算法（除非发现 variant 标记与真实显示宽高严重错位且有最小补丁；优先 CSS/DOM 适配）。
3. 黄历 / 日出 DOM：优先 CSS + 少量结构；若 small 模板无法变成双栏，可在对应 `data-layout-variant` 下复用 medium/large 的渲染分支或加 `almanac-wide`/`sun-wide` 模板，但 **`data-widget-size` 仍反映用户选择的档**。
4. AI 用量横排 **N = 当前渲染的 provider 数**，禁止写死 4；设计图金额只是示意，继续用现网剩余额度文案。
5. **环分色（Lando 点名）**  
   - 现状：所有 provider 共用 `--q-ok-a/b`，仅 `warn`/`critical` 换色。  
   - 目标：每个 `data-source`（或等价 provider id）在 ok 态有独立 `--q-ring-color-a/b`（进度环 SVG gradient + 行内 track 渐变跟着走）。  
   - **不要**改 `.q-icon` 的颜色 / 背景成设计图那种品牌色块。  
   - `warn` / `critical` 仍可用现有告警色覆盖环（或在品牌色上叠告警——优先保持告警可读）。  
   - 建议色（可微调，保持暗底可读）：cursor 紫系、codex/绿系、claude 橙系、grok 近现网蓝紫、copilot 青、antigravity/gemini 蓝、manus 独立一色。未列出的来源给一个中性 fallback，仍别和图标绑死。
6. i18n：新增用户可见文案走现有 localization；纯布局可不加文案。
7. 测试：补/改 Electron 或 CSS 相关断言；至少覆盖  
   - 适中/紧凑下四模块带 `data-layout-variant='wide'`（或 tall）时关键布局规则存在且不把右侧留成「内容贴左」回归；  
   - AI 用量不同 `data-source` 的环色变量不同；  
   - 不破坏现有 `home-fill` / `panel-size` / almanac / sun / inbox / ai-usage 测试。
8. CHANGELOG.md / CHANGELOG.en.md「未发布」各加一条中英文说明。
9. 不提交 secrets；不改 packaging 身份字段以外的无关文件。

## 建议改动面

- `renderer/styles.css`：四模块 `[data-layout-variant=…]` 块；`.ai-usage-provider[data-source=…]` 环色。
- `renderer/almanac-widget.js` / `renderer/sun-widget.js` / `renderer/ai-usage.js` / `renderer/task-inbox.js`：仅当纯 CSS 不够时改渲染。
- `tests/*`：layout-variant / 环色回归。
- `CHANGELOG*.md`

## 验收

1. 适中或紧凑首页铺满后，黄历 wide 不再右空；结构接近设计 `almanac-adapted-wide`。
2. 日出 / AI 用量 / 收件箱 wide|tall 对照设计文件夹同名 adapted 图，无明显左挤右空。
3. AI 用量各来源环颜色可区分；icon 外观与现网一致（非设计图彩色方块）。
4. 标准档、未拉伸的四档尺寸观感不明显回退。
5. 相关测试通过；`git diff --check` 干净。

## 非目标

- 改面板三档尺寸数字、容量 48/36/24、默认模块顺序。  
- 给音乐等已有 variant 模块大改。  
- 打 DMG / 装到 M3（别做）。

实现时以设计图为布局参考，以现网组件与数据为准；有冲突保现网数据与 i18n。
