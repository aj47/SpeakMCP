# PRD: Standalone Cross-Platform Server Package

## Overview

Create a standalone server package (`@speakmcp/server`) that extracts core agent functionality from the Electron desktop app, enabling any frontend (mobile, web, CLI) to interact with SpeakMCP's capabilities via HTTP API.

### Goals
- Run as pure Node.js process (`node server.js` or `npx @speakmcp/server`)
- Share configuration with desktop app while supporting environment variables
- Spawn MCP servers cross-platform (macOS, Linux, Windows)
- Maintain backwards compatibility with existing Electron app
- OpenAI-compatible API endpoints

### Non-Goals (This Phase)
- Web UI
- Authentication/authorization changes
- Breaking changes to Electron app
- Serverless deployment (nice-to-have, not required)

---

## Architecture

### Package Structure

```
packages/
  server/                              # @speakmcp/server
    src/
      index.ts                         # CLI entry point
      server.ts                        # Fastify HTTP server
      
      config/
        index.ts                       # ConfigStore (platform-agnostic)
        paths.ts                       # Cross-platform data directories
        env.ts                         # Environment variable handling
        defaults.ts                    # Default config values
        
      services/
        mcp-service.ts                 # MCP client management
        llm.ts                         # Agent loop orchestration  
        llm-fetch.ts                   # LLM API calls (AI SDK)
        ai-sdk-provider.ts             # Provider factory
        conversation-service.ts        # Conversation persistence
        profile-service.ts             # Profile management
        diagnostics.ts                 # Health checks & logging
        state.ts                       # Agent session state
        context-budget.ts              # Context reduction
        builtin-tools.ts               # Built-in tool definitions
        emergency-stop.ts              # Emergency stop handler
        
      types/
        index.ts                       # Server-specific types
        
    package.json
    tsconfig.json
    tsup.config.ts
    README.md
```

### Service Dependency Graph

```
index.ts (CLI)
    └── server.ts (Fastify)
            ├── config/index.ts
            │       └── config/paths.ts
            │       └── config/env.ts
            ├── services/mcp-service.ts
            │       └── services/state.ts
            ├── services/llm.ts
            │       └── services/llm-fetch.ts
            │       └── services/ai-sdk-provider.ts
            │       └── services/context-budget.ts
            ├── services/conversation-service.ts
            ├── services/profile-service.ts
            └── services/diagnostics.ts
```

---

## Service Extraction Analysis

| Service | Electron Deps | Strategy | Parallel Group |
|---------|---------------|----------|----------------|
| `state.ts` | None | Direct copy | A |
| `llm-fetch.ts` | None | Direct copy | A |
| `context-budget.ts` | None | Direct copy | A |
| `config/paths.ts` | NEW | Create cross-platform | B |
| `config/env.ts` | NEW | Create env handling | B |
| `config/defaults.ts` | Extract from config.ts | Extract defaults | B |
| `config/index.ts` | Refactor | New ConfigStore | B (after paths) |
| `ai-sdk-provider.ts` | configStore | Port with new config | C |
| `llm.ts` | None | Direct copy | C |
| `conversation-service.ts` | paths | Use new config | C |
| `profile-service.ts` | `app.getPath()` | Use new config | C |
| `mcp-service.ts` | `app`, `dialog` | Abstract, skip dialog | D |
| `diagnostics.ts` | electron version | Make optional | D |
| `server.ts` | Refactor remote-server | Clean imports | E |
| `index.ts` | NEW | CLI entry point | E |

---

## Cross-Platform Path Resolution

### Default Paths by Platform

| Platform | Data Directory |
|----------|---------------|
| macOS | `~/Library/Application Support/speakmcp` |
| Windows | `%APPDATA%/speakmcp` |
| Linux | `~/.local/share/speakmcp` (XDG_DATA_HOME) |

### Environment Variable Overrides

```bash
# Data paths (highest priority)
SPEAKMCP_DATA_DIR=/custom/path      # Override all data paths
SPEAKMCP_CONFIG_PATH=/custom/config.json

# API Keys
SPEAKMCP_OPENAI_API_KEY=sk-...
SPEAKMCP_GROQ_API_KEY=gsk_...
SPEAKMCP_GEMINI_API_KEY=...

# Server settings
SPEAKMCP_PORT=3210
SPEAKMCP_BIND_ADDRESS=127.0.0.1
SPEAKMCP_AUTH_TOKEN=secret          # Bearer token auth
SPEAKMCP_LOG_LEVEL=info             # debug|info|warn|error

# Observability
LANGFUSE_PUBLIC_KEY=...
LANGFUSE_SECRET_KEY=...
LANGFUSE_BASE_URL=...
```

