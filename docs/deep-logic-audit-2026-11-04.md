# 2026-11-04 深度审查与修复

分支：`dev`；审查基线：`2689595`。本轮结合近期 `a8623c8..2689595` 改动、风险导向代码检查、隔离 Electron 复现与项目回归；不将通过测试等同于不存在其它缺陷。

## 审查范围

- 近期设置六组导航、旧入口映射、动态卡片/状态、面板三档与首页容量投影。
- 首页四模块拉伸、AI 额度主/副指标与渐变，以及指令备注编辑、复制、删除、提示层的事件生命周期。
- 工作区初始化、存储读取、NAS 投影与异步操作之间的数据版本边界；同时复查通知转发链、监听与会议模式实现。
- 项目完整 Node/Electron 清单覆盖笔记、录制、密钥、剪贴板、数据迁移、同步/恢复、AI 来源与提醒等已有路径。NAS 使用测试服务和隔离身份，不做真实设备部署。

## 已复现并修复

| 问题 | 修复前证据 | 修复与复测 |
| --- | --- | --- |
| 备注失焦保存会重建整张列表，吞掉随后复制或跨行编辑的第一次真实点击 | `interaction-before.json` 中 `copyAfterBlur=false`、`nextEditor=false`，备注本身已经保存 | 编辑结束只替换当前输入区域，其余行和操作按钮保留；复测复制、跨行编辑均为 true。补验正文失焦后首次删除，弹窗显示最新正文，取消保留数据 |
| 删除预览过期后仍删除同步更新的新版本，单删/批删均存在 | `singlePreserved=false`、`bulkPreserved=false`；确认前投影更新同 ID 的正文/备注，确认后新版本消失 | 预览捕获副本，确认时复核 ID、正文、备注和创建时间；只删除未变化的版本。保留更新项并提示重新确认，批量中未变项仍可删除，未选中项保留；单独验证仅备注变化也受保护 |
| 合法 JSON 的集合类型异常、链接空项/错误子列表可中断整个工作区初始化 | 指令/录音对象触发 `.map is not a function`，隐藏窗口对象触发 `.filter is not a function`，链接空项触发读取 `links` 异常；四场景 `ready=false` | 统一按列表形状读取，链接在内存中排除无效分组/条目、保护子列表，并对同步投影使用相同边界。四场景 `ready=true`、无渲染异常、原 LocalStorage 和磁盘镜像字节保留；有效链接不被坏邻居丢弃 |

修复集中在 `renderer/workspace.js`；删除提示补齐十语言。共享指令按钮构造，删除原失焦全列表重建和旧通用 JSON fallback 接口，避免渲染/编辑结束时样式、标签和事件处理分叉。未改变指令/备注存储字段。

异常集合防护仅保证其它工作区功能继续使用，并保留启动时的原始字符串；不声称自动修复、恢复异常记录内容。有效数据不做迁移或重写。

## Electron 截图与机器证据

全部来自隔离用户目录与模拟数据，复制写入被拦截，没有改系统剪贴板。截图先经人工查看；异常数据场景首轮抓到了展开前帧，随后增加可见性断言、等待合成帧并重录，以下均为最终有效画面。

- [修复前跨行操作](screenshots/deep-logic-2026-11-04/interaction-before.png) / [修复后第二行编辑器已打开](screenshots/deep-logic-2026-11-04/cross-row-after.png)。
- [失焦后首次复制成功](screenshots/deep-logic-2026-11-04/copy-blur-after.png)。
- [正文失焦后首次删除预览包含新正文](screenshots/deep-logic-2026-11-04/delete-after-text-blur.png)。
- [旧确认误删新版本](screenshots/deep-logic-2026-11-04/delete-race-before.png) / [新版本保留并提示重新确认](screenshots/deep-logic-2026-11-04/delete-race-after.png)。
- [坏指令集合下设置正常打开](screenshots/deep-logic-2026-11-04/commands-after.png)。
- [坏链接邻居不影响有效链接](screenshots/deep-logic-2026-11-04/links-after.png)。
- 同目录五组 `*-before.json` / `*-after.json` 保留布尔断言与初始化异常；[validation.json](screenshots/deep-logic-2026-11-04/validation.json) 记录测试清单和方法。

## 验证结果与边界

- Node：1108 项，1106 通过、2 平台相关跳过、0 失败。
- 58 份 Electron 清单分段完成，含重启共 75 次；136 项清单 JavaScript 语法检查完成，新增测试脚本另经 `node --check`。
- 初次 `npm test` 的既有 `notes-workflow` 在 90 秒 watchdog 超时；未改测试或笔记产品代码，相同条件隔离复跑通过，再从 `windows-widget` 接续原清单通过。没有把该单次 `npm test` 报为全绿。
- 最终五个新增场景又完整复跑，包含真实可见性、正文失焦删除预览、仅备注的同步更新和原始磁盘字节断言。
- 翻译资源、版本一致性及 `git diff --check` 通过。版本仍为开发版 0.11.0，变更进入未发布记录。
- 真实 Codex/Cursor/Claude 配置的哈希在测试前后保持一致。
- 未做 Windows 真机、真实 NAS 安装/部署、真实 AI 账号端到端验收或桌面打包/安装替换。当前修复属于源码验收。

## 本地复验

```sh
audit_profile=$(mktemp -d /tmp/pome-deep-check-XXXXXX)
env -u ELECTRON_RUN_AS_NODE TODO_TEST_USER_DATA="$audit_profile" ./node_modules/.bin/electron tests/deep-review.electron.js
```

异常集合分别用全新的隔离目录，设置 `POME_AUDIT_PHASE=commands` / `recordings` / `windows` / `links` 运行同一脚本。`npm test` 已登记交互和四种异常集合场景。
