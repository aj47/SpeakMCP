#!/bin/bash

mkdir -p resources/bin

cd speakmcp-rs

cargo build -r

# Handle different platforms
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" || "$OSTYPE" == "cygwin" ]]; then
    # Windows
    cp target/release/speakmcp-rs.exe ../resources/bin/speakmcp-rs.exe
else
    # Unix-like systems (macOS, Linux)
    cp target/release/speakmcp-rs ../resources/bin/speakmcp-rs
fi

cd ..

# Sign the binary on macOS
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "🔐 Signing Rust binary..."
    ./scripts/sign-binary.sh
fi
