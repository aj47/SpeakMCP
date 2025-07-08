#!/bin/bash

mkdir -p resources/bin

cd speakmcp-rs

cargo build -r

cp target/release/speakmcp-rs ../resources/bin/speakmcp-rs

cd ..

# Sign the binary on macOS
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "🔐 Signing Rust binary..."
    ./scripts/sign-binary.sh
fi
