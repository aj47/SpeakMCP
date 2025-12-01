# PowerShell script for building Rust binary on Windows
# Enhanced with better error handling and diagnostics

# Set error action preference to stop on errors
$ErrorActionPreference = "Stop"

Write-Host "[BUILD] Starting Windows Rust binary build..." -ForegroundColor Green

# Check prerequisites
Write-Host "[CHECK] Checking prerequisites..." -ForegroundColor Yellow

# Check if Rust is installed
$rustInstalled = $false
$cargoPath = "$env:USERPROFILE\.cargo\bin\cargo.exe"

if (Test-Path $cargoPath) {
    Write-Host "[OK] Found Cargo at: $cargoPath" -ForegroundColor Green
    $rustInstalled = $true
} elseif (Get-Command cargo -ErrorAction SilentlyContinue) {
    Write-Host "[OK] Found Cargo in PATH" -ForegroundColor Green
    $cargoPath = "cargo"
    $rustInstalled = $true
} else {
    Write-Host "[ERROR] Cargo not found. Please install Rust from https://rustup.rs/" -ForegroundColor Red
    Write-Host "   Or run: winget install Rustlang.Rustup" -ForegroundColor Yellow
    exit 1
}

# Check Rust version
try {
    $rustVersion = & $cargoPath --version
    Write-Host "[OK] Rust version: $rustVersion" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Failed to get Rust version: $_" -ForegroundColor Red
    exit 1
}

# Check for Visual Studio Build Tools
$vsInstalled = $false
$vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vsWhere) {
    $vsInstallations = & $vsWhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -format json | ConvertFrom-Json
    if ($vsInstallations.Count -gt 0) {
        Write-Host "[OK] Visual Studio Build Tools found" -ForegroundColor Green
        $vsInstalled = $true
    }
}

if (-not $vsInstalled) {
    Write-Host "[WARN] Visual Studio Build Tools not detected" -ForegroundColor Yellow
    Write-Host "   If build fails, install from: https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022" -ForegroundColor Yellow
}

# Create resources/bin directory if it doesn't exist
Write-Host "[INFO] Creating resources/bin directory..." -ForegroundColor Yellow
if (!(Test-Path "resources/bin")) {
    New-Item -ItemType Directory -Path "resources/bin" -Force | Out-Null
    Write-Host "[OK] Created resources/bin directory" -ForegroundColor Green
} else {
    Write-Host "[OK] resources/bin directory exists" -ForegroundColor Green
}

# Change to Rust project directory for keyboard helper
Write-Host "[INFO] Entering Rust project directory (keyboard helper)..." -ForegroundColor Yellow
if (!(Test-Path "speakmcp-rs")) {
    Write-Host "[ERROR] speakmcp-rs directory not found!" -ForegroundColor Red
    exit 1
}

Set-Location "speakmcp-rs"

# Clean previous builds
Write-Host "[CLEAN] Cleaning previous keyboard helper builds..." -ForegroundColor Yellow
try {
    & $cargoPath clean
    Write-Host "[OK] Clean completed" -ForegroundColor Green
} catch {
    Write-Host "[WARN] Clean failed, continuing anyway: $_" -ForegroundColor Yellow
}

# Build the Rust keyboard helper in release mode
Write-Host "[BUILD] Building Rust keyboard helper for Windows..." -ForegroundColor Green
Write-Host "   This may take a few minutes..." -ForegroundColor Yellow

