# agents.md

Practical guide for AI coding agents working in this codebase. Read CLAUDE.md first for architecture overview.

## Critical Rules

1. **pnpm only** - Never use npm/yarn. The lockfile is `pnpm-lock.yaml`.
2. **Path aliases** - Main process uses `@shared/*`, renderer uses `@renderer/*` or `~/*`. Never use relative paths like `../../shared/`.
3. **No circular imports** - Check dependency direction before adding imports. See "Circular Import Avoidance" in CLAUDE.md.
4. **Singleton pattern** - Services use `static getInstance()`. Don't create new instances; use the exported singleton.
5. **Types in `src/shared/types.ts`** - Types used by BOTH main and renderer go here (~1510 lines). Types only for shared package go in `packages/shared/src/types.ts`.
6. **Build shared first** - After changing `packages/shared`, run `pnpm build:shared` before `pnpm dev`.

## How to Add a New IPC Handler

1. **Define the handler in `tipc.ts`:**
```typescript
const myHandler = tipc.procedure
  .input(z.object({ foo: z.string() }))  // Zod schema for input
  .action(async ({ input }) => {
    // Implementation
    return result
  })
```

2. **Export it in the router object** at the bottom of `tipc.ts` (search for `export const router =`).

3. **Call from renderer:**
```typescript
const result = await window.electron.ipcRenderer.invoke('myHandler', { foo: 'bar' })
```

4. **For main→renderer events**, add the event type to `renderer-handlers.ts`:
```typescript
export type RendererHandlers = {
  myEvent: (data: MyEventData) => void
  // ...existing handlers
}
```
Then emit from main: `getRendererHandlers<RendererHandlers>(webContents).myEvent.send(data)`

## How to Add a New Built-in Tool

Built-in tools appear as `speakmcp-settings:tool_name` to the LLM.

1. **Add schema to `builtin-tool-definitions.ts`** (this file MUST stay dependency-free):
```typescript
{
  name: `${BUILTIN_SERVER_NAME}:my_tool`,
  description: "What the tool does",
  inputSchema: {
    type: "object",
    properties: { param: { type: "string", description: "..." } },
    required: ["param"],
  },
}
```

2. **Add handler to `builtin-tools.ts`** in the `toolHandlers` record:
```typescript
const toolHandlers: Record<string, ToolHandler> = {
  my_tool: async (args): Promise<MCPToolResult> => {
    // Implementation - CAN import from other services
    return { content: [{ type: "text", text: "result" }], isError: false }
  },
  // ...existing handlers
}
```

## How to Add a New Settings Page

1. Create page component in `apps/desktop/src/renderer/src/pages/settings-mypage.tsx`
2. Export `Component` as named export (for React Router lazy loading):
```typescript
export function Component() { return <div>...</div> }
```
3. Add route in `router.tsx`:
```typescript
{ path: "settings/mypage", lazy: () => import("./pages/settings-mypage") }
```
4. Add navigation link in the settings sidebar (in `app-layout.tsx`)

## How to Add a New Main Process Service

1. Create file in `apps/desktop/src/main/my-service.ts`
2. Use the singleton pattern:
```typescript
class MyService {
  private static instance: MyService | null = null
  static getInstance(): MyService {
    if (!MyService.instance) MyService.instance = new MyService()
    return MyService.instance
  }
  private constructor() {}
}
export const myService = MyService.getInstance()
```
3. Import the singleton where needed. Register any IPC handlers in `tipc.ts`.

## Common Pitfalls

### Import Errors
- **"Cannot find module @shared/..."**: You're in a renderer file using main-process alias. Use `import from "../../shared/..."` or check which tsconfig applies.
- **Circular dependency**: `builtin-tools.ts` ↔ `profile-service.ts` was a past issue. Schemas go in `builtin-tool-definitions.ts` (no deps), handlers in `builtin-tools.ts`.

### Type Mismatches Between Processes
- Main and renderer are SEPARATE TypeScript compilations (`tsconfig.node.json` vs `tsconfig.web.json`).
- Shared types must be in `src/shared/` or `@speakmcp/shared`.
- The renderer cannot import from `src/main/` directly.

### Agent Session State
- Always use `agentSessionStateManager` for session state, not raw `state.*` properties.
- The `state.shouldStopAgent` global flag is legacy; prefer session-scoped `shouldStopSession(sessionId)`.
- Call `cleanupSession()` in finally blocks to prevent state leaks.

### Tool Name Sanitization
- MCP tools use `server:tool_name` format. LLM providers require `^[a-zA-Z0-9_-]{1,128}$`.
- `llm-fetch.ts` sanitizes names (`:` → `__COLON__`) and maintains a `nameMap` for reverse lookup.
- Never hardcode sanitized names; always use the mapping.

