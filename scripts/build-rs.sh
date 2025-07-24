#!/bin/bash

# Create resources/bin directory
mkdir -p resources/bin

# Check if we're on Windows (Git Bash, MSYS2, or WSL)
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" || "$OSTYPE" == "cygwin" || -n "$WINDIR" ]]; then
    echo "🪟 Building for Windows..."

    # Check if Rust is installed
    if ! command -v cargo &> /dev/null; then
        echo "❌ Cargo not found. Please install Rust from https://rustup.rs/"
        echo "   After installation, restart your terminal and try again."
        exit 1
    fi

    cd speakmcp-rs

    # Build for Windows
    cargo build --release

    # Copy Windows executable with .exe extension
    if [ -f "target/release/speakmcp-rs.exe" ]; then
        cp target/release/speakmcp-rs.exe ../resources/bin/speakmcp-rs.exe
        echo "✅ Windows binary built successfully: resources/bin/speakmcp-rs.exe"
    else
        echo "❌ Failed to build Windows binary"
        exit 1
    fi

    cd ..

elif [[ "$OSTYPE" == "darwin"* ]]; then
    echo "🍎 Building for macOS..."

    cd speakmcp-rs

    cargo build --release

    cp target/release/speakmcp-rs ../resources/bin/speakmcp-rs

    cd ..

    # Sign the binary on macOS
    echo "🔐 Signing Rust binary..."
    ./scripts/sign-binary.sh

else
    echo "🐧 Building for Linux..."

    cd speakmcp-rs

    cargo build --release

    cp target/release/speakmcp-rs ../resources/bin/speakmcp-rs

    cd ..
fi
