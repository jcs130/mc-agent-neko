param([string]$Source = "$PSScriptRoot\unattended-supervisor.ps1")
$ErrorActionPreference = 'Stop'
$original = Get-Content -Raw -LiteralPath $Source
$cases = @(
  @{name='healthy';viewer='@{ok=$true;gameOnline=$true}';expected='running';ensure=0},
  @{name='remote-offline';viewer='@{ok=$true;gameOnline=$false}';expected='waiting_for_minecraft_server';ensure=0},
  @{name='remote-offline-repeated';viewer='@{ok=$true;gameOnline=$false}';expected='waiting_for_minecraft_server';ensure=0;loops=4},
  @{name='viewer-gone';viewer='$null';expected='recovering';ensure=1},
  @{name='main-gone';viewer='@{ok=$true;gameOnline=$false}';main='$null';expected='recovering';ensure=1},
  @{name='plugin-gone';viewer='@{ok=$true;gameOnline=$false}';plugin='$null';expected='recovering';ensure=1},
  @{name='stopped';viewer='@{ok=$true;gameOnline=$true}';expected=$null;ensure=0}
)
foreach ($case in $cases) {
  $sandbox = Join-Path ([IO.Path]::GetTempPath()) ('neko-supervisor-test-' + [Guid]::NewGuid().ToString('N'))
  $null = New-Item -ItemType Directory -Path (Join-Path $sandbox 'logs') -Force
  $sourceCopy = $original.Replace('Local\NekoMcTrialUnattended', 'Local\NekoMcTrialTest-' + [Guid]::NewGuid().ToString('N'))
  [IO.File]::WriteAllText((Join-Path $sandbox 'unattended-supervisor.ps1'), $sourceCopy)
  $fake = @'
$trialRoot=$PSScriptRoot
$script:iterations=0
function Write-TrialJson([string]$Path,$Value) { $Value | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $Path }
function Test-TrialEnabled { return __ENABLED__ }
function Start-Sleep { param([int]$Seconds) }
function Get-TrialHttp([string]$Url) {
  if ($Url -like '*18030*') { $script:iterations++; return @{loaded=$true;model='qwen3.8-flash-next-iq3_xxs'} }
  if ($Url -like '*48911*') { return __MAIN__ }
  if ($Url -like '*3000*') { return __VIEWER__ }
  return __PLUGIN__
}
function Stop-OwnedTrialProcess { throw 'Healthy processes must not be stopped in a one-pass test.' }
'@
  $loopLimit = if ($case.loops) {$case.loops} else {1}
  $fake = $fake.Replace('__VIEWER__', $case.viewer).Replace('__ENABLED__', $(if ($case.name -eq 'stopped') {'$false'} elseif ($loopLimit -gt 1) {'($script:iterations -lt ' + $loopLimit + ')'} else {'$true'}))
  $fake = $fake.Replace('__MAIN__', $(if ($case.main) {$case.main} else {'@{ok=$true}'}))
  $fake = $fake.Replace('__PLUGIN__', $(if ($case.plugin) {$case.plugin} else {'@{status=@{status="running"}}'}))
  [IO.File]::WriteAllText((Join-Path $sandbox 'trial-lifecycle.ps1'), $fake)
  [IO.File]::WriteAllText((Join-Path $sandbox 'start-trial.ps1'), 'param([switch]$RequireUnattended)' + "`n" + 'Add-Content -LiteralPath "$PSScriptRoot\ensure-calls.txt" -Value ensure')
  if ($loopLimit -gt 1) { & (Join-Path $sandbox 'unattended-supervisor.ps1') }
  else { & (Join-Path $sandbox 'unattended-supervisor.ps1') -Once }
  $statePath = Join-Path $sandbox 'unattended-status.json'
  $actualState = if (Test-Path -LiteralPath $statePath) { (Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json).state } else {$null}
  $callsPath = Join-Path $sandbox 'ensure-calls.txt'
  $calls = if (Test-Path -LiteralPath $callsPath) { @(Get-Content -LiteralPath $callsPath).Count } else {0}
  if ($actualState -ne $case.expected -or $calls -ne $case.ensure) {
    throw "$($case.name): expected state=$($case.expected),ensure=$($case.ensure); actual state=$actualState,ensure=$calls. Fixture: $sandbox"
  }
  Write-Output "PASS $($case.name): state=$actualState ensure=$calls"
}
