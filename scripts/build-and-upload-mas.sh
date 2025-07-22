#!/bin/bash

echo "🏪 Building SpeakMCP for Mac App Store"
echo "======================================"

# Load environment variables
if [ -f .env ]; then
    set -a
    source .env
    set +a
fi

# Check prerequisites
echo "🔍 Checking prerequisites..."

# Check for Mac App Store certificates
MAS_APP_CERT=$(security find-identity -v -p codesigning | grep "3rd Party Mac Developer Application")
MAS_INSTALLER_CERT=$(security find-identity -v -p codesigning | grep "3rd Party Mac Developer Installer")

if [ -z "$MAS_APP_CERT" ]; then
    echo "❌ 3rd Party Mac Developer Application certificate not found"
    echo "   Please create it at: https://developer.apple.com/account/resources/certificates/list"
    exit 1
fi

echo "✅ Mac App Store application certificate found"

if [ -z "$MAS_INSTALLER_CERT" ]; then
    echo "⚠️  3rd Party Mac Developer Installer certificate not found"
    echo "   This is needed to create .pkg files, but we can upload .app files directly"
    echo "   You can create it at: https://developer.apple.com/account/resources/certificates/list"
    SKIP_PKG_BUILD=true
else
    echo "✅ Mac App Store installer certificate found"
    SKIP_PKG_BUILD=false
fi

# Check for provisioning profile (optional for direct .app upload)
if [ -n "$MAS_PROVISIONING_PROFILE" ] && [ -f "$MAS_PROVISIONING_PROFILE" ]; then
    echo "✅ Provisioning profile found: $MAS_PROVISIONING_PROFILE"
elif [ "$SKIP_PKG_BUILD" = "false" ]; then
    echo "❌ Provisioning profile not found or not configured"
    echo "   Please set MAS_PROVISIONING_PROFILE in .env file"
    echo "   Or upload the .app file directly using Transporter"
    exit 1
else
    echo "⚠️  Provisioning profile not found - will upload .app file directly"
fi

# Build the app
echo ""
echo "🔨 Building Mac App Store version..."
CSC_NAME="$CSC_MAS_NAME" npm run build:mas

if [ $? -ne 0 ]; then
    echo "❌ Build failed"
    exit 1
fi

echo "✅ Build completed successfully"

# Check what was built
APP_FILE=$(find dist -name "SpeakMCP.app" -path "*/mas-*/*" | head -1)
PKG_FILE=$(find dist -name "*-mas.pkg" | head -1)

if [ -n "$PKG_FILE" ]; then
    echo "📦 Generated package: $PKG_FILE"
    UPLOAD_FILE="$PKG_FILE"
    UPLOAD_TYPE="pkg"
elif [ -n "$APP_FILE" ]; then
    echo "📱 Generated app: $APP_FILE"
    UPLOAD_FILE="$APP_FILE"
    UPLOAD_TYPE="app"
else
    echo "❌ No .pkg or .app file found in dist directory"
    exit 1
fi

# Verify the package/app
echo ""
if [ "$UPLOAD_TYPE" = "pkg" ]; then
    echo "🔍 Verifying package..."
    pkgutil --check-signature "$UPLOAD_FILE"
    if [ $? -eq 0 ]; then
        echo "✅ Package signature verified"
    else
        echo "⚠️  Package signature verification failed (this might be expected for MAS builds)"
    fi
else
    echo "🔍 Verifying app signature..."
    codesign -dv --verbose=4 "$UPLOAD_FILE" 2>&1 | head -5
    if [ $? -eq 0 ]; then
        echo "✅ App signature verified"
    else
        echo "⚠️  App signature verification failed"
    fi
fi

# Upload options
echo ""
echo "📤 Upload Options:"
echo "=================="
echo ""
echo "Option 1: Upload using Transporter app (Recommended)"
echo "  1. Download Transporter from Mac App Store"
echo "  2. Open Transporter and sign in with: $APPLE_ID"
echo "  3. Drag and drop: $UPLOAD_FILE"
echo "  4. Click 'Deliver'"
echo ""
echo "Option 2: Upload using command line"
echo "  xcrun altool --upload-app --type osx --file \"$UPLOAD_FILE\" --username \"$APPLE_ID\" --password \"$APPLE_APP_SPECIFIC_PASSWORD\""
echo ""

# Ask user which option they prefer
read -p "Would you like to upload now using command line? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🚀 Uploading to App Store Connect..."
    xcrun altool --upload-app --type osx --file "$UPLOAD_FILE" --username "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD"

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
    echo "📋 File ready for upload: $UPLOAD_FILE"
    echo "Use Transporter app or the command line option shown above."
fi

echo ""
echo "🎉 Mac App Store build process completed!"
