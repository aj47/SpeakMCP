#!/bin/bash

# Sign binaries for macOS distribution
# This script signs all native binaries in resources/bin/

BINARIES=(
    "resources/bin/speakmcp-rs"
    "resources/bin/speakmcp-audio"
    "resources/bin/screencapture-audio"
)

# Check if we have a signing identity
if [ -n "$APPLE_DEVELOPER_ID" ]; then
    for BINARY_PATH in "${BINARIES[@]}"; do
        if [ -f "$BINARY_PATH" ]; then
            echo "🔐 Signing $BINARY_PATH with Developer ID: $APPLE_DEVELOPER_ID"
            codesign --force --sign "$APPLE_DEVELOPER_ID" --timestamp --options runtime "$BINARY_PATH"

            if [ $? -eq 0 ]; then
                echo "✅ $BINARY_PATH signed successfully"
            else
                echo "❌ Failed to sign $BINARY_PATH"
                exit 1
            fi
        else
            echo "⚠️  Binary not found at $BINARY_PATH (skipping)"
        fi
    done
else
    echo "⚠️  No APPLE_DEVELOPER_ID environment variable found"
    echo "⚠️  Skipping code signing (binaries will work for development)"
    echo "⚠️  For distribution, set APPLE_DEVELOPER_ID to your Developer ID"
fi

echo "✅ All binaries ready"
