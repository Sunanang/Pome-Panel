# AI 完成事件过滤与等待操作提醒技术方案

日期：2026-10-18。基线：`dev` / `aa44fef` / 桌面 0.11.0。状态：待实施的技术与交互方案；本文及配套设计图不代表业务功能已经上线。现有产品行为继续以 [README](../../README.md) 为准，实施时同步更新。

## 1. 要解决的问题

完成提醒只展示主会话面向用户的最终结果。后台辅助任务、建议生成、筛选结果、工具返回值、思考和中间消息不弹气泡、不进入 AI 完成列表、不增加未读数。

AI 正在等待操作时，顶部明确显示「Codex 等待你输入」「Cursor 等待你选择」「Claude 等待你授权」。收到对应回答、取消或继续运行的可信事件后撤销提醒。气泡只负责提醒和返回来源软件，不代替用户回答或授权。

本轮交付是实施方案与设计图。实施需要覆盖 macOS arm64 和 Windows x64，逐个验证实际工具版本，不能把“有等待样式”当成“所有客户端已接通”。

配套 [R2 醒目版设计预览](../design/ai-attention-reminders/attention-v2.html) 与 [三状态设计图](../design/ai-attention-reminders/overview-v2.png)。R2 根据用户对显著性的反馈更新；初版在设计目录保留。预览中的问题与项目名均为设计示例。

## 2. 当前代码和已确认的缺口

- `scripts/codex-notify.js` 基本透传 notify JSON；当前没有辅助任务过滤。`main-services.js/taskNotificationIdentity` 优先使用最后助手文本提取标题，`concreteTitle` 只排除少量空泛完成文案。
- 本机核查发现 7 条 `{"suggestions":[]}` / `{"exclude":[]}` 记录，全部标记为 Codex 完成。它们是已观察到的噪声签名；仅凭现有记录无法证明上游内部任务的具体种类。
- Claude 接入主要是 `Stop`；Cursor 是 `stop` 和 `afterAgentResponse`。这两个 Cursor 事件不能等同于等待用户操作事件。
- `awaiting` 已能显示蓝色状态标记、隐藏倒计时并持续保留。`main.js` 当前把它和完成通知一起存入 `task-inbox.json`、进入同一个 FIFO；未关闭的等待气泡会挡住后续通知。
- 现有 `taskId` 优先取 turn ID，其次才是 thread/session ID；不能拿它同时当会话、回合和请求身份。新增逻辑必须分别保留这些字段。
- 当前没有等待请求的开始、解决、取消和过期状态机，也没有逐来源的等待能力说明。

## 3. 判断顺序：先识别事件，再决定是否输出

新增纯函数模块 `aiEventPolicy.js`，供来源适配器和 HTTP 接收端共同使用。主进程重新校验，不能只靠脚本过滤。分类结果限定为：

- `ignore`：已知后台辅助事件、子代理、重复事件和已确认的噪声内容。
- `completion`：主会话已结束且面向用户的最终完成或最终失败。
- `attention`：真实的输入、选择、授权请求。
- `stateOnly`：开始运行、解决请求、取消、终止等状态事件，本身不产生完成通知。

### 3.1 正常完成的准入条件

按顺序执行：

1. 校验来源、事件类型、正文尺寸和身份；排除云端、子代理及已确认的辅助会话。复用现有白名单与来源脚本的远程过滤规则。
2. 使用来源原生生命周期确认回合终态；`afterAgentResponse`、工具调用完成和一段 assistant 文本都不能单独触发成功。
3. 在对应会话和回合里选择面向用户的最终助手消息。原生有 `channel` / `phase` / task class 时按实际字段识别；字段必须来自已验证适配器，不能自造字段后宣称原生支持。
4. 排除下节规定的控制内容，再提取可读摘要和标题。未通过准入的消息不能换成「Codex 已完成」继续提醒。
5. 有可信主会话终态但没有文本的事件，可按证据显示「Codex 已结束本轮任务」。来源角色不明、仅有空输出的事件不以通用标题补成成功。
6. 只有最终准入成功才调用 `taskInbox.accept`、广播 `task-completion:new`、增加未读并入气泡队列。失败终态保持 `failed`，不能冒充成功。

### 3.2 JSON 过滤规则

JSON 格式本身不能作为删除条件，用户可能要求输出接口结果或配置文件。

优先使用来源身份、任务类型和最终消息标记。已证实为辅助任务的输出，无论 JSON 是否为空、有多少内容，全部忽略。

