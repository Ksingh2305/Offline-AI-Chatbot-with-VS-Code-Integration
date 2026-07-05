# install-models.ps1
# Run this ONCE on the target PC after installing LocalForge.
# Copy this script + the models\ folder to the target PC alongside the installer.
#
# Usage (run as Administrator):
#   .\install-models.ps1
# Or point it at wherever your models folder is:
#   .\install-models.ps1 -ModelsSource "D:\USB\models"

param(
    [string]$ModelsSource = "$PSScriptRoot\models"
)

$dest = "C:\ProgramData\LocalForge\models"

if (-not (Test-Path $ModelsSource)) {
    Write-Host "ERROR: models folder not found at: $ModelsSource" -ForegroundColor Red
    Write-Host "Make sure the 'models' folder is next to this script." -ForegroundColor Yellow
    exit 1
}

$gguf = Get-ChildItem $ModelsSource -Filter "*.gguf"
if ($gguf.Count -eq 0) {
    Write-Host "ERROR: No .gguf files found in $ModelsSource" -ForegroundColor Red
    exit 1
}

Write-Host "==> Installing LocalForge models to $dest ..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $dest | Out-Null

foreach ($f in $gguf) {
    Write-Host "    Copying $($f.Name) ($([math]::Round($f.Length/1GB,2)) GB)..." -ForegroundColor Gray
    Copy-Item $f.FullName -Destination $dest -Force
}

Write-Host ""
Write-Host "Done! Models installed:" -ForegroundColor Green
Get-ChildItem $dest -Filter "*.gguf" | ForEach-Object {
    Write-Host "  $($_.Name)  ($([math]::Round($_.Length/1GB,2)) GB)" -ForegroundColor White
}
Write-Host ""
Write-Host "You can now launch LocalForge." -ForegroundColor Green
