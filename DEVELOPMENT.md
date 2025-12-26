# Development Guide

## Prerequisites

- **Node.js 18+** and **pnpm** (required package manager)
- **Rust toolchain** for the native keyboard/input binary
- **Xcode** (macOS only) for code signing

> ⚠️ **Important**: This project uses **pnpm**. Using npm or yarn may cause installation issues.
> ```bash
> npm install -g pnpm
> ```

## Quick Start

```bash
git clone https://github.com/aj47/SpeakMCP.git
cd SpeakMCP
pnpm install
pnpm build-rs  # Build Rust binary
pnpm dev       # Start development server
```

## Build Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development server |
| `pnpm build` | Production build for current platform |
| `pnpm build:mac` | macOS build (Apple Silicon + Intel) |
| `pnpm build:win` | Windows build (x64) |
| `pnpm build:linux` | Linux build (x64) |
| `pnpm test` | Run test suite |
| `pnpm test:run` | Run tests once (CI mode) |
| `pnpm test:coverage` | Run tests with coverage |

For signed release builds, see [BUILDING.md](BUILDING.md).

## Docker Support

Docker is useful for building Linux packages in a consistent environment:

```bash
docker compose run --rm build-linux       # Build Linux packages
docker compose run --rm --build build-linux  # Rebuild after code changes
docker compose run --rm shell             # Interactive development shell
```

> **Note**: SpeakMCP is an Electron desktop app that requires a display. Docker is primarily for building Linux packages.

## Debug Mode

Enable comprehensive debug logging for development:

```bash
pnpm dev d               # Enable ALL debug logging
pnpm dev debug-llm       # LLM calls and responses only
pnpm dev debug-tools     # MCP tool execution only
pnpm dev debug-ui        # UI focus and state changes
```

See [apps/desktop/DEBUGGING.md](apps/desktop/DEBUGGING.md) for detailed debugging instructions.

## Project Structure

```
SpeakMCP/
├── apps/
│   ├── desktop/         # Electron desktop application
│   │   ├── src/main/    # Main process (MCP, TTS, system integration)
│   │   ├── src/renderer/# React UI
│   │   └── speakmcp-rs/ # Rust keyboard/input binary
│   └── mobile/          # React Native mobile app (Expo)
├── packages/
│   └── shared/          # Shared utilities and types
└── scripts/             # Build and release scripts
```

## Troubleshooting

### "Electron uninstall" error

Electron binaries weren't installed correctly:

```bash
rm -rf node_modules
pnpm install
```

### Multiple lock files

You've mixed package managers:

```bash
rm -f package-lock.json bun.lock
rm -rf node_modules
pnpm install
```

### Windows: "not a valid Win32 application"

If `pnpm install` fails with this error:

```powershell
pnpm install --ignore-scripts
pnpm.cmd -C apps/desktop exec electron-builder install-app-deps
```

### Node version mismatch

This project requires Node.js 18-20:

```bash
node --version  # Should be v18.x, v19.x, or v20.x
nvm use 20      # If using nvm
```

## Architecture

| Component | Technology | Purpose |
|-----------|------------|---------|
| Desktop App | Electron | System integration, MCP orchestration, TTS |
| UI | React + TypeScript | Real-time progress tracking, conversation management |
| Native Binary | Rust | Keyboard monitoring, text injection |
| MCP Client | TypeScript | Model Context Protocol with OAuth 2.1 |
| AI Providers | OpenAI, Groq, Gemini | Speech recognition, LLM, TTS |
| Multi-Agent | ACP + A2A | Task delegation to specialized sub-agents |

### Multi-Agent System

SpeakMCP supports delegating tasks to specialized sub-agents using two protocols:

- **ACP (Agent Client Protocol)**: Zed's protocol for local agents (stdio) or remote HTTP agents
- **A2A (Agent-to-Agent Protocol)**: Google's protocol for agent-to-agent communication

See [apps/desktop/src/main/acp/README.md](apps/desktop/src/main/acp/README.md) for detailed documentation.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `pnpm test`
5. Open a Pull Request

**💬 Get help on [Discord](https://discord.gg/cK9WeQ7jPq)** | **🌐 More info at [techfren.net](https://techfren.net)**