为兼容现有 Codex notify，加入一个范围明确的噪声规则：完整文本去除一层 Markdown JSON 代码围栏、解析为单个对象后，若键集合恰好是 `suggestions` 或 `exclude` 中的一个，且对应值是空数组，视为已观察噪声签名。忽略空白、格式化换行和键序变化。只处理整个消息，不对自然语言中的 JSON 片段做子串匹配。

该兼容规则有边界：它不能证明来源是后台任务。如果适配器能够提供已核实的用户请求上下文，证明用户明确要求交付该 JSON，则允许该最终结果；不能仅凭未经核实的 `final: true` 覆盖规则。没有这种上下文的旧 notify 按上述窄规则过滤，并在实现文档中公开这一限制。

以下情况保留或另行判断：

- 用户最终输出 `{"success":true,"count":3}`：保留，不因 JSON 而丢弃。
- “接口返回 `{"exclude":[]}`，已据此完成修复”：这是完整自然语言结果，保留。
- `{"suggestions":[...]}`：只有原生身份已证明是辅助任务才忽略；不能扩展为空数组规则之外的猜测。
- 空对象、空数组、损坏 JSON：结合可信终态与消息角色判断，不默认算成功，也不递归解析任意工具输出。
- 内部 JSON 后又有真实 final 消息：按当前回合的 final 消息生成一次结果，不取 JSON 首行作标题。

分类返回稳定 reason code，例如 `auxiliary_task`、`subagent`、`non_terminal`、`known_control_envelope`、`no_user_result`。诊断仅记录原因、来源、版本、时间和哈希，不记录完整输入、回答或原始会话。

### 3.3 已存在的噪声记录

首次升级不直接批量删除旧记录。对精确匹配的旧 Codex 噪声，使用统一的可见性投影隐藏；列表分页、总数、未读、最新一条和顶部角标都基于相同投影计算，不能只在 DOM 隐藏造成空页。

保留原始文件与去重身份，避免重投后再次显示。真正清理磁盘记录时提供一次性清理预览、备份和取消入口。普通用户 JSON 与未知结构不得跟随清理。

## 4. 统一事件与接收流程

继续使用 `POST http://127.0.0.1:43821/notify/<source>`，保留 `codex` / `claude` / `cursor` 来源白名单，不新开端口。原始 notify v1 继续由 legacy adapter 解释；新适配器发送带版本的事件。

以下是拟新增的 Pome 内部协议，不是任何工具现有字段的逐字复制：

```json
{
  "schemaVersion": 2,
  "kind": "attention.required",
  "source": "codex",
  "eventId": "stable-provider-event-id",
  "sessionId": "native-thread-id",
  "turnId": "native-turn-id",
  "requestId": "native-request-id",
  "action": "select",
  "question": "这次修改直接上线，还是先预览？",
  "project": "Pome-Panel",
  "occurredAt": 1792296000000,
  "sequence": 18,
  "evidence": {
    "adapter": "codex-app-server",
    "surface": "bridge",
    "providerVersion": "detected-at-runtime",
    "signal": "item/tool/requestUserInput"
  }
}
```

`kind` 支持 `turn.started`、`turn.completed`、`turn.failed`、`attention.required`、`attention.resolved`、`turn.cancelled`。`action` 限 `input` / `select` / `approve`，解决原因限已答复、已取消、已继续、已终止；未知值拒收。

`sessionId`、`turnId`、`requestId` 分开存储，三个来源均带适配器和客户端 surface。原生缺字段时只在适配器有明确、已验证的关联链时分配合成身份；缺少关联能力时将能力标记为受限，不拿项目目录或“最近一个窗口”猜请求归属。

问题摘要最多 160 个 Unicode 字符；显示最多一行，完整安全摘要在 AI 完成组件的「待处理」区域查看。正文沿用现有尺寸上限。只取问题文本和选项标签判断操作类型，不发送回答、密钥、Token、环境变量、完整命令或完整文件差异。机密交互只显示通用提醒。

接收顺序为：`HTTP 校验 → source adapter → 分类 → 去重及状态归并 → 持久化 → UI 广播`。被过滤事件返回 202 和 `ignored` / reason code；持久化失败返回 503，不能虚报成功。重复事件返回 202 `duplicate`，不重复提醒。

现有回环 HTTP 不是来源身份认证。`evidence` 用于记录适配器证据，不能被当成权限凭据；不根据载荷执行命令、任意 URL 或授权动作。新 bridge 的连接凭据与验证在实施时单独管理，不能用一个可伪造字段冒充可信请求。

