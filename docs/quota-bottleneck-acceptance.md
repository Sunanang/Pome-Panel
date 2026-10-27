# 额度瓶颈与刷新动画验收（2026-10-21）

## 行为

- 主数字、环长：最短已报告窗口；颜色、紧急排序、过期：所有有界窗口的最小剩余瓶颈。
- 用完 > 告急（≤10%）> 偏低（≤20%）> 正常。mini/small 排紧急度，medium/large 保留设置顺序。
- 长周期低额度显示窗口名、百分比与真实重置时间。缺失或仅有日期的瓶颈数据不编造时分；Cursor 同周期 Auto/Other 不加角标。
- small 两行 9.5px 说明；medium 单行说明及窗口条；large 保留完整说明。medium 超过 6 家内部滚动，模型多时明细内部滚动。
- mini 只显示灰/红/橙状态点，并总结多家用完、全部用完、用完与告急并存、多家告急；汇总覆盖折叠来源。
- 展示时先渲染保留数据并后台查询，30 秒内重复展示不重复请求。手动刷新立即查询。失败保留成功值及其时间戳，仍展示认证失效状态。
- 720ms ease-out 数值/环同步，窗口条按 60ms 错开；颜色同步渐变，状态文案只在等级变化时淡入淡出。新数据从当前帧继续，同值/失败不启动新动画。缺失读数保持未知。减少动态效果直接切换。
- 环长使用完整 dasharray 与 dashoffset，条宽用 scaleX，数字等宽；用完变灰和划线在状态过渡后应用。

## 参考图

已逐张读取总览、mini、small、medium、large 与 mini 边界图。图中的示意时间未用于实现；验收夹具使用独立的未来时间，真实应用使用接口/本机记录。

- [设计文件夹](https://drive.google.com/drive/folders/1TfJSkqEXjpY0FPFDD1cKHH2-94iBREwg)
- [总览](https://drive.google.com/file/d/1Uq6HhBeekKbsc3veGqMeXgP6l73qLkLE/view)
- [mini](https://drive.google.com/file/d/1s5ucAMjUKOQ-MPkeAqgfTsicxO5hL6kM/view)
- [small](https://drive.google.com/file/d/12-rBCq3tKYFrDZVBnLXN0Un33ECNICWL/view)
- [medium](https://drive.google.com/file/d/1-Rn0tEvpAaFc9I455_A0WtI00rQuNd3Y/view)
- [large](https://drive.google.com/file/d/1oyby5zJYk2jt-_OtK4gPvCV5ugZVq0o7/view)
- [mini 边界](https://drive.google.com/file/d/1K_xwA7GM6atGGqR_UiJmxptDPC3bgiCB/view)

## 验证

- Node 专项覆盖：5h 100%/周 0%、各类 mini 摘要、无 resetAt、Cursor 同周期、起止值、相同值、失败、中途续接、减少动态效果、窗口条延迟、30 秒边界与未知读数。
- Electron `ai-usage`：四尺寸、各来源数量、错误/本地回退、金额积分、语言、长名称、多模型滚动、源内容转义。
- Electron `quota-refresh`：真实展开/收起、30 秒防抖、手动刷新、连续过渡、相同/失败、减少动态效果及四尺寸约束。
- Electron `startup` / `provider-credentials`：真实主进程的认证失败空记录保留旧值，凭据更新后等待动画终点，仍验证安全存储。
- 完整 `npm test`：exit 0；Node 844 pass / 0 fail / 1 skipped，30 次 Electron 检查及语法/i18n 检查完成。
- 准备提交的隔离副本：i18n 检查、54 项 Node 专项、startup / ai-usage / quota-refresh Electron 均通过，确认额度提交不依赖未提交的语言控件、NAS 或全局报错条修改。

## 截图与录屏

`QUOTA_REFRESH_EVIDENCE=<绝对路径> TODO_TEST_USER_DATA=<隔离目录> electron tests/quota-refresh.electron.js` 输出 `mini.png` / `small.png` / `medium.png` / `large.png`、`panel-refresh.webm`、录屏抽帧及帧时间。图片与视频留在验收产物目录，不纳入 Git。

对照已确认：主值仍为 5h，周 0% 不改成主值 0%；颜色、角标、灰环/划线与长周期说明准确；small 两行不裁切；medium/large 进度条独立标色；设置来源顺序和紧急排序不同；视频中唤出后保留缓存，拿到结果后连续过渡。

在 macOS Electron、隔离临时配置和接口夹具中验证。未打包、未推送、未修改 main；未做 Windows 真机或真实账号配额变动的网络端到端验证。
