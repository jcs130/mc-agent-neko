param(
  [Parameter(Mandatory=$true)][string]$TrialRoot,
  [switch]$RequireUnattended
)
$ErrorActionPreference='Stop'
$primaryPath=Join-Path $TrialRoot 'state/config/local_tts_primary.json'
$primary=$null
if (Test-Path -LiteralPath $primaryPath) { $primary=Get-Content -LiteralPath $primaryPath -Raw | ConvertFrom-Json }
if ($primary -and $primary.enabled -eq $true -and $primary.model -eq 'voxcpm2') {
  $arguments=@{
    Config=Join-Path $TrialRoot 'runtime/voxcpm2-primary/wsl-config.json'
    ProcessFile=Join-Path $TrialRoot 'local-voxcpm2-process.json'
    LogDirectory=Join-Path $TrialRoot 'logs'
  }
  if ($RequireUnattended) { $arguments.TrialState=Join-Path $TrialRoot 'unattended-state.json' }
  & (Join-Path $PSScriptRoot '../local-index-tts/start-wsl.ps1') @arguments
} else {
  & (Join-Path $PSScriptRoot '../local-index-tts/ensure-trial-backup.ps1') -TrialRoot $TrialRoot -RequireUnattended:$RequireUnattended
}
