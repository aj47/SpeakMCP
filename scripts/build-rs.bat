@echo off
REM Windows batch script for building Rust binary

if not exist "resources\bin" mkdir "resources\bin"

cd speakmcp-rs

cargo build -r

copy "target\release\speakmcp-rs.exe" "..\resources\bin\speakmcp-rs.exe"

cd ..

echo Rust binary built successfully for Windows