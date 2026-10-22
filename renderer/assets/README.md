# 桌面静态资源

首页背景以现有 WebP 为运行资源，CSS 使用固定路径，番茄钟还通过 `assets/pomodoro-bg-${size}.webp` 按尺寸选择。

- AI 额度：`cursor-usage-bg.webp`。
- 笔记：`note-bg-ink.webp` / `note-bg-ink-tall.webp`。
- 当前窗口、常用指令、录音：各自的 `*-bg.webp`。
- 汽水音乐与番茄钟：`music-bg-{mini,small,medium,large}.webp` 和 `pomodoro-bg-{mini,small,medium,large}.webp`。
- 天气/日照：保留 `sun-sky-*` 的横向和纵向 WebP 版本。
- `app-logo-128.png` 是应用仍引用的位图标识；`inbox/` 与 `notification/` 保存来源及状态图标，许可证见对应目录。

2026-10-22 检查仓库文本引用及动态背景选择后，删除无引用的六张旧 PNG 背景（commands/current-window/cursor-usage/note/pomodoro/recorder）和 `generated/` 的八张 PNG 中间文件，共 8,238,156 字节。运行用 WebP、应用标识、历史来源图标与许可证保留。Git 历史可恢复已删除的中间资源；本轮文件清单和 SHA-256 记录见 `docs/quota-cleanup-acceptance.md` 指向的本地验收目录。
