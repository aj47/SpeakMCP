# PowerShell script for building Rust binary on Windows
# Enhanced with better error handling and diagnostics

# Set error action preference to stop on errors
$ErrorActionPreference = "Stop"

Write-Host "🔧 Starting Windows Rust binary build..." -ForegroundColor Green

# Check prerequisites
Write-Host "📋 Checking prerequisites..." -ForegroundColor Yellow

# Check if Rust is installed
$rustInstalled = $false
$cargoPath = "$env:USERPROFILE\.cargo\bin\cargo.exe"

if (Test-Path $cargoPath) {
    Write-Host "✅ Found Cargo at: $cargoPath" -ForegroundColor Green
    $rustInstalled = $true
} elseif (Get-Command cargo -ErrorAction SilentlyContinue) {
    Write-Host "✅ Found Cargo in PATH" -ForegroundColor Green
    $cargoPath = "cargo"
    $rustInstalled = $true
} else {
    Write-Host "❌ Cargo not found. Please install Rust from https://rustup.rs/" -ForegroundColor Red
    Write-Host "   Or run: winget install Rustlang.Rustup" -ForegroundColor Yellow
    exit 1
}

# Check Rust version
try {
    $rustVersion = & $cargoPath --version
    Write-Host "✅ Rust version: $rustVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Failed to get Rust version: $_" -ForegroundColor Red
    exit 1
}

# Check for Visual Studio Build Tools
$vsInstalled = $false
$vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vsWhere) {
    $vsInstallations = & $vsWhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -format json | ConvertFrom-Json
    if ($vsInstallations.Count -gt 0) {
        Write-Host "✅ Visual Studio Build Tools found" -ForegroundColor Green
        $vsInstalled = $true
    }
}

if (-not $vsInstalled) {
    Write-Host "⚠️  Visual Studio Build Tools not detected" -ForegroundColor Yellow
    Write-Host "   If build fails, install from: https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022" -ForegroundColor Yellow
}

# Create resources/bin directory if it doesn't exist
Write-Host "📁 Creating resources/bin directory..." -ForegroundColor Yellow
if (!(Test-Path "resources/bin")) {
    New-Item -ItemType Directory -Path "resources/bin" -Force | Out-Null
    Write-Host "✅ Created resources/bin directory" -ForegroundColor Green
} else {
    Write-Host "✅ resources/bin directory exists" -ForegroundColor Green
}

# Change to Rust project directory
Write-Host "📂 Entering Rust project directory..." -ForegroundColor Yellow
if (!(Test-Path "speakmcp-rs")) {
    Write-Host "❌ speakmcp-rs directory not found!" -ForegroundColor Red
    exit 1
}

Set-Location "speakmcp-rs"

# Clean previous builds
Write-Host "🧹 Cleaning previous builds..." -ForegroundColor Yellow
try {
    & $cargoPath clean
    Write-Host "✅ Clean completed" -ForegroundColor Green
} catch {
    Write-Host "⚠️  Clean failed, continuing anyway: $_" -ForegroundColor Yellow
}

# Build the Rust binary in release mode
Write-Host "🔨 Building Rust binary for Windows..." -ForegroundColor Green
Write-Host "   This may take a few minutes..." -ForegroundColor Yellow

try {
    & $cargoPath build --release --verbose

    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Rust binary built successfully!" -ForegroundColor Green

        # Verify the binary exists
        $binaryPath = "target/release/speakmcp-rs.exe"
        if (Test-Path $binaryPath) {
            $binarySize = (Get-Item $binaryPath).Length
            Write-Host "✅ Binary found: $binaryPath ($([math]::Round($binarySize/1KB, 2)) KB)" -ForegroundColor Green

            # Copy the binary to resources/bin with .exe extension
            Write-Host "📋 Copying binary to resources/bin..." -ForegroundColor Yellow
            Copy-Item $binaryPath "../resources/bin/speakmcp-rs.exe" -Force
            Write-Host "✅ Binary copied to resources/bin/speakmcp-rs.exe" -ForegroundColor Green
        } else {
            Write-Host "❌ Binary not found at expected location: $binaryPath" -ForegroundColor Red
            Set-Location ".."
            exit 1
        }
    } else {
        Write-Host "❌ Build failed with exit code: $LASTEXITCODE" -ForegroundColor Red
        Set-Location ".."
        exit 1
    }
} catch {
    Write-Host "❌ Build failed with error: $_" -ForegroundColor Red
    Write-Host "💡 Common solutions:" -ForegroundColor Yellow
    Write-Host "   1. Install Visual Studio Build Tools 2022" -ForegroundColor Yellow
    Write-Host "   2. Run PowerShell as Administrator" -ForegroundColor Yellow
    Write-Host "   3. Restart your terminal after installing Rust" -ForegroundColor Yellow
    Set-Location ".."
    exit 1
}

# Return to project root
Set-Location ".."

# Final verification
$finalBinaryPath = "resources/bin/speakmcp-rs.exe"
if (Test-Path $finalBinaryPath) {
    $finalSize = (Get-Item $finalBinaryPath).Length
    Write-Host "🎉 Windows Rust binary build completed successfully!" -ForegroundColor Green
    Write-Host "📍 Final binary: $finalBinaryPath ($([math]::Round($finalSize/1KB, 2)) KB)" -ForegroundColor Green
} else {
    Write-Host "❌ Final binary verification failed!" -ForegroundColor Red
    exit 1
}
