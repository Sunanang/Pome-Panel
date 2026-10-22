# 桌面静态资源

首页背景以现有 WebP 为运行资源，CSS 使用固定路径，番茄钟还通过 `assets/pomodoro-bg-${size}.webp` 按尺寸选择。

- AI 额度：`cursor-usage-bg.webp`。
- 笔记：`note-bg-ink.webp` / `note-bg-ink-tall.webp`。
- 当前窗口、常用指令、录音：各自的 `*-bg.webp`。
- 汽水音乐与番茄钟：`music-bg-{mini,small,medium,large}.webp` 和 `pomodoro-bg-{mini,small,medium,large}.webp`。
- 天气/日照：保留 `sun-sky-*` 的横向和纵向 WebP 版本。
- 应用打包标识使用 `build/pome-panel-icon.png`；`inbox/` 保存 AI 来源图标（旧 GPT 复用 `openai.svg`），`notification/{task,todo}.svg` 保存任务汇总与待办来源图标，`notification/glyphs.svg` 保存提醒状态符号，许可证见对应目录。

2026-10-22 检查仓库文本引用及动态背景选择后，删除无引用的六张旧 PNG 背景（commands/current-window/cursor-usage/note/pomodoro/recorder）和 `generated/` 的八张 PNG 中间文件，共 8,238,156 字节。同日删除空目录 `generated/`、未引用的 `app-logo-128.png` 和独立的 `notification/gpt.svg`。复核动态来源路径后恢复仍用于运行的 `task.svg`、`todo.svg`：它们与状态符号承担不同职责。运行用 WebP、inbox 来源图标与许可证保留。清单见 `docs/quota-cleanup-acceptance.md`。