### Window References
- Use `WINDOWS.get("main")` / `WINDOWS.get("panel")` from `window.ts`.
- Panel window may not exist. Always null-check.
- Panel has special resize logic (`resizePanelForAgentMode`, `resizePanelToNormal`).

## Config System

### Legacy config.json
Config is a flat JSON object persisted at `~/Library/Application Support/app.speakmcp/config.json` (macOS).
- Read: `configStore.get()` returns full `Config` object
- Write: `configStore.set(partial)` merges partial updates
- Migration logic in `config.ts` handles schema evolution (e.g., Groq TTS model renames)
- Config type defined in `src/shared/types.ts` as `Config` interface

### .agents/ modular config (canonical)
Skills and memories are stored as discrete `.md` files in a `.agents/` directory with simple `key: value` frontmatter.

**Two layers** with overlay semantics (workspace overrides global by ID):
- **Global**: `<appData>/<APP_ID>/.agents/` — via `globalAgentsFolder` from `config.ts`
- **Workspace** (optional): resolved by `resolveWorkspaceAgentsFolder()` — uses `SPEAKMCP_WORKSPACE_DIR` env var or upward search

**Directory structure:**
```
.agents/
├── skills/<skill-id>/skill.md    # frontmatter: id, name, description, enabled, createdAt, updatedAt
├── memories/<memory-id>.md       # frontmatter: id, content summary
├── .backups/                     # timestamped backups (auto-rotated)
│   ├── skills/
│   └── memories/
└── (future: mcp.json, models.json, speakmcp-settings.json, agents.md, system-prompt.md, loops.md)
```

**Infrastructure** (`apps/desktop/src/main/agents-files/`):
- `frontmatter.ts` — simple `key: value` parser/serializer (no YAML dependency)
- `safe-file.ts` — atomic writes (temp+rename), timestamped backups with rotation, auto-recovery
- `modular-config.ts` — `AgentsLayerPaths` type, layer path calculations
- `skills.ts` — skill `.md` read/write, directory scanning, `writeAgentsSkillFile()`
- `memories.ts` — memory `.md` read/write

**Key functions:**
- `getAgentsLayerPaths(agentsDir)` → `AgentsLayerPaths` (agentsDir, backupsDir)
- `loadAgentsSkillsLayer(layer)` → scans `.agents/skills/` recursively for `skill.md`/`SKILL.md`
- `writeAgentsSkillFile(layer, skill)` → atomic write with backup
- `safeWriteFileSync(path, data, opts)` → atomic temp+rename, optional backup+rotation
- `safeReadJsonFileSync(path)` → parse + auto-recover from backup on failure

## Key Type Hierarchy

```
@speakmcp/shared (packages/shared/src/types.ts)
  └─ ToolCall, ToolResult, BaseChatMessage, ChatApiResponse, QueuedMessage

src/shared/types.ts (apps/desktop/src/shared/types.ts)
  └─ Re-exports from @speakmcp/shared
  └─ Config, MCPConfig, MCPServerConfig, OAuthConfig
  └─ AgentProgressStep, AgentProgressUpdate
  └─ ACPAgentConfig, ACPDelegationProgress
  └─ AgentProfile, Persona, Profile (unified as AgentProfile)
  └─ ConversationMessage, Conversation
  └─ AgentMemory, AgentStepSummary
  └─ SessionProfileSnapshot, ModelPreset

src/main/agents-files/ (layer types)
  └─ AgentsLayerPaths (modular-config.ts)
  └─ AgentsSkillOrigin, LoadedAgentsSkillsLayer (skills.ts)
  └─ SkillOrigin { layer, filePath } (skills-service.ts — private)
```

## Vercel AI SDK Usage

LLM calls use Vercel AI SDK (`ai` package), NOT raw fetch:
- `generateText()` for non-streaming tool calls (main agent loop)
- `streamText()` for streaming responses
- Providers: `@ai-sdk/openai` (also used for Groq via OpenAI-compatible endpoint), `@ai-sdk/google`
- Tool schemas converted via `jsonSchema()` from AI SDK
- Provider created in `ai-sdk-provider.ts` with `createLanguageModel()`

## Context Budget

`context-budget.ts` manages token limits:
- `MODEL_REGISTRY` maps model names to context windows (200K for Claude, 128K for GPT-4, etc.)
- `shrinkMessagesForLLM()` trims conversation history to fit context
- `estimateTokensFromMessages()` for rough token counting
- `summarizeContent()` for compacting old messages

## Running the App for Testing

```bash
pnpm install && pnpm build-rs && pnpm dev
# First run will show onboarding flow
# Need at least one API key (OpenAI/Groq/Gemini) configured to use agent mode
```

