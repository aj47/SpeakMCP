# CLAUDE.md

This file provides guidance to Claude Code and AI coding agents working with this repository.

## Quick Reference

```bash
# Setup & Dev
pnpm install              # Install deps (MUST use pnpm, not npm/yarn)
pnpm build-rs             # Build Rust keyboard binary (required before first dev)
pnpm dev                  # Start Electron app in dev mode

# Testing (Vitest, colocated .test.ts files)
pnpm test                 # Run all tests
pnpm --filter @speakmcp/desktop test:run  # Desktop tests once
pnpm --filter @speakmcp/desktop exec vitest run src/main/llm-fetch.test.ts  # Specific file

# Type checking & Linting
pnpm typecheck            # Type check all packages
pnpm lint                 # Lint all packages

# Production builds
pnpm build                                  # Full build (typecheck + test + build)
pnpm --filter @speakmcp/desktop build:mac   # macOS
pnpm --filter @speakmcp/desktop build:win   # Windows
pnpm --filter @speakmcp/desktop build:linux # Linux
```

## Debug Flags

All flags work as CLI args or env vars. Use `-d` for all, or combine specific flags:

```bash
pnpm dev -- -d            # ALL debug logging
pnpm dev -- -dl           # LLM calls/responses
pnpm dev -- -dt           # MCP tool execution
pnpm dev -- -dui          # UI/renderer state
pnpm dev -- -dmcp         # MCP protocol messages (request/response JSON)
pnpm dev -- -dacp         # ACP agent protocol messages
pnpm dev -- -dk           # Keybind events
pnpm dev -- -dapp         # General app lifecycle

# Environment variable alternatives
DEBUG=llm,tools pnpm dev
DEBUG=* pnpm dev          # Same as -d

# Chrome DevTools Protocol
REMOTE_DEBUGGING_PORT=9222 pnpm dev -- -d
```

Debug logging is implemented in `apps/desktop/src/main/debug.ts`. Each category has `isDebugX()` guards and `logX()` helpers (e.g. `isDebugLLM()`, `logLLM()`). MCP/ACP loggers include direction prefix (→ request, ← response, ◆ notification).

## Architecture Overview

### Monorepo Structure (pnpm workspaces)

```
SpeakMCP/
├── apps/desktop/          # Electron desktop app (@speakmcp/desktop)
│   ├── src/main/          # Main process - all backend logic
│   ├── src/renderer/      # React UI (renderer process)
│   ├── src/shared/        # Types shared between main/renderer
│   ├── src/preload/       # Electron preload scripts
│   └── speakmcp-rs/       # Rust native binary (keyboard/input)
├── apps/mobile/           # React Native/Expo mobile app (@speakmcp/mobile)
├── packages/shared/       # @speakmcp/shared - types, colors, utils for both apps
└── packages/mcp-whatsapp/ # Built-in WhatsApp MCP server
```

### Path Aliases (important for imports!)

**Main process** (`tsconfig.node.json`):
- `@shared/*` → `src/shared/*` (e.g. `import { Config } from "@shared/types"`)

**Renderer** (`tsconfig.web.json`):
- `@renderer/*` → `src/renderer/src/*`
- `~/*` → `src/renderer/src/*` (alternate alias, same target)
- `@shared/*` → `src/shared/*`

**Cross-package**: `@speakmcp/shared` → `packages/shared` (workspace dependency)

### Desktop Main Process - Service Map

The main process (`apps/desktop/src/main/`) is the core. Key files:

**Entry & Window Management:**
- `index.ts` - App entry, window creation, initialization flow
- `window.ts` - Window management (main window, panel window), resize logic
- `tray.ts` - System tray icon and menu
- `menu.ts` - Application menu
- `panel-position.ts` - Panel window positioning/constraints

**IPC & Communication:**
- `tipc.ts` - ALL IPC handlers (~4100 lines). This is the API surface between main↔renderer
- `renderer-handlers.ts` - Type definitions for renderer→main event handlers
- `emit-agent-progress.ts` - Broadcasts agent progress to all windows

