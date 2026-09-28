## 选择你的安装包

| 电脑 | 下载文件 | 安装方式 |
| --- | --- | --- |
| Mac · Apple Silicon · macOS 13+ | [下载 macOS 安装包（.dmg）](https://github.com/Sunanang/Pome-Panel/releases/download/v{{VERSION}}/Pome-Panel-{{VERSION}}-arm64.dmg) | 打开 DMG，将应用拖入「应用程序」 |
| Windows 10/11 · Intel / AMD 64 位（x64） | [下载 Windows 安装包（.exe）](https://github.com/Sunanang/Pome-Panel/releases/download/v{{VERSION}}/Pome-Panel-{{VERSION}}-windows-x64-setup.exe) | 双击 EXE，按安装向导完成安装 |

`.sha256` 是对应文件的完整性校验码，不是安装包。官网提供 macOS 与 Windows 两个下载入口。

## {{VERSION}} · 双端统一

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