---

## CLI Interface

```bash
# Basic usage
npx @speakmcp/server

# With options
speakmcp-server --port 3210 --bind 0.0.0.0

# With config file
speakmcp-server --config /path/to/config.json

# Help
speakmcp-server --help
```

### CLI Options

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--port` | `-p` | 3210 | Server port |
| `--bind` | `-b` | 127.0.0.1 | Bind address |
| `--config` | `-c` | auto | Config file path |
| `--log-level` | `-l` | info | Log verbosity |
| `--help` | `-h` | - | Show help |

---

## API Endpoints

All endpoints from existing `remote-server.ts` are preserved:

### OpenAI-Compatible
- `POST /v1/chat/completions` - Streaming/non-streaming chat
- `GET /v1/models` - List available models

### MCP Tools
- `GET /mcp/tools` - List available tools
- `POST /mcp/tools/:toolName` - Execute tool
- `GET /mcp/servers` - List MCP servers
- `POST /mcp/servers/:name/reconnect` - Reconnect server

### Profiles
- `GET /profiles` - List profiles
- `GET /profiles/:id` - Get profile
- `POST /profiles` - Create profile
- `PUT /profiles/:id` - Update profile
- `DELETE /profiles/:id` - Delete profile

### Settings
- `GET /settings` - Get configuration
- `PATCH /settings` - Update configuration

### Conversations
- `GET /conversations` - List conversations
- `GET /conversations/:id` - Get conversation
- `DELETE /conversations/:id` - Delete conversation

### Control
- `POST /stop` - Emergency stop all agents
- `GET /health` - Health check
- `GET /diagnostics` - Diagnostic report

---

## Implementation Phases

### Phase 1: Foundation (Sequential)
**Duration: 1-2 hours**

Create package scaffold and core infrastructure.

| Task | Description | Dependencies |
|------|-------------|--------------|
| 1.1 | Create `packages/server/` directory structure | None |
| 1.2 | Create `package.json` with dependencies | 1.1 |
| 1.3 | Create `tsconfig.json` and `tsup.config.ts` | 1.1 |
| 1.4 | Update `pnpm-workspace.yaml` to include new package | 1.1 |

### Phase 2: Config Layer (Parallel Group B)
**Duration: 1-2 hours | Can run 3 sub-agents in parallel**

| Task | Sub-Agent | Description | Dependencies |
|------|-----------|-------------|--------------|
| 2.1 | `config-paths` | Create `config/paths.ts` - cross-platform data dirs | Phase 1 |
| 2.2 | `config-env` | Create `config/env.ts` - env var handling | Phase 1 |
| 2.3 | `config-defaults` | Create `config/defaults.ts` - extract from desktop | Phase 1 |
| 2.4 | Sequential | Create `config/index.ts` - ConfigStore class | 2.1, 2.2, 2.3 |

### Phase 3: Platform-Agnostic Services (Parallel Group A + C)
**Duration: 2-3 hours | Can run 6 sub-agents in parallel**

| Task | Sub-Agent | Description | Dependencies |
|------|-----------|-------------|--------------|
| 3.1 | `svc-state` | Port `state.ts` | Phase 1 |
| 3.2 | `svc-context` | Port `context-budget.ts` | Phase 1 |
| 3.3 | `svc-llm-fetch` | Port `llm-fetch.ts` | Phase 1 |
| 3.4 | `svc-ai-provider` | Port `ai-sdk-provider.ts` | Phase 2 |
| 3.5 | `svc-llm` | Port `llm.ts` | 3.3, 3.4 |
| 3.6 | `svc-diagnostics` | Port `diagnostics.ts` (make electron optional) | Phase 2 |

### Phase 4: Data Services (Parallel Group C)
**Duration: 1-2 hours | Can run 2 sub-agents in parallel**

| Task | Sub-Agent | Description | Dependencies |
|------|-----------|-------------|--------------|
| 4.1 | `svc-conversation` | Port `conversation-service.ts` | Phase 2 |
| 4.2 | `svc-profile` | Port `profile-service.ts` | Phase 2 |

### Phase 5: MCP Service (Sequential - Complex)
**Duration: 2-3 hours**

| Task | Description | Dependencies |
|------|-------------|--------------|
| 5.1 | Port `mcp-service.ts` - remove Electron deps | Phase 2, 3.1 |
| 5.2 | Port `builtin-tools.ts` | 5.1 |
| 5.3 | Port `builtin-tool-definitions.ts` | 5.1 |
| 5.4 | Port `emergency-stop.ts` | 3.1, 5.1 |

### Phase 6: Server & CLI (Parallel Group E)
**Duration: 2-3 hours | Can run 2 sub-agents in parallel**

| Task | Sub-Agent | Description | Dependencies |
|------|-----------|-------------|--------------|
| 6.1 | `server-core` | Create `server.ts` from `remote-server.ts` | Phase 3, 4, 5 |
| 6.2 | `server-cli` | Create `index.ts` CLI entry point | Phase 2 |
| 6.3 | Sequential | Integration testing | 6.1, 6.2 |

### Phase 7: Documentation & Polish
**Duration: 1 hour**

| Task | Description | Dependencies |
|------|-------------|--------------|
| 7.1 | Create `packages/server/README.md` | Phase 6 |
| 7.2 | Add npm scripts to root `package.json` | Phase 6 |
| 7.3 | Document future Electron migration plan | Phase 6 |

---

## Parallel Execution Strategy

### Maximum Parallelism Timeline

```
Time    Phase 1     Phase 2         Phase 3              Phase 4    Phase 5    Phase 6
────────────────────────────────────────────────────────────────────────────────────────
T+0     [1.1-1.4]
T+1                 [2.1][2.2][2.3] [3.1][3.2][3.3]
T+2                 [2.4]           [3.4][3.5][3.6]      [4.1][4.2]
T+3                                                                  [5.1-5.4]
T+4                                                                             [6.1][6.2]
T+5                                                                             [6.3]
```

### Sub-Agent Assignments

**Wave 1** (after Phase 1 complete) - 6 parallel agents:
- `config-paths`: Create paths.ts
- `config-env`: Create env.ts
- `config-defaults`: Extract defaults
- `svc-state`: Port state.ts
- `svc-context`: Port context-budget.ts
- `svc-llm-fetch`: Port llm-fetch.ts

**Wave 2** (after Wave 1) - 4 parallel agents:
- `svc-ai-provider`: Port ai-sdk-provider.ts
- `svc-diagnostics`: Port diagnostics.ts
- `svc-conversation`: Port conversation-service.ts
- `svc-profile`: Port profile-service.ts

**Wave 3** (after Wave 2) - 1 agent (complex):
- `svc-mcp`: Port mcp-service.ts and related

**Wave 4** (after Wave 3) - 2 parallel agents:
- `server-core`: Create server.ts
- `server-cli`: Create CLI entry point

---

## Testing Plan

### Unit Tests

Each service should have corresponding unit tests:

| Service | Test File | Key Test Cases |
|---------|-----------|----------------|
| `config/paths.ts` | `paths.test.ts` | Platform detection, env overrides, path construction |
| `config/env.ts` | `env.test.ts` | Env var parsing, type coercion, defaults |
| `config/index.ts` | `config.test.ts` | Load/save config, merge with defaults, validation |
| `state.ts` | `state.test.ts` | Session lifecycle, abort controllers, process tracking |
| `llm-fetch.ts` | `llm-fetch.test.ts` | Tool name sanitization, response parsing, error handling |
| `conversation-service.ts` | `conversation.test.ts` | CRUD operations, compaction, indexing |
| `profile-service.ts` | `profile.test.ts` | Profile CRUD, MCP server config validation |
| `mcp-service.ts` | `mcp-service.test.ts` | Server lifecycle, tool discovery, OAuth flow |

### Integration Tests

| Test Suite | Description |
|------------|-------------|
| `server.integration.test.ts` | Full API endpoint testing |
| `agent-loop.integration.test.ts` | End-to-end agent execution |
| `mcp-stdio.integration.test.ts` | MCP server spawning |

### Cross-Platform Tests

| Platform | Test Environment |
|----------|-----------------|
| macOS | GitHub Actions `macos-latest` |
| Linux | GitHub Actions `ubuntu-latest` |
| Windows | GitHub Actions `windows-latest` |

### Test Infrastructure

```typescript
// packages/server/src/test/setup.ts
import { beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

let testDataDir: string

beforeEach(() => {
  // Create isolated temp directory for each test
  testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'speakmcp-test-'))
  process.env.SPEAKMCP_DATA_DIR = testDataDir
})

