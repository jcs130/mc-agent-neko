param([switch]$Once)
$ErrorActionPreference='Stop'
. "$PSScriptRoot\trial-lifecycle.ps1"
$shellPath=(Get-Process -Id $PID).Path
$mutex=[Threading.Mutex]::new($false,'Local\NekoMcTrialUnattended')
$ownsMutex=$false
try { $ownsMutex=$mutex.WaitOne(0) }
catch [Threading.AbandonedMutexException] { $ownsMutex=$true }
if (-not $ownsMutex) { $mutex.Dispose(); exit 0 }
$failures=@{main=0;mc=0}
$lastRecovery=[DateTime]::MinValue
$backoff=15
$state='starting'
$recoveryCount=0
Write-TrialJson "$trialRoot\unattended-process.json" @{pid=$PID;started=(Get-Date).ToString('o')}

function Write-SupervisorEvent([string]$Message) {
  Add-Content -LiteralPath "$trialRoot\logs\unattended-supervisor.log" -Value "[$((Get-Date).ToString('o'))] $Message"
}

try {
  do {
    if (-not (Test-TrialEnabled)) { break }
    $model=Get-TrialHttp 'http://127.0.0.1:18030/health'
    $main=Get-TrialHttp 'http://127.0.0.1:48911/health'
    $viewer=Get-TrialHttp 'http://127.0.0.1:3000/healthz'
    $plugin=Get-TrialHttp 'http://127.0.0.1:48916/plugin/status?plugin_id=game_agent_minecraft'
    $modelReady=$model -and $model.loaded -and $model.model -eq 'qwen3.8-flash-next-iq3_xxs'
    $mainReady=[bool]$main
    # A remote server outage is handled by the native client's reconnect loop.
    # Only a missing local viewer service counts toward process recovery.
    $mcServiceReady=[bool]($viewer -and $viewer.ok)
    $mcReady=[bool]($mcServiceReady -and $viewer.gameOnline -ne $false)
    foreach ($component in @('main','mc')) {
      $healthy=$(if ($component -eq 'main') { $mainReady } else { $mcServiceReady })
      $failures[$component]=$(if ($healthy) { 0 } else { $failures[$component]+1 })
    }
    $pluginReady=$plugin -and $plugin.status.status -eq 'running'
    $nextState=$(if (-not $modelReady) { 'waiting_for_local_model' } elseif ($mainReady -and $mcReady -and $pluginReady) { 'running' } elseif ($mainReady -and $mcServiceReady -and $pluginReady) { 'waiting_for_minecraft_server' } else { 'recovering' })
    if ($nextState -ne $state) { Write-SupervisorEvent "state=$nextState"; $state=$nextState }
    if ($state -eq 'running') { $backoff=15 }
    $mayRecover=((Get-Date)-$lastRecovery).TotalSeconds -ge $backoff
    if ($mayRecover -and $state -notin @('running','waiting_for_minecraft_server')) {
      $lastRecovery=Get-Date
      if (-not $modelReady) {
        # Loading/busy inference is not a reason to replace a live model.
        # Only relaunch this exact local model after its listener is gone.
        $modelListener=Get-NetTCPConnection -State Listen -LocalPort 18030 -ErrorAction SilentlyContinue
        $loading=Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" | Where-Object { $_.CommandLine -like '*Strata-runtime*serve*server.py*--port 18030*' }
        if (-not $modelListener -and -not $loading -and (Test-TrialEnabled)) {
          Start-Process -FilePath $shellPath -ArgumentList '-NoProfile','-File',"$trialRoot\start-local-model.ps1" -WindowStyle Hidden | Out-Null
          Write-SupervisorEvent 'restarted exact local Qwen model'
          $recoveryCount++
        }
      } else {
        try {
          if ($failures.main -ge 3) { Stop-OwnedTrialProcess "$trialRoot\neko-process.json" '*python*launcher.py*' }
          if ($failures.mc -ge 3) { Stop-OwnedTrialProcess "$trialRoot\mc-process.json" '*main.js*' }
          if (Test-TrialEnabled) {
            & "$trialRoot\start-trial.ps1" -RequireUnattended | Out-Null
            Write-SupervisorEvent 'official trial launch/ensure completed'
            $recoveryCount++
          }
        } catch {
          Write-SupervisorEvent "recovery failed: $($_.Exception.Message)"
        }
      }
      $backoff=[Math]::Min(120,$backoff*2)
    }
    Write-TrialJson "$trialRoot\unattended-status.json" @{
      checked_at=(Get-Date).ToString('o');pid=$PID;enabled=(Test-TrialEnabled);state=$state
      model_ready=[bool]$modelReady;main_ready=$mainReady;mc_ready=$mcReady;mc_service_ready=$mcServiceReady;plugin_ready=[bool]$pluginReady
      model='qwen3.8-flash-next-iq3_xxs';model_url='http://127.0.0.1:18030/v1'
      viewer='http://192.168.3.133:3000/dungeon/';recoveries=$recoveryCount
    }
    if ($Once) { break }
    Start-Sleep -Seconds 5
  } while (Test-TrialEnabled)
} finally {
  if ($ownsMutex) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
