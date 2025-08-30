# Windows Defender Exclusions Setup for SpeakMCP
# Run this script as Administrator to add necessary exclusions

param(
    [switch]$Development = $false,
    [switch]$Remove = $false,
    [switch]$List = $false
)

# Check if running as Administrator
function Test-Administrator {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Administrator)) {
    Write-Host "❌ This script must be run as Administrator" -ForegroundColor Red
    Write-Host "   Right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    exit 1
}

Write-Host "🛡️  SpeakMCP Windows Defender Setup" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan

# Get current user path
$userPath = $env:USERPROFILE
$programFiles = ${env:ProgramFiles}

# Define exclusions
$userFolders = @(
    "$userPath\AppData\Local\Programs\SpeakMCP",
    "$userPath\AppData\Roaming\SpeakMCP"
)

$systemFolders = @(
    "$programFiles\SpeakMCP"
)

$processes = @(
    "speakmcp.exe",
    "speakmcp-rs.exe"
)

$developmentFolders = @(
    "$userPath\Development\SpeakMCP",
    "$userPath\Documents\SpeakMCP",
    "$userPath\Desktop\SpeakMCP"
)

$developmentProcesses = @(
    "cargo.exe",
    "electron.exe"
)

# Function to add exclusions
function Add-Exclusions {
    param($folders, $processes, $type)
    
    Write-Host "📁 Adding $type folder exclusions..." -ForegroundColor Yellow
    
    foreach ($folder in $folders) {
        try {
            Add-MpPreference -ExclusionPath $folder -ErrorAction Stop
            Write-Host "   ✓ $folder" -ForegroundColor Green
        } catch {
            if ($_.Exception.Message -like "*already exists*") {
                Write-Host "   ⚠ $folder (already exists)" -ForegroundColor Yellow
            } else {
                Write-Host "   ✗ $folder - $($_.Exception.Message)" -ForegroundColor Red
            }
        }
    }
    
    Write-Host "🔄 Adding $type process exclusions..." -ForegroundColor Yellow
    
    foreach ($process in $processes) {
        try {
            Add-MpPreference -ExclusionProcess $process -ErrorAction Stop
            Write-Host "   ✓ $process" -ForegroundColor Green
        } catch {
            if ($_.Exception.Message -like "*already exists*") {
                Write-Host "   ⚠ $process (already exists)" -ForegroundColor Yellow
            } else {
                Write-Host "   ✗ $process - $($_.Exception.Message)" -ForegroundColor Red
            }
        }
    }
}

# Function to remove exclusions
function Remove-Exclusions {
    param($folders, $processes, $type)
    
    Write-Host "📁 Removing $type folder exclusions..." -ForegroundColor Yellow
    
    foreach ($folder in $folders) {
        try {
            Remove-MpPreference -ExclusionPath $folder -ErrorAction Stop
            Write-Host "   ✓ Removed $folder" -ForegroundColor Green
        } catch {
            Write-Host "   ⚠ $folder (not found or already removed)" -ForegroundColor Yellow
        }
    }
    
    Write-Host "🔄 Removing $type process exclusions..." -ForegroundColor Yellow
    
    foreach ($process in $processes) {
        try {
            Remove-MpPreference -ExclusionProcess $process -ErrorAction Stop
            Write-Host "   ✓ Removed $process" -ForegroundColor Green
        } catch {
            Write-Host "   ⚠ $process (not found or already removed)" -ForegroundColor Yellow
        }
    }
}

# Function to list current exclusions
function List-Exclusions {
    Write-Host "📋 Current Windows Defender Exclusions:" -ForegroundColor Cyan
    
    try {
        $preferences = Get-MpPreference
        
        Write-Host "`n📁 Folder Exclusions:" -ForegroundColor Yellow
        if ($preferences.ExclusionPath) {
            $preferences.ExclusionPath | Where-Object { $_ -like "*SpeakMCP*" -or $_ -like "*speakmcp*" } | ForEach-Object {
                Write-Host "   • $_" -ForegroundColor White
            }
        } else {
            Write-Host "   (none)" -ForegroundColor Gray
        }
        
        Write-Host "`n🔄 Process Exclusions:" -ForegroundColor Yellow
        if ($preferences.ExclusionProcess) {
            $preferences.ExclusionProcess | Where-Object { $_ -like "*speakmcp*" -or $_ -like "*cargo*" -or $_ -like "*electron*" } | ForEach-Object {
                Write-Host "   • $_" -ForegroundColor White
            }
        } else {
            Write-Host "   (none)" -ForegroundColor Gray
        }
        
    } catch {
        Write-Host "❌ Failed to retrieve exclusions: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Main execution
try {
    if ($List) {
        List-Exclusions
        exit 0
    }
    
    if ($Remove) {
        Write-Host "🗑️  Removing SpeakMCP exclusions..." -ForegroundColor Red
        Remove-Exclusions $userFolders $processes "user"
        Remove-Exclusions $systemFolders @() "system"
        
        if ($Development) {
            Remove-Exclusions $developmentFolders $developmentProcesses "development"
        }
        
        Write-Host "`n✅ SpeakMCP exclusions removed successfully!" -ForegroundColor Green
    } else {
        Write-Host "➕ Adding SpeakMCP exclusions..." -ForegroundColor Green
        
        # Add user exclusions
        Add-Exclusions $userFolders $processes "user"
        
        # Add system exclusions
        Add-Exclusions $systemFolders @() "system"
        
        # Add development exclusions if requested
        if ($Development) {
            Write-Host "`n🔧 Adding development exclusions..." -ForegroundColor Cyan
            Add-Exclusions $developmentFolders $developmentProcesses "development"
        }
        
        Write-Host "`n✅ SpeakMCP exclusions added successfully!" -ForegroundColor Green
        Write-Host "   You may need to restart SpeakMCP for changes to take effect." -ForegroundColor Yellow
    }
    
} catch {
    Write-Host "❌ An error occurred: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "`n📖 For more information, see: WINDOWS_DEFENDER_SETUP.md" -ForegroundColor Cyan
