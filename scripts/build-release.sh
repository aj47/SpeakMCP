#!/bin/bash
# SpeakMCP Release Build Script
# Builds signed DMG (macOS), IPA (iOS), and APK (Android) for distribution
#
# For detailed instructions, see BUILDING.md
#
# Environment Variables Required:
#
# macOS DMG signing:
#   CSC_NAME             - Developer ID name WITHOUT prefix (e.g., "Your Name (TEAMID)")
#                          Run: security find-identity -v -p codesigning
#                          ❌ WRONG: "Developer ID Application: Your Name (TEAMID)"
#                          ✅ RIGHT: "Your Name (TEAMID)"
#   APPLE_DEVELOPER_ID   - Same as CSC_NAME, used for Rust binary signing
#   ENABLE_HARDENED_RUNTIME=true - Enable hardened runtime for notarization
#
# macOS Notarization (optional but recommended):
#   APPLE_TEAM_ID        - Your 10-character Apple Team ID
#   APPLE_ID             - Your Apple ID email
#   APPLE_APP_SPECIFIC_PASSWORD - App-specific password from appleid.apple.com
#
# iOS IPA signing:
#   APPLE_TEAM_ID        - Apple Developer Team ID
#   IOS_PROVISIONING_PROFILE - Provisioning profile name or UUID
#
# Android APK signing:
#   ANDROID_KEYSTORE_FILE     - Path to release keystore file
#   ANDROID_KEYSTORE_PASSWORD - Keystore password
#   ANDROID_KEY_ALIAS         - Key alias (default: speakmcp)
#   ANDROID_KEY_PASSWORD      - Key password
#
# Optional:
#   SKIP_MAC    - Set to 1 to skip macOS build
#   SKIP_IOS    - Set to 1 to skip iOS build
#   SKIP_ANDROID - Set to 1 to skip Android build

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RELEASE_DIR="$ROOT_DIR/release"

echo "🚀 SpeakMCP Release Build Script"
echo "================================"
echo "Root directory: $ROOT_DIR"
echo ""

# Create release directory
mkdir -p "$RELEASE_DIR"

# Build shared package first
echo "📦 Building shared package..."
cd "$ROOT_DIR"
pnpm run build:shared

#######################################
# macOS DMG Build
#######################################
build_macos() {
    echo ""
    echo "🍎 Building macOS DMG..."
    echo "------------------------"
    
    cd "$ROOT_DIR/apps/desktop"
    
    # Build the Rust binary first
    echo "🦀 Building Rust binary..."
    pnpm run build-rs
    
    # Set hardened runtime for production
    export ENABLE_HARDENED_RUNTIME=true
    
    # Build DMG for both architectures (skip type checking for now)
    echo "📦 Building DMG packages..."
    # Use electron-vite build directly to skip type checking
    npx electron-vite build
    npx electron-builder --mac --config electron-builder.config.cjs --publish=never
    
    # Copy artifacts to release folder
    cp "$ROOT_DIR/apps/desktop/dist/"*.dmg "$RELEASE_DIR/" 2>/dev/null || true
    
    echo "✅ macOS build complete!"
    ls -la "$RELEASE_DIR/"*.dmg 2>/dev/null || echo "⚠️ No DMG files found"
}

