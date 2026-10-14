# AI 完成来源 · 视觉与交互验收

final result: passed

本轮参考：用户提供的设置页与首页空状态 Google Drive PNG。原图已通过 Google Drive 插件读取，保存在 dist.noindex/ai-sources/design-settings.png、design-empty.png。界面捕获来自生产 Electron、真实 preload 和主进程，用临时 HOME，不用缺少原生桥接的浏览器替代。

## 同状态对比

两张原图首帧均裁取 (18,94)-(946,571)，归一到 1240×638；实际捕获 2480×1276（2x），归一后横向合成 comparison-settings.png 与 comparison-empty.png。对比前已查看原图和最终捕获。设计 PNG 是复合示例，不声称逐像素完全一致。

- 设置混合状态：Codex 已接入 / Claude 未接入 / Cursor 配置异常，与参考对应；按说明删除 GPT，N/4 变 N/3。新卡片位于 API 与额度之间，其它卡片不被压缩，左栏滚动保留。
- 使用原有字体、颜色、圆角与共享按钮；正式 Codex/Claude/Cursor 图标均为本地品牌资产。配置路径省略显示、title 保留全路径。
- 确认浮层使用顶层 dialog，右对齐点击位置并向上弹出，宽度/高度按视口限制；已确认、取消、路径变化与过期均由生产流程验证。真实运行时/备份路径更长，浮层比示例更高，文字可折行及内部滚动。
- 首页未接入、等待、失效（橙色光晕）、首次提示四种状态均有捕获。mini/small 已检查无卡片溢出。首页可修复失效直接打开备份确认；主操作复用共享胶囊按钮。
- 关闭时淡色添加占位保持原格子，重新开启不会修改其他卡片。小/中/大号 3/5/10 条按最新需求实现；空态全部已读隐藏，! 与 9+ 边界完全一致且不遮字。
- 损坏正文使用 text-2 与正式红色图标；文件名及完整路径悬停分离。保留期文案用 text-3/caption。

## 证据

settings-mixed-states.png、settings-all-connected.png、settings-confirm.png、settings-test-delivered.png；empty-none.png、empty-waiting.png、empty-source-error.png、first-detection.png、empty-mini.png、empty-small.png、home-repair-confirm.png、hidden-inbox-placeholder.png；comparison-settings.png、comparison-empty.png。均位于 dist.noindex/ai-sources/。既有四尺寸、空态/损坏及角标截图在 dist.noindex/inbox-bento/ 已重捕获。

生产 Electron 夹具 result.json 中 consoleErrors 为空。完整测试与性能结果见 docs/plans/2026-10-13-ai-source-hooks.md。

## 说明

设计中的 GPT 行/图标删除；测试不入历史；其它首页模块保持用户原布局，未照新示例重排。实际工具状态、数据、路径和窗口数量不固定成设计样例。Windows 真机与实体多屏/DPI 未验证；不把隔离配置测试描述为已接入真实用户工具。
