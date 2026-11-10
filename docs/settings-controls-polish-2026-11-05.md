# 2026-11-05 设置细节与桌面控件统一

分支：`dev`；基线：`c6c1638`。依据本次三张问题截图调整，覆盖此前 A-r3.3 将 Token 单独放在来源列表下方的安排；保留六组导航和所有已有业务控件。

## 结果

- 数据：本地资料行去掉末尾多余分割线；导出与恢复仍是两张独立卡片，标题/说明在左，按钮在右垂直居中，中文与英文、三档窗口均保持同行。
- 常用：语言、快捷键、位置、默认页、开机自启、手动/自动会议、顶部气泡和条件显示的 Windows 能力按行分隔。自动会议的信号标签和覆盖说明留在同一设置块。外观中天气开关与 Open-Meteo 附属说明之间仍不加分割线。
- AI：六家 Token 配置回到对应来源行下方，默认折叠。展开后保留原来的获取并保存、输入、保存/清除、Grok 团队 ID，以及 Manus 完成提醒控件；Claude Code 与 Grok Bot 保留原本的本机额度说明。八家顺序、接入/修复/断开与相关确认逻辑保留。
- 折叠/展开、状态刷新、切组和换语言不重建 Token 输入；已有草稿、焦点、状态节点及绑定保留。摘要文字单独绑定在 span 上，换语言不会移除同一摘要中的状态节点。Token 配置可用性独立于完成提醒接入，未接入不再把 Token 区域整体变暗。
- 共用 `renderer/controls.css` 集中动作按钮、图标动作与下拉框的外观变量和状态：普通 32px、紧凑 30px；下拉框 32px/9px 圆角，统一箭头/焦点/禁用样式；图标按钮 8px 圆角并保持原 hitbox。主要/普通/危险操作保留语义差别，导航、分段、媒体控制和链接型操作保留各自形态。
- 本机设置原无通用类的按钮、密钥列表编辑/复制/删除及删除弹窗使用同一动作组件。清理重复的按页按钮覆盖与旧 Token brief 样式，不改数据格式。
- 原生键盘检查复现 Token summary 按 Space 会触发全局收起；改为让 button/summary/link 保留原生键盘行为，背景区域的 Space 唤出/收起继续保留。

## 实际渲染截图

使用隔离 Electron、模拟额度/凭据与拦截的剪贴板写入。图片只含测试数据；截图清除了同一夹具此前操作留下的临时反馈，以呈现目标页面。没有向生产界面写入示意状态。

| 验证项 | 截图 |
| --- | --- |
| 数据同行与无末尾分割线 | [标准](screenshots/settings-controls-2026-11-05/standard-data.png)、[适中](screenshots/settings-controls-2026-11-05/medium-data.png)、[紧凑](screenshots/settings-controls-2026-11-05/compact-data.png)、[紧凑英文](screenshots/settings-controls-2026-11-05/compact-data-en.png) |
| 常用的行分隔、按钮/选择框 | [顶部](screenshots/settings-controls-2026-11-05/standard-common.png)、[自动会议与气泡](screenshots/settings-controls-2026-11-05/meeting-signals.png) |
| AI 来源内 Token 折叠 | [标准](screenshots/settings-controls-2026-11-05/standard-ai.png)、[紧凑](screenshots/settings-controls-2026-11-05/compact-ai.png) |
| 展开 Token 与原控件 | [Cursor/Codex](screenshots/settings-controls-2026-11-05/ai-tokens.png)、[Manus 与录音入口](screenshots/settings-controls-2026-11-05/ai-manus-recording.png) |
| 跨弹窗与页面样式 | [录音弹窗](screenshots/settings-controls-2026-11-05/recording-modal.png)、[密钥列表](screenshots/settings-controls-2026-11-05/credentials-actions.png) |
| 保留天气无中间分割线 | [紧凑外观](screenshots/settings-controls-2026-11-05/compact-appearance.png) |

## 验收

- 完整 `npm test` exit 0：1108 项 Node（1106 通过、2 Windows 相关跳过），58 份 Electron 清单（含重启 75 次）及 136 项清单语法检查完成。
- 最终组件字体变量/图标圆角及密钥按钮微调后补跑：settings-slim、command-comments、content-delete、workbench、security-recovery、metadata-races、visual-consistency 全部通过。
- 设置回归新增原生 Space 展开验证，来源与 Token 所属行、六个状态节点的语言切换保留、按钮/下拉框计算样式对照、常用分割线，以及三档中英文备份同行几何检查。
- 翻译资源、版本一致性、`git diff --check` 通过；开发版本仍为 0.11.0，进入未发布记录。真实 Codex/Cursor/Claude 配置哈希不变。
- 未打包或替换安装版；Windows 真机仍待验。NAS 沿用隔离测试服务，没有部署真实设备。

[验收参数](screenshots/settings-controls-2026-11-05/validation.json) · [三档六组几何记录](screenshots/settings-controls-2026-11-05/group-matrix.json)

本地点验：`npm start` → 设置 → 常用检查下方分隔；数据检查三块与按钮同排；AI 展开/收起各来源 Token，输入草稿后切组或换语言确认保留，再检查原有接入、保存/清除与录音弹窗。

自动化截图复验：新建临时目录作为 `TODO_TEST_USER_DATA`，设置 `POME_SETTINGS_SCREENSHOTS` 后运行 `electron tests/settings-slim.electron.js`；保持真实 AI 配置隔离。
