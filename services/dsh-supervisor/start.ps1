param(
    [string]$NativeRoot = 'D:\neko-mc-trial\mc-agent-neko',
    [string]$RuntimeRoot = 'D:\neko-mc-trial\runtime\dsh-supervisor',
    [switch]$Once
)
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($env:DEEPSEEK_API_KEY)) {
    throw 'DEEPSEEK_API_KEY is required for the cloud supervisors; no local fallback is configured.'
}
$mutex = [Threading.Mutex]::new($false, 'Local\NekoMcDshSupervisors')
$owned = $false
try { $owned = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $owned = $true }
if (-not $owned) { $mutex.Dispose(); exit 0 }
try {
    $dshCommand = Get-Command dsh -ErrorAction Stop
    $dshBin = Join-Path (Split-Path $dshCommand.Source -Parent) 'node_modules\@deepseek-ai\dsh\lib\bin.js'
    if (-not (Test-Path -LiteralPath $dshBin)) { throw "Installed DSH launcher missing: $dshBin" }
    if (-not (Test-Path -LiteralPath (Join-Path $NativeRoot 'bots\_supervisor\ticket-server.mjs'))) { throw 'Native ticket-server is missing' }
    New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null
    $profileHome = Join-Path $RuntimeRoot 'dsh-home'
    & node (Join-Path $PSScriptRoot 'core.mjs') --init $profileHome $NativeRoot $RuntimeRoot
    if ($LASTEXITCODE -ne 0) { throw 'DSH profile generation failed' }
    # Dedicated process environment and home: never change the user's existing DSH profiles or credentials.
    $env:DSH_HOME = $profileHome
    $env:NEKO_DSH_ONCE = $(if ($Once) { '1' } else { '0' })
    $stopFile = Join-Path $RuntimeRoot 'stop'
    if (Test-Path -LiteralPath $stopFile) { Remove-Item -LiteralPath $stopFile }
    do {
        & node $dshBin --profile neko-supervisor
        $code = $LASTEXITCODE
        if ($Once -or (Test-Path -LiteralPath $stopFile)) { exit $code }
        Start-Sleep -Seconds 15
    } while (-not (Test-Path -LiteralPath $stopFile))
} finally {
    if ($owned) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
