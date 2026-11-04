# AI 副额度条恢复验收

修正上一轮将所有横条误当作重复信息移除的问题。拉伸态只排除主环对应的同一额度，保留 Cursor Other、Codex / Claude 周额度及其它独立额度池。未拉伸态保持原规则。

截图来自 macOS Electron，使用隔离合成数据，不代表真实账号余额：

- `wide-3-providers.png`：Cursor 主环 72% / Other 80%，Codex 主环 85% / 周额度 95%；失败来源不显示空环。
- `tall-4-providers.png`：纵向布局保留 Cursor / Codex / Claude 副额度条。
- `wide-secondary-refresh.png`：刷新后 Codex 周额度独立更新为 67%，主环仍为 85%。
- `tall-multiple-secondary-pools.png`：五条副额度可在卡片内部滚动访问。

回归覆盖 wide / tall / full、拉伸 mini 与 large、六来源窄卡、品牌与告警色、无数值主额度、独立刷新以及副额度内部滚动。仪表环至少 56px，短副额度列表不产生多余滚动条。

相关 Node 测试 37 项通过，原有 ai-usage / ai-usage-final Electron 回归通过，新增布局验收共 41 个状态通过。本次未打包或替换安装版，Windows 真机待验。
