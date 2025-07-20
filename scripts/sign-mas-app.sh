#!/bin/bash

# Script to properly sign Electron app for Mac App Store
# This signs all components including helpers and frameworks

set -e

APP_PATH="$1"
IDENTITY="3rd Party Mac Developer Application: Arash Joobandi (6K8L5F5PA8)"
ENTITLEMENTS="build/entitlements.mas.plist"
INHERIT_ENTITLEMENTS="build/entitlements.mas.inherit.plist"

if [ -z "$APP_PATH" ]; then
    echo "Usage: $0 <path-to-app>"
    exit 1
fi

if [ ! -d "$APP_PATH" ]; then
    echo "Error: App path does not exist: $APP_PATH"
    exit 1
fi

echo "Signing Electron app for Mac App Store: $APP_PATH"

# Sign all frameworks first (without timestamp for MAS)
echo "Signing frameworks..."
find "$APP_PATH/Contents/Frameworks" -name "*.framework" -type d | while read framework; do
    echo "Signing framework: $framework"
    codesign --force --sign "$IDENTITY" --entitlements "$INHERIT_ENTITLEMENTS" "$framework"
done

# Sign all helper apps
echo "Signing helper applications..."
find "$APP_PATH/Contents/Frameworks" -name "*.app" -type d | while read helper; do
    echo "Signing helper app: $helper"
    codesign --force --sign "$IDENTITY" --entitlements "$INHERIT_ENTITLEMENTS" "$helper"
done

# Sign other executables
echo "Signing other executables..."
find "$APP_PATH" -type f -perm +111 | grep -E "(chrome_crashpad_handler|ShipIt|speakmcp-rs)" | while read executable; do
    echo "Signing executable: $executable"
    codesign --force --sign "$IDENTITY" --entitlements "$INHERIT_ENTITLEMENTS" "$executable"
done

# Finally sign the main app
echo "Signing main application..."
codesign --force --sign "$IDENTITY" --entitlements "$ENTITLEMENTS" "$APP_PATH"

echo "Verification..."
codesign --verify --deep --strict "$APP_PATH"
echo "App signing completed successfully!"
