## 选择你的安装包

| 电脑 | 下载文件 | 安装方式 |
| --- | --- | --- |
| Mac · Apple Silicon · macOS 13+ | [下载 macOS 安装包（.dmg）](https://github.com/Sunanang/Pome-Panel/releases/download/v{{VERSION}}/Pome-Panel-{{VERSION}}-arm64.dmg) | 打开 DMG，将应用拖入「应用程序」 |
| Windows 10/11 · Intel / AMD 64 位（x64） | [下载 Windows 安装包（.exe）](https://github.com/Sunanang/Pome-Panel/releases/download/v{{VERSION}}/Pome-Panel-{{VERSION}}-windows-x64-setup.exe) | 双击 EXE，按安装向导完成安装 |
| 飞牛 fnOS · x86 / ARM（通用包） | [下载 NAS 伴侣（.fpk）](https://github.com/Sunanang/Pome-Panel/releases/download/v{{VERSION}}/Pome-Panel-{{VERSION}}-fnos-all.fpk) | 在飞牛应用中心手动安装，需 Node.js 22 运行时 |

`.sha256` 是对应文件的完整性校验码，不是安装包。安装包从本 Release 下载。

三端产物由 GitHub Actions 构建，全部任务成功后才发布。NAS 自动检查覆盖服务与打包流程，不包含真实 NAS 的安装、升级及卸载验证。

## {{VERSION}} · 双端统一

- 新增简体中文 / English。首次启动随系统语言，其他语言回退英文；桌面与 NAS 网页可手动切换，本机偏好不参与同步。安装/卸载向导仅中英并随系统。录音识别语言独立设置，智能命名按内容语言，用户原文保持不变。

- Windows 布局与 Mac 一致：胶囊可拖到工作区四边吸附，展开方向随停靠边变化，收起回到原位；展开尺寸统一为 1240 × 638，按工作区留 24px 安全边，不压任务栏。
- Mac 默认收起位置改到菜单栏下方，与拖到顶部后一致；去掉转写设置弹层多余的顶部留白。
- Windows 收起窗口缩到胶囊大小，修复收起态透明边框挡住下方点击的问题。
- Windows 界面：字体回退到 Segoe UI Variable / Segoe UI / 微软雅黑，滚动区改为 3px 细轨，小字号提半级；托盘与安装包使用多尺寸 `.ico`。
- 唤出快捷键按平台显示（Windows 为 Ctrl / Alt / Shift / Win），Win 键组合可录入。
- 麦克风或摄像头被系统挡住时，提示里可直接打开对应的隐私设置页。
- Windows 全新安装默认开启开机自启，升级用户保持原状；卸载时清理启动项。
- Windows 原生能力（实验功能，默认关闭）：在设置页打开后，首页「当前窗口」可列出并切换窗口，剪贴板可自动粘贴回原窗口，完成通知点击可聚焦对应项目窗口。开关关闭时不加载原生模块。

## 首次安装

Mac 采用 ad-hoc 签名，不进行 Apple 公证。若首次被系统拦截，打开「系统设置 → 隐私与安全性」并点击「仍要打开」。

Windows 安装包目前没有商业代码签名，首次运行可能显示「Windows 已保护你的电脑」。请确认来自本仓库 Release 并核对校验码，再通过「更多信息 → 仍要运行」继续。安装在当前用户目录，无需管理员权限。受组织策略管理的电脑可能需要管理员批准。

Windows 使用 GitHub 托管 Windows runner 验证安装、程序启动、核心 IPC、系统加密、快捷键、录音/摄像头模拟设备生命周期、重新安装数据保留与卸载。物理摄像头/麦克风、Windows 10 实机、多显示器硬件与特定安全软件不属于此次自动测试覆盖范围。

---

## Choose your installer

| Device | Download | Installation |
| --- | --- | --- |
| Apple Silicon Mac · macOS 13+ | [macOS DMG](https://github.com/Sunanang/Pome-Panel/releases/download/v{{VERSION}}/Pome-Panel-{{VERSION}}-arm64.dmg) | Open the DMG and drag Pome Panel to Applications |
| Windows 10/11 · Intel/AMD x64 | [Windows setup EXE](https://github.com/Sunanang/Pome-Panel/releases/download/v{{VERSION}}/Pome-Panel-{{VERSION}}-windows-x64-setup.exe) | Run setup, choose the installation folder and use the desktop/Start menu shortcut |
| fnOS NAS · x86/ARM universal | [NAS companion FPK](https://github.com/Sunanang/Pome-Panel/releases/download/v{{VERSION}}/Pome-Panel-{{VERSION}}-fnos-all.fpk) | Install manually in App Center; Node.js 22 runtime is required |

The `.sha256` files verify integrity; they are not installers. Website buttons separately download Mac and Windows packages. GitHub Actions publishes only after all three builds pass. NAS automation does not replace real install, upgrade and uninstall checks.

## {{VERSION}} · Shared desktop experience

- Chinese/English interface: first launch follows the system, with English fallback. Desktop/NAS manual preferences stay local. Native setup/uninstall use the system language. Recognition is independent; smart naming follows content, preserving user text.
- Both desktop platforms support four-edge docking, expansion from the saved edge and `1240 × 638` windows with 24px work-area margins.
- Mac defaults below the menu bar; transcription settings remove unnecessary top space. Windows collapses to the capsule without an invisible click-blocking frame.
- Windows uses Segoe UI Variable/Segoe UI/Microsoft YaHei, thin 3px scrollbars, clearer small text and multi-size tray/installer icons.
- Shortcut labels follow each platform, including Win combinations. Camera/microphone errors open the relevant privacy settings directly.
- Fresh Windows installs enable launch at login; upgrades preserve the previous choice and uninstall removes registration.
- Windows native capabilities remain experimental and off by default. Enabling them allows Current windows, clipboard paste and notification focus; disabled means no native module is loaded.

## First installation

Mac uses ad-hoc signing without Apple notarization. If blocked, open System Settings → Privacy & Security → Open Anyway.

Windows setup is unsigned and may show Windows protected your PC. Verify the package comes from this repository's Release and check its checksum before choosing More info → Run anyway. Per-user installation needs no administrator rights; organization policy may still require approval.

Windows CI covers installation, application startup, core IPC, system encryption, shortcuts, simulated recording/camera release, reinstall data retention and uninstall. Physical devices, Windows 10 hardware, multiple monitors and specific security products require separate checks. See the [English guide](https://github.com/Sunanang/Pome-Panel/blob/dev/README.en.md) and [complete release history](https://github.com/Sunanang/Pome-Panel/blob/dev/CHANGELOG.en.md).
