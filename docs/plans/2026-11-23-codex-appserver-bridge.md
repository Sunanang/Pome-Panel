# Codex 等待提醒：app-server 只读观察者

日期：2026-11-23。状态：实现已落地（默认关闭），待真实会话样本验收后做成设置项。
关联：[2026-10-18 通知事件方案](2026-10-18-ai-notification-events.md)、`codexAttentionBridge.js`、`scripts/codex-appserver-probe.js`。

## 1. 结论

Codex 的"等你输入 / 等你授权"**不能**从 notify 读出来（notify 只有 `agent-turn-complete`），也**不能**当成工具调用从 rollout JSONL 里读出来（本机 249 个会话文件里只有 `exec` 的 custom_tool_call）。可行路径是 app-server 协议里的**线程状态通知**：

- `thread/status/changed` 的 `status.activeFlags` 取值由权威 schema 定义为 `["waitingOnApproval", "waitingOnUserInput"]`。
- 这两面旗子就是"Codex 正在等人"的唯一权威信号，且是**广播型通知**，不需要成为驱动方。

## 2. 证据（本机实测与官方工具）

```sh
# Codex 自带 CLI（ChatGPT.app 内，0.167.0-alpha.3.2）
"/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex" app-server proxy --help
# → Proxy stdio bytes to the running app-server control socket（可带 --sock）

codex app-server generate-json-schema --experimental --out /tmp/codex-schema
# 生成 400+ 个 schema 文件；关键结论：
#   ThreadActiveFlag     = ["waitingOnApproval", "waitingOnUserInput"]
#   ServerNotification   = thread/status/changed、serverRequest/resolved、item/started、item/completed、turn/* …
#   ServerRequest        = item/tool/requestUserInput、item/{commandExecution,fileChange,permissions}/requestApproval、
#                          mcpServer/elicitation/request、applyPatchApproval、execCommandApproval …
#   ClientRequest        = initialize、initialized、thread/list、thread/read、thread/resume、turn/start …
#   ThreadItem 变体      = 没有 userInput 类 item（所以"等问题"只能靠状态旗子，不能靠 item）
```

本机当时 `app-server` daemon 未运行（`codex app-server daemon version` 报 control socket 不存在），所以**只完成了协议与握手的静态验收**，未取到真实会话样本。

## 3. 设计：只读观察者

`codexAttentionBridge.js`

- 传输：spawn `codex app-server proxy [--sock <path>]`，走 JSON-RPC 行协议。
- 握手：`initialize`（clientInfo 名 `pome-panel`）→ `initialized` → `thread/list {limit:50}`（只读，用于把 threadId 映射成项目名）。
- 只处理 `thread/status/changed`：
  - 出现 `waitingOnApproval` → `attention.required` / action `approve`
  - 出现 `waitingOnUserInput` → `attention.required` / action `input`
  - 旗子消失 → `attention.resolved`（reason `answered`）
  - 同一线程状态重复推送不重弹（本地 tracker 只发状态跃迁）。
- **请求键契约**：required 与 resolved 的 `requestId` 都是 `thread-status:<action>`，`sessionId/turnId` 都是 threadId；不一致就关不掉提醒（本轮已用「存储往返」用例钉住）。
- 事件走既有的 `classifyAiEvent` + `aiAttentionStore`，与 Claude 的等待提醒同一条链路。

## 4. 硬边界（不可越线）

1. **绝不回答服务端请求**：`item/tool/requestUserInput`、各种 `requestApproval` 是发给"驱动该线程的客户端"的请求。观察者收到只记日志并丢弃，绝不回复、绝不授权。测试里断言"收到请求后没有任何回写"。
2. **绝不 `thread/resume` / `turn/start`**：只用 `thread/list`（只读）与通知流，避免抢走用户会话或代跑回合。
3. **不读 UI、不猜内容**：问题文本拿不到就不显示；气泡只显示"Codex 等待你选择/授权"+ 项目名，不伪造问题摘要。
4. **daemon 不在就安静退出**：proxy 连接失败只记日志，不影响完成提醒。

## 5. 启用与验收

默认关闭，需显式打开（真实样本验收前不进设置界面）：

```sh
# 应用内开启（重启 Pome 生效）
POME_CODEX_APPSERVER=1 open -a "Pome Panel"
# 可选：指定 socket 或 codex 可执行文件
#   POME_CODEX_APPSERVER_SOCK=/path/to/app-server-control.sock
#   POME_CODEX_BINARY=/path/to/codex
```

诊断（Codex 正在等你的那一刻跑它，10~15 秒即可）：

```sh
node scripts/codex-appserver-probe.js --seconds 15
# 期望看到：[thread/status/changed] activeFlags=["waitingOnUserInput"]
```

验收判据：
1. probe 能连上 daemon 并收到 `thread/status/changed`；
2. 让 Codex 提问/请求授权时，Pome 顶部出现对应气泡，选择/批准后**自动撤下**；
3. 期间 Codex 端行为不变（没被代答、没被抢线程）；
4. `ps` 无残留 proxy 进程；关闭 Pome 后 proxy 一并退出。

## 6. 已知风险

- **抢占/并发**：daemon 允许多客户端，但线程归属策略未验证；若观察者被当成驱动方，必须立刻降级为只读模式（现状：观察者根本不做驱动动作）。
- **版本漂移**：`ThreadActiveFlag` 是实验性字段（`--experimental` 才导出）。升级 Codex 后必须重跑 schema 生成，取值变化即视为"能力失效"，回退到只支持完成提醒。
- **daemon 生命周期**：只有 Codex Desktop 启动过 daemon 才连得上；daemon 关闭时桥要能自愈重连（当前：退出后不再重试，下次启动 Pome 再连）。
