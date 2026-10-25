# 深度逻辑复查 · 2026-10-25

在 `dev` 当前工作树继续复查主进程持久化、同步迁移与恢复、编辑草稿、剪贴板轮询和待处理提醒。保留前次天气、录音、NAS 修复及官网删除，未提交、推送、打包或更改 `main`。

## 已复现并修复

| 问题与触发条件 | 修复 | 回归证据 |
| --- | --- | --- |
| 本机权威首次迁移只投影 P0–P3，P4–P7 在界面消失 | 复用八列标准投影，删除四列专用助手 | `sync-migration.test.js`，真实主进程/NAS 首次迁移 Electron |
| NAS 同一待办多次修改后，首次迁移把增量历史当当前内容；历史压缩后无法起拉，40 页上限还会静默截断 | 改为全九集合、同一修订的冻结完整快照；分页失败关闭 | `migration-snapshot.test.js`，Electron 的 P7 多修订只保留最新一条 |
| 账号密钥请求等待时解绑或重绑，旧响应可能写回旧凭据 | 请求前后核对服务/用户/设备/token/绑定时间，合并当前设置，并发响应复用已保存密钥 | `sync-key-races.test.js` |
| 链接元数据晚到覆盖已保存标题、手动分组或正在输入的重命名 | 核对初始标题与分组；编辑/拖拽期间延迟刷新 DOM | `metadata-races.test.js` / Electron |
| 自动笔记标题晚到重建正文编辑框，丢失去抖等待中的输入；旧笔记回复误更新当前标题 | 先提交待存正文，再比较内容；只更新对应笔记展示，不重建编辑器 | 同上 |
| 密钥 A/B 读取乱序，或旧保存返回时已进入新编辑，会覆盖/关闭当前草稿 | 编辑代次、请求身份、保存集合及列表读取代次；取消、删除、离页、收起使旧请求失效；保存期间继续输入保留为草稿 | `credential-editor-races.test.js`，Electron A/B 乱序及旧保存/取消/离页 |
| 关闭再开启剪贴板后，旧读取或图片写入会混入新历史、覆盖新基线；旧 finally 可错误释放新任务锁 | 启停代次、工作区及窗口所有权检查；新周期重置锁，旧 finally 仅释放同代锁；图片使用独占创建，只清理本任务未发布文件，成功后提交指纹 | `clipboard-generation.test.js`，真实主进程启停 Electron |
| 媒体授权结束把正常 floating 面板恢复到 screen-saver 层级 | 恢复与主窗口一致的 floating 层 | 主进程服务单测；真实 IPC + 模拟权限返回的 Electron |
| 重置停靠位置保存失败仍返回成功 | 写入失败即返回 false，不重定位；界面持久错误提示及重试 | `security-recovery.electron.js`、剪贴板/设置 Electron |
| 待处理提醒的隐藏/断开写入已 rename、后续刷盘报错，内存持有旧字节，后续永久 storage_changed | 所有 commit 仅在磁盘精确等于本次字节时跟进内存状态，仍向本次操作报告写入异常 | `ai-attention.test.js`（修复前两项失败），实际 HTTP/IPC/提醒窗口重试 Electron |
| 重复确认备份恢复/NAS 恢复，在首个 await 前未持有工作区锁，两个操作可同时进入 | 首个异步读之前持锁；忙时拒绝第二次确认；文件夹选择在对话框返回后复核锁及源路径 | `workspace-operation-lock.test.js`（修复前两项失败）；`work-hub-nas.electron.js` 同时发送两次真实 IPC 并验证恢复/回滚 |

## 改动与验收路径

核心文件：`main.js`、`main-services.js`、`sync-migration.js`、`aiAttentionStore.js`、`renderer/app.js`、`renderer/workspace.js`。新增 Node 回归自动由 `npm test` 收集；新增 `metadata-races`、`migration-integrity`、`clipboard-generation` Electron 场景已纳入桌面总检查。

截图位于 `screenshots/deep-logic-2026-10-25/`：

- `metadata/link-rename-preserved.png`：元数据返回后，已保存标题与当前输入仍保留。
- `metadata/note-draft-preserved.png`：旧正文的标题回复不会重建或覆盖刚输入的正文。
- `metadata/credential-latest-edit-preserved.png`：B 的旧保存返回后，A 的新编辑草稿仍在。
- `migration/migration-local-eight-columns*.png`：本机权威八列迁移。
- `migration/migration-nas-current-snapshot*.png`：NAS 权威最新快照，上下滚动帧覆盖八列和 P7 最新内容。
- `clipboard/clipboard-current-generation.png`：只有新周期的有效文本进入历史。
- `clipboard/panel-reset-write-failure.png`：写盘失败可见提示与修复入口。
- `attention/display-retry-after-write-error.png`：提醒存储写入异常后仍能重新打开待处理。

## 验证边界

NAS 使用回环地址、隔离身份和固定数据；密钥、剪贴板、媒体权限使用假数据/模拟返回，没有读取真实密钥、系统剪贴板或申请真实媒体权限。未进行 Windows 真机、真实 NAS 安装/部署、真实 AI 账号或长期内存/GPU 压测。模拟权限验证 IPC 和层级调用，不代表真实系统权限弹窗已人工验收。

此前一次 Electron 启动曾因自动审批服务额度错误未执行；用户要求继续后重试已恢复，相关 Electron 场景随后实际通过。

## 最终结果

- `npm test` 完整通过：964 项 Node 测试（963 通过、1 项平台跳过），46 次 Electron 调用、118 项语法检查及本地化一致性。日志：`/private/tmp/pome-deep-full.log`。
- 最后增加恢复互斥三项用例后，全量 Node 再跑：967 项，966 通过、1 项平台跳过、0 失败。日志：`/private/tmp/pome-deep-final-node.log`。
- 完整 Electron 期间已验证重复恢复确认仅执行一次，恢复/回滚成功。最终迁移上下滚动截图和设置错误重试补验通过：`/private/tmp/pome-deep-final-electron.log`。
- `git diff --check`、`npm run i18n:check` 通过；当前分支仍为 `dev`。

本轮修复覆盖已复现的问题及上述边界，不把测试通过视为不存在其他缺陷的证明。