try {
    & $cargoPath build --release --verbose

    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] Keyboard helper built successfully!" -ForegroundColor Green

        # Verify the binary exists
        $binaryPath = "target/release/speakmcp-rs.exe"
        if (Test-Path $binaryPath) {
            $binarySize = (Get-Item $binaryPath).Length
            $sizeKB = [math]::Round($binarySize/1024, 2)
            Write-Host "[OK] Binary found: $binaryPath ($sizeKB KB)" -ForegroundColor Green

            # Copy the binary to resources/bin with .exe extension
            Write-Host "[INFO] Copying keyboard helper to resources/bin..." -ForegroundColor Yellow
            Copy-Item $binaryPath "../resources/bin/speakmcp-rs.exe" -Force
            Write-Host "[OK] Keyboard helper copied to resources/bin/speakmcp-rs.exe" -ForegroundColor Green
        } else {
            Write-Host "[ERROR] Keyboard helper not found at expected location: $binaryPath" -ForegroundColor Red
            Set-Location ".."
            exit 1
        }
    } else {
        Write-Host "[ERROR] Keyboard helper build failed with exit code: $LASTEXITCODE" -ForegroundColor Red
        Set-Location ".."
        exit 1
    }
} catch {
    Write-Host "[ERROR] Keyboard helper build failed with error: $_" -ForegroundColor Red
    Write-Host "[HELP] Common solutions:" -ForegroundColor Yellow
    Write-Host "   1. Install Visual Studio Build Tools 2022" -ForegroundColor Yellow
    Write-Host "   2. Run PowerShell as Administrator" -ForegroundColor Yellow
    Write-Host "   3. Restart your terminal after installing Rust" -ForegroundColor Yellow
    Set-Location ".."
    exit 1
}

# Build audio capture service
Write-Host "[INFO] Entering Rust project directory (audio service)..." -ForegroundColor Yellow
if (!(Test-Path "speakmcp-audio")) {
    Write-Host "[ERROR] speakmcp-audio directory not found!" -ForegroundColor Red
    exit 1
}

Set-Location "speakmcp-audio"

Write-Host "[BUILD] Building Rust audio capture service for Windows..." -ForegroundColor Green
Write-Host "   This may take a few minutes..." -ForegroundColor Yellow

try {
    & $cargoPath build --release --verbose

    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] Audio capture service built successfully!" -ForegroundColor Green

        # Verify the binary exists
        $audioBinaryPath = "target/release/speakmcp-audio.exe"
        if (Test-Path $audioBinaryPath) {
            $audioBinarySize = (Get-Item $audioBinaryPath).Length
            $audioSizeKB = [math]::Round($audioBinarySize/1024, 2)
            Write-Host "[OK] Audio binary found: $audioBinaryPath ($audioSizeKB KB)" -ForegroundColor Green

            # Copy the binary to resources/bin with .exe extension
            Write-Host "[INFO] Copying audio service to resources/bin..." -ForegroundColor Yellow
            Copy-Item $audioBinaryPath "../resources/bin/speakmcp-audio.exe" -Force
            Write-Host "[OK] Audio service copied to resources/bin/speakmcp-audio.exe" -ForegroundColor Green
        } else {
            Write-Host "[ERROR] Audio service not found at expected location: $audioBinaryPath" -ForegroundColor Red
            Set-Location ".."
            exit 1
        }
    } else {
        Write-Host "[ERROR] Audio service build failed with exit code: $LASTEXITCODE" -ForegroundColor Red
        Set-Location ".."
        exit 1
    }
} catch {
    Write-Host "[ERROR] Audio service build failed with error: $_" -ForegroundColor Red
    Set-Location ".."
    exit 1
}

# Return to project root
Set-Location ".."

# Final verification
$finalKeyboardPath = "resources/bin/speakmcp-rs.exe"
$finalAudioPath = "resources/bin/speakmcp-audio.exe"

if (Test-Path $finalKeyboardPath -and Test-Path $finalAudioPath) {
    $finalKeyboardSize = (Get-Item $finalKeyboardPath).Length
    $finalAudioSize = (Get-Item $finalAudioPath).Length
    Write-Host "[SUCCESS] Windows Rust binaries build completed successfully!" -ForegroundColor Green
    $finalKeyboardSizeKB = [math]::Round($finalKeyboardSize/1024, 2)
    $finalAudioSizeKB = [math]::Round($finalAudioSize/1024, 2)
    Write-Host "[INFO] Keyboard helper: $finalKeyboardPath ($finalKeyboardSizeKB KB)" -ForegroundColor Green
    Write-Host "[INFO] Audio service: $finalAudioPath ($finalAudioSizeKB KB)" -ForegroundColor Green
} else {
    Write-Host "[ERROR] Final binary verification failed!" -ForegroundColor Red
    exit 1
}
