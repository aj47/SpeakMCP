#!/bin/bash

# Sign the Rust binary for macOS
# This script signs the speakmcp-rs binary for distribution

BINARY_PATH="resources/bin/speakmcp-rs"

if [ ! -f "$BINARY_PATH" ]; then
    echo "❌ Binary not found at $BINARY_PATH"
    exit 1
fi

# Check if we have a signing identity
if [ -n "$APPLE_DEVELOPER_ID" ]; then
    echo "🔐 Signing binary with Developer ID: $APPLE_DEVELOPER_ID"
    codesign --force --sign "$APPLE_DEVELOPER_ID" --timestamp --options runtime "$BINARY_PATH"
    
    if [ $? -eq 0 ]; then
        echo "✅ Binary signed successfully"
    else
        echo "❌ Failed to sign binary"
        exit 1
    fi
else
    echo "⚠️  No APPLE_DEVELOPER_ID environment variable found"
    echo "⚠️  Skipping code signing (binary will work for development)"
    echo "⚠️  For distribution, set APPLE_DEVELOPER_ID to your Developer ID"
fi

echo "✅ Binary ready at $BINARY_PATH"
