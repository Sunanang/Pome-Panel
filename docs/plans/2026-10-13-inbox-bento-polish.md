# AI 完成模块问题修复与验证

2026-10-13，Mac mini `/Users/lando/coding/Pome-Panel`，main 原地修改，未提交、未推送、未打包。范围仅收件箱前端与首页布局，不改变后端或来源支持。

## 修复结果

- B1：保留最近的结构化错误与可恢复标记。冷启动损坏直接显示重建按钮；错误事件之后 IPC 又拒绝时，也不丢失恢复信息。
- B2：前端损坏状态与 toast 改为首页模块文案，不再引导打开旧弹窗。
- B3：角标移到文字右上外侧，选中首页时隐藏；真实 9+ 几何断言验证没有覆盖文字。
- B4：模块关闭时，其他页有未读/异常就显示小点，点击聚焦设置的 AI 完成开关。选中首页仍隐藏。
- B5：关闭保留其他模块的位置与尺寸。原位置独立缓存在本机 `notch-home-inbox-slot-v1`，不混进活动布局；重启后开启优先复用空位，空间不足只缩小收件箱，完全放不下则保持关闭并返回现有布局失败提示。原位置冲突时不挪动其他卡片。
- B6：失败时隐藏全部已读，读取恢复后恢复入口。

中号改为五条、38px 行高；小号恢复全部已读及最新来源/时间。时间、未读标签与保留规则使用 text-3/caption，标题提供完整 title 悬停；错误提示红色降饱和，重建按钮保持明显。

## 本轮改动文件

- UI：`renderer/task-inbox.js`、`renderer/app.js`、`renderer/domain.js`、`renderer/styles.css`。
- 新增测试：`tests/inbox-corrupt-startup.electron.js`。
- 补充/适配测试：`tests/inbox-bento.electron.js`、`tests/inbox-bento-layout.test.js`、`tests/work-hub.electron.js`。
- 测试入口：`scripts/test-desktop.js`。
- 文档：`README.md`、`CHANGELOG.md`、`design-qa.md`、本文。

`renderer/index.html` 无需改动；角标通过样式修复。后端 `taskInbox.js`、`main.js`、`preload.js` 的修改前后 SHA-256 相同。保留仓库先前未提交修改。

## 新增回归

- 独立生产冷启动损坏场景，验证重建按钮立即可见、拒绝 IPC 后恢复标记仍在、取消不清空、确认备份原文并重建。
- B3：选中首页时隐藏；其他页 9+ 边界不与标题相交。
- B4：关闭模块显示小点，点击仍进入设置并聚焦开关。
- B5：关闭后实际重载页面再开启，所有模块的尺寸和位置与关闭前深比较完全一致。
- 两个新增纯布局测试验证记忆位置优先及空位不足时仅收件箱降级；同时检查小号全部已读/来源时间、标题 title、B2 和 B6。

## 测试结果

- `npm test`：557 个单元测试，556 通过、1 跳过、0 失败；11 个 Electron 夹具、2 次进程重启及全部语法检查通过。
- `npm run check:work-hub`：普通 20 次 P95 **233.86ms**，后台同步 20 次 P95 **249.57ms**，低于 300ms；45 次展开收起（含预热）几何稳定，无诊断失败。
- `git diff --check` 通过。后端哈希验证通过。新冷启动测试中打印的 `fixture_transport_rejection` 是有意注入的错误，用于回归 B1，并非产品检查失败。

完整日志和后端哈希：`dist.noindex/inbox-bento/validation/polish/`。
原始性能留档：`dist.noindex/iteration-validation/2026-10-13T09-19-25-235Z/`，含 environment.json、fixture.json、samples.json、geometry.json、NAS 结果和运行日志。
截图和合成对照：`dist.noindex/inbox-bento/`，新增 cold-start-corrupt.png、notes-9plus-badge.png；四尺寸、空态、损坏、详情等截图已重捕获。

## 与设计稿的差异

本轮按新要求将设计稿中号三条改为五条；首页选中时隐藏角标，模块关闭用小点。关闭模块保留空位以维持其他模块位置，不自动填大其他卡片。

仍使用实际 Codex / Claude / GPT 来源与本地品牌图标；不新增 Cursor。摘要沿用已有项目/窗口信息，列表数量、标题、时间和当前窗口均为实际/测试数据，不固定成设计稿样例。Windows 真机与实体多屏/DPI 未在本轮验证。