afterEach(() => {
  // Cleanup
  fs.rmSync(testDataDir, { recursive: true, force: true })
  delete process.env.SPEAKMCP_DATA_DIR
})
```

### Test Commands

```bash
# Run all server tests
pnpm --filter @speakmcp/server test

# Run with coverage
pnpm --filter @speakmcp/server test:coverage

# Run specific test file
pnpm --filter @speakmcp/server exec vitest run src/config/paths.test.ts

# Watch mode during development
pnpm --filter @speakmcp/server test:watch
```

---

## Acceptance Criteria

### Phase 1: Foundation
- [ ] `packages/server/` directory exists with proper structure
- [ ] `pnpm install` succeeds with new package
- [ ] `pnpm --filter @speakmcp/server typecheck` passes

### Phase 2: Config Layer
- [ ] Config loads from correct platform-specific paths
- [ ] Environment variables override config file values
- [ ] `SPEAKMCP_DATA_DIR` overrides all paths
- [ ] Default values match desktop app defaults

### Phase 3-4: Services
- [ ] All ported services pass their unit tests
- [ ] No Electron imports in any server package file
- [ ] Services use new ConfigStore instead of desktop configStore

### Phase 5: MCP Service
- [ ] Can spawn stdio MCP servers on all platforms
- [ ] Tool discovery works correctly
- [ ] Server reconnection works
- [ ] OAuth flow works without dialog (logs URL to console)

### Phase 6: Server & CLI
- [ ] `npx @speakmcp/server` starts server
- [ ] `POST /v1/chat/completions` returns valid response
- [ ] Agent mode executes tools correctly
- [ ] Emergency stop works
- [ ] All API endpoints functional

### Cross-Platform
- [ ] Tests pass on macOS
- [ ] Tests pass on Linux
- [ ] Tests pass on Windows
- [ ] Paths resolve correctly on each platform

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Breaking desktop app | No changes to `apps/desktop/` in this phase |
| MCP server spawning differences | Test on all platforms early in Phase 5 |
| Config conflicts | Use same default paths as Electron's `app.getPath()` |
| Missing dependencies | Track all imports during porting |
| OAuth without dialog | Log auth URL to console, return in API response |

---

## Future Electron Migration

### Phase 2 (Future Work)

Once server package is stable, desktop app can import from it:

```typescript
// apps/desktop/src/main/index.ts (future)
import { createServer, configStore, mcpService } from '@speakmcp/server'

