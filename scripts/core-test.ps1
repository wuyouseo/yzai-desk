$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "toolchain.ps1")
& $DeskCargoExe test --manifest-path (Join-Path $DeskProjectRoot "scripts\core-tests\Cargo.toml") --target-dir (Join-Path $DeskProjectRoot "src-tauri\target\core-tests") --offline
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