**LLM & AI:**
- `llm.ts` - Agent loop orchestration, tool execution coordination (~3370 lines)
- `llm-fetch.ts` - Vercel AI SDK calls (generateText/streamText), retry logic, tool name sanitization
- `ai-sdk-provider.ts` - Provider adapter (OpenAI, Groq, Gemini via AI SDK)
- `system-prompts.ts` - System prompt construction with memory/profile injection
- `context-budget.ts` - Token counting, message shrinking, model registry (context windows)
- `structured-output.ts` - OpenAI structured output schemas for tool calls
- `summarization-service.ts` - Dual-model summarization (cheap model summarizes agent steps)

**MCP (Model Context Protocol):**
- `mcp-service.ts` - MCP client management, tool discovery, multi-transport (~3000 lines)
- `mcp-elicitation.ts` - MCP elicitation protocol support
- `mcp-sampling.ts` - MCP sampling protocol support
- `oauth-client.ts`, `oauth-storage.ts`, `oauth-callback-server.ts`, `oauth-deeplink-handler.ts` - OAuth 2.1 flow

**ACP (Agent Client Protocol) - Multi-Agent System:**
- `acp-service.ts` - ACP agent lifecycle, JSON-RPC over stdio (~1700 lines)
- `acp-session-state.ts` - Maps ACP sessions to SpeakMCP sessions
- `acp-main-agent.ts` - Main agent ACP interface
- `acp/` subdirectory:
  - `acp-registry.ts` - Registry of available ACP agents
  - `acp-smart-router.ts` - Generates delegation prompts for available agents
  - `acp-router-tools.ts` / `acp-router-tool-definitions.ts` - Tools for delegating to agents
  - `acp-client-service.ts` - ACP client connections
  - `acp-process-manager.ts` - ACP process lifecycle
  - `acp-background-notifier.ts` - Background agent notifications
  - `internal-agent.ts` - Internal sub-sessions (same-process agent spawning)
  - `types.ts` - ACP type definitions

**Built-in Tools:**
- `builtin-tool-definitions.ts` - Static tool schemas (dependency-free, avoids circular imports)
- `builtin-tools.ts` - Tool execution handlers. Virtual server name: `speakmcp-settings`
- Built-in tools include: list/toggle MCP servers, list/switch profiles, execute_command, memory CRUD, get_tool_schema, message queue management, emergency stop, delegate_to_agent

**State & Session Management:**
- `state.ts` - Global mutable state, session state manager, tool approval manager, abort controllers
- `agent-session-tracker.ts` - Tracks active/recent agent sessions for sidebar UI
- `conversation-service.ts` - Conversation CRUD, message compaction, JSON file storage
- `emergency-stop.ts` - Kill switch for all agent sessions

**Profiles & Personas (unified as AgentProfile):**
- `agent-profile-service.ts` - Unified profile management (migrated from separate profiles + personas)
- `profile-service.ts` - Legacy profile service (MCP server configs, model configs per profile)

**Other Services:**
- `config.ts` - Persistent JSON config store, migration logic
- `keyboard.ts` - Global hotkey via Rust binary
- `skills-service.ts` - Skill management (GitHub clone, SKILL.md discovery, bundled skills)
- `memory-service.ts` - Agent memory persistence (JSON file, importance-ranked)
- `models-service.ts` - Model listing, models.dev enrichment, caching
- `models-dev-service.ts` - models.dev API integration for pricing/capabilities
- `langfuse-service.ts` - Optional Langfuse observability (traces, spans, generations)
- `langfuse-loader.ts` - Lazy Langfuse loader (handles missing package gracefully)
- `remote-server.ts` - Fastify HTTP server for mobile app connection
- `push-notification-service.ts` - Push notifications to mobile
- `message-queue-service.ts` - Message queuing when agent is busy
- `cloudflare-tunnel.ts` - Cloudflare tunnel for remote access
- `diagnostics.ts` - Runtime diagnostics
- `parakeet-stt.ts` - Local STT via Sherpa ONNX
- `kitten-tts.ts`, `supertonic-tts.ts` - Local TTS engines
- `tts-llm-preprocessing.ts`, `tts-preprocessing.test.ts` - TTS text preprocessing
- `updater.ts` - Auto-update logic

