# macOS 输入法候选词遮挡修复验收

日期：2026-11-02。基线：dev `eac1649`。仅调整窗口行为与测试，没有修改页面布局或 CSS。

## 已确认与修复

隔离 Electron 工作台中调用系统简体拼音，实际输入 `nihao`。系统候选窗由 Electron 自身进程拥有，CGWindow 层级为 20；原面板 `status` 为 25，会遮挡候选窗。修复后，展开且输入框有焦点时使用 `floating`，实测层级为 3，候选词完整显示，按空格成功提交“你好”。输入框失焦和面板收起恢复原层级；`alwaysOnTop` 与跨桌面/全屏可见设置保留。

权限协调器在最后一个请求完成时重新计算当前编辑层级，避免权限提示关闭后错误恢复为 status。来自其他窗口或子 frame 的输入焦点 IPC 不予接受。

## 验证

- Node：1,071 项，1,070 通过、1 项 Windows 专属跳过，0 失败。最初沙箱执行因回环监听 `EPERM` 失败，允许回环监听的环境重新完整执行通过。
- Electron：`typing-layer`、`clipboard-generation`、`desktop-shell`、`workbench`、`notification` 通过。覆盖真实输入框焦点、composition、权限恢复、收起/重开、托盘与通知原有行为。
- 本机原生拼音：CGEvent 按键进入系统输入法，候选窗位于编辑面板上方，真实空格选词提交中文；结束后恢复原先的输入法选择。截图已在对话展示，随后删除，不提交图片。
- 原生全屏 Space：自建 Cocoa 窗口进入全屏后运行真实拼音路径，确认全屏窗口仍在当前屏幕、面板与候选窗同时可见，空格选词成功，结束后关闭测试窗口。首次辅助窗口的 6 秒等待不足，放宽到 12 秒后通过；未修改产品转场或系统设置。
- 十语言资源检查、修改文件语法检查与 `git diff --check` 通过。

`tests/typing-layer.electron.js` 默认进行可重复的 Electron 回归；显式提供 `POME_IME_NATIVE_HELPER` 才运行系统输入法路径。辅助程序源码在 `tests/fixtures/ime-probe.swift`，只操作测试按键、临时输入法选择及窗口元数据，测试恢复原选择。`POME_IME_SHOTS` 可临时输出测试区域截图；图片不应留在仓库。

## 边界

此次未打包、未替换 `/Applications/Pome Panel.app`；代码修复不会自动改变已运行的旧安装版。未验证 Windows 真实输入法及第三方 macOS 输入法。本次执行为完整 Node 测试与相关 Electron 回归，不宣称已经重新运行全部 Electron 清单。
