param(
    [Parameter(Mandatory=$true)][string]$NekoRoot,
    [Parameter(Mandatory=$true)][string]$DataRoot
)
$ErrorActionPreference='Stop'
$source=(Resolve-Path -LiteralPath $NekoRoot).Path
$python=Join-Path $source '.venv/Scripts/python.exe'
if(-not(Test-Path -LiteralPath $python)){
    throw 'Use the existing Neko Python 3.11 virtual environment; this helper does not install dependencies.'
}
$prepare=Join-Path $source 'scripts/prepare_embedding_model.py'
if(-not(Test-Path -LiteralPath $prepare)){throw 'Neko native model preparation script is missing.'}
$models=Join-Path ([IO.Path]::GetFullPath($DataRoot)) 'embedding_models'
& $python $prepare --repo jinaai/jina-embeddings-v5-text-nano-retrieval `
    --revision ac5d898c8d382b17167c33e5c8af644a3519b47d `
    --profile-id local-text-retrieval-v1 --output-root $models --variant int8
if($LASTEXITCODE -ne 0){throw 'Native embedding asset preparation failed; active memory was not changed.'}
Write-Output 'Assets prepared. Set NEKO_VECTORS_ENABLED=1 in the Neko launcher environment.'
Write-Output 'This helper does not restart services, change memory entries, or reserve a GPU.'
