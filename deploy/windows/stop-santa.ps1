# Stops Techsara Secret Santa.
#   powershell -ExecutionPolicy Bypass -File deploy\windows\stop-santa.ps1           -> stop now (starts again at next sign-in)
#   powershell -ExecutionPolicy Bypass -File deploy\windows\stop-santa.ps1 -Remove   -> stop and remove auto-start
param([switch]$Remove)
$taskName = 'Techsara Secret Santa'
$app = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

# 1. Stop the scheduled task and its restart loop (so it doesn't bring the server back)
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
}
Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
  Where-Object { $_.CommandLine -like '*run-santa.ps1*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# 2. Stop only the node process listening on this app's PORT (from .env, default 3000)
$port = 3000
$envFile = Join-Path $app '.env'
if (Test-Path $envFile) {
  $line = Select-String -Path $envFile -Pattern '^\s*PORT\s*=\s*(\d+)' | Select-Object -First 1
  if ($line) { $port = [int]$line.Matches[0].Groups[1].Value }
}
Start-Sleep -Milliseconds 500
$conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) {
  $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
  if ($proc -and $proc.ProcessName -eq 'node') {
    Stop-Process -Id $proc.Id -Force
    Write-Host "Stopped Secret Santa server on port $port (pid $($proc.Id))."
  } elseif ($proc) {
    Write-Host "Port $port is used by '$($proc.ProcessName)', not Secret Santa - left it alone."
  }
} else {
  Write-Host "Nothing was listening on port $port."
}

if ($Remove) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host 'Auto-start removed.'
}
