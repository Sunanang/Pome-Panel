# T5b 交互控件清单（迁移四态 / 历史清空库）

| 控件 ID | 文案 / 位置 | 操作 | 必测维度 | 风格验收用例 | 用例文件 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| `migration.state-banner` | 待办顶「迁移中，稍候」 | 展示 + 只读 | 迁移窗只读；成功后可写 | S1 banner token | `tests/ui-migration.test.js` | ✅ |
| `migration.both-live.confirm` | 两边 live 确认 | 用本地 / 用 NAS / 取消 | live 数/serverRev；取消中止 | S3 dialog + `workspace-button` | `tests/ui-migration.test.js` | ✅ |
| `migration.history-empty.choice` | 恢复本地 / 保持 NAS 删除 | 强制二选一 | 禁止静默；两路径 | S3 | `tests/ui-migration.test.js` | ✅ |
| `migration.failed.retry` | 「重试迁移」 | 点击 | 成功/再失败 | S3 `workspace-button` | `tests/ui-migration.test.js` | ✅ |
| `migration.failed.restore` | 「恢复上次迁移备份」 | 确认/取消 | 二次确认；路径白名单 | S3 dialog | `tests/ui-migration.test.js` | ✅ |

自动化：`tests/sync-migration.test.js`（四态 / CAS / 回滚 / 备份白名单）
