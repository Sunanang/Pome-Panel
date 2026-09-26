$ErrorActionPreference = 'Stop'
$version = node -p "require('./package.json').version"
$installer = Join-Path (Get-Location) "dist.noindex/Pome-Panel-$version-windows-x64-setup.exe"
if (!(Test-Path $installer)) { throw "Missing installer: $installer" }
$testRoot = Join-Path $env:RUNNER_TEMP ("todo-install-" + [guid]::NewGuid().ToString())
$installDir = Join-Path $testRoot 'Pome Panel'
$profile = Join-Path $testRoot 'profile'
New-Item -ItemType Directory -Path $testRoot | Out-Null
$env:SMOKE_ARTIFACT_DIR = Join-Path (Get-Location) 'dist.noindex/windows-smoke'
function Install-Panel {
  $process = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$installDir") -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
  if (!(Test-Path "$installDir/Pome Panel.exe")) { throw 'Installed executable missing' }
}
Install-Panel
# P4-0：koffi 3.x 的原生模块在平台子包里（asar:false，无需解包）。装完必须真的躺在
# 安装目录下，否则 Windows 原生能力（当前窗口 / 自动粘贴）在实机上一开就失败。
$koffiRoot = Join-Path $installDir 'resources/app/node_modules/@koromix/koffi-win32-x64'
if (!(Test-Path $koffiRoot)) { throw "Missing koffi native subpackage: $koffiRoot" }
if (!(Get-ChildItem -Path $koffiRoot -Recurse -Filter '*.node' | Select-Object -First 1)) {
  throw "koffi subpackage ships no .node binary: $koffiRoot"
}
node scripts/smoke-app.js "$installDir/Pome Panel.exe" $profile
if ($LASTEXITCODE -ne 0) { throw 'Installed application smoke failed' }
Install-Panel
node scripts/smoke-app.js "$installDir/Pome Panel.exe" $profile retained
if ($LASTEXITCODE -ne 0) { throw 'Reinstall retention smoke failed' }
$uninstaller = Get-ChildItem -Path $installDir -Filter 'Uninstall*.exe' | Select-Object -First 1
if (!$uninstaller) { throw 'Uninstaller missing' }
$process = Start-Process -FilePath $uninstaller.FullName -ArgumentList @('/S', "_?=$installDir") -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Uninstaller failed: $($process.ExitCode)" }
if (Test-Path "$installDir/Pome Panel.exe") { throw 'Uninstall left executable behind' }
if (!(Test-Path "$profile/workspace.json")) { throw 'Uninstall deleted retained user data' }
# P3-1：卸载后不能留下开机自启项，否则系统会一直尝试拉起已被删掉的 exe。
# 注册表值名等于 AppUserModelId；任务管理器的启用状态另存在 StartupApproved\Run。
$appUserModelId = node -p "require('./package.json').build.appId"
foreach ($runKey in @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run',
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
)) {
  if (Test-Path $runKey) {
    $names = (Get-ItemProperty -Path $runKey).PSObject.Properties.Name
    if ($names -contains $appUserModelId) { throw "Uninstall left an auto-launch entry in $runKey" }
  }
}
$hash = (Get-FileHash -Algorithm SHA256 -Path $installer).Hash.ToLowerInvariant()
"$hash  $([IO.Path]::GetFileName($installer))" | Set-Content -Encoding ascii "$installer.sha256"
Write-Output 'Windows install, launch, reinstall, data retention and uninstall passed.'
