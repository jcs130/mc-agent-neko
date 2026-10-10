param([string]$Source = "$PSScriptRoot\unattended-supervisor.ps1")
$ErrorActionPreference = 'Stop'
$original = Get-Content -Raw -LiteralPath $Source
$cases = @(
  @{name='healthy';viewer='@{ok=$true;gameOnline=$true}';expected='running';ensure=0},
  @{name='remote-offline';viewer='@{ok=$true;gameOnline=$false}';expected='waiting_for_minecraft_server';ensure=0},
  @{name='remote-offline-repeated';viewer='@{ok=$true;gameOnline=$false}';expected='waiting_for_minecraft_server';ensure=0;loops=4},
  @{name='viewer-gone';viewer='$null';expected='recovering';ensure=1},
  @{name='native-reconnecting';viewer='$null';native='owned';expected='waiting_for_minecraft_server';ensure=0;loops=4},
  @{name='native-stale-record';viewer='$null';native='stale';expected='recovering';ensure=1},
  @{name='native-foreign-port';viewer='$null';native='foreign-port';expected='recovering';ensure=1},
  @{name='native-child-gone';viewer='$null';native='no-child';expected='recovering';ensure=1},
  @{name='native-wrong-command';viewer='$null';native='wrong-command';expected='recovering';ensure=1},
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
function Get-CimInstance {
  param($ClassName,[string]$Filter,$ErrorAction)
  if ($Filter -like 'ParentProcessId*') {
    if ('__NATIVE__' -eq 'no-child') { return $null }
    return [pscustomobject]@{ProcessId=9002;ParentProcessId=9001;CreationDate=[DateTime]'2026-10-10T12:00:01';
      CommandLine='node src/process/init_agent.js ag_NEKO';Name='node.exe'}
  }
  return [pscustomobject]@{ProcessId=9001;CreationDate=$(if ('__NATIVE__' -eq 'stale') {[DateTime]'2026-10-10T12:05:00'}else{[DateTime]'2026-10-10T12:00:00'});
    CommandLine=$(if ('__NATIVE__' -eq 'wrong-command') {'node unrelated.js'}else{'node main.js'});Name='node.exe'}
}
function Get-NetTCPConnection {
  param($State,$LocalPort,$ErrorAction)
  return [pscustomobject]@{LocalPort=8765;OwningProcess=$(if ('__NATIVE__' -eq 'foreign-port') {9999}else{9001})}
}
'@
  $loopLimit = if ($case.loops) {$case.loops} else {1}
  $fake = $fake.Replace('__VIEWER__', $case.viewer).Replace('__ENABLED__', $(if ($case.name -eq 'stopped') {'$false'} elseif ($loopLimit -gt 1) {'($script:iterations -lt ' + $loopLimit + ')'} else {'$true'}))
  $fake = $fake.Replace('__MAIN__', $(if ($case.main) {$case.main} else {'@{ok=$true}'}))
  $fake = $fake.Replace('__PLUGIN__', $(if ($case.plugin) {$case.plugin} else {'@{status=@{status="running"}}'}))
  $fake = $fake.Replace('__NATIVE__', [string]$case.native)
  [IO.File]::WriteAllText((Join-Path $sandbox 'trial-lifecycle.ps1'), $fake)
  if ($case.native) {
    [IO.File]::WriteAllText((Join-Path $sandbox 'mc-process.json'), '{"pid":9001,"started":"2026-10-10T12:00:00"}')
  }
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
