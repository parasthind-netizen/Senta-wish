# Keeps Techsara Secret Santa running on this Windows machine.
# Started (hidden) by the "Techsara Secret Santa" scheduled task – see install-autostart.ps1.
# If the server ever exits, it is restarted after 5 seconds. Output goes to logs\server.log.
$ErrorActionPreference = 'Continue'
$app = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $app

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }

$logDir = Join-Path $app 'logs'
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir 'server.log'

while ($true) {
  # Simple rotation so the log never grows without limit
  if ((Test-Path $log) -and (Get-Item $log).Length -gt 10MB) {
    Move-Item -Force $log (Join-Path $logDir 'server.old.log')
  }
  Add-Content -Path $log -Value "`r`n==== $(Get-Date -Format s) starting Techsara Secret Santa ====" -Encoding UTF8
  & cmd.exe /c "`"$node`" --env-file=.env server.js >> `"$log`" 2>&1"
  Add-Content -Path $log -Value "==== $(Get-Date -Format s) server exited (code $LASTEXITCODE) - restarting in 5s ====" -Encoding UTF8
  Start-Sleep -Seconds 5
}
