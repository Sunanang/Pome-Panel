# 当前窗口：跨显示器与桌面空间修复

日期：2026-10-30（Asia/Shanghai）。基线：`dev` / `070cf911038ce31b2921b99cb6fb52d14f64884d` 加本次修改。保留当前 UI；没有修改 CSS，也未打包或替换安装应用。

## 已确认的原因

原实现只读取应用的 `AXWindows`，每次刷新据此重建缓存。代码没有按显示器坐标过滤，但 `AXWindows` 会省略其他 Mission Control 桌面及全屏空间的窗口。该限制也见 [Hammerspoon 的原生窗口接口说明](https://www.hammerspoon.org/docs/hs.window.html)及 [AltTab 的 AX 接口说明](https://github.com/lwouis/alt-tab-macos/blob/master/src/macos/api-wrappers/AXUIElement.swift)。

真实复现：创建两个自有 AppKit 标准窗口 A/B，把 B 放进全屏 Space 后，直接查询 `AXWindows` 仅返回 1 个窗口。修复后仍返回 A/B 两个；新建枚举器、不借用先前缓存，也能发现另一个桌面的 A。因此已确认跨桌面漏项，而非根据用户描述猜测原因。

当前测试机只有一块实体显示器。其他显示器的负坐标、上方屏幕及非当前可见窗口使用受控原生 API 响应验证；未声称已经完成实体多屏验收，也不能据此排除用户机器上的其他因素。

## 修复行为

- 合并普通 AX 清单、聚焦窗口和主窗口；通过所有桌面的 CoreGraphics 清单提供候选，不按屏幕坐标、on-screen、标题可读性或透明度排除窗口。Apple 对 `optionAll` 的定义包含屏幕内及屏幕外窗口，见 [官方说明](https://developer.apple.com/documentation/coregraphics/cgwindowlistoption/optionall)。
- 候选必须重新获得真实 AX 元素，并同时满足 `AXWindow` / `AXStandardWindow`。图形表中的工具栏、辅助表面和窗口子元素不会仅因拥有窗口编号就进入列表。
- 跨桌面使用 `_AXUIElementCreateWithRemoteToken`、`_AXUIElementGetWindow` 兼容接口。保留已解析的元素位置，复用前重新验证窗口编号、AX 身份和角色；真正关闭的窗口不会因缓存而继续显示。
- 对长运行应用采用有进度的限时发现。整体补扫预算 2.2 秒、单应用 140ms，保留主扫描游标；新窗口出现在已扫过的 ID 段时补扫低段，避免漏掉新窗口或反复从零导致高 ID 饥饿。哈希推导只作位置提示，必须通过 `CFEqual` 往返验证，失败则走正常扫描。
- 不变清单的额外搜索冷却 15 秒，普通刷新仍复核已解析窗口；用户手动刷新立即进行下一段有上限的补扫。窗口数量很大或元素 ID 稀疏时，清单可能逐步补全。
- 点击仍只接受主进程最近扫描缓存里的 ID；同时校验 AX 身份和系统窗口编号，再执行既有 AX 聚焦及结果校验。关闭、身份错配和伪造 ID 不会转向同名或前台窗口。
- 非公开兼容接口不可用时保留普通 AX 功能；子进程失败则尝试公共 AX 路径并冷却 30 秒后再试，手动刷新可提前重试。不请求屏幕录制权限，不修改系统辅助功能设置。

## 验证结果

- 全部 Node 回归：1,051 项，1,050 通过、1 项 Windows 专属跳过、0 失败。覆盖负显示器坐标、非当前 Space、全屏、辅助表面排除、缓存复核/删除、错误身份拒绝、接口不可用、哈希方式变化、高 ID 续扫、新低 ID 窗口及手动刷新。
- `tests/windows-native.electron.js`：9 个真实自建窗口准确枚举，5 个终端夹具与两个同名窗口保持独立，隐藏辅助窗口排除；A/B 聚焦、重命名、最小化恢复、关闭和伪造 ID 拒绝通过。本次无需开启测试进程的辅助功能树。
- `tests/windows-widget.electron.js`：8/22 条目、A/B 点击、同名窗口单独隐藏与恢复、滚动/焦点保留、失败修复、语言和小尺寸通过；新增断言确认手动刷新标记从页面经 preload 到达主进程。非工作区页面的 IPC 访问仍被拒绝。
- `npm run check:windows-spaces`：自建 AppKit A/B、真实全屏 Space、已有缓存和冷启动发现、跨 Space 双向聚焦、退出全屏后身份稳定及关闭引用拒绝通过。每次聚焦既检查 key window，也确认目标编号进入系统屏幕可见窗口表，避免仅焦点记录变化而桌面未切换。
- 真实原生检查只创建、聚焦、全屏切换和关闭自己的夹具窗口；退出时恢复桌面并删除临时程序/资料。不调用 `setAccessibilitySupportEnabled`，不修改其他应用。
- 十语言资源检查、修改及新增 JavaScript 文件语法检查、`git diff --check` 通过。真实 Codex/Claude/Cursor 四份配置前后哈希一致。
- 对话展示了自建全屏 B 和窗口组件的合成数据截图；按用户要求清理截图，不提交图片，仅保留本目录文字及自建夹具断言 JSON。

原生扫描耗时（本机、仅作此次记录）：普通冷扫描 2,226ms，全屏已有缓存 505ms，全屏冷扫描 2,352ms，退出全屏后 542ms。该数据包括整个系统窗口查询，不是面板展开耗时，也不代表其他硬件性能。

## 可重复检查与限制

`npm run check:windows-spaces` 为显式原生验收命令，需要交互式 macOS、已授予的辅助功能权限及 Xcode CLI 工具。它只编译测试用 AppKit 程序，不打包产品；没有条件时明确失败，不以跳过冒充通过。测试源在 `tests/windows-spaces.native.cjs` 和 `tests/fixtures/windows-spaces.swift`，默认不保留截图或临时程序。常规 `npm test` 自动执行受控发现回归，并检查原生验收脚本语法，不在 CI 自动切换桌面。

仍未验收：多个实体显示器、所有第三方应用的各自行为，以及其他 macOS 版本。非公开接口可能随系统变化，因此保留检测、公共 AX 回退和失效重试；无法保证任何环境都能立即穷举所有元素。没有新增生产依赖、原生产品构建步骤或系统权限。
