#!/bin/bash

# Setup script for VNC testing secrets
# This script helps you configure the required GitHub secrets for VNC testing

set -e

echo "============================================"
echo "SpeakMCP VNC Testing Setup"
echo "============================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo -e "${RED}Error: GitHub CLI (gh) is not installed${NC}"
    echo ""
    echo "Please install it first:"
    echo "  macOS:   brew install gh"
    echo "  Linux:   See https://github.com/cli/cli/blob/trunk/docs/install_linux.md"
    echo "  Windows: See https://github.com/cli/cli#windows"
    echo ""
    exit 1
fi

# Check if user is authenticated
if ! gh auth status &> /dev/null; then
    echo -e "${YELLOW}You need to authenticate with GitHub first${NC}"
    echo "Running: gh auth login"
    echo ""
    gh auth login
fi

echo -e "${GREEN}✓ GitHub CLI is ready${NC}"
echo ""

# Get repository info
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo "")

if [ -z "$REPO" ]; then
    echo -e "${RED}Error: Not in a GitHub repository${NC}"
    echo "Please run this script from your SpeakMCP repository directory"
    exit 1
fi

echo "Repository: $REPO"
echo ""

# Setup NGROK_AUTH_TOKEN
echo "============================================"
echo "1. Setting up NGROK_AUTH_TOKEN"
echo "============================================"
echo ""
echo "This token is required for remote VNC access."
echo ""
echo "To get your ngrok auth token:"
echo "  1. Sign up at https://ngrok.com (free account is fine)"
echo "  2. Go to https://dashboard.ngrok.com/auth"
echo "  3. Copy your auth token"
echo ""

# Check if secret already exists
if gh secret list | grep -q "NGROK_AUTH_TOKEN"; then
    echo -e "${YELLOW}NGROK_AUTH_TOKEN already exists${NC}"
    read -p "Do you want to update it? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Skipping NGROK_AUTH_TOKEN"
    else
        read -sp "Enter your ngrok auth token: " NGROK_TOKEN
        echo
        if [ -n "$NGROK_TOKEN" ]; then
            echo "$NGROK_TOKEN" | gh secret set NGROK_AUTH_TOKEN
            echo -e "${GREEN}✓ NGROK_AUTH_TOKEN updated${NC}"
        else
            echo -e "${RED}✗ No token provided, skipping${NC}"
        fi
    fi
else
    read -sp "Enter your ngrok auth token: " NGROK_TOKEN
    echo
    if [ -n "$NGROK_TOKEN" ]; then
        echo "$NGROK_TOKEN" | gh secret set NGROK_AUTH_TOKEN
        echo -e "${GREEN}✓ NGROK_AUTH_TOKEN set${NC}"
    else
        echo -e "${RED}✗ No token provided, skipping${NC}"
        echo -e "${YELLOW}⚠ You won't be able to use remote VNC access without this${NC}"
    fi
fi

echo ""

# Setup VNC_PASSWORD
echo "============================================"
echo "2. Setting up VNC_PASSWORD"
echo "============================================"
echo ""
echo "This is the password you'll use to connect to VNC."
echo "Note: VNC passwords are limited to 8 characters"
echo "Default password is 'github123' if not set"
echo ""

# Check if secret already exists
if gh secret list | grep -q "VNC_PASSWORD"; then
    echo -e "${YELLOW}VNC_PASSWORD already exists${NC}"
    read -p "Do you want to update it? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Skipping VNC_PASSWORD"
    else
        read -sp "Enter VNC password (max 8 characters): " VNC_PASS
        echo
        if [ -n "$VNC_PASS" ]; then
            echo "$VNC_PASS" | gh secret set VNC_PASSWORD
            echo -e "${GREEN}✓ VNC_PASSWORD updated${NC}"
        else
            echo -e "${YELLOW}Using default password 'github123'${NC}"
        fi
    fi
else
    read -p "Set custom VNC password? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        read -sp "Enter VNC password (max 8 characters): " VNC_PASS
        echo
        if [ -n "$VNC_PASS" ]; then
            echo "$VNC_PASS" | gh secret set VNC_PASSWORD
            echo -e "${GREEN}✓ VNC_PASSWORD set${NC}"
        else
            echo -e "${YELLOW}Using default password 'github123'${NC}"
        fi
    else
        echo -e "${YELLOW}Using default password 'github123'${NC}"
    fi
fi

echo ""
echo "============================================"
echo "Setup Complete!"
echo "============================================"
echo ""
echo "Your secrets are now configured:"
echo ""

# List all secrets
gh secret list

echo ""
echo "Next steps:"
echo "  1. Go to your repository on GitHub"
echo "  2. Click on 'Actions' tab"
echo "  3. Select 'VNC GUI Testing' workflow"
echo "  4. Click 'Run workflow'"
echo "  5. Configure options and start the workflow"
echo ""
echo "For detailed instructions, see:"
echo "  .github/VNC_TESTING_GUIDE.md"
echo ""
echo -e "${GREEN}Happy testing!${NC}"

