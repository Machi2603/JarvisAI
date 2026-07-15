param(
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$TaskName = "OpenJarvisAudioSatellite"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Python = Join-Path $RepoRoot ".venv-satellite\Scripts\pythonw.exe"

if ($Uninstall) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Jarvis audio satellite removed from Windows startup."
    exit 0
}

if (-not (Test-Path $Python)) {
    throw "Missing $Python. Create the satellite environment before installing startup."
}

$Arguments = "-m openjarvis.windows_satellite --repo-root `"$RepoRoot`""
$Action = New-ScheduledTaskAction `
    -Execute $Python `
    -Argument $Arguments `
    -WorkingDirectory $RepoRoot
$Trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$Settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -StartWhenAvailable

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Description "Always-on local Hey Jarvis audio satellite" `
    -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName
Write-Host "Jarvis audio satellite installed and started."
