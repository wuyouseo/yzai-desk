$DeskProjectRoot = Split-Path -Parent $PSScriptRoot
$DeskCargoRoot = Join-Path $DeskProjectRoot ".toolchains\cargo"
$DeskRustupRoot = Join-Path $DeskProjectRoot ".toolchains\rustup"
$DeskLlvmRoot = Join-Path $DeskProjectRoot ".toolchains\llvm\llvm-mingw-20260407-ucrt-x86_64"
$DeskLlvmBin = Join-Path $DeskLlvmRoot "bin"
$DeskCargoExe = Join-Path $DeskCargoRoot "bin\cargo.exe"
$DeskDummyLibs = (Join-Path $DeskProjectRoot "src-tauri\dummy_libs").Replace("\", "/")
$DeskUnwindLib = (Join-Path $DeskLlvmRoot "x86_64-w64-mingw32\lib\libunwind.a").Replace("\", "/")

if (!(Test-Path -LiteralPath $DeskCargoExe)) {
    throw "Project Rust toolchain is missing. Follow the toolchain setup in README.md."
}

if (!(Test-Path -LiteralPath (Join-Path $DeskLlvmBin "x86_64-w64-mingw32-clang.exe"))) {
    throw "Project LLVM-MinGW toolchain is missing. Follow the toolchain setup in README.md."
}

$env:CARGO_HOME = $DeskCargoRoot
$env:RUSTUP_HOME = $DeskRustupRoot
$env:CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER = Join-Path $DeskLlvmBin "x86_64-w64-mingw32-clang.exe"
$env:CARGO_TARGET_X86_64_PC_WINDOWS_GNU_RUSTFLAGS = "-Lnative=$DeskDummyLibs -C link-arg=$DeskUnwindLib"
$env:CC_x86_64_pc_windows_gnu = Join-Path $DeskLlvmBin "x86_64-w64-mingw32-clang.exe"
$env:CXX_x86_64_pc_windows_gnu = Join-Path $DeskLlvmBin "x86_64-w64-mingw32-clang++.exe"
$env:AR_x86_64_pc_windows_gnu = Join-Path $DeskLlvmBin "x86_64-w64-mingw32-llvm-ar.exe"
$env:WINDRES = Join-Path $DeskLlvmBin "x86_64-w64-mingw32-windres.exe"
$env:PATH = "$DeskLlvmBin;$DeskCargoRoot\bin;$env:PATH"

Set-Location -LiteralPath $DeskProjectRoot
