# 项目审计修复验收（2026-10-23）

分支：`dev`，起点 `0016a83`。本轮开始时工作区干净；未操作 `main`，未打包、发布或推送。

## 修复内容

- 恢复备份后覆盖 NAS：复用同步层的 `TODO_PRIORITIES`，完整收集 P0–P7 的待办与分类名。真实生产 IPC、临时 HTTP 伴侣和 SQLite 回归覆盖预览、暂停期间修改、八类覆盖、本地投影和八类回滚。
- 待办同步：按分类增量更新节点，保留新建草稿、手选日期和未提交分类名；重绘列表时保留正在编辑的文字、焦点与选区。远端删除正在编辑的待办时清除编辑状态。
- 日期弹窗：离开待办、开始收起、页面隐藏或分类结构变更时关闭；关联待办被删除时清除上下文。迁移只读期间不允许打开或写入。
- 时间列表：弹窗可见后定位选中小时和分钟，仅滚动对应列表，首次打开即可看到真实选中值。
- 日期编辑器保存时机：打开、关闭、重复选择当前值均不写盘或重新调度提醒；只在用户实际改变截止时间时保存。非 5 分钟整数倍的原始分钟（如 18:32）在列表中如实显示，相同分钟保留原始秒和毫秒；无截止时间的条目不会因打开编辑器而自动获得日期。
- 未设置截止时间的交互：显示「尚未设置 · 选择后生效」，日期和时分均不显示已选高亮。浏览月份、切换语言和无效选择不写入；主动选择有效日期、小时或分钟后保存一次，显示「已设置」及选中高亮。重新打开已有截止时间的条目不额外显示此提示。
- 本地化：动态待办控件、增删分类、默认新增分类名称和删除确认接入中英资源；保留用户保存或尚未提交的分类名称。
- 清理：额度标题测量合并到已有字体测量缓存，移除重复 Canvas 测量路径；删除无使用者的分类默认顺序导出和旧迷你色点 CSS；更新双语 README 与设置说明。
- 测试：更新委托 focusin 事件与额度更新时间/无原生 tooltip 断言；将新增待办回归加入 `npm test`。

## 改动文件

| 文件 | 用途 |
| --- | --- |
| `main.js` | 八类恢复数据收集 |
| `renderer/app.js` | 草稿保留、增量更新、日期弹窗、时间列表及动态控件文案 |
| `renderer/index.html` | 添加分类按钮本地化、截止时间设置状态提示 |
| `renderer/ai-usage.js` | 共用测量缓存 |
| `renderer/styles.css` | 移除重复迷你色点规则、日期编辑器状态提示样式 |
| `sync-store.js` | 删除未使用导出 |
| `localization/locales/{zh-CN,en-US}.json` | 中英分类与确认文案 |
| `localization/resources.js`、`fnos/app/ui/i18n/resources.js` | 重新生成资源 |
| `scripts/test-desktop.js` | 接入待办回归 |
| `tests/{notch-focus,startup,todo-board-fixes,work-hub-nas}.electron.js` | 真实交互、状态与恢复回归 |
| `tests/sun-home.preload.js` | 隔离提醒调度计数，不调用真实系统提醒 |
| `README.md`、`README.en.md` | 1–8 类规则及草稿、恢复行为 |

## 验收证据

- `npm test`：exit 0；Node 856 通过、0 失败、1 项 Windows 专属跳过；32 次 Electron 调用与 109 项语法检查通过。
- 关键相关单测 98/98 通过；待办、八类 NAS 恢复、焦点、启动与额度矩阵专项 Electron 全部通过。
- 最后补充的语言切换无障碍标签回归再次通过，用户分类名与草稿保留。
- 官网 `npm test` 22/22，通过 `npm run lint`；中英生成资源校验与 `git diff --check` 通过。

证据目录：`dist.noindex/project-audit-fixes-20261022/`（目录沿用开始修复时的日期）。

- `todo/04-todo-time-picker.png`：选中小时/分钟可见，弹窗边界正常。
- `todo/06c-deadline-exact-minute-popover.png`：原始 18:32 的分钟如实显示；`todo/deadline-readonly.json` 验证打开零写入/零调度、真正修改一次写入/一次调度、新建只更新草稿。
- `todo/06d-deadline-unset-zh.png`、`todo/06e-deadline-unset-en.png`：中英文未设置提示，无已选高亮；`todo/06f-deadline-set-en.png`：主动选择后的已设置状态与高亮。`todo/deadline-unset.json` 记录首次打开、浏览月份、切换语言、逐类选择、重复选择与无效选择的写入和提醒计数。
- `todo/08-sync-preserves-drafts.png`：同步新增待办后，草稿、日期、分类名和编辑文字仍保留。
- `todo/09-settings-no-calendar.png`：程序切换设置后日期弹窗消失。
- `todo/10-collapse-no-calendar.png`：快捷键回调收起后日期弹窗消失。
- `todo/11-english-todo-controls.png`：英文动态控件，原有用户名称与内容保留。
- `quota/`：四尺寸、3–6 家、中文/英文、正常/偏低/告急/用完/失效/过期矩阵截图。
- `unit.log`、`related.log`、`full-test.log`：测试日志。
- 日期编辑器补充回归：`date-editor-unit.log`（64 项领域单测）、`date-editor-related.log`（待办/焦点）、`date-editor-visual.log`（截图）、`date-editor-full-test.log`（完整桌面检查）。提醒计数来自测试专用桥接，不触发系统提醒。
- 未设置状态补充回归：`unset-unit.log`（77 项领域和本地化单测）、`unset-related.log`（待办/焦点 Electron 回归）均通过；`unset-full-test.log` 完整桌面检查 exit 0（856 通过、0 失败、1 项 Windows 专属跳过，32 次 Electron 调用及 109 项语法检查）；`unset-website.log` 官网 22 项测试和 lint 通过。

## 验证边界

Electron 在当前 macOS 上使用临时用户目录和夹具运行。NAS 覆盖/回滚使用真实伴侣服务代码建立的本地临时 HTTP 服务，未操作用户实际 NAS。未使用真实 AI 凭据，未安装包，未在 Windows 实机运行。
