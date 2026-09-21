# G0 真机探测清单 — health / me / auth-probe 矩阵

> **状态：🔴 未跑（真机门禁）**  
> Agent **不能**代替用户在 x86 飞牛 NAS 上执行。本文件 + `scripts/nas-sync-g0-probe.js` 仅备好步骤与归档模板。  
> **禁止**根据桌面 `npm test` 绿宣称 G0 / FN Connect / frp / Bearer 已通。

决策与门禁：Project store `docs/nas-sync-verification-gate.md` §5、`docs/nas-sync-p0-tasks.md` §0。

---

## 1. 前置

| 项 | 填写 |
| --- | --- |
| fnOS 版本 | |
| 架构 | x86_64（必须） |
| FPK 是否已装最小探测包（health/me/auth-probe） | ⬜ |
| appPath / Unix socket | |
| 设备同步 TCP 端口（若测） | **不写死**；记实际值 |
| Node / SQLite 形态（FPK 内） | |
| 网关 body/超时/并发上限 | |

---

## 2. 通道 × 会话 × token 矩阵

对每个通道各跑一遍：`lan`（局域网统一网关）/ `fnconnect` / `frp`。

| # | 通道 | 会话 | Bearer | 预期 | 命令骨架 | 归档文件 | 判定 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | lan | web-logged-in | 无 | `me=200`，uid 正确 | `node scripts/nas-sync-g0-probe.js --base-url … --channel lan --session web-logged-in --cookie '…' --out internal/nas-sync-g0/<date>/` | | ⬜ |
| 2 | lan | web-anonymous | 无 | `me=401/403` | `… --session web-anonymous --out …` | | ⬜ |
| 3 | lan | desktop-no-cookie | 有效 token | `auth-probe=200`，uid=token 归属；**不回显 token** | `… --session desktop-no-cookie --token … --out …` | | ⬜ |
| 4 | lan | desktop-no-cookie | 无 | `auth-probe=401` | `… --session desktop-no-cookie --out …` | | ⬜ |
| 5 | lan | desktop-invalid-token | 无效/吊销 | `auth-probe=401` | `… --session desktop-invalid-token --token … --out …` | | ⬜ |
| 6 | lan | web-logged-in-cross-uid-token | 另一 uid token | 不得跨 uid | `… --session web-logged-in-cross-uid-token --cookie … --token … --out …` | | ⬜ |
| 7–12 | fnconnect | （同上 1–6） | | | 换 `--channel fnconnect` + FN Connect URL | | ⬜ |
| 13–18 | frp | （同上 1–6） | | | 换 `--channel frp` + frp URL | | ⬜ |

**成功口径**：身份隔离 + Authorization 是否到达应用层。  
**不是**成功：仅 `health=200`。

脚本退出码默认不因判定失败而非零（便于归档）；用户复核后可用 `--strict`。

---

## 3. 额外真机项

| 项 | 步骤 | 归档 | 状态 |
| --- | --- | --- | --- |
| Authorization 是否被网关剥除 | 对比 auth-probe `tokenAccepted` / uid | | ⬜ |
| `X-Trim-*`：网关仅 socket 可信；设备端口永不信 | 伪造头探测 | | ⬜ |
| FPK 自定义 TCP 端口可行性 | 监听非写死端口；升级后是否稳定；防火墙 | | ⬜ |
| 不可行时 | 记 `device_port_blocked`；走决策 §9 备选 | | ⬜ |
| FN Connect 强制 Cookie 导致无 Cookie 桌面不可达 | 记 `gateway_bearer_blocked`；**不得宣称**桌面同步支持 | | ⬜ |
| 真证书错误 | 自签/过期 → 桌面报证书错误且不转移（桌面自动化已测；真机补一例） | | ⬜ |

---

## 4. 归档模板

建议路径（本机或 Project store）：

```text
internal/nas-sync-g0/<YYYY-MM-DD>/
  README.md          # fnOS 版本、通道、结论摘要（脱敏）
  probe-lan-*.json   # 脚本输出（已 redact）
  probe-fnconnect-*.json
  probe-frp-*.json
  notes.md           # 人工观察：Authorization / X-Trim / 端口
```

脱敏：Authorization、pairing code、Cookie、deviceToken 一律打码。

---

## 5. 宣称边界（写死）

| 证据 | 可说 | 不可说 |
| --- | --- | --- |
| 仅有本清单 + 脚本 | 「G0 探测材料已备好」 | 「G0 已通过」 |
| 用户未回传归档 | — | 「FN Connect / frp / Bearer 已支持」 |
| `npm test` 全绿 | 「桌面自动化门禁绿」 | 「NAS 真机同步可用」 |

```
G0 状态：🔴 未做（真机门禁；agent 不可代替用户 NAS）
```
