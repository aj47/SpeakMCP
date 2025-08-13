# PowerShell script for building Rust binary on Windows

# Create resources/bin directory if it doesn't exist
if (!(Test-Path "resources/bin")) {
    New-Item -ItemType Directory -Path "resources/bin" -Force
}

# Change to Rust project directory
Set-Location "speakmcp-rs"

# Build the Rust binary in release mode
Write-Host "Building Rust binary for Windows..."

# Use full path to cargo if it's not in PATH
$cargoPath = "$env:USERPROFILE\.cargo\bin\cargo.exe"
if (Test-Path $cargoPath) {
    & $cargoPath build --release
} else {
    # Try using cargo from PATH
    cargo build --release
}

# Check if build was successful
if ($LASTEXITCODE -eq 0) {
    Write-Host "Rust binary built successfully"

    # Copy the binary to resources/bin with .exe extension
    Copy-Item "target/release/speakmcp-rs.exe" "../resources/bin/speakmcp-rs.exe" -Force
    Write-Host "Binary copied to resources/bin/speakmcp-rs.exe"
} else {
    Write-Host "Failed to build Rust binary"
    Set-Location ".."
    exit 1
}

# Return to project root
Set-Location ".."

Write-Host "Windows Rust binary build completed successfully!"
