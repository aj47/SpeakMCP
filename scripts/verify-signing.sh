#!/bin/bash

# SpeakMCP Signing Verification Script
# This script verifies that your code signing setup is working correctly

echo "🔍 SpeakMCP Code Signing Verification"
echo "====================================="
echo ""

# Check if we're on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "❌ This script must be run on macOS"
    exit 1
fi

# Load environment variables
if [ -f .env ]; then
    set -a
    source .env
    set +a
    echo "✅ Loaded environment variables from .env"
else
    echo "⚠️  No .env file found. Some checks may fail."
fi

echo ""
echo "📋 Environment Variables Check"
echo "-----------------------------"

if [ -n "$APPLE_TEAM_ID" ]; then
    echo "✅ APPLE_TEAM_ID: $APPLE_TEAM_ID"
else
    echo "❌ APPLE_TEAM_ID not set"
fi

if [ -n "$APPLE_ID" ]; then
    echo "✅ APPLE_ID: $APPLE_ID"
else
    echo "❌ APPLE_ID not set"
fi

if [ -n "$APPLE_APP_SPECIFIC_PASSWORD" ]; then
    echo "✅ APPLE_APP_SPECIFIC_PASSWORD: [HIDDEN]"
else
    echo "❌ APPLE_APP_SPECIFIC_PASSWORD not set"
fi

if [ -n "$CSC_NAME" ]; then
    echo "✅ CSC_NAME: $CSC_NAME"
else
    echo "❌ CSC_NAME not set"
fi

echo ""
echo "🔐 Code Signing Certificates Check"
echo "----------------------------------"

# Check for Developer ID certificates
SIGNING_IDENTITIES=$(security find-identity -v -p codesigning | grep "Developer ID Application")

if [ -z "$SIGNING_IDENTITIES" ]; then
    echo "❌ No Developer ID Application certificates found!"
    echo "   Please install your certificate from Apple Developer Portal"
else
    echo "✅ Found Developer ID Application certificates:"
    echo "$SIGNING_IDENTITIES"
fi

echo ""
echo "🛠️  Xcode Command Line Tools Check"
echo "----------------------------------"

if xcode-select -p &> /dev/null; then
    echo "✅ Xcode Command Line Tools installed at: $(xcode-select -p)"
else
    echo "❌ Xcode Command Line Tools not found"
    echo "   Install with: xcode-select --install"
fi

echo ""
echo "📦 Build Dependencies Check"
echo "---------------------------"

if command -v node &> /dev/null; then
    echo "✅ Node.js: $(node --version)"
else
    echo "❌ Node.js not found"
fi

if command -v npm &> /dev/null; then
    echo "✅ npm: $(npm --version)"
else
    echo "❌ npm not found"
fi

if [ -f "node_modules/.bin/electron-builder" ]; then
    echo "✅ electron-builder installed"
else
    echo "❌ electron-builder not found. Run: npm install"
fi

echo ""
echo "🧪 Test Signing (if app exists)"
echo "------------------------------"

if [ -d "dist/mac-arm64/SpeakMCP.app" ]; then
    echo "Found existing app, testing signature..."
    if codesign -dv --verbose=4 "dist/mac-arm64/SpeakMCP.app" 2>&1 | grep -q "Developer ID Application"; then
        echo "✅ App is properly signed"
    else
        echo "⚠️  App signature verification failed or app is not signed"
    fi
elif [ -f "dist/SpeakMCP-"*".dmg" ]; then
    echo "Found DMG, testing signature..."
    DMG_FILE=$(ls dist/SpeakMCP-*.dmg | head -n1)
    if spctl -a -vvv -t install "$DMG_FILE" 2>&1 | grep -q "accepted"; then
        echo "✅ DMG is properly signed and notarized"
    else
        echo "⚠️  DMG signature/notarization verification failed"
    fi
else
    echo "ℹ️  No built app found. Run 'npm run build:mac:signed' to test signing"
fi

echo ""
echo "📝 Summary"
echo "----------"

# Count issues
ISSUES=0

[ -z "$APPLE_TEAM_ID" ] && ((ISSUES++))
[ -z "$APPLE_ID" ] && ((ISSUES++))
[ -z "$APPLE_APP_SPECIFIC_PASSWORD" ] && ((ISSUES++))
[ -z "$CSC_NAME" ] && ((ISSUES++))
[ -z "$SIGNING_IDENTITIES" ] && ((ISSUES++))

if [ $ISSUES -eq 0 ]; then
    echo "🎉 All checks passed! Your signing setup looks good."
    echo "   You can now run: npm run build:mac:signed"
else
    echo "⚠️  Found $ISSUES issue(s) that need to be resolved."
    echo "   Please check the items marked with ❌ above."
    echo "   Run './scripts/setup-apple-signing.sh' for guided setup."
fi

echo ""
