# 2026-11-03 AI 提醒、会议模式、指令备注与卡片拖拽验收

范围：当前 dev 工作区源码，隔离 Electron 用户目录与 AI 配置。保留任务开始前已有的输入法修改；未打包、未替换已安装应用、未提交推送、未部署 NAS。未在反馈故障的其他电脑及 Windows 实机运行。

## 已确认与修复

- 监听标签原先依赖空收件箱状态，有历史记录便不显示；小卡片还有通用 span 隐藏规则。现在独立显示实际 listener 状态，覆盖四档尺寸。配置接入状态不再单独充当端口健康证明。
- 真实端口占用会导致通知服务启动失败且不重试。隔离测试实际占用端口，验证 EADDRINUSE 显示异常，释放后在重试周期内恢复监听与收信。事件在监听恢复前无法收到；这不证明其他电脑的具体故障原因。
- Codex 接入尊重启动环境的 CODEX_HOME。测试接入执行已配置的 notify 命令，使用测试标记和一次性令牌，不写入消息历史。正常 Codex 字段的完成事件另外经过 HTTP、持久化、渲染和顶部气泡验证。未调用真实账号生成任务，未修改真实 Codex/Claude/Cursor 配置。
- 会议模式由本机设置及托盘切换，持久化独立开关。进入时隐藏现有提示；完成事件继续保存，退出恢复原顶部提示开关，不补弹旧完成记录。未展示的待办保留原恢复策略。应用没有独立通知提示音。
- 指令新增 comment 字段，支持回车保存、Esc 取消、清空、重载持久化、同步投影及 NAS 展示；复制仍只包含 text。
- 拖动卡片的 CSS 选择器优先级低于编辑模式过渡规则，导致坐标插值；当前取消拖动卡片的位置过渡，以抓取点为缩放原点，并保留上一次落格动画被打断时的可见偏移。回归先复现偏移，修改后同一路径的抓取点误差小于 1 CSS px。交换、取消、快速连续拖动、减弱动态效果和保存规则通过。

Codex notify 字段及事件格式参考：[OpenAI 官方文档](https://learn.chatgpt.com/docs/config-file/config-advanced#notifications)。

## 验证

- 全量 Node：1074 项，1073 通过，1 项 Windows 专用跳过，0 失败。
- Electron：notification、notification-listener、home-layout-swap、ai-sources、inbox-bento、retained-workspace、workbench 均通过。
- notification-listener 额外验证 mini/small/medium/large 的监听标识没有被隐藏或越出实际卡片宽度。
- i18n 资源检查、修改文件的 JavaScript 语法检查与 git diff --check 通过。
- 测试期间 EADDRINUSE、ENOSPC、损坏 JSON 和保存失败日志是明确注入的预期场景，最终断言均通过。

## 截图

- home-listening-comments.png：有历史记录时仍显示监听中；常用指令下方显示备注。
- meeting-mode.png：会议模式实际开关、说明、Codex 测试接入按钮。
- bubbles/codex-completed.png：真实 Electron 顶部提示窗口，由隔离 HTTP 完成事件触发。
- drag/drag-pointer-anchor.png：拖入其他卡片后的预览画面；抓取点稳定性由同时运行的坐标断言验证，静态截图本身不证明连续运动。