// Start embedded server
const server = await createServer({ port: 3210 })

// Desktop-specific features continue using Electron
import { app, BrowserWindow } from 'electron'
// keyboard, tray, menu, window management stay in desktop
```

### Phase 3 (Optional Future)

Desktop becomes pure HTTP client:

```typescript
// Desktop app connects to server via HTTP like mobile
const apiClient = new SpeakMCPClient('http://localhost:3210')
```

Benefits:
- Better resource isolation
- Server can run as separate process
- Enables headless server + remote desktop UI

---

## Dependencies

### New Package Dependencies

```json
{
  "dependencies": {
    "@ai-sdk/openai": "^3.0.1",
    "@ai-sdk/google": "^3.0.1",
    "@modelcontextprotocol/sdk": "^1.24.3",
    "@speakmcp/shared": "workspace:^",
    "@fastify/cors": "^11.1.0",
    "ai": "^6.0.3",
    "fastify": "^5.6.1",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.6.3",
    "vitest": "^1.6.0"
  },
  "optionalDependencies": {
    "langfuse": "^3.38.6"
  }
}
```

### Shared Types to Migrate

Types that should move to `@speakmcp/shared`:
- `MCPServerConfig`, `MCPTransportType`
- `Profile`, `ProfilesData`, `ProfileMcpServerConfig`
- `Conversation`, `ConversationMessage`, `ConversationHistoryItem`
- `AgentProgressUpdate`, `SessionProfileSnapshot`
- Core `Config` interface fields

---

## Success Metrics

| Metric | Target |
|--------|--------|
| All unit tests passing | 100% |
| All integration tests passing | 100% |
| Cross-platform tests passing | macOS, Linux, Windows |
| No Electron imports | 0 |
| API parity with remote-server | 100% endpoints |
| Startup time | < 2 seconds |
| Memory baseline | < 100MB idle |

---

## Appendix: File-by-File Port Notes

### `config.ts` → `config/index.ts`
- Remove `import { app } from "electron"`
- Use `paths.ts` for data directories
- Add env var override layer from `env.ts`

### `mcp-service.ts`
- Remove `import { app, dialog } from "electron"`
- For OAuth: log URL to console instead of dialog
- Use `paths.ts` for any path references

### `profile-service.ts`
- Remove `import { app } from "electron"`
- Use `paths.ts` for profiles directory

### `diagnostics.ts`
- Make `process.versions.electron` optional
- Return "standalone" when not in Electron

### `agent-session-tracker.ts`
- **Do not port** - UI notification specific
- Server uses SSE via existing API endpoints

### `remote-server.ts` → `server.ts`
- Update all imports to use new service locations
- Remove window/panel references (already optional)
- Add proper lifecycle (start/stop exports)


