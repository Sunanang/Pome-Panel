# AI 额度拉伸回归

此处保留第一轮验收图；副额度条被错误移除的问题已在[后续修复](../ai-secondary-quota-fix-shots/README.md)中恢复，以后续截图为准。

这些图片直接来自 Electron，使用合成 Cursor / Codex / Grok Bot / Claude 数据，不是账号实时额度。

- `wide-3-providers.png`、`wide-4-providers.png`：三／四来源横排，含失败来源。
- `wide-3-ready.png`：三来源均有额度，三种品牌进度弧可区分。
- `tall-2-providers.png`、`tall-4-providers.png`、`tall-1-providers.png`：至多两列，单来源居中。
- `full-4-providers.png`：full 沿用纵向大环布局。
- `unstretched-small.png`、`medium.png`、`large.png`：原未拉伸排布。
- `wide-warn.png`、`wide-critical.png`：告警色覆盖品牌色。
- `wide-mini-footprint.png`：保留 mini 足迹标记，拉伸后显示完整大环／数字／重置时间。
- `wide-6-narrow.png`：六来源窄卡片，最小环 56px，内部横向滚动可访问最后一个来源。

专项验收检查：可见来源数决定列数，所有有额度的环直径 ≥56px，百分比可见，未同时显示横条，失败来源不创建空环。常规 wide 三／四来源环为 91px；tall 两来源为 86px，四来源为 113px，单来源为 187px。窄卡片与 mini 拉伸触及 56px 下限。

原图标未改色；未拉伸图标像素与 `a8623c8` 对照相同。完整测量和其余模块审查见 [审查记录](../layout-variant-review-shots/README.md)。
