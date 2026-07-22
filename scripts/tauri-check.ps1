$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "toolchain.ps1")

& $DeskCargoExe check --manifest-path (Join-Path $DeskProjectRoot "src-tauri\Cargo.toml") --offline
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
