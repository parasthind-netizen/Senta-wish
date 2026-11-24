# Registers a Windows scheduled task that starts Techsara Secret Santa (hidden) every time
# you sign in to Windows, then starts it right away. No administrator rights needed.
#   powershell -ExecutionPolicy Bypass -File deploy\windows\install-autostart.ps1
$taskName = 'Techsara Secret Santa'
$runner = Join-Path $PSScriptRoot 'run-santa.ps1'
$user = "$env:USERDOMAIN\$env:USERNAME"

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable `
  -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
  -Principal $principal -Description 'Runs the Techsara Secret Santa website (deploy\windows\run-santa.ps1).' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host "Scheduled task '$taskName' installed and started."
