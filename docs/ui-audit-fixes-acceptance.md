# UI 复核修复 · 2026-10-22

基于 dev 的 `c06c392`，修复代码复核确认的通知来源图标、额度定时文案和布局保存反馈问题，同时清理可确认无用的额度输出。保留现有额度动画、顶部导航栏和其他模块布局。

## 行为

- 恢复仍通过动态路径加载的 `notification/task.svg`、`notification/todo.svg`。旧 GPT 来源复用 `inbox/openai.svg`；别名与未知来源先归一化再选择图标。来源图标与 `glyphs.svg` 的状态符号不互相替代。
- 首次绘制与 30 秒更新统一调用额度说明格式函数。small 中文去空格，英文及其他尺寸保留正常词间距；tooltip 保留完整文案并同步更新。
- 首页编辑保存遇到本机存储失败时，显示明确报错、保留当前编辑及取消快照，继续提供保存重试。成功重试后退出编辑并清除对应布局报错；失败时不再提示“布局已保存”。

## 瘦身与测量

- 删除隐藏的 `ai-*-source` 节点及多余 model 字段。测试改为读取实际卡片 tooltip，来源信息继续在 tooltip / ARIA 中提供。
- 删除非 mini 页脚的无效文案、隐藏按钮生成分支和两条专用翻译，不为非 mini 计算 mini 摘要。
- 文字宽度按文本和字体属性跨刷新、缩放缓存，最多 256 项；字体加载完成后失效重算。保留现有实际字形边界复查，避免变量字体缩小后截断末字。
- 删除通知相对时间中未使用的局部变量。没有替换或删除 `renderer/ai-usage-animation.js`，其 SHA-256 保持 `1ce31412ccd39aa11ad2142dceec17b68f00bc51e9d980714f34e01067a06aae`。

## 文件

- 产品：`renderer/ai-usage.js`、`renderer/app.js`、`renderer/notification-domain.js`。
- 资源：`renderer/assets/notification/{task,todo}.svg`、`renderer/assets/README.md`。
- 文案：`localization/locales/{zh-CN,en-US}.json` 及生成的桌面、NAS `resources.js`。
- 回归：`tests/notification-domain.test.js`、`tests/notification.electron.js`、`tests/ai-usage-final.electron.js`、`tests/ai-usage.electron.js`、`tests/startup.electron.js`、`tests/ui-simplify.electron.js`。

## 验收

相关 Node 单测 47 项通过；`npm run i18n:generate`、`npm run i18n:check` 通过。最终 `npm test` exit 0：857 项通过、0 失败、1 项 Windows 专用测试跳过，31 次 Electron 运行及 JavaScript 语法检查均通过。

新增断言覆盖内部待办/汇总、旧 GPT 和未知来源的资源存在性，以及 Electron 中实际显示的通知图标解码；实际停留超过 30 秒后的中文小卡片；英文与较大尺寸词间距；六次重复缩放新增测量节点为零、字体完成事件后重新测量；布局各存储键失败后保留编辑、取消还原、跨页面回到保存操作，以及有改动/无改动时的成功重试。现有四尺寸状态矩阵、固定条长、动画中途更新、失败保留旧值、30 秒唤出防抖和 reduced-motion 回归保留并通过。

截图均已目视检查：

- `dist.noindex/audit-fixes-20261022/todo-due-soon.png`：真实待办提醒 IPC，来源日历图标与到期状态图标分别显示。
- 同目录 `task-completed.png`、`gpt-completed-no-project.png`：任务汇总与旧 GPT 来源图标恢复。
- 同目录 `quota/small-zh-CN-after-tick.png`：停留 31 秒后仍为无空格的中文 small 说明；同目录保留四尺寸、3–6 家、各状态及英文截图。
- 同目录 `layout-save-failed-retained.png`、`layout-save-retry-succeeded.png`：失败时保留编辑操作，重试后正常保存。

完整日志为同目录 `full-test.log`，相关单测和 UI 日志为 `unit-test.log`、`related-ui-test.log`。

证据位于 `dist.noindex/audit-fixes-20261022/`。隔离 userData 和接口夹具验证，未使用真实账号联网，未进行 Windows 真机、安装或打包验证。
