Write-Host "Creating manual Windows build..." -ForegroundColor Cyan

$projectRoot = Get-Location
$buildDir = Join-Path $projectRoot "manual-build-win"
$electronVersion = "31.7.0"

# Clean build directory
if (Test-Path $buildDir) {
    Write-Host "Cleaning existing build directory..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $buildDir
}

New-Item -ItemType Directory -Path $buildDir -Force | Out-Null

Write-Host "Downloading Electron..." -ForegroundColor Green

# Download Electron for Windows
$electronUrl = "https://github.com/electron/electron/releases/download/v$electronVersion/electron-v$electronVersion-win32-x64.zip"
$electronZip = Join-Path $buildDir "electron.zip"

try {
    Invoke-WebRequest -Uri $electronUrl -OutFile $electronZip

    Write-Host "Extracting Electron..." -ForegroundColor Green
    Expand-Archive -Path $electronZip -DestinationPath $buildDir -Force

    # Remove the zip file
    Remove-Item $electronZip

    Write-Host "Copying application files..." -ForegroundColor Green

    # Create app directory
    $appDir = Join-Path $buildDir "resources\app"
    New-Item -ItemType Directory -Path $appDir -Force | Out-Null

    # Copy package.json
    Copy-Item (Join-Path $projectRoot "package.json") (Join-Path $appDir "package.json")

    # Copy built output
    $outDir = Join-Path $projectRoot "out"
    if (Test-Path $outDir) {
        Copy-Item -Recurse $outDir (Join-Path $appDir "out")
    } else {
        Write-Host "Built output not found. Please run 'npx electron-vite build' first." -ForegroundColor Red
        exit 1
    }

    # Copy resources
    $resourcesDir = Join-Path $projectRoot "resources"
    if (Test-Path $resourcesDir) {
        Copy-Item -Recurse $resourcesDir (Join-Path $appDir "resources")
    }

    # Copy node_modules (essential ones only)
    Write-Host "Copying essential node_modules..." -ForegroundColor Green
    $nodeModulesDir = Join-Path $appDir "node_modules"
    New-Item -ItemType Directory -Path $nodeModulesDir -Force | Out-Null

    # Copy essential dependencies
    $essentialDeps = @(
        "@egoist/electron-panel-window",
        "@modelcontextprotocol/sdk"
    )

    foreach ($dep in $essentialDeps) {
        $srcPath = Join-Path $projectRoot "node_modules\$dep"
        $destPath = Join-Path $nodeModulesDir $dep
        if (Test-Path $srcPath) {
            Copy-Item -Recurse $srcPath $destPath
        }
    }

    # Rename electron.exe to speakmcp.exe
    $electronExe = Join-Path $buildDir "electron.exe"
    $appExe = Join-Path $buildDir "speakmcp.exe"
    if (Test-Path $electronExe) {
        Rename-Item $electronExe "speakmcp.exe"
    }

    Write-Host "Manual Windows build completed!" -ForegroundColor Green
    Write-Host "Build location: $buildDir" -ForegroundColor Cyan
    Write-Host "Run: $appExe" -ForegroundColor Cyan

} catch {
    Write-Host "Build failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
