param(
  [Parameter(Mandatory=$true,Position=0)][string]$RuntimePath,
  [Parameter(Mandatory=$true,Position=1)][string]$ScriptPath,
  [Parameter(Mandatory=$true,Position=2)][string]$PomeMarker,
  [Parameter(ValueFromRemainingArguments=$true)][string[]]$PayloadArguments
)
$ErrorActionPreference = 'Stop'
$env:ELECTRON_RUN_AS_NODE = '1'
$PomeMarker = '--' + $PomeMarker
function Quote-NativeArgument([string]$Value) {
  # Windows CommandLineToArgvW quoting, including trailing backslashes.
  $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
  $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
  return '"' + $escaped + '"'
}
$arguments = @($ScriptPath, $PomeMarker)
if ($PomeMarker -eq '--pome-panel-hook=codex') {
  if ($PayloadArguments.Count -gt 0) {
    $arguments += '--pome-forward=' + $PayloadArguments[0]
    $payload = $PayloadArguments[-1]
    if (-not $payload.StartsWith('--pome-')) {
      $arguments += '--pome-payload=' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payload))
    }
  }
}
$start = New-Object Diagnostics.ProcessStartInfo
$start.FileName = $RuntimePath
$start.Arguments = ($arguments | ForEach-Object { Quote-NativeArgument $_ }) -join ' '
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.RedirectStandardInput = $true
$child = [Diagnostics.Process]::Start($start)
if ($PomeMarker -ne '--pome-panel-hook=codex') { $child.StandardInput.Write([Console]::In.ReadToEnd()) }
$child.StandardInput.Close()
$child.WaitForExit()
exit $child.ExitCode
