# make-sfx.ps1 — OPTIONAL. Only needed if your bundled model pushes the single
# installer past NSIS's comfortable ~2 GB ceiling (e.g. you switched to a 7B model).
#
# It builds a 7-Zip self-extracting archive: ONE .exe that contains the normal
# LocalForge installer plus the large model, and runs the installer on extract.
# Requires 7-Zip installed (https://www.7-zip.org).
#
# Strategy: keep the model OUT of tauri resources (so the NSIS .exe stays small),
# ship the model beside it, and have a tiny config place it after install.
# For most users the default 3B single-.exe is simpler — use this only if needed.

$ErrorActionPreference = "Stop"
$sevenZip = "C:\Program Files\7-Zip\7z.exe"
if (-not (Test-Path $sevenZip)) { throw "7-Zip not found at $sevenZip" }

$root      = Split-Path -Parent $PSScriptRoot
$nsisExe   = Get-ChildItem "$root/src-tauri/target/release/bundle/nsis/*.exe" | Select-Object -First 1
$model     = "$root/src-tauri/resources/models/qwen2.5-coder-7b-instruct-q4_k_m.gguf"  # adjust
$staging   = "$env:TEMP/localforge_sfx"
$archive   = "$env:TEMP/localforge_payload.7z"
$outExe    = "$root/LocalForge-Offline-Setup.exe"

if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Force -Path $staging | Out-Null
Copy-Item $nsisExe "$staging/setup.exe"
Copy-Item $model   "$staging/model.gguf"

# config.txt drives the SFX module: run the installer silently after extraction.
$config = @"
;!@Install@!UTF-8!
RunProgram="setup.exe /S"
GUIMode="2"
;!@InstallEnd@!
"@
$configPath = "$env:TEMP/sfx_config.txt"
Set-Content -Path $configPath -Value $config -Encoding UTF8

& $sevenZip a -t7z $archive "$staging/*" | Out-Null
$sfxModule = "C:\Program Files\7-Zip\7z.sfx"
cmd /c copy /b "$sfxModule" + "$configPath" + "$archive" "$outExe" | Out-Null

Write-Host "Single self-extracting installer written to: $outExe" -ForegroundColor Green
