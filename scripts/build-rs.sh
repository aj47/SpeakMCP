#!/bin/bash

mkdir -p resources/bin

# Build keyboard helper
cd speakmcp-rs
cargo build -r

# Handle different platforms for keyboard helper
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" || "$OSTYPE" == "cygwin" ]]; then
    # Windows
    cp target/release/speakmcp-rs.exe ../resources/bin/speakmcp-rs.exe
else
    # Unix-like systems (macOS, Linux)
    cp target/release/speakmcp-rs ../resources/bin/speakmcp-rs
fi

cd ..

# Build audio capture service
cd speakmcp-audio
cargo build -r

# Handle different platforms for audio service
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" || "$OSTYPE" == "cygwin" ]]; then
    # Windows
    cp target/release/speakmcp-audio.exe ../resources/bin/speakmcp-audio.exe
else
    # Unix-like systems (macOS, Linux)
    cp target/release/speakmcp-audio ../resources/bin/speakmcp-audio
fi

cd ..

# On macOS, copy the ScreenCaptureKit audio binary if it exists
if [[ "$OSTYPE" == "darwin"* ]]; then
    SWIFT_BINARY="macos-audio-tap/ScreenCaptureAudio/.build/release/screencapture-audio"
    if [[ -f "$SWIFT_BINARY" ]]; then
        echo "📦 Copying screencapture-audio binary..."
        cp "$SWIFT_BINARY" resources/bin/screencapture-audio
    else
        echo "⚠️  screencapture-audio binary not found at $SWIFT_BINARY"
        echo "   Run 'npm run build:screencapture-audio' to build it"
    fi
fi

# Sign the binaries on macOS
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "🔐 Signing Rust binaries..."
    ./scripts/sign-binary.sh
fi