### Desktop Renderer Process

**Stack:** React 18 + TypeScript + Tailwind CSS + Radix UI primitives

**Key directories** (`apps/desktop/src/renderer/src/`):
- `pages/` - Route pages (sessions, settings/*, panel, onboarding, setup, memories)
- `components/` - Shared components (agent-progress, mcp-config-manager, profile-manager, session tiles, etc.)
- `components/ui/` - Radix-based design system primitives (button, dialog, input, etc.)
- `stores/` - Zustand stores (agent-store, conversation-store)
- `hooks/` - Custom hooks (use-resizable, use-sidebar, use-store-sync)
- `lib/` - Utilities (queries.ts for React Query, recorder.ts, tts-manager.ts, tipc-client.ts)

**Routing:** React Router DOM with lazy loading. Main layout wraps all settings routes.
- `/` and `/:id` - Sessions view (main view)
- `/panel` - Floating panel window (separate Electron window)
- `/settings/*` - Settings pages
- `/onboarding`, `/setup` - First-run flows
- `/memories` - Agent memory management

### Shared Package (`packages/shared`)

Exports: colors, types (ToolCall, ToolResult, BaseChatMessage, ChatApiResponse, QueuedMessage), tts-preprocessing, chat-utils.
Built with tsup. Both desktop and mobile depend on `@speakmcp/shared`.

## Key Patterns & Conventions

### Singleton Services
Most services use singleton pattern: `class FooService { private static instance; static getInstance() }`
Or module-level singletons: `export const fooService = FooService.getInstance()`

### IPC Pattern (tipc)
1. Handler defined in `tipc.ts` using `tipc.procedure.input(zodSchema).action(async ({ input }) => { ... })`
2. Renderer calls via `window.electron.ipcRenderer.invoke('methodName', params)`
3. Main→Renderer events via `getRendererHandlers<RendererHandlers>(webContents).eventName.send(data)`
4. Renderer handler types declared in `renderer-handlers.ts`

### Agent Session Lifecycle
1. Session created: `agentSessionStateManager.createSession(sessionId, profileSnapshot)`
2. Session tracked: `agentSessionTracker.createSession(sessionId, ...)`
3. Agent loop runs in `processTranscriptWithAgentMode()` (llm.ts)
4. Progress emitted via `emitAgentProgress(update)`
5. Stop: `agentSessionStateManager.stopSession(sessionId)` → aborts controllers, kills processes
6. Cleanup: `agentSessionStateManager.cleanupSession(sessionId)`

### Tool Execution Flow
1. LLM returns tool calls → `llm.ts` dispatches
2. Built-in tools (`speakmcp-settings:*`) → `executeBuiltinTool()` in `builtin-tools.ts`
3. MCP tools (`server:tool`) → `mcpService.callTool()` in `mcp-service.ts`
4. Tool approval: `toolApprovalManager.requestApproval()` → UI prompt → resolve promise

### Circular Import Avoidance
`builtin-tool-definitions.ts` is intentionally dependency-free. Tool schemas live there; execution handlers in `builtin-tools.ts`. This breaks the cycle: `profile-service → builtin-tool-definitions` (no cycle) while `builtin-tools → profile-service` is fine.

### Profile Snapshot Isolation
Agent sessions capture a `SessionProfileSnapshot` at creation time. This prevents mid-session profile changes from affecting running agents. The snapshot includes system prompt, guidelines, and tool configurations.

## Testing

Vitest with colocated test files (`*.test.ts`, `*.test.tsx`). Config in `apps/desktop/vitest.config.ts`.

```bash
# Run all desktop tests
pnpm --filter @speakmcp/desktop test:run

# Specific file
pnpm --filter @speakmcp/desktop exec vitest run src/main/llm-fetch.test.ts

# Pattern match
pnpm --filter @speakmcp/desktop exec vitest run -t "sanitize"

# Watch mode
pnpm --filter @speakmcp/desktop test
```

Tests use `vitest/globals` (no explicit imports needed for describe/it/expect). Path aliases resolve via `vite-tsconfig-paths` plugin.
