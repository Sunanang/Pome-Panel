# AI 额度名称约定

完整名称用于详情、tooltip 和无障碍说明；紧凑卡片使用同一套词汇的缩写。

| 来源/周期 | 完整名称 | 紧凑名称 |
| --- | --- | --- |
| 一天 | 日额度 | 日 / Day |
| 一周 | 周额度 | 周 / Week |
| 一个月 | 月额度 | 月 / Month |
| N 小时 | N 小时额度 | Nh |
| N 天 | N 天额度 | Nd |
| Codex / Claude 5h | 5 小时额度 | 5h |
| Codex / Claude 7d | 周额度 | 周 |
| Grok Bot | 周额度 | 周 |
| Cursor | Auto · 月额度 / Other · 月额度 | Auto / Other；环内周期为月 |
| Copilot | 高级请求额度 / 聊天额度 / 补全额度 | 保留池名称 |
| Antigravity | 模型名 · 已知周期额度；周期未知则模型名额度 | 保留模型名 |
| Grok | 已入账预付余额 | 原货币单位 |
| Manus | 可用积分 | 原积分单位 |

- Claude 的“5 小时”“7 天”和模型池的“Weekly”等重复周期别名仅在与已报告周期相符时去掉。真正的模型/池身份保留。
- Cursor 月额度是展示名称；底层真实周期起止时间、windowMinutes 和 resetAt 不修改，不把月份强制换成 30 天。
- Grok Bot 的本机快照已报告 10080 分钟周期，展示时使用周额度，渲染层不再将其改成泛称“额度”。
- 未报告周期的 Copilot / Antigravity 池不猜成周或月；余额、积分和无限额度不伪造周期或百分比。
- 日期和时间仍来自已有数据，统一到分钟；仅有日期时不添加时间，未知重置时间保持未知。
- 所有尺寸的详情展开后显示完整名称，窗口进度条下方显示重置说明；紧凑卡片保留缩写。

验收使用隔离 Electron 配置和接口夹具，覆盖中英文、八个来源及四种尺寸。截图目录：`dist.noindex/quota-labels/`（`naming-*`）；相关测试在 `tests/ai-usage.test.js` 与 `tests/ai-usage.electron.js`。
