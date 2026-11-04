# Codex notify 包装链修复验收

分支：`dev`。没有打包、推送或修改真实 Codex / Claude / Cursor 配置。

## 问题与行为

Computer Use 可把原来的 Pome notify 放进 `--previous-notify`。旧实现只检查顶层 Pome 标记，再次接入则把整条旧链编码进 `--pome-forward`，留下旧 Pome 层。

现在只遍历已识别的 Pome 与 Computer Use 协议。嵌套 Pome 显示配置异常、修复按钮和通知链提示；确认修复后只保留一个最外层 Pome，并继续转发其它原命令。清理时合并相邻、路径与其它参数完全相同的 Computer Use 包装；不同路径或参数不合并。没有 Pome 的原链及未知命令保持原样。

断开同样清理已识别的嵌套 Pome，不把旧 Pome 恢复回来。非法 JSON、非字符串命令数组、重复 previous-notify 参数或超过 16 层的链拒绝写入。保留预览、原文件备份、原子写入和预览后配置被修改时拒绝覆盖。

Codex 后续重启或更新仍可能再次改写 notify。本修复会在下次刷新接入状态时识别这种情况，不在后台与 Codex 反复争写配置。

## 已执行

- 通知链回归 8 项通过：macOS / Windows 配置路径、修复、再次被包装、重复修复不增加层数、断开、损坏及歧义配置不写入、普通命令中的字面量 Pome 标记不误拆、未知命令与未改动 JSON 保留，以及测试期间 Codex 改写配置时拒绝启动其它外层命令。
- Codex 脚本回归 5 项通过：大输入和长结果压缩到接收端可接受范围、原通知命令仍收到未经修改的 JSON、截断不误生成空 JSON 控制消息、Windows Base64 Unicode 载荷、过滤与防递归转发。
- 实际 Node 子进程执行修复后的脚本，使用不打开端口的传输替身确认投递一次；Computer Use 替身只调用一次，原通知命令收到原始 JSON 和原参数。
- 原接入相关回归 19 项通过。
- 收件箱、通知领域、AI 事件与本地化回归 59 项通过。
- 首页布局领域、平台几何与面板尺寸回归 88 项通过。本轮上述已执行回归合计 179 项通过，不包含真实 HTTP 监听和 Electron。
- JavaScript 语法、本地化生成资源、`git diff --check` 通过。
- 本轮深查清理重复通知链解析、未使用的预览 `existed` 字段、没有消费者的测试 stderr 管道；配置错误提示也在来源行展示具体原因。保留仍被调用的布局、状态缓存与测试辅助函数。
- 用户提供的 `666.jpg`：有问题的电脑手动 POST 返回 `queued` 且出现气泡，证明该电脑当时的接收、保存与气泡链路可用。它不是本次新代码的验收截图，也不能替代真实 Codex 完成验收。

## 待验与阻塞

本次真实 HTTP 端口回归与 Electron 截图未完成。自动审批服务因额度用尽拒绝了需要提升权限的测试命令，并未判定该命令不安全；没有绕过审批。深查时另在现有沙箱内尝试启动 `codex-notify-chain.electron.js`，Electron 启动即 `SIGABRT` 退出，未进入断言或截图路径。Windows 真机依旧待验。

已新增并注册 `tests/codex-notify-chain.electron.js`，验收路径包括：设置提示 → 修复预览不写入 → 确认修复 → 测试连接不生成历史 → 实际 Pome hook 向主进程投递 → 气泡和首页记录 → 断开保留 Computer Use。Computer Use 本体在该脚本中仅为配置替身；真实转发次数由 Node 回归验证。

在允许 Electron 与本机监听的环境运行：

```sh
test_profile=$(mktemp -d /tmp/pome-codex-chain-native-XXXXXX)
env -u ELECTRON_RUN_AS_NODE TODO_TEST_USER_DATA="$test_profile" ./node_modules/.bin/electron tests/codex-notify-chain.electron.js
```

成功后截图输出在 `dist.noindex/codex-notify-chain/`：

- `01-wrapped-needs-repair.png`
- `02-repaired-connected.png`
- `03-completion-bubble.png`
- `04-completion-history.png`

端口回归命令：`node --test tests/codex-notify-chain.test.js tests/ai-source-hooks.test.js`。本次已执行的是其中不监听端口的子集，不声称完整套件通过。

仍需在安装新代码的 macOS Codex 桌面 App 上修复接入、重开 Codex、刷新检查 notify 归属，再完成一次真实本机对话；若重新被包装，应显示修复提示，不能视为稳定接入。
