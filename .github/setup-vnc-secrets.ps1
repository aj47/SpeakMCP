# Setup script for VNC testing secrets (PowerShell version)
# This script helps you configure the required GitHub secrets for VNC testing

$ErrorActionPreference = "Stop"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "SpeakMCP VNC Testing Setup" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Check if gh CLI is installed
try {
    $null = Get-Command gh -ErrorAction Stop
    Write-Host "✓ GitHub CLI is installed" -ForegroundColor Green
} catch {
    Write-Host "Error: GitHub CLI (gh) is not installed" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install it first:"
    Write-Host "  Windows: winget install GitHub.cli"
    Write-Host "  Or download from: https://cli.github.com/"
    Write-Host ""
    exit 1
}

# Check if user is authenticated
try {
    gh auth status 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Not authenticated"
    }
    Write-Host "✓ GitHub CLI is authenticated" -ForegroundColor Green
} catch {
    Write-Host "You need to authenticate with GitHub first" -ForegroundColor Yellow
    Write-Host "Running: gh auth login"
    Write-Host ""
    gh auth login
}

Write-Host ""

# Get repository info
try {
    $REPO = gh repo view --json nameWithOwner -q .nameWithOwner 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Not in a repository"
    }
    Write-Host "Repository: $REPO" -ForegroundColor Cyan
} catch {
    Write-Host "Error: Not in a GitHub repository" -ForegroundColor Red
    Write-Host "Please run this script from your SpeakMCP repository directory"
    exit 1
}

Write-Host ""

# Setup NGROK_AUTH_TOKEN
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "1. Setting up NGROK_AUTH_TOKEN" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "This token is required for remote VNC access."
Write-Host ""
Write-Host "To get your ngrok auth token:"
Write-Host "  1. Sign up at https://ngrok.com (free account is fine)"
Write-Host "  2. Go to https://dashboard.ngrok.com/auth"
Write-Host "  3. Copy your auth token"
Write-Host ""

# Check if secret already exists
$secretsList = gh secret list 2>&1
if ($secretsList -match "NGROK_AUTH_TOKEN") {
    Write-Host "NGROK_AUTH_TOKEN already exists" -ForegroundColor Yellow
    $update = Read-Host "Do you want to update it? (y/N)"
    if ($update -eq "y" -or $update -eq "Y") {
        $ngrokToken = Read-Host "Enter your ngrok auth token" -AsSecureString
        $ngrokTokenPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ngrokToken))
        
        if ($ngrokTokenPlain) {
            $ngrokTokenPlain | gh secret set NGROK_AUTH_TOKEN
            Write-Host "✓ NGROK_AUTH_TOKEN updated" -ForegroundColor Green
        } else {
            Write-Host "✗ No token provided, skipping" -ForegroundColor Red
        }
    } else {
        Write-Host "Skipping NGROK_AUTH_TOKEN"
    }
} else {
    $ngrokToken = Read-Host "Enter your ngrok auth token" -AsSecureString
    $ngrokTokenPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ngrokToken))
    
    if ($ngrokTokenPlain) {
        $ngrokTokenPlain | gh secret set NGROK_AUTH_TOKEN
        Write-Host "✓ NGROK_AUTH_TOKEN set" -ForegroundColor Green
    } else {
        Write-Host "✗ No token provided, skipping" -ForegroundColor Red
        Write-Host "⚠ You won't be able to use remote VNC access without this" -ForegroundColor Yellow
    }
}

Write-Host ""

# Setup VNC_PASSWORD
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "2. Setting up VNC_PASSWORD" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "This is the password you'll use to connect to VNC."
Write-Host "Note: VNC passwords are limited to 8 characters"
Write-Host "Default password is 'github123' if not set"
Write-Host ""

# Check if secret already exists
if ($secretsList -match "VNC_PASSWORD") {
    Write-Host "VNC_PASSWORD already exists" -ForegroundColor Yellow
    $update = Read-Host "Do you want to update it? (y/N)"
    if ($update -eq "y" -or $update -eq "Y") {
        $vncPass = Read-Host "Enter VNC password (max 8 characters)" -AsSecureString
        $vncPassPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($vncPass))
        
        if ($vncPassPlain) {
            $vncPassPlain | gh secret set VNC_PASSWORD
            Write-Host "✓ VNC_PASSWORD updated" -ForegroundColor Green
        } else {
            Write-Host "Using default password 'github123'" -ForegroundColor Yellow
        }
    } else {
        Write-Host "Skipping VNC_PASSWORD"
    }
} else {
    $setPassword = Read-Host "Set custom VNC password? (y/N)"
    if ($setPassword -eq "y" -or $setPassword -eq "Y") {
        $vncPass = Read-Host "Enter VNC password (max 8 characters)" -AsSecureString
        $vncPassPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($vncPass))
        
        if ($vncPassPlain) {
            $vncPassPlain | gh secret set VNC_PASSWORD
            Write-Host "✓ VNC_PASSWORD set" -ForegroundColor Green
        } else {
            Write-Host "Using default password 'github123'" -ForegroundColor Yellow
        }
    } else {
        Write-Host "Using default password 'github123'" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "Setup Complete!" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Your secrets are now configured:"
Write-Host ""

# List all secrets
gh secret list

Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Go to your repository on GitHub"
Write-Host "  2. Click on 'Actions' tab"
Write-Host "  3. Select 'VNC GUI Testing' workflow"
Write-Host "  4. Click 'Run workflow'"
Write-Host "  5. Configure options and start the workflow"
Write-Host ""
Write-Host "For detailed instructions, see:"
Write-Host "  .github/VNC_TESTING_GUIDE.md"
Write-Host ""
Write-Host "Happy testing!" -ForegroundColor Green

