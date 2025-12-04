#!/bin/bash

# Script to ensure the Rust binary exists before running dev mode
# This is called by the predev npm script

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
BIN_DIR="$DESKTOP_DIR/resources/bin"

# Determine binary name based on platform
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" || "$OSTYPE" == "cygwin" ]]; then
    BINARY_NAME="speakmcp-rs.exe"
else
    BINARY_NAME="speakmcp-rs"
fi

BINARY_PATH="$BIN_DIR/$BINARY_NAME"

# Check if binary exists
if [ -f "$BINARY_PATH" ]; then
    echo "✅ Rust binary found at $BINARY_PATH"
    exit 0
fi

echo "⚠️  Rust binary not found at $BINARY_PATH"
echo "🔨 Building Rust binary..."

# Run the build script
cd "$DESKTOP_DIR"
sh scripts/build-rs.sh

# Verify the binary was created
if [ -f "$BINARY_PATH" ]; then
    echo "✅ Rust binary built successfully"
    exit 0
else
    echo "❌ Failed to build Rust binary"
    echo "Please run 'pnpm build-rs' manually from the apps/desktop directory"
    exit 1
fi

