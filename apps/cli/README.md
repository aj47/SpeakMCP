# SpeakMCP CLI

Terminal-based configuration and server management for SpeakMCP.

## Installation

The CLI is included in the SpeakMCP monorepo. To use it:

```bash
cd apps/cli
npm install
```

## Usage

```bash
# Run CLI commands
npx tsx src/index.ts <command>
```

Or build and run the compiled version:

```bash
npm run build
npx tsx dist/index.js <command>
```

## Commands

### setup
Interactive setup wizard for first-time configuration.

```bash
speakmcp setup
```

### config
Manage configuration settings.

```bash
# Get all config values
speakmcp config get

# Get specific config value
speakmcp config get remoteServerEnabled

# Set config value
speakmcp config set remoteServerEnabled true

# Show config file paths
speakmcp config path
```

### qr
Generate QR code for mobile/web connection.

```bash
speakmcp qr
```

### status
Show current configuration status.

```bash
speakmcp status
```

## Configuration

The CLI manages SpeakMCP's configuration stored in:
- **Linux/macOS:** `~/.config/speakmcp/config.json`
- **Windows:** `%APPDATA%\speakmcp\config.json`

## Features

- Interactive setup wizard
- Configuration management (get/set)
- QR code generation for mobile connections
- Status monitoring
- Headless operation for SSH/VM environments