## 5. 各来源具体接法与交付边界

### 5.1 Claude Code：先完成可验证的原生接入

保留 `Stop` 完成转发。为等待请求新增专用 `scripts/claude-attention.js`，以只观察、无决策输出的 command hook 运行，stdout 保持为空；任何异常静默退出，不改变 Claude 的权限判定。

拟接入的事件：

- `PreToolUse` 中已验证的 `AskUserQuestion`：产生选择或输入提醒；问题对象存在选项时为 `select`，只有可验证的自由文本请求才是 `input`。使用 session 与 tool-use 身份关联。
- `PostToolUse` / `PostToolUseFailure`：解决对应提问。不得因另一个无关工具完成而清掉整个会话的等待。
- `Notification` 中 `permission_prompt`：产生授权提醒；`elicitation_dialog` 等交互表单按实际结构产生输入提醒。官方通知可能等待约 6 秒才触发，应在能力说明中标明延迟，不承诺立即出现。
- `PermissionRequest` 可以作为立即观测的候选，但该事件本身没有 `tool_use_id`，而其他 hook/宿主可能直接决定请求。首版不把每次 PermissionRequest 都当成已展示的用户授权框。只有完成可靠关联与取消验证后才启用即时模式。
- `UserPromptSubmit`、`Stop`、会话结束用于同会话有证据的继续/终止收敛。没有原生 turn ID 时维护本地会话回合 epoch，并测试“同一回合连问多次”。

`Notification` 不一定携带唯一请求身份。与已观测工具请求匹配时，优先原生 ID；否则必须在 session、回合 epoch、请求类型及脱敏指纹范围内明确唯一。重复投递合并，同一命令后续再次请求仍是新请求；不能仅按命令字符串永久去重。

无法唯一关联解决事件时显示「需返回来源软件确认」，不自动宣称已回答。`idle_prompt` 代表空闲，不是用户提问，不映射为等待输入。

