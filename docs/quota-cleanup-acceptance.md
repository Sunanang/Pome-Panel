# 额度旧样式与未引用资源清理 · 2026-10-22

本次清理只涉及已由 `ai-usage-final.css` 接管的旧布局，以及没有代码或构建引用的背景 PNG 中间资源。工作区原有 UI 简化、凭据文案、Grok Bot 图标改动独立保留。

## 旧 CSS

从 `renderer/styles.css` 移除 114 行旧实现：旧圆环/来源格基础布局的重复声明、旧横排与隐藏圆环模式、small/medium/large 的叠加布局补丁及旧多池条结构。保留仍被详情弹层、颜色、图标、状态划线和动画使用的基础规则；现有动画模块没有改动。

清理前后用固定额度时间夹具运行同一四尺寸 Electron 矩阵，覆盖 3–6 家、正常/偏低/告急/用完/失效/过期及英文。107 张截图中，104 张像素一致，3 张存在首次展示、顶栏或单像素差异，未作为像素等价证明；两轮几何、溢出、轨道与交互断言均通过。完整记录 `dist.noindex/quota-polish/css-pixel-review.json`，截图为同目录 `before/`、`css-only/`。未将后续改名和短名带来的外观变化计入 CSS 对照。

## 删除的无引用 PNG

运行入口与构建脚本不引用以下 PNG；实际背景由现有 WebP 及按尺寸选择的 WebP 加载。保留位图应用标识、所有运行背景、来源图标、历史图标与许可证。

- `renderer/assets/commands-bg.png`（753,112 字节）。
- `renderer/assets/current-window-bg.png`（754,868 字节）。
- `renderer/assets/cursor-usage-bg.png`（871,959 字节）。
- `renderer/assets/generated/music-bg-large.png`（1,091,649 字节）。
- `renderer/assets/generated/music-bg-medium.png`（574,483 字节）。
- `renderer/assets/generated/music-bg-mini.png`（128,570 字节）。
- `renderer/assets/generated/music-bg-small.png`（254,250 字节）。
- `renderer/assets/generated/pomodoro-bg-large.png`（861,217 字节）。
- `renderer/assets/generated/pomodoro-bg-medium.png`（484,915 字节）。
- `renderer/assets/generated/pomodoro-bg-mini.png`（132,963 字节）。
- `renderer/assets/generated/pomodoro-bg-small.png`（237,005 字节）。
- `renderer/assets/note-bg.png`（952,689 字节）。
- `renderer/assets/pomodoro-bg.png`（493,987 字节）。
- `renderer/assets/recorder-bg.png`（646,489 字节）。

共 14 个文件、8,238,156 字节（约 7.9 MiB）。引用检查、文件大小与 SHA-256 记录为 `dist.noindex/quota-polish/unused-assets.json`；已删除的源文件仍可从 Git 历史恢复。

## 验证边界

清理后的完整 `npm test` 已通过（856 pass / 0 fail / 1 Windows-only skip、31 次 Electron 运行）；后续时间说明修复纳入最后一轮全量回归，结果见 `docs/quota-polish-acceptance.md`。使用隔离 userData 与接口夹具，未做 Windows 真机、真实账号联网或安装包验证；未打包、推送或合并 main。
