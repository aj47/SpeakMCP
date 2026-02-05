# SpeakMCP CLI - Product Requirements Document

## Overview

A terminal user interface (TUI) client for SpeakMCP that provides a standalone alternative to the Electron desktop app. Built with OpenTUI and powered by `@speakmcp/server`. Can run the server embedded (single command) or connect to an external server.

## Goals

1. **Standalone operation** — run CLI + server in one command, no Electron app needed
2. **Feature parity** with Electron app's core functionality
3. **Cross-platform** support (macOS, Linux, Windows)
4. **Streaming responses** with real-time token display
5. **Session continuity** for conversation context
6. **Single binary** distribution via Bun compilation

## Technical Stack

| Component | Technology |
|-----------|------------|
| Framework | OpenTUI (`@opentui/core` ^0.1.74) |
| Runtime | Bun (required — Node.js/tsx won't work due to OpenTUI tree-sitter deps) |
| Language | TypeScript |
| Backend | `@speakmcp/server` (Fastify HTTP API) — embedded or external |
| Package Location | `apps/cli/` |
| Binary Name | `speakmcp` |

## Architecture

### Embedded Mode (default — single command)

```
┌──────────────────────────────────────────────┐
│              speakmcp CLI process             │
│                                              │
│  ┌──────────────┐    ┌────────────────────┐  │
│  │  TUI (OpenTUI)│◄──►│ @speakmcp/server  │  │
│  │              │    │ (in-process)       │  │
│  └──────────────┘    └────────────────────┘  │
└──────────────────────────────────────────────┘
```

The CLI imports `startServer()` from `@speakmcp/server` and boots the server in-process before launching the TUI. No separate terminal needed.

### External Mode (connect to running server)

```
┌─────────────────┐     HTTP/SSE      ┌──────────────────┐
│   speakmcp CLI  │ ◄───────────────► │ @speakmcp/server │
│   (OpenTUI)     │                   │   (separate)     │
└─────────────────┘                   └──────────────────┘
```

Use `--url` to connect to an already-running server (e.g. started by the Electron app or manually).

## Project Structure

```
apps/cli/
├── package.json
├── tsconfig.json
├── prd.md                 # This document
├── src/
│   ├── index.ts           # CLI entry point + arg parsing + embedded server boot
│   ├── app.ts             # Main TUI application (OpenTUI setup, view switching)
│   ├── client.ts          # HTTP client for server API
│   ├── config.ts          # Configuration management (CLI args, env, file, auto-discover)
│   ├── types.ts           # TypeScript interfaces
│   └── views/
│       ├── base.ts        # Base view class
│       ├── chat.ts        # Chat/conversation view (primary)
│       ├── sessions.ts    # Sessions list view
│       ├── settings.ts    # Settings view (LLM config + MCP server toggles)
│       └── tools.ts       # MCP tools browser view
└── e2e/                   # End-to-end tests (vitest + node-pty)
```

## Running

### Quick Start (embedded server — single command)

```bash
cd apps/cli && bun run src/index.ts
```

This starts the server on a free port and launches the TUI automatically. No separate server process needed.

### With explicit server URL

```bash
# Terminal 1: Start server manually
cd packages/server && npx tsx src/index.ts --port 3211 --api-key test-key

# Terminal 2: Connect CLI to it
cd apps/cli && bun run src/index.ts --url http://127.0.0.1:3211 --api-key test-key
```

### Environment variables

```bash
export SPEAKMCP_URL=http://127.0.0.1:3211
export SPEAKMCP_API_KEY=test-key
cd apps/cli && bun run src/index.ts
```

## Configuration

### Priority Order (highest to lowest)

1. CLI flags (`--url`, `--api-key`, etc.)
2. Environment variables (`SPEAKMCP_URL`, `SPEAKMCP_API_KEY`)
3. Config file (`~/.speakmcp/cli-config.json`)
4. Auto-discovery (probe ports: 3210, 3211, 3212, 8080)
5. Embedded server (start one automatically if nothing found)

### CLI Arguments

```
speakmcp [options]

Options:
  -h, --help              Show help
  -v, --version           Show version
  -u, --url <url>         Server URL (default: auto-discover, then embedded)
  -k, --api-key <key>     API key for authentication
  -c, --conversation <id> Resume specific conversation
  -p, --port <port>       Port for embedded server (default: 3211)
  --no-server             Don't start embedded server, only connect to external
  --debug                 Enable debug logging
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `SPEAKMCP_URL` | Server URL (skips auto-discover and embedded server) |
| `SPEAKMCP_API_KEY` | API key for authentication |
| `SPEAKMCP_CONVERSATION` | Default conversation ID |

## Current State

### ✅ Implemented

#### Chat View (F1) — Primary
- Text input field at bottom
- Scrollable message history
- Real-time SSE streaming response display
- Agent iteration count and tool call visualization
- Session continuity (maintains conversation_id)
- New conversation (Ctrl+N)

#### Sessions View (F2)
- List all conversations with timestamps
- Resume previous conversations (Enter)
- Delete conversations (D)
- Search conversations (/)
- Create new conversation (N)

#### Settings View (F3)
- LLM provider selection (OpenAI, Groq, Gemini)
- Model selection (per-provider)
- Max iterations (1-100)
- MCP server enable/disable toggles
- Save (S) and Reset (R) controls

#### Tools View (F4)
- Browse all MCP tools organized by server
- Show tool descriptions and input schemas
- Display server connection status

#### Global Features
- Tab navigation (F1-F4)
- Profile switching (Ctrl+P popup overlay)
- Emergency stop (Ctrl+C during agent execution)
- Help overlay (? or F12)
- Health check with reconnection detection
- Auto-discovery of running servers

### ❌ Not Yet Implemented

- **Embedded server mode** — CLI currently requires a separate server process
- Agent behavior settings (message queue, verify completion, final summary, memories)
- Profile management UI (create, edit, delete — only switching works)
- Provider API key configuration
- Provider base URL configuration
- Dual model settings
- Memory system settings

## UI Layout

### Main Layout

```
┌─────────────────────────────────────────────────────────┐
│ [F1] Chat  [F2] Sessions  [F3] Settings  [F4] Tools     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│                    (Active View)                        │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ Profile: default  │  Model: gpt-4o  │  Server: ●        │
└─────────────────────────────────────────────────────────┘
```

## Key Bindings

### Global

| Key | Action |
|-----|--------|
| `F1` | Switch to Chat view |
| `F2` | Switch to Sessions view |
| `F3` | Switch to Settings view |
| `F4` | Switch to Tools view |
| `Ctrl+C` | Emergency stop (during agent) / Exit |
| `Ctrl+N` | New conversation |
| `Ctrl+P` | Quick profile switcher popup |
| `?` or `F12` | Show help overlay |
| `Esc` | Cancel / Close popup / Go back |

### Chat View

| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Up/Down` | Scroll history |
| `PgUp/PgDn` | Scroll page |

### Sessions View

| Key | Action |
|-----|--------|
| `Enter` | Resume selected conversation |
| `N` | New conversation |
| `D` | Delete selected |
| `/` | Search |
| `Up/Down` | Navigate list |

## API Integration

### HTTP Client Methods

| Method | Endpoint | Description |
|--------|----------|-------------|
| `getModels()` | `GET /v1/models` | List available models |
| `getProfiles()` | `GET /v1/profiles` | List profiles |
| `getCurrentProfile()` | `GET /v1/profiles/current` | Get active profile |
| `switchProfile(id)` | `POST /v1/profiles/current` | Switch profile |
| `getSettings()` | `GET /v1/settings` | Get settings |
| `patchSettings(data)` | `PATCH /v1/settings` | Update settings |
| `getConversations()` | `GET /v1/conversations` | List conversations |
| `getConversation(id)` | `GET /v1/conversations/:id` | Get conversation |
| `createConversation(data)` | `POST /v1/conversations` | Create conversation |
| `deleteConversation(id)` | `DELETE /v1/conversations/:id` | Delete conversation |
| `chatStream(messages, id)` | `POST /v1/chat/completions` | Chat with SSE streaming |
| `getMcpServers()` | `GET /v1/mcp/servers` | MCP server status |
| `toggleMcpServer(name, on)` | `POST /v1/mcp/servers/:name/toggle` | Enable/disable server |
| `listMcpTools()` | `POST /mcp/tools/list` | List MCP tools |
| `callMcpTool(name, args)` | `POST /mcp/tools/call` | Execute MCP tool |
| `emergencyStop()` | `POST /v1/emergency-stop` | Kill all agents |
| `isHealthy()` | `GET /v1/models` | Health check |

## Build & Distribution

### Development

```bash
# From repo root
pnpm install

# Run CLI (requires server running separately for now)
cd apps/cli && bun run src/index.ts
```

### Build

```bash
cd apps/cli

# JavaScript bundle
bun run build

# Standalone binary (current platform)
bun run build:binary

# Cross-platform binaries
bun run build:macos
bun run build:linux
bun run build:windows
```

### E2E Tests

```bash
cd apps/cli
bun run test:e2e
```

## Implementation Phases

### Phase 1: Foundation ✅
- [x] Project setup (package.json, tsconfig.json)
- [x] HTTP client with all endpoints
- [x] SSE streaming support
- [x] Config management (CLI args, env, file, auto-discover)

### Phase 2: Core TUI ✅
- [x] Main app shell with OpenTUI
- [x] Tab navigation (F1-F4)
- [x] Status bar with profile/model/server info
- [x] Help overlay (? / F12)

### Phase 3: Chat View ✅
- [x] Message display with scrolling
- [x] Text input field
- [x] Streaming response rendering
- [x] Tool call visualization
- [x] Session continuity

### Phase 4: Supporting Views ✅
- [x] Sessions view (list, resume, delete, search)
- [x] Settings view (provider, model, max iterations, MCP toggles)
- [x] Tools view (browse MCP tools by server)
- [x] Profile switcher (Ctrl+P popup)

### Phase 5: Embedded Server 🔲
- [ ] Import and start `@speakmcp/server` in-process
- [ ] Auto-generate API key for embedded mode
- [ ] Find free port automatically
- [ ] Graceful shutdown of embedded server on CLI exit
- [ ] `--no-server` flag to skip embedded server

### Phase 6: Extended Settings 🔲
- [ ] Agent behavior toggles (message queue, verify completion, etc.)
- [ ] Profile management (create, edit, delete)
- [ ] Provider API key configuration
- [ ] Provider base URL configuration

### Phase 7: Polish & Distribution 🔲
- [ ] Error handling refinement
- [ ] Cross-platform binary builds
- [ ] README documentation

## Dependencies

```json
{
  "dependencies": {
    "@opentui/core": "^0.1.74",
    "@speakmcp/server": "workspace:*"
  },
  "devDependencies": {
    "@types/bun": "^1.2.14",
    "@types/node": "^25.0.10",
    "node-pty": "^1.1.0",
    "strip-ansi": "^7.1.2",
    "tsx": "^4.21.0",
    "typescript": "^5.8.3",
    "vitest": "^1.6.0"
  }
}
```

## Success Criteria

1. **Standalone**: `bun run src/index.ts` works with zero setup — boots server + TUI in one command
2. **Functional**: Can send messages and receive streaming responses with tool execution
3. **Parity**: Covers core Electron app features (chat, sessions, settings, profiles, tools)
4. **Portable**: Single binary works on macOS, Linux, Windows
5. **Responsive**: Sub-100ms UI response, real-time streaming
6. **Robust**: Graceful error handling, reconnection logic

## Future Enhancements (Out of Scope)

- Voice input (requires audio capture)
- Plugin/extension system
- Custom themes
- Multi-window support
- Scripting/automation mode
- Memory system UI
- Agent personas
- Langfuse configuration

