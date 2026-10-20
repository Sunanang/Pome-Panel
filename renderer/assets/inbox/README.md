# 收件箱来源图标

来源：[Lobe Icons](https://github.com/lobehub/lobe-icons)，MIT 许可证见本目录 LICENSE。2026-10-13 获取，作为本地静态资源使用，无运行时网络请求或新增依赖。

- codex.svg：[原文件](https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/codex.svg)
- claude.svg：[原文件](https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/claude-color.svg)
- openai.svg：[原文件](https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/openai.svg)，用于保留的历史 GPT 记录（界面标为“其他”）。

新增 cursor.svg：https://raw.githubusercontent.com/lobehub/lobe-icons/master/packages/static-svg/icons/cursor.svg。

完成接入图标：Codex / Claude Code / Cursor / Grok / Copilot CLI / Antigravity / Manus（Manus 走 API 轮询，非 HTTP hook）。`grok.svg` 与 `grokbot.svg` 复用定稿源包中的 Lobe Icons Grok 标；Grok Bot 暂用 Grok 标，仪表盘增加圆角方底区分。`manus.svg` 使用定稿源包提供的官方白色字形（manus-white），用于深色卡片和通知蒙版。circle-alert.svg 来自 Lucide，许可证见 LICENSE-alert，用于损坏状态的小型提示。

- `copilot.svg`：GitHub Primer Octicons 的 [copilot-24](https://github.com/primer/octicons/blob/main/icons/copilot-24.svg)，MIT 许可证见 LICENSE-copilot.txt；填色改为白色。
- `antigravity.svg`：[官方 favicon](https://www.antigravity.google/favicon.svg) 中的标志轮廓，去掉背景与颜色效果，裁切 viewBox 并改为白色，以用于通知蒙版。

定稿源包：[AI 剩余额度 B 仪表盘](https://drive.google.com/file/d/17r9ApKIEm8M3XhLLLL2sgvxHp7bYHbW9/view)。额度模块与面板共用系统字体栈，不再单独挂载 Inter。
