param(
  [Parameter(Mandatory=$true)][string]$TrialRoot,
  [switch]$RequireUnattended
)
$ErrorActionPreference='Stop'
$backupPath=Join-Path $TrialRoot 'state/config/local_tts_backup.json'
if (-not (Test-Path -LiteralPath $backupPath)) { return }
if ((Get-Content -LiteralPath $backupPath -Raw | ConvertFrom-Json).enabled -ne $true) { return }
$arguments=@{
  Config=Join-Path $TrialRoot 'runtime/index-tts-backup/wsl-config.json'
  ProcessFile=Join-Path $TrialRoot 'local-tts-process.json'
  LogDirectory=Join-Path $TrialRoot 'logs'
}
if ($RequireUnattended) { $arguments.TrialState=Join-Path $TrialRoot 'unattended-state.json' }
& (Join-Path $PSScriptRoot 'start-wsl.ps1') @arguments
