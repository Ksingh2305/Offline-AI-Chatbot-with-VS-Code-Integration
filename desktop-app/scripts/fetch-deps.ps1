# fetch-deps.ps1  — run ONCE on your dev machine (needs internet).
# Downloads the llama.cpp CPU server + the GGUF models into src-tauri/resources/
# so that `npm run tauri build` can bundle everything into one offline installer.
#
# Usage (from the project root, in PowerShell):
#   ./scripts/fetch-deps.ps1
#
# To use a bigger/better chat model (e.g. 7B for higher quality), change
# $ChatUrl / $ChatFile below AND the matching model_file in src-tauri/registry.yaml.

$ErrorActionPreference = "Stop"
$root      = Split-Path -Parent $PSScriptRoot
$resources = Join-Path $root "src-tauri/resources"
$llamaDir  = Join-Path $resources "llama"
$modelsDir = Join-Path $resources "models"

New-Item -ItemType Directory -Force -Path $llamaDir, $modelsDir | Out-Null

# ----------------------------------------------------------------------------
# 1) llama.cpp CPU server (Windows x64). Grabs the latest release asset.
# ----------------------------------------------------------------------------
Write-Host "==> Resolving latest llama.cpp release..." -ForegroundColor Cyan
$release = Invoke-RestMethod "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest" `
    -Headers @{ "User-Agent" = "localforge" }

$asset = $release.assets | Where-Object { $_.name -match "bin-win-cpu-x64\.zip$" } | Select-Object -First 1
if (-not $asset) {
    # Older naming fallback
    $asset = $release.assets | Where-Object { $_.name -match "win-avx2-x64\.zip$" } | Select-Object -First 1
}
if (-not $asset) { throw "Could not find a Windows CPU build in the latest llama.cpp release. Check the releases page and set the URL manually." }

$zipPath = Join-Path $env:TEMP $asset.name
Write-Host "==> Downloading $($asset.name) ..." -ForegroundColor Cyan
Invoke-WebRequest $asset.browser_download_url -OutFile $zipPath

$tmp = Join-Path $env:TEMP "llama_extract"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Expand-Archive $zipPath -DestinationPath $tmp -Force

# Copy the server exe and every DLL it needs into resources/llama
Get-ChildItem $tmp -Recurse -Include "llama-server.exe", "*.dll" |
    ForEach-Object { Copy-Item $_.FullName -Destination $llamaDir -Force }

if (-not (Test-Path (Join-Path $llamaDir "llama-server.exe"))) {
    throw "llama-server.exe not found after extraction."
}
Write-Host "    llama-server + DLLs -> $llamaDir" -ForegroundColor Green

# ----------------------------------------------------------------------------
# 2) GGUF models. These filenames MUST match src-tauri/registry.yaml sidecars.
# ----------------------------------------------------------------------------
# Chat model — Qwen2.5-Coder 3B (~1.9 GB). Keeps the single .exe under NSIS limits.
$ChatUrl  = "https://huggingface.co/Qwen/Qwen2.5-Coder-3B-Instruct-GGUF/resolve/main/qwen2.5-coder-3b-instruct-q4_k_m.gguf"
$ChatFile = Join-Path $modelsDir "qwen2.5-coder-3b-instruct-q4_k_m.gguf"

# Embedding model — nomic-embed-text v1.5 (~85 MB).
$EmbUrl   = "https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q4_K_M.gguf"
$EmbFile  = Join-Path $modelsDir "nomic-embed-text-v1.5.Q4_K_M.gguf"

function Get-Model($url, $out) {
    if (Test-Path $out) { Write-Host "    exists: $(Split-Path $out -Leaf)" -ForegroundColor DarkGray; return }
    Write-Host "==> Downloading $(Split-Path $out -Leaf) ..." -ForegroundColor Cyan
    Invoke-WebRequest $url -OutFile $out
}

Get-Model $ChatUrl $ChatFile
Get-Model $EmbUrl  $EmbFile

Write-Host "`nDone. Resources ready:" -ForegroundColor Green
Get-ChildItem $resources -Recurse -File | Select-Object FullName, @{n="MB";e={[math]::Round($_.Length/1MB,1)}} | Format-Table -Auto
Write-Host "Next: npm run tauri build" -ForegroundColor Yellow
