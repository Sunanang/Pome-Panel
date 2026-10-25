# 追加检查与清理 · 2026-10-25

本轮在 `dev` 的现有工作树上继续检查，保留前次风效、数据安全、NAS 修复及官网删除。未提交、推送、打包或修改 `main`。

## 确认问题与修复

- 录音没有 `audioPath` 时，原先直接退出加载函数，详情一直显示“加载中”；现在展示已有的本地化“音频文件不可用”。读取拒绝、空文件同样回退；浏览器解码失败也释放媒体并展示此状态。
- 详情重建、切换或删除录音时，旧媒体元素可能继续持有音频，最后一个 Blob URL 也会驻留至窗口退出；现在在重建前暂停、清空媒体源并撤销 URL。请求代次检查防止异步旧结果影响当前播放器。
- 播放时离开录制页、收起或文档隐藏，原先仍可播放；现在暂停，返回后可手动继续。录音采集流程未改动。
- 当前窗口长按拖到移除区后收到 `pointercancel`，原先走与 `pointerup` 相同的保存隐藏路径；现在取消仅清理拖拽。开始收起也立即取消，正常松手移除仍有效。
- 截图确认音频状态使用 `--text-4` 太暗，改为现有 `--text-2`。

## 确认无调用后删除

| 位置 | 删除内容 |
| --- | --- |
| `renderer/app.js` | `ordersEqual`、`applyHomeOrder` 两个旧布局助手；未调用的 `replayMirrorPixelReveal` 和其专用元素引用 |
| `renderer/index.html`、`renderer/styles.css` | 未触发的镜子像素动画节点、样式及关键帧 |
| `main.js` | 未使用的 `COLLAPSED_WIDTH`、`toggleVisibility` 和拖拽中未读取的 `tentative` 对象 |

官网代码和资源已在上一轮按要求整套删除，本轮确认不会由本地化生成器重新创建。

剩余资源扫描同时核对固定引用与动态路径：`Sun.skyAsset()` 使用天气天空横/纵版本，番茄钟按尺寸拼接背景路径；NAS `app/ui/config` 的 `images/icon_{0}.png` 是平台尺寸占位规则。以上图片、通知 SVG 符号集、图标许可证和 NAS 内置同步协议副本继续保留。没有仅凭文本检索“零引用”删除动态资源。

## 验收路径

- 新增 `tests/recording-playback.test.js`：无路径、读取拒绝、空数据、同一录音的新旧请求乱序、释放幂等、移除/退出后旧请求、解码失败。
- 新增并纳入 `npm test` 的 `tests/workspace-lifecycle.electron.js`：真实 Electron 渲染器中注入隔离音频与窗口数据，验证失败空态、有效 WAV 解码播放、切页/收起暂停、删除释放、取消拖拽不持久化及正常松手仍能移除。
- 截图：`screenshots/cleanup-2026-10-25/recording-unavailable.png`、`recording-ready.png`、`window-drag-cancelled.png`。

验证结果：

- `npm test` 完整通过：全量 Node 测试、43 次 Electron 调用和 118 项语法检查；本地化资源一致性通过。日志：`/private/tmp/pome-cleanup-full.log`。
- 最后补充解码失败与正常松手场景后，再跑全量 Node：931 项，930 通过、1 项 Windows 平台跳过、0 失败。日志：`/private/tmp/pome-cleanup-final-node.log`。
- 最终 `workspace-lifecycle.electron.js` 复验通过，截图已更新。日志：`/private/tmp/pome-cleanup-final-electron.log`。
- `git diff --check` 通过；确认 `website/` 和 Pages 部署工作流未重新出现。

本轮没有使用真实麦克风、实际辅助功能窗口操作、Windows 真机或真实 NAS 部署；上述媒体和窗口回归使用隔离固定数据。截图验证实际渲染，不能单独证明全部动态生命周期，相关断言由 Electron 回归覆盖。
