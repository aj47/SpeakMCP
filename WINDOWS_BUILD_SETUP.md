# Windows Build Setup for SpeakMCP

## Prerequisites

### 1. Install Rust

Before building SpeakMCP for Windows, you need to install Rust:

**Option A: Using rustup-init.exe (Recommended)**
1. Download rustup-init.exe from https://rustup.rs/
2. Run the installer and follow the prompts
3. Choose "1) Proceed with installation (default)"
4. Restart your terminal after installation

**Option B: Using winget (Windows Package Manager)**
```powershell
winget install Rustlang.Rustup
```

**Option C: Using Chocolatey**
```powershell
choco install rustup.install
```

### 2. Install Visual Studio Build Tools (CRITICAL for Windows)

**This step is REQUIRED** - Rust on Windows needs Microsoft C++ build tools:

**Method 1: Visual Studio Installer (Recommended)**
1. Download "Build Tools for Visual Studio 2022" from:
   https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022
2. Run the installer
3. Select "C++ build tools" workload
4. Ensure these components are selected:
   - MSVC v143 - VS 2022 C++ x64/x86 build tools
   - Windows 11 SDK (latest version)
   - CMake tools for Visual Studio
5. Install and restart your computer

**Method 2: Visual Studio Community (Alternative)**
1. Download Visual Studio Community 2022
2. During installation, select "Desktop development with C++" workload
3. Install

**Method 3: Chocolatey (Command Line)**
```powershell
choco install visualstudio2022buildtools --package-parameters "--add Microsoft.VisualStudio.Workload.VCTools"
```

### 3. Verify Installation

After installing both Rust and Visual Studio Build Tools:
```bash
cargo --version
rustc --version
```

If you get linking errors, restart your terminal and try again.

## Building SpeakMCP for Windows

### Step 1: Install Node.js Dependencies
```bash
pnpm install
```

### Step 2: Build Rust Binary
```bash
# Using PowerShell
pnpm run build-rs:win

# Or using bash/MINGW64
pnpm run build-rs
```

### Step 3: Build Windows Application
```bash
pnpm run build:win
```

This will create:
- NSIS installer: `dist/SpeakMCP-{version}-{arch}-setup.exe`
- Portable version: `dist/SpeakMCP-{version}-{arch}.exe`

## Windows-Specific Features

### Keyboard Shortcuts
- **Ctrl (Hold)**: Voice recording mode
- **Ctrl+Alt (Hold)**: Agent mode with MCP tools
- **Ctrl+T**: Text input mode
- **Ctrl+Shift+Escape**: Emergency stop (kill switch)

### System Integration
- Global keyboard hooks work across all Windows applications
- Text injection into any Windows application that accepts text input
- System tray integration
- Auto-start capabilities

### Permissions Required
- **Microphone Access**: For voice recording
- **Accessibility/Input Injection**: For global keyboard shortcuts and text insertion
- **Network Access**: For AI provider APIs and MCP servers

## Troubleshooting

### Common Issues

1. **"cargo: command not found"**
   - Rust is not installed or not in PATH
   - Restart terminal after Rust installation
   - Add `%USERPROFILE%\.cargo\bin` to PATH manually if needed

2. **"link.exe not found" or C++ compiler errors**
   - Install Visual Studio Build Tools with C++ workload
   - Ensure Windows SDK is installed

3. **"Cannot create symbolic link" errors during electron-builder**
   - **SOLUTION**: Run PowerShell/Command Prompt as Administrator
   - This is required for electron-builder to extract winCodeSign tools
   - Alternative: Enable Developer Mode in Windows Settings > Update & Security > For developers

4. **Permission denied errors during build**
   - Run terminal as Administrator
   - Disable antivirus temporarily during build

5. **Binary not found in resources/bin**
   - Ensure Rust binary built successfully
   - Check `resources/bin/speakmcp-rs.exe` exists after build

6. **TypeScript compilation errors**
   - Use `npx electron-vite build` instead of `npm run build` to bypass type checking
   - Or fix TypeScript errors before building

### Build Verification

After successful build, verify the installer:
1. Check `dist/` folder for generated files
2. Test installer on clean Windows system
3. Verify all shortcuts work after installation
4. Test microphone permissions and text injection

## Distribution

The generated installer (`SpeakMCP-{version}-{arch}-setup.exe`) includes:
- Main Electron application
- Rust binary for system integration
- All Node.js dependencies
- Desktop shortcuts and Start Menu entries
- Uninstaller

### System Requirements
- Windows 10 or later (64-bit recommended)
- 4GB RAM minimum
- 500MB disk space
- Microphone for voice input
- Internet connection for AI providers
