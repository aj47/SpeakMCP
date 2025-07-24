# Windows Build Guide

This guide explains how to build SpeakMCP for Windows.

## Prerequisites

1. **Node.js and pnpm**: Make sure you have Node.js and pnpm installed
2. **Rust**: Install Rust from https://rustup.rs/ (this was automatically installed during the build process)
3. **Windows**: This build process is designed for Windows 10/11

## Quick Build

To build the Windows application quickly:

```bash
pnpm run build:win:manual
```

This command will:
1. Run TypeScript type checking
2. Build the Electron app with Vite
3. Build the Rust binary
4. Create a manual Windows build

## Manual Build Process

If you need to build step by step:

### 1. Build the Electron App

```bash
pnpm run typecheck
npx electron-vite build
```

### 2. Build the Rust Binary

```bash
pnpm run build-rs
```

Or manually:
```bash
cd speakmcp-rs
cargo build --release
copy target\release\speakmcp-rs.exe ..\resources\bin\speakmcp-rs.exe
cd ..
```

### 3. Create Windows Executable

```bash
powershell -ExecutionPolicy Bypass -File scripts/manual-windows-build.ps1
```

## Build Output

The Windows build will be created in the `manual-build-win` directory with:

- `speakmcp.exe` - The main application executable
- `resources/app/` - The application code and resources
- `resources/app/resources/bin/speakmcp-rs.exe` - The Rust binary for system integration

## Running the Application

After building, you can run the application by executing:

```bash
manual-build-win\speakmcp.exe
```

## Troubleshooting

### File Locking Issues

If you encounter "file is being used by another process" errors:

1. Close any running instances of the app
2. Kill any electron processes: `taskkill /f /im electron.exe`
3. Remove build directories: `Remove-Item -Recurse -Force manual-build-win`
4. Try building again

### Rust Build Issues

If the Rust build fails:

1. Make sure Rust is installed: `cargo --version`
2. If not installed, run: `winget install Rustlang.Rust.MSVC`
3. Restart your terminal after installation
4. Try building again

### Permission Issues

If you get permission errors:

1. Run PowerShell as Administrator
2. Or run: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`

## Build Scripts

- `scripts/build-rs-cross-platform.js` - Cross-platform Rust build script
- `scripts/build-rs.bat` - Windows batch file for Rust building
- `scripts/manual-windows-build.ps1` - PowerShell script for manual Windows build

## Notes

- The manual build process bypasses electron-builder's packaging issues on Windows
- Code signing is disabled to avoid Windows permission problems
- The build includes only essential dependencies to keep the size manageable
- The Rust binary provides system-level keyboard and mouse integration
