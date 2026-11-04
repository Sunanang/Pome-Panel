# 设置 IA A-r3.3 实现与验收

设计参考：[A-r3.3 终稿](https://drive.google.com/drive/folders/1468YaGzI0sSrBxYKZGHIQfZXIRQZnxe7)。已读取 NOTES、常用／外观／显示／数据、AI 全量和异常页、录音及三类 AI 确认图、NAS 五态／展开／12 类确认图。控件、状态与文案以现网 DOM 和运行时 i18n 为准，没有将设计示意数据写入生产。

## 实现范围

- 左侧固定「常用 / 外观 / 显示 / AI / 数据 / NAS」，右侧只展示当前组并内滚，原节点一直挂载，保留事件与未保存输入。普通从其它页面进入设置时默认常用；明确的设置链接优先定位目标组。收起／重新展开同一设置页保持当前组，不写入持久化偏好。
- 支持上下方向键、Home、End 切组；选中状态、焦点和 ARIA tab 语义同步。旧设备、录音、显示、备份锚点及首页、额度、错误修复、欢迎入口均映射到对应组。
- 八来源顺序固定；六家 Token 位于完整来源列表之后，录音卡在 AI 页底部。保留手动填写、获取并保存、xAI 团队 ID、Manus 提醒和所有原确认处理。没有改动录音弹窗字段或视觉。
- 数据文件夹、导出、恢复为三张同宽卡。复用原备份处理；数据页的成功／失败反馈仍可见，取消恢复不会执行写入。
- NAS 保留摘要和诊断复制；连接、同步详情、10 条内容结果、故障处理直接展开；HTTP 权限、迁移、恢复按钮仍按原状态显隐。弹窗根节点留在 settings-page 下、各隐藏组之外，保留原样式作用域。
- 天气说明紧跟开关；开关与 Open-Meteo 归属说明之间无 border，正常分隔从温度单位行开始。平台条件与会议状态标签保留。
- 清理被替换的双列／顶部子导航样式、旧生成代码和不再使用的观察器。四个新增分组文案键补齐十语言；生成资源由项目脚本更新。首页仅修改设置跳转，不改布局或模块样式。

## 截图

全部来自 macOS 真实 Electron、隔离 userData / hook HOME 和模拟服务，非真实账号余额或真实 NAS。

- `standard-*.png`、`medium-*.png`、`compact-*.png`：三档 × 六组，共 18 张。矩阵见 `group-matrix.json`，包含当前组、同宽、横向溢出、滚动和侧栏边界断言。
- `meeting-signals.png`、`mirror-cover.png`：滚动后仍可操作的会议信号与镜子。
- `ai-tokens.png`、`ai-manus-recording.png`：长页中的 Token、团队 ID、Manus 提醒、录音卡；显示假草稿用于验证输入保持。
- `recording-modal.png`：原录音转写与命名弹窗，深色输入。
- `nas-content-details.png`：10 条同步内容与展开的故障区。
- `ai/`：真实接入／断开／修复预览与混合状态；只修改临时配置，真实配置前后哈希一致。
- `nas/`：五态及异常、连接／迁移／恢复确认。12 类中的 11 个网页弹层实际触发并截图；资料恢复仍使用系统原生确认，自动化核对其完整标题、说明和两侧数量并返回取消，证据为 `restore-confirmation.json`，未冒充系统弹窗截图。

AI 与 NAS 是长页，截图通过正常滚动分段呈现，不通过缩字或截掉功能来塞入一个视口。NAS 迁移／恢复等互斥状态分别触发，未在生产中常驻互斥按钮。

## 验证与边界

完整 Node：1108 项，1106 通过，2 项平台跳过，0 失败。相关 Electron 回归均通过，清单见 `checks.json`。其中 settings-slim 验证三档六组、未保存草稿、语言、键盘、旧锚点、排队深链、天气无中线、原顶部导航保持、显示独立开关和至少一个首页模块；nas-settings-card 覆盖配对、HTTP、证书、吊销、endpoint 删除、两类迁移抉择、迁移备份恢复、本机覆盖 NAS、快照回退、数据备份反馈和取消边界。

原设置区 106 个静态 ID 全部保留；没有真实工具配置修改。检查包含本地化、JS 语法、差异空白和发布策略。没有运行整套 npm test 的所有 Electron 用例；本次运行的是上面列出的受影响回归。没有打包、安装、发布或连接真实 NAS；Windows 真机仍待验。

## 本地点验

1. 完全退出已运行的 Pome Panel，在 dev 执行 `npm start`，展开面板后点击「设置」。普通进入应选中常用。
2. 依次点六项侧栏，确认只出现当前组，Tab／上下键可导航，右侧滚到底后侧栏仍可见。
3. 外观切换三档，核对镜子、温度、动效和天气说明无中线；显示页核对两列开关、容量提示与禁用。
4. AI 滚过八家来源、六家 Token 和录音卡；打开三类预览后点取消，确认配置不变；打开录音配置核对深色输入。
5. 数据核对三块；恢复先看比较确认，取消不写入。NAS 核对展开内容及各状态按钮；真实配对、吊销、覆盖操作仍须由用户明确选择。

隔离复跑：

```sh
settings_qa_profile=$(mktemp -d /tmp/pome-settings-ia-XXXXXX)
env -u ELECTRON_RUN_AS_NODE \
  NODE_OPTIONS="--require=$PWD/tests/provider-usage-fixtures.cjs" \
  TODO_TEST_USER_DATA="$settings_qa_profile" \
  POME_SETTINGS_SCREENSHOTS=dist.noindex/settings-ia \
  ./node_modules/.bin/electron tests/settings-slim.electron.js
```

验收图片默认留在 dist.noindex；归档为本次快照，不在常规测试时覆盖提交文件。
