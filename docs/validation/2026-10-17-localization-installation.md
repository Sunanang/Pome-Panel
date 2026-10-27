# 中英双语 Mac / NAS 实机安装验证

日期：2026-10-17。分支：`dev`。版本：0.11.0。用户明确授权本机打包、安装和验证；安装验证阶段没有提交或推送。随后用户另行授权提交、推送至 dev；不涉及合并 main、创建标签、GitHub Release 或官网发布。

## 结果

| 项目 | 实测结果 |
| --- | --- |
| Mac DMG | `npm run build` 成功；镜像校验通过，只读挂载后安装至 `/Applications/Pome Panel.app`；实际安装应用 `codesign --verify --deep --strict` 通过，可启动并展开首页、设置。 |
| Mac 界面 | 系统中文首次启动显示中文；手动选 English 后菜单和设置显示英文；退出重开仍保留 English；验证后恢复「跟随系统」，重新显示中文。用户笔记和实际 AI 摘要保留原文。 |
| Mac 原生说明 | 实际安装资源经 Foundation `Bundle.main.localizedInfoDictionary` 分别按 zh-CN、en-US 解析，摄像头、麦克风、系统事件、局域网四项均得到正确语言。实际权限引导窗口显示英文。没有主动开启摄像头/麦克风来触发全部系统安全弹窗。 |
| NAS FPK | 官方 fnpack 1.2.3 构建成功；国内版 fnOS 1.2.0800 应用中心完成安装；最终 `app status` 为 running、microApp=true。安装的 Node.js 22 依赖保持不变。 |
| NAS 页面 | 独立网页和飞牛桌面内嵌入口均打开成功，沿用当前 Lando 登录；English 切换和刷新保持通过，原有三台设备正常显示；恢复「跟随系统」后重开内嵌页面显示中文。 |
| NAS 原生向导 | 实际新安装向导中文正确解析，端口与 LAN 选项可操作；新配置向导 JSON 已由系统读取。当前国内版宿主没有找到语言切换入口，因此没有声称英文原生安装/卸载向导实机通过。 |
| 数据保留 | 安装前后 server-id 相同、sync-state.bin 字节相同；原有三台配对设备保留；端口 45875、监听范围 0.0.0.0 保留。 |

## 安装方式与回退

Mac 旧应用完整保存在 `dist.noindex/install-validation-20261017/previous-Pome Panel.app`。只替换应用目录，没有清空用户资料。用户自行处理了钥匙串授权；没有读取密码。DMG 验证后卸载挂载。

NAS 同版本安装会被应用中心拒绝，因此没有改版本号规避。先停用，使用既有 SSH 对应用私有 var / etc / home 做 root-only 备份，再由应用中心选择「保留已有文件」卸载并安装新 FPK，复用原端口和 LAN 配置。备份保存在 NAS `/vol1/@appdata/.pome-panel-install-backup-20261017/`，未删除。NAS 的读取、上传、状态查询和停用优先使用 fnos skill 的 trim-cli；私有目录备份和静默字节比较不在 CLI 能力内，才使用 SSH。依赖需要 UI 确认时使用应用中心，没有绕过安全检查。

没有吊销设备、生成新配对码、清空业务资料，或修改真实 Codex / Cursor / Claude 配置。

## 观察到的限制

- Mac 现有 NAS 地址显示「本机曾配置同步地址，但设备令牌已丢失，请重新配对」。这只确认当前安装版无法取得有效设备令牌，不能据此认定为本地化回归；临时 ad-hoc 构建签名与旧安全存储授权可能有关。原有加密资料保留，没有自动重新配对或覆盖令牌。本轮不声称 Mac 与 NAS 已完成真实同步。
- Mac 当前窗口能力提示需要屏幕录制权限；验证中选择「以后再说 / Later」，没有修改系统权限。
- 实机发现 NAS 英文端口说明拼接处缺空格，已在英文源字典补齐并重新生成资源；35 项相关测试通过。安装截图与已安装的这份包取自该空格修正之前。该差异仅为说明文字间的空格，没有再次卸载 NAS 或替换 Mac 应用来重复安装验证。
- Windows 的安装/卸载、国际 NAS 的英文宿主语言传入及原生英文向导，仍需对应系统验收。没有真实英文转写音频验收。

## 测试与证据

此前完整 `npm test` 通过：682 项 Node 测试中 681 通过、1 项 Windows 专属跳过；17 个 Electron 夹具及两次真实重启通过。官网 22 项测试、lint、Pages 静态构建通过。实机英文空格修正后重跑 `tests/localization.test.js` 与 `tests/fnos-device-port.test.js`，35 / 35 通过。初次受沙箱限制出现 listen EPERM，获本机端口运行权限后通过。

证据目录：`dist.noindex/install-validation-20261017/`（本机忽略产物，不提交安装包、日志或备份）：

- `mac-build.log`、`nas-build.log`：打包日志。
- `installed-artifacts.sha256`：实际验证的 DMG、FPK 哈希。
- `mac-installed-codesign.log`：已安装应用签名校验。
- `mac-installed-english.png`、`mac-installed-system.png`：英文与恢复系统语言后的 Mac 设置。
- `mac-installed-permission-english.png`：实际英文权限引导。
- `mac-native-zh.json`、`mac-native-en.json`：Foundation 原生本地化资源解析。
- `nas-installer-chinese.png`：实际中文安装向导。
- `nas-installed-english.png`、`nas-installed-embedded-english.png`：NAS 独立页及飞牛内嵌英文启动。
- `nas-installed-embedded-system.png`：恢复系统语言后的 NAS 内嵌中文启动。
- `nas-native-config-wizard.json`、`nas-final-status.json`、`nas-data-retention.log`：原生配置、最终状态和保留核对，不含密码/token。
- `copy-spacing-tests.log`：最后 35 项测试结果。

## 手动查看

Mac 打开 `/Applications/Pome Panel.app`，点击顶部胶囊 → 设置 → 语言，可在「跟随系统 / 简体中文 / English」间切换。

NAS 打开 `http://192.168.1.13:9527/`，双击桌面 Pome Panel；右上角选择语言。独立入口为同地址下 `/app/pome-panel`，需要已有飞牛登录。没有对公网开放新端口。
