#!/bin/bash

echo "🔍 Checking Mac App Store Setup for SpeakMCP"
echo "============================================="

# Check for Developer ID certificates (already have these)
echo "✅ Checking Developer ID certificates..."
security find-identity -v -p codesigning | grep "Developer ID Application"

echo ""
echo "🏪 Checking Mac App Store certificates..."

# Check for Mac App Store certificates (check both old and new naming)
MAS_APP_CERT=$(security find-identity -v -p codesigning | grep -E "(Mac App Distribution|3rd Party Mac Developer Application)" || echo "❌ Not found")
MAS_INSTALLER_CERT=$(security find-identity -v | grep -E "(Mac Installer Distribution|3rd Party Mac Developer Installer)" || echo "❌ Not found")

echo "Mac App Distribution: $MAS_APP_CERT"
echo "Mac Installer Distribution: $MAS_INSTALLER_CERT"

echo ""
echo "📋 Bundle ID Status:"
echo "Required Bundle ID: app.speakmcp"
echo "Current config: $(grep 'appId:' electron-builder.config.cjs | cut -d'"' -f2)"

echo ""
echo "📦 Provisioning Profiles:"
PROFILES=$(find ~/Library/MobileDevice/Provisioning\ Profiles/ -name "*.provisionprofile" 2>/dev/null)
if [ -n "$PROFILES" ]; then
    echo "✅ Found provisioning profiles:"
    echo "$PROFILES"
else
    echo "❌ No provisioning profiles found"
fi

echo ""
echo "🔧 Next Steps:"
echo "1. If Mac App Store certificates are missing, create them at:"
echo "   https://developer.apple.com/account/resources/certificates/list"
echo ""
echo "2. Create Bundle ID 'app.speakmcp' at:"
echo "   https://developer.apple.com/account/resources/identifiers/list"
echo ""
echo "3. Create Mac App Store provisioning profile at:"
echo "   https://developer.apple.com/account/resources/profiles/list"
echo ""
echo "4. Create app record in App Store Connect at:"
echo "   https://appstoreconnect.apple.com"
echo ""
echo "5. Once setup is complete, build with:"
echo "   npm run build:mas"
