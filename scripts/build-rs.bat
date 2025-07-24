@echo off
echo 🪟 Building Rust binary for Windows...

REM Create resources/bin directory
if not exist "resources\bin" mkdir "resources\bin"

REM Check if Rust is installed
where cargo >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ Cargo not found. Please install Rust from https://rustup.rs/
    echo    After installation, restart your terminal and try again.
    exit /b 1
)

REM Change to Rust project directory
cd speakmcp-rs

REM Build for Windows
echo Building Rust project...
cargo build --release

REM Check if build was successful
if %errorlevel% neq 0 (
    echo ❌ Failed to build Rust project
    cd ..
    exit /b 1
)

REM Copy Windows executable
if exist "target\release\speakmcp-rs.exe" (
    copy "target\release\speakmcp-rs.exe" "..\resources\bin\speakmcp-rs.exe"
    echo ✅ Windows binary built successfully: resources\bin\speakmcp-rs.exe
) else (
    echo ❌ Failed to find built binary at target\release\speakmcp-rs.exe
    cd ..
    exit /b 1
)

cd ..
echo ✅ Build completed successfully!
