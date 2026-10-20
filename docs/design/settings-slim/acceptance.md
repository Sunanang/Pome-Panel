# 设置页「方案 A 完善版」验收

分支：dev。只改设置正文和首页待处理入口；未改 main，未打包、推送或发布。

## 参考与取舍

- [整页定稿](https://drive.google.com/file/d/1dn2rnfBAsat-iC3yrxgXVz1YAl_ArRlP/view)
- [AI 卡定稿](https://drive.google.com/file/d/1s9u_O8K4EIgaGhBD0GKiDbo7Cm8hfJwZ/view)
- 明确忽略设计图顶部导航。Claude 是否保留接入操作的文字/图片冲突，已由用户确认按图保留接入/断开；额度使用本机 OAuth，不新增 Token 控件。
- 定稿只示意部分来源，实际保留全部 8 家来源与原有按钮能力。Manus 不凭空增加「获取本机」；保留已有 API Token、完成开关、检查连接与提醒预览。Grok 的 xAI 团队 ID 仍在本行下方。
- 语言沿用已有选择框；次列保持镜子封面、NAS 同步、本机与唤出的原内容。窗口与导航尺寸不变，两列仍独立滚动。

## 已核对

- AI 统一一张卡：状态、紧凑路径、接入/断开/修复、行内 Token。接入为蓝色，其他操作为灰边，已接入绿标、仅额度蓝描边。断开/未检测来源的 Token 部分更弱，但输入、保存不禁用。
- 能力矩阵、可展开限制、发送测试及送达反馈已从设置/首页界面移除。后端 runTest、IPC 与转发脚本回归保留。
- Token 节点在状态刷新、Manus 状态更新、语言切换时保持稳定，保留未保存的密码输入、团队 ID 和焦点。
- 首页待处理入口打开小列表，保留安全摘要、返回来源、隐藏请求重新弹出、重启后未确认标记、备份并修复存储；不再跳转设置。解决事件仍自动撤销，不额外显示已回答。
- 显示统一一张卡：6 个工作区开关排 3 列，10 个首页开关排 2 列；关闭为灰色。设置 IPC 与首页可见性数据分开，最后一个可用组件不能隐藏，录制保护和平台不可用项仍走原规则。
- 首页 AI 完成的既有布局容量校验保持不变：自定义格子已满时不会强行覆盖其他组件；合并界面未改变该规则。
- 中英文文案与桌面/NAS 共用生成资源同步更新。

## 证据

macOS 上运行当前 dev 的生产 Electron、preload 与主进程；测试 HOME 和 userData 隔离，使用合成 Token/额度与模拟远端响应，不写真实工具配置、不连接真实 NAS。

截图目录：`dist.noindex/settings-slim/`。

- `settings-viewport.png`：真实固定尺寸窗口，未拉长生产窗口。
- `settings-full.png`：两列实际滚动截图拼接，完整展示正文。
- `settings-ai.png`：从实际 AI 卡截图裁切的特写。
- `comparison-ai.png`：左为定稿，右为实现；来源数量、Token 状态及 Codex 本机额度信息不同为实际保留能力的差异。
- `header-before-after.png`、`header-comparison.json`：开始前原始 HTML/CSS 与修改后的同一设置选中状态。54 个导航元素计算样式无差异、几何相同，截图像素差异为空；未修改顶部 HTML、图标与导航代码。
- `dist.noindex/ai-attention-design/home-pending-list.png`：首页待处理小列表及重新弹出路径。
- `npm-test.log`：完整测试日志。

自动化覆盖设置接入/取消/失败/断开/修复、原配置保留、Cursor/Codex 获取/保存/清除、四家通用 Token 的实际保存/清除按钮、Grok 团队 ID、Manus 开关/连接/完成链路、工作区开关、首页可见性独立与最后组件保护、双语输入保留、首页待处理重开与存储修复。

未做：Windows 真机视觉验收、真实账号额度/外部工具端到端操作。跨平台布局和能力分支由现有自动化覆盖，不声称已完成 Windows 真机验证。

## 改动文件

- `renderer/index.html`、`renderer/styles.css`：合并 AI / 显示卡与正文样式。
- `renderer/ai-sources.js`：统一来源行、内联 Token、保留接入操作、稳定表单节点。
- `renderer/ai-attention.js`、`renderer/task-inbox.js`：首页待处理列表与移除发送测试界面。
- `renderer/ai-usage.js`：仅更新通用设置入口，指向合并后的 AI 卡标题。
- `localization/locales/zh-CN.json`、`en-US.json`、`localization/resources.js`、`fnos/app/ui/i18n/resources.js`：双语与生成资源。
- `tests/settings-slim.electron.js`：新增设置布局、状态刷新、输入保留、显示规则与导航回归。
- `tests/ai-sources.electron.js`、`tests/additional-completion.electron.js`、`tests/ai-attention.electron.js`、`tests/provider-credentials.electron.js`、`tests/startup.electron.js`、`scripts/test-desktop.js`：更新界面断言并补实际按钮/入口验证。
- `README.md`、`README.en.md`、本验收记录：更新用户路径与验收依据。

开始前已有的额度算法、字号/字体与对应测试、CHANGELOG、根 design-qa.md 改动均保留，不纳入本次提交。与既有改动重叠的 `renderer/styles.css` 和 `renderer/ai-usage.js` 只暂存本次差异。

## 最终结果

- `npm test` 全部通过：824 项 Node 测试，823 通过、1 项平台专属跳过、0 失败；27 次 Electron 场景/重启运行，JavaScript 语法和语言资源检查全部通过。
- Codex、Claude、Cursor 真实配置文件的前后 SHA-256 一致，记录在截图目录的 `real-config-before.json` / `real-config-after.json`。
- 顶部导航 54 个元素的计算样式和截图像素差异均为空，几何一致。

## 2026-10-20 追加布局调整

- 设置各卡片删除大标题上方的小标题，镜子封面保留「首页镜子」。
- 语言选择保留原控件、ID、语言偏好逻辑，作为「本机与唤出」卡第一项。
- 主列现在依次为 API 配置、AI；次列依次为镜子封面、NAS 同步、显示、本机与唤出。
- 设置与 NAS 位置断言已更新，补充只剩镜子小标题、语言属于本机子项的检查；已有双语切换和表单保留回归继续覆盖移动后的语言控件。
- macOS 生产 Electron 截图：`dist.noindex/settings-slim-r2/settings-full.png`（滚动拼接）、`settings-viewport.png`（实际窗口）。顶部 54 个元素的计算样式和截图像素仍无差异。
- 本次不新增文案；README 中的语言入口路径已随位置更新。真实账号与 Windows 真机验证范围同上。

## 2026-10-20 最终布局补充

- 按后续要求，镜子封面从次列移到主列 API 配置上方；镜子原来的小标题和内容保留。
- AI 卡主标题改为「AI 配置」/「AI configuration」，使用 `settings.ai.title` 双语资源；设置位置及切换语言后的标题均有回归断言。
- 最终顺序：主列「镜子封面 → API 配置 → AI 配置」；次列「NAS 同步 → 显示 → 本机与唤出」，语言仍是本机卡第一项。
- 最新截图目录为 `dist.noindex/settings-slim-r3/`，R2 目录只保留上一步验收历史。

最终布局追加回归：`npm test` 全部通过（824 项 Node 测试中 823 通过、1 项平台专属跳过；27 次 Electron 场景/重启运行及全部语法/语言资源检查通过）。日志：`dist.noindex/settings-slim-r3/npm-test.log`。
