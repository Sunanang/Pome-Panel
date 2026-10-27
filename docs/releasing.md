# 双平台发布流程

每个版本在同一 GitHub Release 提供两个独立安装包和各自 SHA-256：
- Mac：`Pome-Panel-<版本>-arm64.dmg`，macOS 13+ Apple Silicon，ad-hoc 签名。
- Windows：`Pome-Panel-<版本>-windows-x64-setup.exe`，Windows 10/11 x64，NSIS 当前用户安装，暂无商业代码签名。

## 发布前

1. `package.json`、`package-lock.json` 版本一致；CHANGELOG、README 稳定版本、`docs/release-notes.md` 对齐。发布说明里的下载链接写 `{{VERSION}}`，由工作流按 package.json 版本替换，不要写死版本号。
2. 运行桌面端 `npm test`，覆盖桌面与 NAS 共用协议、服务和界面回归。
3. `Release macOS and Windows` 工作流的手动运行只验证并上传 Actions artifacts；不创建 Release。`main`、`feat/**` 分支推送与 Pull Request 也执行同样验证。
4. Windows runner 运行 `npm run build:win`，随后 `scripts/verify-windows.ps1` 安装实际 EXE、启动真实程序、验证核心 IPC/数据/系统加密/快捷键/模拟相机与录音释放，并打开一次「Windows 原生能力」开关确认 koffi 可加载、窗口列表可用，重新安装检查数据，再卸载。
5. Mac runner 运行 `npm run build`、codesign 与 hdiutil 校验。两者全部通过才允许发布。
6. 不提交 node_modules、dist、密码、API Key、录音、剪贴板或测试用户数据。

## 正式发布

用户确认发布后，通过 `dev → main` PR 合并，再推送与 package.json 匹配的 `v*.*.*` 标签。工作流重新构建验证两个平台，汇总资产校验 SHA-256，再创建一个 Release。任何平台失败均不会创建 Release；修复后在发布前重新验证，不覆盖已发布版本。

下载入口统一使用 GitHub Releases。

发布后检查：
- Actions 两个平台及发布步骤成功。
- Release 有两个安装包与两个校验文件，版本及 SHA-256 相符。
- README 的 GitHub Releases 下载入口有效。
- 发布说明区分系统要求、首次系统拦截提示、Windows 首版功能限制及自动测试边界。

## 本地构建

`npm run build` 生成 Mac DMG；`npm run build:win` 生成 Windows EXE。使用对应系统构建最稳妥，CI 可从 Mac 发起并在 Windows 执行。安装包不要求终端用户安装 Node.js；通知转发脚本由相应 AI 工具的 Node 环境调用。

Windows 默认安装路径为 `%LOCALAPPDATA%/Programs/Pome Panel`（以安装向导为准），通知脚本位于安装目录的 `resources/app/scripts/`。普通工作区可复制迁移，系统加密密钥不能跨用户或操作系统直接解密，应重新输入。卸载默认保留工作区。

## 测试边界

Windows runner 属于托管 Windows Server 环境。自动化验证并不等于 Windows 10/11 每种硬件都已实测。物理相机/麦克风、多显示器插拔、DPI 混用、组织策略和 SmartScreen 信誉需要真实用户设备持续反馈。测试截图和日志保存在 Actions 的 windows-test-evidence artifact。
