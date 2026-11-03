# 自动会议模式验收（2026-11-03）

本次在 `dev` 上扩展现有手动会议模式，保留工作区原有未提交改动。没有执行桌面打包、安装、提交、推送或发布。

## 行为

- 本机 `autoMeetingMode` 默认开启，`meetingMode` 继续只保存手动选择。有效暂停为手动开关或任一自动信号，不将检测结果写入手动开关，不同步 NAS。
- 摄像头使用持续约 3 秒后触发；共享 / 系统专注状态检测为真时立即触发。各项连续解除约 30 秒后各自释放，全部释放且手动模式关闭才恢复。
- 暂停期间收起已有气泡，完成事件和等待状态继续保存。旧完成记录不集中补弹；等待请求按原策略恢复。未展示的待办不写提醒回执，恢复展示后才记录。
- 无法读取、探针异常或扫描不完整均不是解除条件。已触发项保持暂停，并显示无法检测；可关闭自动模式解除自动暂停，手动模式仍独立生效。
- 设置显示各项检测状态，首页会议状态的悬停说明显示自动暂停原因。十种界面语言均已补齐。

## 原生实现与边界

| 系统 | 摄像头 | 投屏 / 共享 | 系统勿扰 / 专注 |
| --- | --- | --- | --- |
| macOS 13+ | CoreMediaIO 设备运行状态；本应用镜子使用的同一摄像头无法归属时返回未知，其他活动摄像头仍可触发 | CoreGraphics 镜像状态，加辅助功能中受支持会议软件 / 浏览器可见、启用的停止共享控件 | Intents 的 `INFocusStatusCenter`，不可读取时返回未知；表达系统对本应用公开的通知静音状态，不能保证区分具体专注模式或获知未共享的全局状态 |
| Windows 10/11 | Media Foundation `IMFSensorActivityMonitor` 读取进程的流活动，排除本应用进程 / 可执行文件 | QueryDisplayConfig 活动路径的共同源检测镜像，加 UI Automation 的受支持软件停止共享控件 | Shell WNF 活动静音配置兼容查询；未知返回码、长度或配置值均返回未知 |

共享控件适配范围包含 Zoom、腾讯会议、Teams、Webex、飞书 / Lark、Slack 与 Chrome / Edge / Firefox（macOS 另含 Safari）。这是针对可识别控件的检测，并非对上述软件所有版本 / 语言 / 共享方式的完整支持承诺。浏览器文档内容不参与扫描，避免任意网页按钮造成误判；不可访问的共享条、浏览器标签页以及不受支持的软件可能漏检。macOS 控件读取需要辅助功能权限，扫描有时间和节点上限。普通扩展显示器不会因连接而触发，镜像投屏参与触发。

Windows WNF 是系统兼容接口，不是微软承诺稳定的公开 DND getter，必须随 Windows 更新做回归。Windows 探针使用独立 PowerShell MTA 进程，C# 只编译一次；不依赖 koffi，不启用窗口聚焦、自动粘贴等实验能力。macOS 打包钩子会编译并签名 Swift 探针；源码运行按源码哈希缓存编译结果。此处仅验证 Swift 探针编译，未执行桌面打包。

所有探测只读设备 / 系统状态与控件属性，不采集画面、声音，不点击共享控件，不申请或更改系统权限。探针通过带版本的逐行 JSON 通信，超时 / 退出会退避重试，关闭自动模式及应用退出时停止。

一手接口参考：[Apple CoreMediaIO](https://developer.apple.com/documentation/coremediaio/kcmiodevicepropertydeviceisrunningsomewhere)、[Apple 镜像状态](https://developer.apple.com/documentation/coregraphics/cgdisplayisinmirrorset(_:))、[Apple 专注状态](https://developer.apple.com/documentation/intents/infocusstatuscenter)、[Microsoft 传感器活动报告](https://learn.microsoft.com/en-us/windows/win32/api/mfidl/nn-mfidl-imfsensoractivityreport)、[Microsoft Windows SDK 接口定义](https://github.com/microsoft/win32metadata/blob/main/generation/WinSDK/RecompiledIdlHeaders/um/mfidl.h)、[WNF 兼容查询的原作者示例](https://gist.github.com/riverar/980120d7e3a13ed8b1d665cf974c8e31)。

## 本次验证

- 全量 Node：1084 项，1082 通过，2 项 Windows 专属检查跳过。日志 `/tmp/pome-auto-meeting-all-unit.log`。
- 十语言资源检查和改动 JavaScript 语法检查通过。
- 原生 Swift 探针以 macOS 13 arm64 目标编译通过。本机实际只读样本：摄像头未使用、专注未触发；共享控件报告 `accessibility_required`。未修改系统辅助功能授权或系统专注设置。
- `tests/meeting-mode.electron.js`：真实 Electron / HTTP 接收 / 工作区存储 / 通知窗口，自动信号和时间由隔离测试注入。覆盖摄像头防抖、多信号组合、连续解除延时、当前气泡隐藏、历史保存、不补弹旧完成、未知状态保持暂停、手动优先、自动偏好保存、渲染重载、原提醒偏好保留，以及未展示待办恢复与展示回执。时间注入不代表实际等待 30 秒，但使用生产同一个状态机与默认阈值。
- 原有 Electron 的 notification、notification-listener、ai-attention、todo-reminders、settings-slim、localization 通过。待办测试首轮在模拟磁盘失败提示等待处超时，单独复核通过；保留首轮及复核日志，未把首轮失败归因于会议模式。日志位于 `dist.noindex/auto-meeting/`，总览 `/tmp/pome-auto-meeting-related.log` 与 `/tmp/pome-auto-meeting-related-remaining.log`。
- 所有 Electron 使用独立临时 userData 和凭据样本；没有修改真实 Codex / Claude / Cursor 配置。

## 截图

- [自动检测待机](automatic-idle.png)：默认自动开关与三类未触发状态。
- [摄像头暂停](automatic-camera.png)：摄像头防抖结束后的暂停状态。
- [组合暂停](automatic-sharing-focus.png)：摄像头恢复等待、共享和系统专注共同保留暂停。
- [检测不可用](automatic-unavailable.png)：共享无法检测；先前已触发的专注项无法读取时仍保持暂停。
- [退出后恢复待办](automatic-todo-resumed.png)：暂停期间未展示的待办恢复为实际通知气泡，并写入展示回执。
- [自动关闭](automatic-off.png)：关闭自动模式后各信号显示已关闭，原顶部提醒偏好保持。

截图已经在对话中展示；这些画面验证 Electron 渲染和调度，不代表真实摄像头开启、投屏或系统勿扰切换的真机测试。

## 尚未验证

- 当前主机为 macOS，没有 Windows 真机 / 虚拟机。Windows C# / PowerShell 原生探针运行及 Windows 原生 Electron 显示未在本机验证；已加入只在 Windows 运行的原生探针编译 / 协议测试，等待 Windows 环境运行。
- 未实际开启摄像头、切换系统专注、建立镜像投屏或向会议参与者共享画面；各会议软件版本、不同语言、外接 / 虚拟摄像头，以及 Pome 镜子与其他应用同时使用同一摄像头的实际行为仍需真机回归。
- 未替换已安装应用，未执行 macOS / Windows 安装包构建或签名产物验证。