修改 `aiSourceHooks.js` 的接入、修复、断开和状态检查，识别所有 Pome 自有 hook。保留其他 hook、matcher、顺序与超时，沿用预览、备份和过期校验。旧用户在设置中明确显示「完成已接入，等待提醒需补全」，不能直接报全部接通。[Claude 官方文档](https://code.claude.com/docs/en/hooks)

### 5.2 Codex：完成通道与等待通道分开

继续用现有 notify 处理回合结束和噪声过滤。OpenAI Docs 当前明确：`notify` 支持 `agent-turn-complete`；TUI 的审批提示不等于外部 notify 事件。因此修改 notify 脚本本身无法实现所有等待提醒。[OpenAI Docs：Notifications](https://learn.chatgpt.com/docs/config-file/config-advanced#notifications)

可验证的 bridge 路径使用 Codex app-server 协议：

- 观察 `item/tool/requestUserInput`，解析原生问题和选项，生成 `input` / `select`。
- 观察命令、文件修改、额外权限相关的原生 approval request，生成 `approve`。
- 观察 `mcpServer/elicitation/request`，按 form / URL 类型生成通用输入或操作提示，不自动打开表单 URL。
- 用 `serverRequest/resolved` 按原生 request ID 撤销；该事件也可能表示被清理，并不必然表示用户已经答复。继续/取消文案依照具体原因，不猜测。
- 读取同一传输上的 turn 开始、完成、取消，处理解决事件遗漏。[OpenAI Docs：App Server](https://learn.chatgpt.com/docs/app-server)

该路径的硬前提是 Pome bridge 合法位于对应会话的协议传输上。自行启动一个 app-server 不能自动观察已经打开的 Codex 桌面端或 IDE 会话。桥接只转发脱敏事件副本，原请求和回答仍由原宿主处理，不占用请求、不伪造回答、不在连接故障时自动授权。

对于用户现有 Codex 桌面端，先做单独的事件可达性验证：是否存在受支持的订阅接口，或是否能从有界、只读会话记录中同时获得提问、原生 call ID、回答/取消与回合状态。只有真实样本和重放测试都通过后，才启用对应版本的 watcher。磁盘记录不是通用实时 API；权限弹窗也可能完全不落在可读记录里。

若 watcher 可行，按已定位的会话文件增量读取，记录 inode 与偏移，处理半行、轮换、截断和重复；不全盘扫描、不读取 auth.json、不转发原始输入。记录格式变化立即停用等待能力，保留完成提醒。若验证失败，设置页明确显示「完成提醒可用；此客户端等待事件不可用」，将完整接入列为后续 bridge 工作，不用文本问号或“长时间没动”冒充等待检测。

### 5.3 Cursor：IDE 与 CLI/ACP 分别验收

保留 `afterAgentResponse` 只缓存同 conversation + generation 摘要、`stop` 才产生终态；原生 error 保持失败，aborted 不通知成功。

IDE 路径先用隔离 fixture 和真实工具验证 `preToolUse` / `postToolUse` 是否实际覆盖提问工具：必须能收到问题、稳定 tool-use ID 和对应结束事件。官方通用工具 hook 的存在本身不证明所有内置提问 UI 都会触发它。不为观察而返回 `permission: ask`，避免改变用户自动运行策略。[Cursor Hooks](https://cursor.com/docs/hooks)

如果真实 IDE 无事件，标记不支持；不安装不存在的 `Notification` / `PermissionRequest` hook。Cursor 对 Claude hook 的兼容清单也不包含这两类。[Cursor Third-party Hooks](https://prod.cursor.com/docs/reference/third-party-hooks)

CLI 的 ACP 接入可观察 `cursor/ask_question`、计划确认及原生权限请求，并在响应后发解决事件；自由文本输入是否暴露单独验证。它只覆盖经过该 ACP 宿主的会话，不能声称覆盖所有现有 Cursor IDE 对话。[Cursor ACP](https://cursor.com/docs/cli/acp)

### 5.4 设置中的能力状态

在来源接入状态中分别报告：完成事件、等待输入、等待选择、等待授权、自动撤销。每项取 `verified` / `partial` / `unsupported`，并附客户端 surface、实际版本和验证信号。

能力来自实际版本探测与验收结果，不根据安装了某工具就全开。缺少自动撤销的渠道必须显示受限说明。首次启用 watcher/bridge 时说明读取范围；沿用现有设置预览和用户主动接入，不擅改真实工具配置。

## 6. 等待状态与持久化

新增 `aiAttentionStore.js`，以 `userData/ai-attention.json` 本地原子持久化，复用 `atomicStorage.js` 的校验、外部修改保护、备份恢复模式。等待状态不进入 LocalStorage、普通工作区或 NAS 同步。

请求键由 source、surface、sessionId、turnId、requestId 构成，序列化后哈希；不同会话相同目录/问题不合并。保存最少字段：请求键、操作类型、安全问题摘要、首次/最后观测时间、来源版本、生命周期证据与显示状态。

状态限定为 `pending`、`resolved`、`cancelled`、`unverified`。UI 的“已关闭/已查看”是独立的显示字段，不等于请求已解决。

- 首次 required：建立 pending，请求一次提醒。
- 同请求重复 required：更新最后观测时间，不新增未读、不重弹。
- 对应 resolved 或同请求工具返回：撤销气泡和待处理入口；只清除匹配请求。
- 有序且可信的同回合继续、取消、终态：解决该回合相应请求；收到另一个回合或旧回合的完成不得清除当前等待。
- resolved 先于 required：保存短期 tombstone，迟到 required 不重新显示。优先原生 sequence/revision；没有时依靠明确回合边界与请求身份，不单靠跨进程墙钟排序。
- 应用重启/来源断线：pending 转 unverified，保留入口但不立即重新弹出；重新确认仍在等待才恢复。超时只降低可信度，不能自行把请求写成已完成。
- 存储损坏/写入失败：保留原文件，显示可修复错误；不能假装已收取并丢弃后续事件。

完成历史与待处理状态分开。新等待不新增“AI 已完成”记录和完成未读数；Bento 组件提供紧凑的待处理入口，关闭该组件时仍可从设置查看和恢复被关闭的等待提醒。旧版 awaiting 历史保持可读，不自动重放为新的真实等待。

## 7. 顶部显示与队列规则

复用当前 400px 无焦点通知窗口、屏幕定位、黑色顶部连接区与来源图标。R2 视觉提案以大面积琥珀色正文、「需要你操作」标签、20px 动作标题和常显返回按钮加强显著性。等待气泡不显示倒计时、不闪烁、不增加外围阴影，不改变主工作区几何。

R2 依次显示操作标签、动作标题、单行问题摘要、返回按钮与项目状态。macOS 提案高度为 176px（32px 顶帽 + 144px 正文），高于初版 110px；Windows 需按无顶帽内容单独测量。实施时同步主进程高度允许值、屏幕边界计算、渲染测量与集成测试，不只改 CSS。最多一行摘要，长内容进入详情；未知项目时省略项目和分隔点。该尺寸是待实施设计，不修改现有窗口约束。

标题为来源 + 等待类型；英文使用同义的完整翻译模板。系统标题由本机语言生成，用户原始问题不翻译。所有新增文字进入现有中英字典，运行 `i18n:generate` 与 `i18n:check`，不手工改生成脚本资源。

点击主体只返回允许的来源软件。现有 macOS 聚焦与打开能力优先；Windows 关闭原生能力时继续遵守点击仅关闭/提示手动返回的约束，不能偷偷启用 koffi。只有实际可返回时才显示「点击返回」，否则提示「请返回 Cursor 选择」。不承诺定位到精确聊天或题目。

等待气泡的 × 仅隐藏这次气泡，pending 仍在待处理入口；同一请求重投不重弹。用户可以从入口重新查看。点击来源软件后也不直接判为已回答。

队列拆成完成 FIFO 和等待请求集合，由 `aiNotificationScheduler.js` 仲裁：

1. 新等待优先于普通完成，但不打断用户正在悬停、键盘访问的气泡；安全切换后将原完成放回队首并保留实际剩余倒计时，不补足时间。
2. 单条等待在没有其他通知时持续保留。存在其他等待/完成时按 6 秒展示时隙公平轮转；这是展示调度，不是请求超时，不显示倒计时条。悬停期间不轮转。
3. 多条等待显示额外待处理数量，点击待处理入口可选择请求。每轮保证普通完成有展示时隙，避免等待永久挡住完成通知。
4. 解决或手动关闭当前气泡立即切换；后台已解决的请求直接从集合移除。数量只统计可展示的真实 pending。
5. 窗口动画、IPC 及回调全部带展示 generation，旧 dismiss/resize 回调不能关掉替换后的新提醒。`task-notification:hover` 也携带 event ID 或展示 token 校验发送者与当前项。
6. 切换、暂停、返回失败、来源断线和轮转都不能自动点击选项或产生权限决定。

已有纯等待不自动消失的测试需要区分「无竞争时常驻」与「有竞争时轮转」，不能简单删除原有覆盖。

## 8. 拟修改的代码位置

- `aiEventPolicy.js`：来源终态与控制内容分类；纯函数，可重放测试。
- `aiAttentionStore.js`：等待请求身份、状态、tombstone、持久化与兼容读取。
- `aiNotificationScheduler.js`：完成与等待两类展示的仲裁，使用可注入时钟验证公平和暂停。
- `scripts/codex-notify.js`、`scripts/cursor-notify.js`、`scripts/claude-notify.js`：保留完成兼容，传递来源/会话/回合身份；新增等待适配器独立文件，避免 Stop 承担所有事件。
- `aiSourceHooks.js`：多事件预览、安装、断开、完整性检测及逐能力状态；保留旧配置备份。
- `main-services.js`、`main.js`：准入前置，禁止 ignore 写入收件箱；v2 路由、解决事件、广播、IPC 当前项校验、窗口生命周期。
- `taskInbox.js`、`renderer/task-inbox-domain.js`、`renderer/task-inbox.js`：完成列表统一过滤投影、兼容旧 awaiting、待处理入口，分页与角标一致。
- `preload.js`、`renderer/notification-domain.js`、`renderer/notification.js`、`renderer/notification.html`、`renderer/notification.css`：安全桥接与三类等待渲染，不允许渲染层直接 require Electron。
- `localization/locales/*.json`、`package.json/build.files` 和 `mac.files`：完整翻译、包含所有新增模块与 bridge 运行资源。Mac 包继续排除 koffi 与 @koromix。
- `README.md`、`README.en.md`、两份 CHANGELOG：实施完成后记录实际支持范围；计划能力不得提前写成已交付。

## 9. 分阶段实施和通过条件

**P0：阻断噪声进入完成链。** 实现来源分类、窄 JSON 兼容规则和旧记录投影；验证真实 final、失败、用户 JSON 和重复事件。此阶段独立可交付，不依赖等待通道。

**P1：统一等待基础。** 完成 v2 envelope、状态存储、仲裁、三类 UI 与双语资源。使用隔离 fixture 验证完整 required/resolved 流程；fixture 成功只证明 Pome 消费能力，不算真实工具已接通。

**P2：Claude 真实接入。** 验证提问、授权、表单、回答、取消、自动允许、同回合重复问题。保存脱敏事件样本、实际工具版本和截图，分别验收终端与受支持宿主。

**P3：Codex / Cursor 可达性验证。** 按 desktop / IDE / CLI 拆分，逐场景记录有没有 required 和 resolved。可达且通过重放才实现对应适配器；不可达的客户端保留明确限制。不得用脚本强行弹一条 awaiting 充当覆盖了真实客户端。

**P4：双平台与升级验收。** Mac/Windows 验证队列、多屏、原生能力开关、重启、存储异常、既有配置保留。由用户明确确认后再打包安装；没有实机环境的项目标为未验证。

产品若要求「任何现有 Codex/Cursor 弹框都提醒」，必须把原宿主事件桥接的可达性当作前置工作；当前公开完成 hook 不能独自保证这一目标。

## 10. 必须覆盖的验收用例

### 完成过滤

1. 两种已观察 JSON 噪声，含多行/空白/代码围栏：不弹、不入完成列表、不增未读。
2. 中间助手消息与工具返回：均不输出；同回合真正 final 到达后只显示一次真实结果。
3. 正常 JSON 交付、含 JSON 的自然语言结果、明确用户要求的同形 JSON：按准入证据保留；覆盖兼容规则的已知限制。
4. 已证实辅助任务的非空 JSON 也忽略；未知辅助结构不依靠关键字猜身份。
5. 最终失败按失败提醒；aborted、子代理、云端事件不冒充成功。
6. 旧噪声位于第一页/最后一页/唯一未读时，页码、总数、空态和角标均一致；磁盘原文与去重保留。

### 等待生命周期

7. 输入、选择、授权三类标题正确，没有绿色完成标记或倒计时；长问题截断可查看，敏感问题用通用标题。
8. 同请求重投不重弹；同 session 后续新请求不丢；不同会话相同问题不合并。
9. 回答、取消、继续、结束分别撤销对应请求；其他会话完成不误撤销，resolved 早到不被迟到 required 复活。
10. Notification 无唯一 ID、权限被其他 hook 自动处理、表单取消、问题自动解决的情况不生成虚假持久等待。
11. 单等待常驻，多等待与普通完成公平展示；hover 不切换，离开不补时；旧动画/IPC 不影响当前项。
12. 点 ×、点击来源、来源启动失败分别测试；隐藏气泡不等于已答复，失败可重试且保留问题状态。
13. 重启、源断线、旧日志重放、日志轮换/截断、缺少解决事件：不批量重弹，不凭超时改成成功。
14. hook 接入/修复/断开完整覆盖所有 Pome 自有事件；其他用户 hook、TOML/JSON 格式和备份保留。
15. 中英切换不改变用户问题、请求 ID、去重或未读；Windows 原生能力关闭时不加载 koffi。
16. 存储损坏、503、快速并发和外部修改：保留数据并有明确修复路径；工具本身不被阻塞。

先运行对应 Node 单测和通知/来源 Electron 集成，再执行完整 `npm test`。真实来源另附客户端版本、端到端开始/解决事件及截图；单纯人工 POST 不作为真实接入验收。

## 11. 发布、回退与范围

实施期间保持 `dev` 开发流程。推送前检查版本与锁文件、两份更新日志、README 和官网动态下载入口；正式发布继续走 `dev → main` 与版本标签流程。

完成过滤与各来源等待能力可独立关闭；关闭等待 adapter 时保留完成监听和旧配置恢复能力。回退先停用新增 Pome 自有 hook/bridge，再恢复上一应用版本；不删除用户 AI 工具配置、完成历史或 NAS 令牌。

本方案不让 Pome 成为答案输入器、授权代理或通用聊天宿主，不改变 NAS 协议，不读取登录凭据，不为提醒新增麦克风/摄像头/屏幕采集权限。

## 12. 资料与实施前核验

来源核对日期：2026-10-18。外部客户端接口可能变化，实施时重新核对实际版本和事件结构。

- [OpenAI Docs：外部 notify 与终端通知](https://learn.chatgpt.com/docs/config-file/config-advanced#notifications)
- [OpenAI Docs：App Server 请求和解决事件](https://learn.chatgpt.com/docs/app-server)
- [Claude Code：Hooks reference](https://code.claude.com/docs/en/hooks)
- [Cursor：Hooks](https://cursor.com/docs/hooks)
- [Cursor：第三方 hook 兼容边界](https://prod.cursor.com/docs/reference/third-party-hooks)
- [Cursor：CLI ACP 的交互请求](https://cursor.com/docs/cli/acp)

引用仅证明相应公开接口存在，不证明当前 Pome 已接入，也不证明能旁听另一个现有宿主会话。
