; electron-builder 自动把 build/installer.nsh 作为 nsis.include 引入（不必进 build.files）。
;
; P3-1：开机自启的注册表值名默认等于 AppUserModelId（main.js 里设置的
; com.dynamicpanel.app），默认卸载器不会清理它，卸载后系统仍会尝试拉起
; 已经不存在的 exe。任务管理器的"启动应用"开关另存在 StartupApproved\Run，
; 同样要删，否则重装后会沿用上一次的禁用状态。
;
; ${isUpdated} 保护是必须的：升级安装时旧版本的卸载器也会跑一遍，
; 不加判断就会把用户的自启设置连同升级一起抹掉。

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.dynamicpanel.app"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.dynamicpanel.app"
  ${endIf}
!macroend
