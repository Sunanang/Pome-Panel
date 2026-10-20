# 七家 AI：额度与完成统一接入

日期：2026-10-19。基线：`dev` / `e6eeda8`。状态：已合入 P0–P3（能力位以 `aiProviderCatalog.js` 为准；未验证完成通道仍不开放 HTTP）。

## 已定决策

- **1C**：`grok`（xAI 独立）与 `grokbot`（Cursor/Anysphere 会话池）各一张卡；设置写清归属，避免与 Cursor 主额度重复解读。
- **2C**：一次成型统一注册表 + 能力矩阵；额度与完成可不同步；只合入已验证能力，其余标 unsupported/partial。

稳定来源 ID：`codex`、`claude`、`cursor`、`grok`、`grokbot`、`antigravity`、`copilot`、`manus`。

## 原则

参考 [CodexBar](https://github.com/steipete/CodexBar)、[QuotaBar](https://github.com/gentpan/QuotaBar)、[Pulse](https://github.com/qunqin24/Pulse)、[aiusg](https://github.com/abnegate/aiusg) 几乎只做额度。Pome 完成通道是本机 `127.0.0.1:43821/notify/<source>` + hook。

- 额度：借鉴端点与本机凭据发现，在 Node/Electron 内重写（safeStorage、host 白名单、超时、不写回第三方 CLI 凭据）；不嵌入 Swift/Rust，不依赖另装菜单栏 App。
- 完成：继续 hook → 转发脚本 → HTTP → taskInbox；新来源须有可信本机终态信号才进白名单。
- 不做：主动窥探对方窗口是否跑完；公网 webhook 直收；未验证标 verified。

```mermaid
flowchart LR
  catalog[AiProviderCatalog]
  usage[UsageAdapters]
  notify[NotifyHooks]
  policy[aiEventPolicy]
  inbox[taskInbox]
  catalog --> usage
  catalog --> notify
  notify --> policy
  policy --> inbox
```

## 架构（先骨架）

1. 扩展 `renderer/ai-provider-registry.js`（或上提共享 catalog）：每项含 id、label、usage/completion/attention 能力位、归属说明（grok vs grokbot vs cursor）。
2. 能力矩阵对齐 `aiSourceHooks.js` 的 verified|partial|unsupported；设置里额度与完成共用同一列表。
3. 泛化额度管道：`renderer/ai-usage.js`、`renderer/ai-usage-domain.js` 去掉硬编码双栏；按 registry 动态列出 available 来源；统一快照形状；大于 2 家时用主选切换或可滚动列表。
4. 完成管道目录化：`aiEventPolicy.js`、`taskInbox.js`、main 白名单、`aiSourceHooks.js`、图标与 i18n；旧 gpt 历史仍显示为其他；未验证 source 不接收 HTTP。
5. 设置：同一来源行展示两列能力；completion 用一键接入 hook；usage 用 Token/导入；grokbot 注明依赖 Cursor 登录；grok 注明 xAI 独立。

## 目标能力（未验证前保持 unsupported）

- cursor：额度已有；完成已有 stop/afterAgentResponse。
- codex：额度与完成已有。
- claude：完成已有；额度新增（aiusg 风格 OAuth usage + 本机登录发现）。
- grokbot：额度从 Cursor 池升格独立卡（GetSandUsageStatus）；完成 unsupported。
- grok：额度走 xAI Management 预付账本；完成已接官方 `~/.grok/hooks` Stop/StopFailure（partial）；等待仍 unsupported。
- copilot：额度走 GitHub copilot_internal/user；CLI 完成已接 agentStop / errorOccurred（partial），VS Code/云端仍未接入。
- antigravity：额度走本地 LS/agy 或 OAuth retrieveUserQuotaSummary（CodexBar 文档路径）；完成已接官方 Stop（partial）。
- manus：额度走官方 usage.availableCredits + API Key（safeStorage）；完成因公网 webhook 与回环冲突，首版固定 unsupported。

## 分期

**P0 骨架**：catalog + 矩阵；现有 Cursor/Codex/Claude 迁入；额度 UI 支持 N 家；改双栏硬编码测试。

**P1 额度**：先 grokbot 独立卡 + Claude 额度；再按验证顺序 copilot → grok → antigravity → manus。

**P2 完成**：白名单改目录驱动；维持现有三家；每新增一家前隔离 fixture + 真机样本后再开。grokbot/manus 完成默认长期 unsupported。

**P3 文档**：README/CHANGELOG 矩阵、参考仓致谢（接口知识）、i18n、归属说明。

## 明确不做

- 为凑齐完成而接 Manus 公网 webhook。
- 整包嵌入 QuotaBar/Pulse。
- 用静默窗/未读替换冒充只推最终结果（另案）。
- 未验证标 verified。


## 2026-10-19 审查修复

- Copilot 的 gh 命令显式指定 github.com，hosts.yml 只识别该主机块；企业 GH_HOST 下不借用环境 Token。
- Grok 实际接的是 xAI 开发者 Management API，设置保存团队 ID 与系统加密 Key。解析 `total.val` 的反向美元分账，以已入账美元余额显示，不推导消费版 Grok 或任意订阅百分比；错误/缺失金额不视为零。
- Antigravity 先只读查询 loadCodeAssist 获得 project，再读取额度摘要；支持 response.groups/buckets 的 measured remainingFraction，缺少测量值明确不可用，不写回第三方凭据、不自动开户或授权。
- Manus 使用官方 `GET https://api.manus.ai/v2/usage.availableCredits` 与 `x-manus-api-key`；只读取 `data.total_credits`（可消费余额），不把 `pro_monthly_credits` 月度配额当作余额或分母。缺失/非法余额或业务错误不视为成功；完整接入文档索引确认该端点后已移除临时降级方案。
- Copilot/Grok/Antigravity/Manus 的 401/403 会清除成功缓存，并保持失效标记直到凭据变化或请求成功。普通网络故障可保留同账号原数据并标记刷新失败。
- Claude 等待能力以完整的已连接观察 hook 为条件；缺失或未连接时为 unsupported。
- 动态 Token 卡使用语言绑定更新文字，保留未保存输入；修复设置读取白名单遗漏 encryptedProviderTokens，公共设置不暴露该加密字段。
- 回归覆盖主机隔离、请求协议、真实结构响应、缓存失效、语言切换、系统加密、无明文泄露及独立进程重启。Electron 测试默认隔离新增提供商的真实凭据，显式注入假账号与响应。

依据：[xAI Billing API](https://docs.x.ai/developers/rest-api-reference/management/billing)、[xAI 接入与账本语义](https://github.com/steipete/CodexBar/blob/main/docs/xai.md)、[Antigravity 分组结构](https://github.com/steipete/CodexBar/blob/main/docs/antigravity.md)、[Manus 官方可用积分](https://open.manus.ai/docs/v2/usage.availableCredits.md)。真实提供商账号联网、Windows 真机仍需单独验收；本次 fixture 结果不提升为 verified。

最终验证：`npm test` 全部通过，732 项 Node 测试中 731 通过、1 项平台专属跳过；21 个 Electron 场景和 3 次独立进程重启检查通过，全部语法检查通过。`i18n:generate`、`i18n:check`、`git diff --check` 通过。凭据测试仅使用隔离 profile 和假网络响应，验证系统加密落盘、公共设置/LocalStorage 不泄露密钥、设置写入与重启后保留、语言切换保留草稿，以及 Grok 美元/Manus 积分的余额展示。


## 2026-10-20 响应兼容修复

- Copilot 排除 unlimited=true 的数值占位桶；所有已报告桶均无限时显式显示“无限制”，不产生 0% 剩余、红色提示或虚构进度。有限窗口优先使用自身重置时间，缺省回退顶层 quota_reset_date_utc / quota_reset_date，支持 quota_reset_at 的秒/毫秒值；不由一个重置日期虚构固定 30 天周期。
- Grok Bot 的 currentPeriodStart 与 nextResetTimestampUtc 支持 ISO、epoch 秒/毫秒及数字字符串，保留毫秒精度。未知值保持未知，已知重置参与原有刷新调度。
- Antigravity 同时支持 response.groups、summary.groups 和根 groups，以及 remainingFraction 的平铺、嵌套与带 case/value 的形式；名称/id 别名可显示，unknown/disabled 不推导成满额或耗尽。
- 固定来源与样本说明见 [tests/fixtures/ai-usage/README.md](../../tests/fixtures/ai-usage/README.md)。这些是参考响应的脱敏、精简样本，金额和时间为示例，并非真实账号联网验收。相关能力继续保持 partial/unsupported，不提升为 verified。

本轮完整 `npm test` 通过：736 项 Node 测试中 735 通过、1 项平台专属跳过；21 个 Electron 场景和 3 次独立进程重启检查通过，全部语法与本地化资源检查通过。新增回归覆盖混合/全部无限 Copilot、顶层重置日期、Grok Bot ISO 重置提示及 Antigravity summary/tagged 响应，包含实际界面显示断言。完成通知、待操作提醒、历史裁剪与 NAS 同步回归通过；`git diff --check` 通过。

## Grok 完成链路修复（2026-10-20）

- 官方事件样本按 `sessionId + promptId` 建立轮次身份；重试去重、同会话后续轮次独立保留，沿用事件时间。过滤 `subagentType` 和会话结束 `Stop`，仅 `reason=end_turn` 的 Stop 作为完成，主会话 StopFailure 保留失败状态。
- 桌面/NAS 协议均允许 Grok，参与同一工作区同步周期、已读合并和最新 100 条裁剪；本机窗口与 cwd 仍不随历史同步。
- 完成气泡和收件箱保留 Grok 名称/图标；打开来源沿用 Claude 的终端路径、安全目录参数和 Windows 原生能力限制。
- hook 接入使用 `GROK_HOME`，否则回退 `~/.grok`；只增删 Pome 标记节点。修复保留其他 hook、匹配条件、字段与缩进，断开只在没有其他配置时删除专属文件。
- 回归使用隔离用户目录和按官方协议构造的精简样本（`tests/fixtures/grok-stop.json`），覆盖转发脚本→真实接收→气泡/收件箱、NAS 同步及两种平台适配器。没有实际调用 Grok 模型，也没有 Windows 真机验收，能力保持 partial。Stop 是可阻止的 gate；与其他阻止停止的 hook 并用时，单次 Stop 不保证是最终完成，这一协议边界仍适用。

协议依据：[官方 hook 文档](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/10-hooks.md)、[官方目录设置](https://docs.x.ai/build/settings)。

修复验收：完整 `npm test` 通过，759 项 Node 测试中 758 通过、1 项平台专属跳过；24 次 Electron 场景/独立重启检查以及语法、本地化资源检查通过。长轮次 ID 的身份摘要加固后，额外 11 项去重/双设备同步专项及真实转发/通知 Electron 场景复验通过。官网 22 项测试和 lint 通过，`git diff --check` 通过；Codex、Claude、Cursor、Grok 的真实配置前后哈希一致。

截图在 `dist.noindex/notification-design/`：`grok-one.png`、`grok-two.png`、`grok-three.png`、`windows-grok-native-off.png`。桌面完整日志为 `/private/tmp/pome-grok-fixes-full.log`，最终通知复验为 `/private/tmp/pome-grok-fixed-final.log`。

## Copilot CLI 与 Antigravity 完成接入（2026-10-20）

- Copilot CLI 按 [官方 hook 协议](https://docs.github.com/en/copilot/reference/hooks-reference) 写入 `$COPILOT_HOME/hooks/pome-panel.json`，默认 `~/.copilot/hooks/pome-panel.json`。使用 `exec/args` 和 Electron Node 运行时，避免跨平台 shell 转义；只注册 `agentStop` 和 `errorOccurred`，排除子代理、退出会话、可恢复及工具错误。成功摘要只读当前助手结果；跨用户输入边界不复用旧回答，读取尾部最多 256 KiB。不从额度变化推测完成。
- 当前结果 ID 优先用于重试身份；没有结果时按官方 hook 时间建立会话内事件身份，不退化为整个会话一个 ID。没有可信身份则不创建记录。[Copilot 事件参考](https://github.com/github/copilot-sdk/blob/main/docs/features/agent-loop.md)。
- Antigravity 按 [官方 hook 协议](https://www.antigravity.google/docs/hooks) 维护 `~/.gemini/config/hooks.json` 下的 `pome-panel.Stop`。只增删标记项，保留同文件其他命名 hook 和配置；连接时只检测真实 Antigravity 数据目录，不把 Gemini 本身误判为 Antigravity。`fullyIdle=true` 且 `terminationReason=model_stop` 才完成，error/max_steps_exceeded 标失败，取消、未知原因及有后台工作的状态不报完成。会话与 executionNum 区分轮次。
- Antigravity 官方 Stop 没有答案正文且本机未安装客户端，首版不猜转录格式，成功使用来源默认标题。App、IDE、CLI 分别返回对应应用或终端；只使用已知产品名作为路由提示，不采用记录中的任意 bundle ID。Copilot CLI 打开终端。Windows 原生能力关闭时保留现有点击限制。
- 两家同时接入通知、收件箱、NAS 已读与最新 100 条历史裁剪。渲染层来源名称和图标改为读取统一 catalog，补充“所有完成来源均有图标和 NAS 结构”的一致性测试。Manus、Grok Bot 保持 unsupported；Copilot VS Code 与云端明确不在本轮范围。
- 两家均标 partial。本机未检测到客户端，使用按官方字段构造的精简样本，不把隔离测试当作真实模型验收。Stop 都可被其他 hook 阻止；与阻止停止的 hook 并用时，单独观察该信号无法证明最终完成，此限制继续保留。
- 专项覆盖配置保留、损坏/过期预览、自定义目录、带空格/单引号安装路径、重复与后续轮次、失败/取消/子代理、静默故障、平台打开与 Windows 回退。新增 Electron 场景通过实际配置执行脚本并走生产接收/界面，NAS 场景覆盖真实本地模拟服务与双设备读状态、容量及跨设备窗口信息剥离。

验收结果：完整 `npm test` 通过，788 项 Node 测试中 787 通过、1 项平台专属跳过；25 次 Electron 场景/独立重启检查通过，语法和本地化检查通过。额外复验同名通知的事件身份与非空截图，避免截到切换动画。官网 22 项测试和 lint 通过，`git diff --check` 通过；六家工具的真实配置前后哈希一致。两个打包目标的文件清单均包含新脚本和共享转发模块，未执行打包。

主要文件：`scripts/copilot-notify.js`、`scripts/antigravity-notify.js`、`scripts/completion-forwarder.js`、`aiSourceHooks.js`、`aiProviderCatalog.js`、通知/收件箱渲染文件、平台打开适配器、桌面/NAS 两份同步协议及相关测试。Copilot 与 Antigravity 占位图已替换为正式来源轮廓，来源和许可保存在 `renderer/assets/inbox/README.md`。

截图：`dist.noindex/additional-completion/`（设置页、Copilot 多轮/失败、Antigravity 完成/失败/CLI/IDE）；Windows 原生能力关闭预览在 `dist.noindex/notification-design/windows-{copilot,antigravity}-native-off.png`。完整日志：`/private/tmp/pome-two-source-final-full.log`；最终界面复验：`/private/tmp/pome-two-source-final-ui.log`。本轮保持在 dev，未提交、推送或发布。
