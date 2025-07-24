#!/bin/bash

# Script to properly sign the Rust binary with the same certificate as the main app

BINARY_PATH="resources/bin/speakmcp-rs"

# Use MAS entitlements if building for MAS, otherwise use regular entitlements
if [ -n "${CSC_MAS_NAME:-}" ] && [ "${CSC_NAME:-}" = "${CSC_MAS_NAME:-}" ]; then
    ENTITLEMENTS_PATH="build/entitlements.mas.plist"
    echo "🏪 Using Mac App Store entitlements"
else
    ENTITLEMENTS_PATH="build/entitlements.mac.plist"
    echo "🖥️  Using regular macOS entitlements"
fi

if [ ! -f "$BINARY_PATH" ]; then
    echo "❌ Binary not found at $BINARY_PATH"
    exit 1
fi

if [ ! -f "$ENTITLEMENTS_PATH" ]; then
    echo "❌ Entitlements file not found at $ENTITLEMENTS_PATH"
    exit 1
fi

# Get the signing identity from environment or use self-signing for development
if [ -n "${CSC_NAME:-}" ]; then
    IDENTITY="$CSC_NAME"
    echo "🔐 Signing binary with certificate: $IDENTITY"
else
    IDENTITY="-"
    echo "🔐 Self-signing binary for development"
fi

# Sign the binary with the appropriate entitlements
codesign --force --sign "$IDENTITY" --entitlements "$ENTITLEMENTS_PATH" "$BINARY_PATH"

if [ $? -eq 0 ]; then
    echo "✅ Binary signed successfully"

    # Verify the signature
    echo "🔍 Verifying signature..."
    codesign -dv "$BINARY_PATH"
else
    echo "❌ Failed to sign binary"
    exit 1
fi
