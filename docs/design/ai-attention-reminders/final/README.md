# AI 待操作提醒 · B 蓝色定稿

2026-10-18 定稿，取代 R1/R2。生产实现为 renderer/attention-reminder.css 与 notification.*，只采用 B 蓝色；src/ 保存 Drive 原稿文本与品牌图标，原稿 CSS 中的 A/琥珀探索内容不用于产品。

来源：[Drive 文件夹](https://drive.google.com/drive/folders/1W4Kf3zEVLxwutRDeUoPD8hHsyqvKUpY3)、[标注](https://drive.google.com/file/d/1J9_au5q4f6slfvZU7rRFz8WGuvwSFQsQ/view)、[完整源包](https://drive.google.com/file/d/1er9HRnU7IQtHD9HfsbLydQbvTyyoXuXB/view)。大字体文件未重复纳入仓库；原稿的字体 fallback 在 Mac 使用系统字体，跨平台复现字体可从完整源包取 fonts/。生产界面使用已有系统字体栈。

macOS 400×146，32px 顶帽 + 114px 内容；Windows 为 384×114 可见卡片。按钮 #2F6FE0，悬停 #2A66D6；接缝/圆点/顶线 #438CFF。状态 20px 高，摘要 15px/21px 单行，按钮高 28px；入场 320ms，内容 120ms 后淡入 180ms，按钮 200ms 后 220ms，接缝 140ms 后 300ms，光晕呼吸 2800ms。减少动态效果时关闭呼吸与涟漪，使用淡入淡出。

实现截图及逐项核验见 [实施记录](../../../plans/2026-10-18-ai-attention-implementation.md)。截图来自隔离 Electron 消费端；不等同真实 Codex/Cursor/Claude 来源已接通。
