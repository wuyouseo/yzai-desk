$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "toolchain.ps1")

& npm.cmd run tauri -- build
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
