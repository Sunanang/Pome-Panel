; electron-builder 自动把 build/installer.nsh 作为 nsis.include 引入（不必进 build.files）。
;
; P3-1：开机自启的注册表值名默认等于 AppUserModelId（main.js 里设置的
; com.dynamicpanel.app），默认卸载器不会清理它，卸载后系统仍会尝试拉起
; 已经不存在的 exe。任务管理器的"启动应用"开关另存在 StartupApproved\Run，
; 同样要删，否则重装后会沿用上一次的禁用状态。
;
; ${isUpdated} 保护是必须的：升级安装时旧版本的卸载器也会跑一遍，
; 不加判断就会把用户的自启设置连同升级一起抹掉。

; 使用标准安装向导：先说明目录与快捷方式，再进入可浏览的目录选择页。
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "安装 Pome Panel"
  !define MUI_WELCOMEPAGE_TEXT "此向导将安装 Pome Panel。$\r$\n$\r$\n下一步可以选择程序的安装目录。安装完成后，将在桌面和开始菜单创建启动快捷方式。"
  !insertmacro MUI_PAGE_WELCOME
  !define MUI_DIRECTORYPAGE_TEXT_TOP "请选择 Pome Panel 的安装目录。程序文件保存在此目录，桌面将创建启动快捷方式。"
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.dynamicpanel.app"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.dynamicpanel.app"
  ${endIf}
!macroend
