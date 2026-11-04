# 四模块 layout-variant 审查与修复

审查区间：`git diff a8623c8 8a97c06`。只修改 `dev`，没有打包或安装。

设计来源：[layout-variant 参考文件夹](https://drive.google.com/drive/folders/1x3m-P22vk9k974Dm21M4-DF39tl0WGxa)，已读取 NOTES、overview 与八张 adapted 图。布局以参考为方向，数据与图标沿用组件现有实现。

## 确认并修复的问题

- AI provider 被改成 flex，内部 gauge 仍依赖 grid 的剩余高度；旧横条同时参与测量，导致环缩至最小尺寸。恢复独立的标题／仪表／重置时间网格，拉伸态只渲染环；按真实可用空间计算直径，至少 56px。
- mini 旧样式仍强制 30px、隐藏中心数字；拉伸后明确覆盖，逻辑足迹仍是 mini。
- 失败或无进度来源不创建占位环和隐形行；刷新时允许旧节点中不存在 ring，保留原失败文案及修复操作。
- 多来源窄卡片在内部滚动访问，保留最小可读单元，避免环溢出相邻格子；未改变首页外滚、容量或铺满算法。
- 黄历 tall 的 meta `margin-top:auto` 造成大空洞；恢复分区纵向分配，并为底部说明预留空间。移除 full 对 tall 容器的冲突分栏。
- 日出 tall 的 hero 与 stats 重复展示白昼时长；只在统计区保留。wide 的 SVG 原视口在宽卡片中居中留边，现按可用宽高重新计算视口和天文点横坐标，等比显示文字与太阳标记。相同布局属性重复写入不再重建太阳 SVG。
- 收件箱 wide 原来只展示项目名，失败状态与摘要争同一列；改为标题／状态一组、真实完成摘要另一列。未拉伸 DOM 保持原样。

三个模块的 observer 均为初始化时创建一次，未放进渲染路径。黄历按日期／尺寸／variant 缓存，太阳新增属性值去重，新增的宽图尺寸观察在 pagehide 断开且只在视口比例变化时更新；收件箱对同一尺寸／variant 不重复发起读取，原有分页请求过期校验继续生效。没有发现本轮 observer 产生持续请求或重复 listener 标签。

## 截图与基线

所有图片由真实 Electron 渲染直接 capture，使用合成数据，不读取账号凭据。测试固定时间为 2026-11-04 12:30（上海），禁用动画并移开鼠标，以稳定比较。固定色背景只用于隔离玻璃后方的其它卡片，未覆盖组件自身样式。

每个模块均有：

- `*-wide.png`：拉宽（600×248 逻辑像素）。
- `*-tall.png`：拉高（320×510）。
- `*-unstretched-mini.png`、`small.png`、`medium.png`、`large.png`：四档未拉伸。

`baseline/` 来自 `git archive a8623c8` 的独立源码快照，同一预加载数据与同一截图代码。`baseline-comparison.json` 是实际断言结果：

- 黄历、日出：四档各自像素完全一致，共 8 组。
- 收件箱：四档 DOM、关键计算样式、内容与几何完全一致。截图仍有透明合成层的像素差异，记录 `pixels:false`，不声称逐像素一致；人工对照未见布局或字段变化。
- AI：四档几何与文字一致，原图标局部像素一致；进度弧品牌色变化为已授权需求。

`metrics-review.json` 保存本轮宽高、几何与 AI 仪表测量；`baseline/metrics-baseline.json` 保存旧版本对照。AI 专项图见 [ai-usage-fix-shots](../ai-usage-fix-shots/README.md)。

## 验证

- `node --test tests/*.test.js`：1108 项，1106 通过，2 项平台条件跳过，0 失败。
- Electron：home-fill、panel-size（含重启）、almanac-home、sun-home、sun-weather、inbox-bento、inbox-pagination、ai-usage、ai-usage-final，以及新增 home-layout-variant 均通过。
- 本地化生成资源、JS 语法与 `git diff --check` 通过。
- 完整并发 Node 测试另暴露旧通知链用例读取半行 JSONL 的竞态；修为只读完整行，不改产品通知逻辑。
- sun-home 原用例隐藏窗口后等待 requestAnimationFrame 导致超时；改为显示测试窗口，保留所有原断言。AI 原生 hover 用例串行执行后通过，避免并行截图窗口争夺前台焦点。

没有改动 `HOME_SIZE_FOOTPRINTS`、`HOME_SIZE_DEFAULTS`、面板尺寸、容量、默认顺序或 `fitHomeWidgetView`。本轮是 macOS 原生 Electron 与模拟平台的渲染验收，Windows 真机仍未验证。

常规测试默认输出到 `dist.noindex/`，不重写已提交的验收图片，也不把另一台机器的 DPI 当作像素基线。以下命令在相同 Electron / DPI 环境下显式复跑本机验收：

```sh
variant_profile=$(mktemp -d /tmp/pome-variant-review-XXXXXX)
env -u ELECTRON_RUN_AS_NODE TODO_TEST_USER_DATA="$variant_profile" \
  POME_VARIANT_SHOTS=docs/plans/layout-variant-review-shots \
  POME_VARIANT_AI_SHOTS=docs/plans/ai-usage-fix-shots \
  POME_VARIANT_BASELINE_SHOTS=docs/plans/layout-variant-review-shots/baseline \
  ./node_modules/.bin/electron tests/home-layout-variant.electron.js
```
