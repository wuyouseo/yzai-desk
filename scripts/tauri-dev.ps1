$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "toolchain.ps1")

& npm.cmd run tauri -- dev
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
