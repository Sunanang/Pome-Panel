param([int]$OwnPid, [string]$OwnExecutable)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
# Compile once in a persistent child. No profiles, network, registry writes,
# media acquisition or input injection. The child exits when the parent closes stdin.
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'meeting-probe.cs'), [Text.Encoding]::UTF8)
Add-Type -TypeDefinition $source -ReferencedAssemblies @('System.dll', [System.Windows.Automation.AutomationElement].Assembly.Location, [System.Windows.Automation.ControlType].Assembly.Location, [System.Windows.DependencyObject].Assembly.Location)
$camera = New-Object -TypeName PomeMeeting.CameraReader -ArgumentList $OwnPid, $OwnExecutable
try {
    while ($null -ne ($request = [Console]::ReadLine())) {
        $result = @{ schemaVersion = 1; camera = $camera.Read(); sharing = [PomeMeeting.SystemReader]::Sharing(); focus = [PomeMeeting.SystemReader]::Focus() }
        [Console]::WriteLine(($result | ConvertTo-Json -Compress -Depth 5))
    }
} finally { $camera.Dispose() }
