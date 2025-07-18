#!/bin/bash

echo "🏪 Building SpeakMCP for Mac App Store"
echo "======================================"

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Check prerequisites
echo "🔍 Checking prerequisites..."

# Check for Mac App Store certificates
MAS_APP_CERT=$(security find-identity -v -p codesigning | grep "Mac App Distribution")
MAS_INSTALLER_CERT=$(security find-identity -v -p codesigning | grep "Mac Installer Distribution")

if [ -z "$MAS_APP_CERT" ]; then
    echo "❌ Mac App Distribution certificate not found"
    echo "   Please create it at: https://developer.apple.com/account/resources/certificates/list"
    exit 1
fi

if [ -z "$MAS_INSTALLER_CERT" ]; then
    echo "❌ Mac Installer Distribution certificate not found"
    echo "   Please create it at: https://developer.apple.com/account/resources/certificates/list"
    exit 1
fi

echo "✅ Mac App Store certificates found"

# Check for provisioning profile
if [ -n "$MAS_PROVISIONING_PROFILE" ] && [ -f "$MAS_PROVISIONING_PROFILE" ]; then
    echo "✅ Provisioning profile found: $MAS_PROVISIONING_PROFILE"
else
    echo "❌ Provisioning profile not found or not configured"
    echo "   Please set MAS_PROVISIONING_PROFILE in .env file"
    exit 1
fi

# Build the app
echo ""
echo "🔨 Building Mac App Store version..."
npm run build:mas

if [ $? -ne 0 ]; then
    echo "❌ Build failed"
    exit 1
fi

echo "✅ Build completed successfully"

# Find the generated .pkg file
PKG_FILE=$(find dist -name "*-mas.pkg" | head -1)

if [ -z "$PKG_FILE" ]; then
    echo "❌ No .pkg file found in dist directory"
    exit 1
fi

echo "📦 Generated package: $PKG_FILE"

# Verify the package
echo ""
echo "🔍 Verifying package..."
pkgutil --check-signature "$PKG_FILE"

if [ $? -eq 0 ]; then
    echo "✅ Package signature verified"
else
    echo "⚠️  Package signature verification failed (this might be expected for MAS builds)"
fi

# Upload options
echo ""
echo "📤 Upload Options:"
echo "=================="
echo ""
echo "Option 1: Upload using Transporter app (Recommended)"
echo "  1. Download Transporter from Mac App Store"
echo "  2. Open Transporter and sign in with: $APPLE_ID"
echo "  3. Drag and drop: $PKG_FILE"
echo "  4. Click 'Deliver'"
echo ""
echo "Option 2: Upload using command line"
echo "  xcrun altool --upload-app --type osx --file \"$PKG_FILE\" --username \"$APPLE_ID\" --password \"$APPLE_APP_SPECIFIC_PASSWORD\""
echo ""

# Ask user which option they prefer
read -p "Would you like to upload now using command line? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🚀 Uploading to App Store Connect..."
    xcrun altool --upload-app --type osx --file "$PKG_FILE" --username "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD"

    if [ $? -eq 0 ]; then
        echo "✅ Upload completed successfully!"
        echo ""
        echo "Next steps:"
        echo "1. Go to App Store Connect: https://appstoreconnect.apple.com"
        echo "2. Navigate to your SpeakMCP app"
        echo "3. Wait for processing to complete (can take several minutes)"
        echo "4. Add app metadata, screenshots, and description"
        echo "5. Submit for review"
    else
        echo "❌ Upload failed. Please check the error messages above."
        echo "You can also try using the Transporter app instead."
    fi
else
    echo "📋 Package ready for upload: $PKG_FILE"
    echo "Use Transporter app or the command line option shown above."
fi

echo ""
echo "🎉 Mac App Store build process completed!"