#######################################
# iOS IPA Build
#######################################
build_ios() {
    echo ""
    echo "📱 Building iOS IPA..."
    echo "----------------------"
    
    if [[ "$(uname)" != "Darwin" ]]; then
        echo "⚠️ iOS builds require macOS. Skipping..."
        return 0
    fi
    
    cd "$ROOT_DIR/apps/mobile"
    
    # Install dependencies
    echo "📦 Installing dependencies..."
    pnpm install
    
    # Install CocoaPods dependencies
    echo "🍫 Installing CocoaPods..."
    cd ios
    pod install --repo-update
    cd ..
    
    # Generate native code with Expo
    echo "🔧 Running Expo prebuild..."
    npx expo prebuild --platform ios --clean
    
    # Create export options with environment variables
    EXPORT_OPTIONS="$ROOT_DIR/apps/mobile/ios/ExportOptions.plist"
    EXPORT_OPTIONS_TEMP="$ROOT_DIR/apps/mobile/ios/ExportOptions.temp.plist"
    
    if [ -n "$APPLE_TEAM_ID" ] && [ -n "$IOS_PROVISIONING_PROFILE" ]; then
        sed -e "s/\${APPLE_TEAM_ID}/$APPLE_TEAM_ID/g" \
            -e "s/\${IOS_PROVISIONING_PROFILE}/$IOS_PROVISIONING_PROFILE/g" \
            "$EXPORT_OPTIONS" > "$EXPORT_OPTIONS_TEMP"
        EXPORT_OPTIONS="$EXPORT_OPTIONS_TEMP"
    fi
    
    # Build archive
    echo "🔨 Building iOS archive..."
    xcodebuild -workspace ios/SpeakMCP.xcworkspace \
        -scheme SpeakMCP \
        -configuration Release \
        -archivePath "$RELEASE_DIR/SpeakMCP.xcarchive" \
        archive \
        CODE_SIGN_IDENTITY="${IOS_CODE_SIGN_IDENTITY:-iPhone Distribution}" \
        DEVELOPMENT_TEAM="${APPLE_TEAM_ID:-}" \
        -allowProvisioningUpdates
    
    # Export IPA
    echo "📤 Exporting IPA..."
    xcodebuild -exportArchive \
        -archivePath "$RELEASE_DIR/SpeakMCP.xcarchive" \
        -exportPath "$RELEASE_DIR" \
        -exportOptionsPlist "$EXPORT_OPTIONS" \
        -allowProvisioningUpdates
    
    # Cleanup temp file
    rm -f "$EXPORT_OPTIONS_TEMP"
    
    # Rename IPA with version
    VERSION=$(grep '"version"' "$ROOT_DIR/apps/mobile/app.json" | sed 's/.*"version": "\(.*\)".*/\1/')
    if [ -f "$RELEASE_DIR/SpeakMCP.ipa" ]; then
        mv "$RELEASE_DIR/SpeakMCP.ipa" "$RELEASE_DIR/SpeakMCP-${VERSION:-1.0.0}.ipa"
    fi
    
    echo "✅ iOS build complete!"
    ls -la "$RELEASE_DIR/"*.ipa 2>/dev/null || echo "⚠️ No IPA files found"
}

#######################################
# Android APK Build  
#######################################
build_android() {
    echo ""
    echo "🤖 Building Android APK..."
    echo "--------------------------"
    
    cd "$ROOT_DIR/apps/mobile"
    
    # Install dependencies
    echo "📦 Installing dependencies..."
    pnpm install
    
    # Generate native code with Expo
    echo "🔧 Running Expo prebuild..."
    npx expo prebuild --platform android --clean
    
    # Build release APK
    echo "🔨 Building release APK..."
    cd android
    
    if [[ "$(uname)" == "Darwin" ]] || [[ "$(uname)" == "Linux" ]]; then
        ./gradlew assembleRelease
    else
        ./gradlew.bat assembleRelease
    fi
    
    # Copy APK to release folder
    VERSION=$(grep '"version"' "$ROOT_DIR/apps/mobile/app.json" | sed 's/.*"version": "\(.*\)".*/\1/')
    APK_PATH="app/build/outputs/apk/release/app-release.apk"
    
    if [ -f "$APK_PATH" ]; then
        cp "$APK_PATH" "$RELEASE_DIR/SpeakMCP-${VERSION:-1.0.0}.apk"
        echo "✅ Android build complete!"
    else
        echo "⚠️ APK not found at expected path: $APK_PATH"
        # Try to find APK
        find . -name "*.apk" -type f 2>/dev/null
    fi
    
    ls -la "$RELEASE_DIR/"*.apk 2>/dev/null || echo "⚠️ No APK files found"
}

#######################################
# Main Build Process
#######################################

# Parse arguments
BUILD_MAC=true
BUILD_IOS=true
BUILD_ANDROID=true

for arg in "$@"; do
    case $arg in
        --mac-only)
            BUILD_IOS=false
            BUILD_ANDROID=false
            ;;
        --ios-only)
            BUILD_MAC=false
            BUILD_ANDROID=false
            ;;
        --android-only)
            BUILD_MAC=false
            BUILD_IOS=false
            ;;
        --skip-mac)
            BUILD_MAC=false
            ;;
        --skip-ios)
            BUILD_IOS=false
            ;;
        --skip-android)
            BUILD_ANDROID=false
            ;;
    esac
done

# Environment variable overrides
[ "$SKIP_MAC" = "1" ] && BUILD_MAC=false
[ "$SKIP_IOS" = "1" ] && BUILD_IOS=false
[ "$SKIP_ANDROID" = "1" ] && BUILD_ANDROID=false

# Run builds
if [ "$BUILD_MAC" = true ]; then
    build_macos
fi

if [ "$BUILD_IOS" = true ]; then
    build_ios
fi

if [ "$BUILD_ANDROID" = true ]; then
    build_android
fi

#######################################
# Summary
#######################################
echo ""
echo "🎉 Build Complete!"
echo "=================="
echo "Release artifacts in: $RELEASE_DIR"
echo ""
ls -la "$RELEASE_DIR/"

