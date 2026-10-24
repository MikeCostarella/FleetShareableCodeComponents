<#
  Register (or re-register) the Windows scheduled task that runs
  refresh-absentee.ps1 twice a day on this machine.

    powershell -ExecutionPolicy Bypass -File C:\projects\{{REPO}}\react-app\scripts\register-absentee-task.ps1

  Times: 8:12 AM and 6:22 PM. The Board stamps its file around 6:03 PM, so
  the evening run picks up the day's file; the morning run catches anything
  posted overnight. If the PC is asleep at those times the task runs as soon
  as it wakes (StartWhenAvailable).

  Runs as you, only while you are logged on, so it uses your own git
  credentials - no password is stored in the task.

  To remove it after the election:
    Unregister-ScheduledTask -TaskName "<repo> absentee refresh" -Confirm:$false
#>
$ErrorActionPreference = 'Stop'
$Script = Join-Path $PSScriptRoot 'refresh-absentee.ps1'
$Repo   = Split-Path -Leaf (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$Task   = "$Repo absentee refresh"

$action   = New-ScheduledTaskAction -Execute 'powershell.exe' `
              -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Script`""
$triggers = @(
  (New-ScheduledTaskTrigger -Daily -At '8:12 AM'),
  (New-ScheduledTaskTrigger -Daily -At '6:22 PM')
)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 15) `
              -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $Task -Action $action -Trigger $triggers -Settings $settings `
  -Principal $principal -Description "Fetch the Board's absentee file and push it when it changes ($Script)" -Force | Out-Null

Write-Host "Registered scheduled task: $Task"
Write-Host "  runs $Script at 8:12 AM and 6:22 PM daily"
Write-Host "  log:  $env:LOCALAPPDATA\CountyVoters\$Repo-absentee.log"
Write-Host "Run it now with:  Start-ScheduledTask -TaskName `"$Task`""
