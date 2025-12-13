# Windows Build Script with Process Cleanup
# Handles common Windows build issues like locked files and running processes

param(
    [switch]$SkipTypes = $false
)

Write-Host "[BUILD] Starting Windows build with cleanup..." -ForegroundColor Green

# Function to kill processes safely
function Stop-SpeakMCPProcesses {
    Write-Host "[CLEANUP] Stopping SpeakMCP processes..." -ForegroundColor Yellow
    
    try {
        # Kill speakmcp.exe processes
        $processes = Get-Process -Name "speakmcp" -ErrorAction SilentlyContinue
        if ($processes) {
            Write-Host "[CLEANUP] Found $($processes.Count) speakmcp.exe processes" -ForegroundColor Yellow
            $processes | ForEach-Object {
                try {
                    $_.Kill()
                    Write-Host "[CLEANUP] Killed process $($_.Id)" -ForegroundColor Green
                } catch {
                    Write-Host "[WARNING] Could not kill process $($_.Id): $($_.Exception.Message)" -ForegroundColor Yellow
                }
            }
            Start-Sleep -Seconds 2
        }
        
        # Kill speakmcp-rs.exe processes
        $rsProcesses = Get-Process -Name "speakmcp-rs" -ErrorAction SilentlyContinue
        if ($rsProcesses) {
            Write-Host "[CLEANUP] Found $($rsProcesses.Count) speakmcp-rs.exe processes" -ForegroundColor Yellow
            $rsProcesses | ForEach-Object {
                try {
                    $_.Kill()
                    Write-Host "[CLEANUP] Killed Rust process $($_.Id)" -ForegroundColor Green
                } catch {
                    Write-Host "[WARNING] Could not kill Rust process $($_.Id): $($_.Exception.Message)" -ForegroundColor Yellow
                }
            }
            Start-Sleep -Seconds 2
        }
        
        if (-not $processes -and -not $rsProcesses) {
            Write-Host "[CLEANUP] No SpeakMCP processes found" -ForegroundColor Green
        }
    } catch {
        Write-Host "[WARNING] Error during process cleanup: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# Function to clean dist directory with retries
function Remove-DistDirectory {
    Write-Host "[CLEANUP] Cleaning dist directory..." -ForegroundColor Yellow
    
    $maxRetries = 3
    $retryCount = 0
    
    while ($retryCount -lt $maxRetries) {
        try {
            if (Test-Path "dist") {
                Remove-Item -Path "dist" -Recurse -Force -ErrorAction Stop
                Write-Host "[CLEANUP] Successfully removed dist directory" -ForegroundColor Green
                return $true
            } else {
                Write-Host "[CLEANUP] Dist directory does not exist" -ForegroundColor Green
                return $true
            }
        } catch {
            $retryCount++
            Write-Host "[WARNING] Attempt $retryCount failed: $($_.Exception.Message)" -ForegroundColor Yellow
            
            if ($retryCount -lt $maxRetries) {
                Write-Host "[CLEANUP] Waiting 3 seconds before retry..." -ForegroundColor Yellow
                Start-Sleep -Seconds 3
                
                # Try to kill processes again
                Stop-SpeakMCPProcesses
            } else {
                Write-Host "[ERROR] Failed to clean dist directory after $maxRetries attempts" -ForegroundColor Red
                Write-Host "[INFO] You may need to:" -ForegroundColor Cyan
                Write-Host "  1. Close any running SpeakMCP instances" -ForegroundColor Cyan
                Write-Host "  2. Disable antivirus temporarily" -ForegroundColor Cyan
                Write-Host "  3. Run PowerShell as Administrator" -ForegroundColor Cyan
                return $false
            }
        }
    }
    return $false
}

# Function to ensure required directories exist
function Ensure-BuildDirectories {
    Write-Host "[SETUP] Ensuring build directories exist..." -ForegroundColor Yellow

    $directories = @(
        "dist",
        "dist-installer",
        "resources/bin"
    )

    foreach ($dir in $directories) {
        if (!(Test-Path $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
            Write-Host "[SETUP] Created directory: $dir" -ForegroundColor Green
        } else {
            Write-Host "[SETUP] Directory exists: $dir" -ForegroundColor Green
        }
    }
}

# Main build process
try {
    # Step 1: Stop any running processes
    Stop-SpeakMCPProcesses

    # Step 2: Clean dist directory
    $cleanSuccess = Remove-DistDirectory
    if (-not $cleanSuccess) {
        Write-Host "[ERROR] Could not clean dist directory. Build may fail." -ForegroundColor Red
        Write-Host "[INFO] Continuing anyway..." -ForegroundColor Yellow
    }

    # Step 3: Ensure required directories exist
    Ensure-BuildDirectories

    # Step 4: Run the build
    Write-Host "[BUILD] Starting electron build..." -ForegroundColor Green

    if ($SkipTypes) {
        Write-Host "[BUILD] Running build with type checking skipped..." -ForegroundColor Yellow
        & pnpm run build:win:skip-types
    } else {
        Write-Host "[BUILD] Running full build with type checking..." -ForegroundColor Yellow
        & pnpm run build:win
    }
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[SUCCESS] Windows build completed successfully!" -ForegroundColor Green
        
        # Show build artifacts
        if (Test-Path "dist") {
            Write-Host "[INFO] Build artifacts:" -ForegroundColor Cyan
            Get-ChildItem -Path "dist" -File | ForEach-Object {
                $sizeKB = [math]::Round($_.Length / 1KB, 2)
                Write-Host "  $($_.Name) ($sizeKB KB)" -ForegroundColor Cyan
            }
        }
    } else {
        Write-Host "[ERROR] Build failed with exit code $LASTEXITCODE" -ForegroundColor Red
        exit $LASTEXITCODE
    }
    
} catch {
    Write-Host "[ERROR] Build script failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
