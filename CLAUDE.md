# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
# Development
pnpm install              # Install dependencies (must use pnpm)
pnpm build-rs             # Build Rust keyboard binary (required before dev)
pnpm dev                  # Start Electron app in dev mode

# CLI Development (NEW - PR #988)
cd apps/cli && bun run src/index.ts           # Run CLI in embedded mode
cd apps/cli && bun run src/index.ts --debug   # Run with verbose logging
cd packages/server && pnpm dev                 # Run server standalone

# Testing
pnpm test                 # Run all tests (vitest)
pnpm --filter @speakmcp/desktop test:run  # Run desktop tests once
pnpm --filter @speakmcp/desktop test      # Run desktop tests in watch mode

# Type checking
pnpm typecheck            # Type check all packages

# Linting
pnpm lint                 # Lint all packages

# Production builds
pnpm build                # Full production build (typecheck + test + build)
pnpm --filter @speakmcp/desktop build:mac  # macOS build
pnpm --filter @speakmcp/desktop build:win  # Windows build
pnpm --filter @speakmcp/desktop build:linux # Linux build
```

## Debug Modes

```bash
pnpm dev -- -d            # Enable all debug logging
pnpm dev -- -dl           # Debug LLM calls only
pnpm dev -- -dt           # Debug MCP tool execution only
pnpm dev -- -dui          # Debug UI/renderer only

# Chrome DevTools Protocol debugging
REMOTE_DEBUGGING_PORT=9222 pnpm dev -- -d
```

## Architecture

### Monorepo Structure

- `apps/desktop/` - Electron desktop app (main package)
- `apps/mobile/` - React Native/Expo mobile app
- `apps/cli/` - Terminal-based TUI client (NEW - see PR #988)
- `packages/shared/` - Shared types, colors, and utilities used by both apps
- `packages/server/` - Standalone MCP server with SSE streaming (NEW - see PR #988)

### Desktop App Architecture

**Main Process** (`apps/desktop/src/main/`):
- `index.ts` - App entry, window creation, initialization
- `tipc.ts` - IPC handlers for renderer communication (uses @egoist/tipc)
- `mcp-service.ts` - MCP client management, tool discovery, OAuth handling
- `llm.ts` - LLM orchestration, agent loop, tool execution coordination
- `llm-fetch.ts` - Direct LLM API calls (OpenAI, Groq, Gemini via AI SDK)
- `keyboard.ts` - Global hotkey handling via Rust binary
- `config.ts` - Persistent config store

**Renderer Process** (`apps/desktop/src/renderer/`):
- React 18 + TypeScript + Tailwind CSS
- Zustand stores in `stores/` for state management
- React Query for async data fetching (`lib/queries.ts`)
- Routes defined in `router.tsx`

**Shared** (`apps/desktop/src/shared/`):
- `types.ts` - TypeScript types shared between main/renderer
- `mcp-utils.ts` - MCP config parsing utilities

**Rust Binary** (`apps/desktop/speakmcp-rs/`):
- Native keyboard monitoring and text injection
- Built separately via `pnpm build-rs`

### CLI App Architecture (NEW - PR #988)

**Terminal TUI Client** (`apps/cli/`):
- Standalone terminal-based client with full feature parity to desktop app
- Supports three connection modes:
  1. **Embedded Server** (default): Runs `@speakmcp/server` in-process
  2. **External Server**: Connects to remote server via `--url`
  3. **Auto-discover**: Probes default ports (3210, 3211, 3212, 8080)
- Cloudflare tunnel support with QR code rendering
- Full keyboard shortcuts and interactive settings
- Built with OpenTUI framework

**Standalone Server** (`packages/server/`):
- Fastify-based MCP server with OpenAI-compatible SSE streaming
- Library exports: `@speakmcp/server/server` and `@speakmcp/server/config`
- Cloudflare tunnel integration for remote access
- Dual build: CLI entry (with shebang) + library exports

### CLI Quick Commands

```bash
# Embedded mode (recommended - one command)
cd apps/cli && bun run src/index.ts

# With debug logging
cd apps/cli && bun run src/index.ts --debug

# External server mode
cd apps/cli && bun run src/index.ts --url http://localhost:3210 --api-key <key>

# Custom port
cd apps/cli && bun run src/index.ts --port 3211 --no-server
```

### IPC Communication

Uses `@egoist/tipc` for type-safe IPC between main and renderer:
- Handlers defined in `tipc.ts`
- Client usage: `window.electron.ipcRenderer.invoke('methodName', params)`
- All procedures listed in `tipc.ts`

### MCP Integration

The app functions as an MCP client that can connect to multiple servers:
- Supports stdio, WebSocket, and streamableHttp transports
- OAuth 2.1 support for protected servers
- Tool approval workflow for sensitive operations
- Conversation context maintained across agent iterations

### Key Data Flows

1. **Voice Recording**: Hold hotkey → Record audio → Transcribe via STT API → Process with LLM
2. **Agent Mode**: User input → LLM decides tools → Execute MCP tools → Loop until complete
3. **Tool Execution**: `mcp-service.ts` dispatches to appropriate MCP server, handles results

## Testing

Tests use Vitest and are colocated with source files (`.test.ts`):
```bash
# Run specific test file
pnpm --filter @speakmcp/desktop exec vitest run src/main/llm-fetch.test.ts

# Run tests matching pattern
pnpm --filter @speakmcp/desktop exec vitest run -t "pattern"
```
