param(
  [Parameter(Mandatory=$true)][string]$Config,
  [Parameter(Mandatory=$true)][string]$ProcessFile,
  [Parameter(Mandatory=$true)][string]$LogDirectory,
  [ValidateSet('Start','Status','Stop')][string]$Action='Start',
  [string]$TrialState
)
$ErrorActionPreference='Stop'
$settings=Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json
$distro=[string]$settings.distribution
$linuxRoot=[string]$settings.linux_root
$engine=if ($settings.backend) { [string]$settings.backend } else { 'indextts2' }
switch ($engine) {
  'indextts2' { $port=18040; $model='indextts-2.5'; $unitName='neko-index-tts.service'; $otherUnit='neko-voxcpm2.service' }
  'voxcpm2' { $port=18041; $model='voxcpm2'; $unitName='neko-voxcpm2.service'; $otherUnit='neko-index-tts.service' }
  default { throw 'Invalid local TTS backend.' }
}
if ($distro -notmatch '^[A-Za-z0-9._-]+$' -or
    $linuxRoot -notmatch '^/opt/[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*$' -or
    $settings.port -ne $port) { throw 'Invalid local TTS configuration.' }
$keeper="$linuxRoot/keep-alive.sh"
$mutex=[Threading.Mutex]::new($false,'Local\NekoLocalTtsWsl')
$ownsMutex=$false
try { $ownsMutex=$mutex.WaitOne(0) }
catch [Threading.AbandonedMutexException] { $ownsMutex=$true }
if (-not $ownsMutex) { $mutex.Dispose(); Write-Output 'Another local TTS lifecycle operation is in progress.'; return }
try {
function Test-OwnedKeeper($Candidate) {
  return ($Candidate -and $Candidate.Name -eq 'wsl.exe' -and
    $Candidate.CommandLine -and $Candidate.CommandLine.Contains($distro) -and
    $Candidate.CommandLine.Contains($keeper))
}
function Get-RecordedKeeper {
  if (-not (Test-Path -LiteralPath $ProcessFile)) { return $null }
  $record=Get-Content -LiteralPath $ProcessFile -Raw | ConvertFrom-Json
  $candidate=Get-CimInstance Win32_Process -Filter "ProcessId=$($record.pid)" -ErrorAction SilentlyContinue
  if (-not (Test-OwnedKeeper $candidate)) { return $null }
  $recordedTime=if ($record.started -is [DateTime]) {
    $record.started.ToUniversalTime()
  } else { [DateTimeOffset]::Parse([string]$record.started).UtcDateTime }
  if ([Math]::Abs(($candidate.CreationDate.ToUniversalTime()-$recordedTime).TotalSeconds) -gt 10) {
    throw 'Stale TTS keeper record; no process was stopped.'
  }
  return $candidate
}
function Save-KeeperRecord($Candidate) {
  @{
    pid=$Candidate.ProcessId; started=$Candidate.CreationDate.ToString('o')
    distribution=$distro; linux_root=$linuxRoot; backend='vllm-omni'; port=$port; model=$model; unit=$unitName
  } | ConvertTo-Json | Set-Content -LiteralPath $ProcessFile -Encoding utf8
}
$owned=Get-RecordedKeeper
if ($Action -eq 'Status') {
  $ready=$false
  try {
    $models=Invoke-RestMethod "http://127.0.0.1:$port/v1/models" -TimeoutSec 3
    $ready=[bool]($models.data | Where-Object id -eq $model)
  } catch { }
  [pscustomobject]@{keeper_alive=[bool]$owned; api_ready=$ready; backend='vllm-omni'; port=$port; model=$model}
  return
}
if ($Action -eq 'Stop') {
  # Verify the unit's ExecStart before touching it; never terminate a distro.
  $unit=(& wsl.exe -d $distro --exec systemctl show $unitName -p ExecStart --value 2>$null) -join "`n"
  if ($LASTEXITCODE -ne 0 -or -not $unit.Contains("$linuxRoot/run.sh")) {
    throw 'Cannot verify ownership of the WSL TTS unit.'
  }
  & wsl.exe -d $distro --exec systemctl stop $unitName
  if ($LASTEXITCODE -ne 0) { throw 'WSL TTS unit did not stop.' }
  if ($owned) { Stop-Process -Id $owned.ProcessId -Force -ErrorAction SilentlyContinue }
  Write-Output 'Owned local TTS stopped.'
  return
}
if ($TrialState) {
  if ((Get-Content -LiteralPath $TrialState -Raw | ConvertFrom-Json).enabled -ne $true) {
    Write-Output 'Unattended gameplay is disabled; local TTS was not started.'
    return
  }
}
if ($owned) { Write-Output 'Owned WSL TTS keeper already running.'; return }
# Both supported engines share the deployment's 12 GiB TTS card.
& wsl.exe -d $distro --exec systemctl is-active --quiet $otherUnit
if ($LASTEXITCODE -eq 0) { throw 'The other local TTS engine is active; stop its owned service first.' }
# A record may have been lost while a loading service still owns its keeper.
$existing=@(Get-CimInstance Win32_Process -Filter "Name='wsl.exe'" | Where-Object { Test-OwnedKeeper $_ })
if ($existing.Count -gt 0) {
  Save-KeeperRecord $existing[0]
  Write-Output 'Recovered the existing WSL TTS keeper record.'
  return
}
New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$process=Start-Process -FilePath 'wsl.exe' -ArgumentList @(
  '-d',$distro,'--exec','/bin/bash',$keeper
) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $LogDirectory "$engine-wsl-$stamp.out.log") `
  -RedirectStandardError (Join-Path $LogDirectory "$engine-wsl-$stamp.err.log")
$candidate=Get-CimInstance Win32_Process -Filter "ProcessId=$($process.Id)"
if (-not (Test-OwnedKeeper $candidate)) { throw 'WSL TTS keeper failed to launch; inspect its startup log.' }
Save-KeeperRecord $candidate
Write-Output "WSL $model starting; keeper PID $($process.Id)."
} finally {
  if ($ownsMutex) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
