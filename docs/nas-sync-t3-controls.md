# T3 交互控件清单（配对 / 设备）

| 控件 ID | 文案 / 位置 | 操作 | 必测维度 | 风格验收用例 | 用例文件 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| `pair.code-input` | 设置→NAS 同步→配对码 | 输入 / Enter | 空/非法/合法 | S1/S3 | `tests/ui-pair.test.js` | ✅ |
| `pair.submit` | 「配对」 | 点击 | 成功/失败/禁用 | S3 `workspace-button.primary` | `tests/ui-pair.test.js` | ✅ |
| `pair.http-extra-confirm` | HTTP 额外确认 | 确认/取消 | 必出；取消不 claim | S3 dialog | `tests/ui-pair.test.js` | ✅ |
| `pair.reauth` | 「吊销令牌并重新配对」 | 确认/取消 | 清除绑定 | S3 | `tests/ui-pair.test.js` | ✅ |
| `devices.list` | 已配对设备列表 | 展示 | insecureBound 徽标 | S1 `--accent-orange` | `tests/ui-devices.test.js` | ✅ |
| `devices.revoke` | 「吊销」 | 确认/取消 | 令牌失效 | S3 | `tests/ui-devices.test.js` | ✅ |

自动化安全：`tests/fnos-pairing.test.js`、`tests/sync-credentials.test.js`
