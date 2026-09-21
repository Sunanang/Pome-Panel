# T6 交互控件清单（NAS 同步设置 / endpoint / HTTP 开关）

依据：verification-gate 附录 A.1–A.3 / A.6；决策 §8 / §8.1–8.3 / §9 / §11 / §13.5–13.6。

| 控件 ID | 文案 / 位置 | 操作 | 必测维度 | 风格验收用例 | 用例文件 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| `settings.nas-sync.tab` | 设置 → NAS 同步卡片 | 进入面板 | 可见；无绑定空态 | S3/S4 `#tab-settings` / `tile settings-card` | `tests/ui-nas-sync-settings.test.js` | ✅ |
| `settings.nas-sync.status-bar` | 状态条 | 展示各态 | 未绑定/迁移中/同步中/已同步/离线待传/需重新认证/schema 不兼容/迁移失败/证书错误/endpoint 已停用 | S1 token 色 | `tests/ui-nas-sync-status.test.js` | ✅ |
| `settings.nas-sync.retry` | 「重试」 | 点击 | 启用成功/失败；禁用态 | S3 `workspace-button` | `tests/ui-nas-sync-status.test.js` | ✅ |
| `settings.nas-sync.export-backup` | 「导出备份」 | 点击 → dialog | 成功/取消/失败 | S3 + toast | `tests/ui-nas-sync-backup.test.js` | ✅ |
| `settings.nas-sync.restore-backup` | 「恢复上次迁移备份」 | 二次确认 | 确认/取消 | S3 dialog | `tests/ui-nas-sync-backup.test.js` | ✅ |
| `settings.nas-sync.http-warning` | HTTP 持续警告 | 展示 | 开可见、关隐藏、回环免 | S1 `--accent-orange` | `tests/ui-nas-sync-http-toggle.test.js` | ✅ |
| `endpoint.add` | 「添加 endpoint」 | 点击 | 成功/失败 | S3 | `tests/ui-endpoint-editor.test.js` | ✅ |
| `endpoint.baseUrl` | Base URL | 输入/Enter | 空/非法/合法；改 URL 重置 HTTP | S1/S3 input | `tests/ui-endpoint-editor.test.js` | ✅ |
| `endpoint.edit` | 「用作当前」 | 点击 | 合法保存 | S3 | `tests/ui-endpoint-editor.test.js` | ✅ |
| `endpoint.delete` | 「删除」 | 确认/取消 | 确认删/取消保留 | S3 dialog | `tests/ui-endpoint-editor.test.js` | ✅ |
| `endpoint.enable` | 启停 | 切换 | `disabledByPolicy` 不可盲目启用 | S3 | `tests/ui-endpoint-editor.test.js` | ✅ |
| `endpoint.reorder` | 上移/下移 | 点击 | 顺序持久化；边界 | S3 | `tests/ui-endpoint-editor.test.js` | ✅ |
| `endpoint.test-connection` | 「测试连接」 | 点击 | 成功/失败/进行中禁用 | S3 | `tests/ui-endpoint-editor.test.js` | ✅ |
| `endpoint.kind-device-port` | device-port 行 | 展示/编辑 | 与网关同表并存 | S3/S6 无第二套皮肤 | `tests/ui-endpoint-editor.test.js` | ✅ |
| `endpoint.allowInsecureHttp` | 「允许明文 HTTP」 | 开/关 | 默认关；确认；关闭→disabledByPolicy；不改写 https | S3 开关同构 | `tests/ui-nas-sync-http-toggle.test.js` | ✅ |
| `endpoint.allowInsecureHttp.confirm` | HTTP 确认框 | 确认/取消 | 窃听/篡改文案 | S3 dialog | `tests/ui-nas-sync-http-toggle.test.js` | ✅ |
| `endpoint.allowInsecureHttp.loopback` | 回环 | 免开关 | 127/::1/localhost | 逻辑 N/A | `tests/ui-nas-sync-http-toggle.test.js` | ✅ |
| `devices.list` / `devices.revoke` | 设备列表（既有 T3） | 展示/吊销 | insecureBound 徽标 | S1/S3 | `tests/ui-devices.test.js` | ✅ |

**风格验收**：S1–S6 覆盖于上表用例；新增 CSS 仅扩展既有 token，无新主色/字体栈。  
**§8.3 静态禁扫**：`tests/sync-tls-ban.test.js` ✅  
**真机门禁**：FN Connect / frp / 真证书错误 → 未跑；**不宣称 G0 / 选路真机可用**。
