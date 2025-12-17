# SpeakMCP CLI

A lightweight command-line interface for SpeakMCP - an alternative to the Electron desktop app.

## Features

- 🚀 **Fast startup** - Native binary with no Chromium overhead
- 💾 **Low memory usage** - Uses minimal system resources
- 🔧 **Scriptable** - Use in shell scripts and automation
- 🖥️ **Interactive REPL** - Full-featured chat interface
- ⚡ **Single binary** - No Node.js or Electron dependencies

## Prerequisites

The CLI requires the SpeakMCP desktop app to be running with the Remote Server enabled:

1. Open SpeakMCP desktop app
2. Go to Settings → Remote Server
3. Enable "Remote Server"
4. Copy the API key

## Installation

### From source

```bash
cd apps/cli
cargo build --release
# Binary will be at: target/release/speakmcp
```

### Add to PATH

```bash
# macOS/Linux
cp target/release/speakmcp ~/.local/bin/

# Or add to cargo bin
cargo install --path .
```

## Quick Start

```bash
# Configure the CLI
speakmcp config --api-key YOUR_API_KEY

# Start interactive chat
speakmcp

# Or send a single message
speakmcp send "What's the weather like?"
```

## Usage

### Interactive Mode (default)

```bash
# Start interactive chat
speakmcp

# Continue an existing conversation
speakmcp --conversation CONV_ID
```

### Single Message Mode

```bash
# Send a message and exit
speakmcp send "Hello, how are you?"

# Continue a conversation
speakmcp send "Tell me more" --conversation CONV_ID
```

### Configuration

```bash
# Initialize config file
speakmcp config --init

# Set server URL and API key
speakmcp config --server-url http://localhost:3210/v1
speakmcp config --api-key YOUR_API_KEY

# View current config
speakmcp config --show
```

### Environment Variables

```bash
export SPEAKMCP_SERVER_URL="http://localhost:3210/v1"
export SPEAKMCP_API_KEY="your-api-key"
speakmcp
```

### Check Connection

```bash
speakmcp status
```

## Configuration File

Config is stored at `~/.config/speakmcp/cli.toml`:

```toml
server_url = "http://localhost:3210/v1"
api_key = "your-api-key-here"
colored_output = true
show_tool_calls = true
```

## REPL Commands

In interactive mode, you can use these commands:

| Command | Description |
|---------|-------------|
| `/new` or `/clear` | Start a new conversation |
| `/status` | Show connection status |
| `/help` | Show help |
| `/quit` or `/exit` | Exit the CLI |

## Examples

### Basic Chat

```bash
$ speakmcp
╔════════════════════════════════════════╗
║          SpeakMCP CLI v1.0.0           ║
╚════════════════════════════════════════╝

you> Hello!
agent> Hello! How can I help you today?

you> /quit
Goodbye!
```

### Scripting

```bash
#!/bin/bash
# Automated task with SpeakMCP

RESPONSE=$(speakmcp send "List all files in the current directory")
echo "Agent response: $RESPONSE"
```

## Building

```bash
# Debug build
cargo build

# Release build (optimized)
cargo build --release

# Run tests
cargo test
```

## License

MIT License - see the main SpeakMCP repository for details.

