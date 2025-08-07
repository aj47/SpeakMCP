# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SpeakMCP is an Electron-based AI-powered voice assistant with MCP (Model Context Protocol) integration. It transforms voice input into intelligent actions through speech recognition, LLM processing, and external tool execution via MCP servers.

## Development Commands

### Core Development

```bash
# Start development server with hot reload
pnpm dev

# Build for production (includes TypeScript compilation and Rust binary)
pnpm build

# Type checking (both Node.js main process and web renderer)
pnpm typecheck

# Linting and formatting
pnpm lint
pnpm format
```

### Platform-Specific Builds

```bash
# macOS builds
pnpm build:mac
pnpm build:mac:universal    # Universal binary for Intel + Apple Silicon
pnpm build:mas             # Mac App Store build
pnpm build:mas:dev         # Mac App Store development build

# Windows and Linux
pnpm build:win
pnpm build:linux
```

### Testing

```bash
# Run all tests
pnpm test

# Run specific test suites
npm test src/main/__tests__/mcp-path-resolution.test.ts
npm test src/main/__tests__/mcp-e2e.test.ts
npm test src/main/__tests__/mcp-service.test.ts

# Test with coverage
pnpm test --coverage
```

### Rust Binary Management

```bash
# Build the Rust binary (required for keyboard/text injection)
pnpm build-rs

# Manual Rust build (alternative)
cd speakmcp-rs && cargo build --release
```

## Architecture Overview

### Multi-Process Architecture

- **Main Process** (`src/main/`): Electron main process handling system integration, API calls, MCP orchestration
- **Renderer Process** (`src/renderer/`): React-based UI with real-time progress tracking and conversation management
- **Preload Scripts** (`src/preload/`): Secure communication bridge between main and renderer processes
- **Rust Binary** (`speakmcp-rs/`): Low-level system integration for keyboard monitoring and text injection

### Key Components

#### Main Process (`src/main/`)

- **`tipc.ts`**: Type-safe IPC router and API handlers using @egoist/tipc
- **`mcp-service.ts`**: MCP client managing connections to external tool servers
- **`llm.ts`**: LLM processing with support for OpenAI, Groq, and Google Gemini
- **`conversation-service.ts`**: Persistent conversation management with message history
- **`keyboard.ts`**: Keyboard event handling and text injection via Rust binary
- **`structured-output.ts`**: Type-safe LLM responses using OpenAI SDK and Zod validation
- **`diagnostics.ts`**: Error tracking, logging, and health checks

#### Renderer Process (`src/renderer/src/`)

- **`components/agent-progress.tsx`**: Real-time agent progress visualization
- **`components/conversation-display.tsx`**: Conversation history and management UI
- **`contexts/conversation-context.tsx`**: React context for conversation state
- **`pages/settings-*.tsx`**: Configuration pages for providers, tools, and general settings

#### Shared Types (`src/shared/`)

- **`types.ts`**: Comprehensive TypeScript types for configuration, conversations, MCP, and agent progress

### MCP Integration

The app implements a full MCP client that connects to external tool servers. Key aspects:

- **PATH Resolution**: Fixes `spawn npx ENOENT` errors in Electron environments
- **Multi-Server Support**: Connect to multiple MCP servers simultaneously
- **Agent Mode**: Iterative tool calling with intelligent decision making
- **Tool Management**: Enable/disable individual tools, test connections, restart servers

## Configuration System

Configuration is managed through Electron's storage system with these key areas:

### Provider Configuration

- **Speech-to-Text**: OpenAI Whisper, Groq
- **LLM Processing**: OpenAI GPT models, Groq models, Google Gemini
- **Custom Base URLs**: Support for self-hosted APIs

### MCP Server Configuration

MCP servers are configured in the `mcpConfig.mcpServers` object. The app supports both local command-based servers and remote servers via WebSocket or Streamable HTTP transports.

#### Local Command-Based Servers (stdio transport)

```typescript
{
  "filesystem": {
    "transport": "stdio",
    "command": "npx",
    "args": ["@modelcontextprotocol/server-filesystem", "/path/to/workspace"],
    "env": {},
    "disabled": false
  }
}
```

#### Remote WebSocket Servers

```typescript
{
  "remote-websocket": {
    "transport": "websocket",
    "url": "ws://localhost:8080",
    "timeout": 10000,
    "disabled": false
  }
}
```

#### Remote Streamable HTTP Servers

```typescript
{
  "remote-http": {
    "transport": "streamableHttp",
    "url": "http://localhost:8080/mcp",
    "timeout": 10000,
    "disabled": false
  }
}
```

**Transport Types:**

- `stdio` (default): Local command-based servers using stdin/stdout communication
- `websocket`: Remote servers accessible via WebSocket protocol
- `streamableHttp`: Remote servers using the MCP Streamable HTTP transport

### Keyboard Shortcuts

- **Voice Recording**: Hold Ctrl or Ctrl+/
- **MCP Agent Mode**: Hold Ctrl+Alt or Ctrl+Alt+/
- **Text Input**: Ctrl+T, Ctrl+Shift+T, or Alt+T

## Testing Infrastructure

### MCP Testing (Critical)

The app has comprehensive MCP testing to address PATH resolution issues:

- **`docs/MCP_TESTING.md`**: Complete testing documentation
- **`scripts/mock-mcp-server.mjs`**: Mock MCP server for testing
- **PATH Resolution Tests**: Fix `spawn npx ENOENT` errors in Electron

### Test Organization

- **Unit Tests**: Service-level testing in `src/main/__tests__/`
- **Integration Tests**: End-to-end MCP server communication
- **Mock Infrastructure**: Lightweight testing tools in `scripts/`

## Common Development Patterns

### TIPC Communication

The app uses @egoist/tipc for type-safe IPC between Electron processes. New endpoints should be added to the router in `tipc.ts` with proper input validation.

### MCP Tool Development

When adding new MCP functionality:

1. Update MCP service in `mcp-service.ts`
2. Add corresponding UI in renderer components
3. Update shared types in `types.ts`
4. Add tests for PATH resolution and integration

### Agent Mode Processing

Agent mode supports iterative tool calling with conversation continuity. The unified processing function `processWithAgentMode()` handles both single-shot and iterative tool execution.

### Structured LLM Responses

Use the structured output system in `structured-output.ts` for reliable JSON responses from LLMs, with Zod schemas for validation.

## Troubleshooting

### Common Issues

- **MCP `spawn npx ENOENT`**: Run MCP tests and check PATH resolution fixes
- **Microphone/Accessibility**: Check system permissions on macOS
- **Rust Binary**: Ensure `pnpm build-rs` completes successfully
- **Type Errors**: Run `pnpm typecheck` to check both Node.js and web TypeScript

### Development Debugging

- **MCP Debug Mode**: Set `DEBUG=mcp*` environment variable
- **Electron DevTools**: Available in development mode
- **Diagnostic Reports**: Use built-in diagnostics system for health checks

## Release Process

```bash
# Update version and create release
pnpm release

# Platform-specific signed builds
pnpm build:mac:signed
pnpm setup:apple        # Apple signing setup
pnpm verify:signing     # Verify code signing
```
