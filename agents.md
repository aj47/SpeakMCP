# agents.md

Practical guide for AI coding agents working in this codebase.

## Critical Rules

1. **pnpm only** - Never use npm/yarn. The lockfile is `pnpm-lock.yaml`.
2. **Path aliases** - Main process uses `@shared/*`, renderer uses `@renderer/*` or `~/*`. Never use relative paths like `../../shared/`.
3. **No circular imports** - Check dependency direction before adding imports.
4. **Singleton pattern** - Services use `static getInstance()`. Don't create new instances; use the exported singleton.
5. **Types in `src/shared/types.ts`** - Types used by BOTH main and renderer go here. Types only for shared package go in `packages/shared/src/types.ts`.
6. **Build shared first** - After changing `packages/shared`, run `pnpm build:shared` before `pnpm dev`.
7. **No user profiles** - User profiles have been eliminated. Settings (guidelines, model config, MCP config, skills) are global via `config.json`. The concept of "current profile" no longer exists for end users.
8. **Agents, not Personas** - What was previously called "Persona" is now called "Agent". Use "agent" in all user-facing text, comments, and new code.

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
- **Circular dependency**: `builtin-tools.ts` ↔ service files was a past issue. Schemas go in `builtin-tool-definitions.ts` (no deps), handlers in `builtin-tools.ts`.

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

## Agents (formerly Personas)

The app uses a unified **Agent** concept (`AgentProfile` type) for all specialized AI assistants.
- **No user profiles** — user settings (guidelines, model config, MCP servers, skills) are global in `config.json`
- **Agents** replace what was previously called "Personas" and "External Agents"
- Each agent has: name, system prompt, guidelines, connection type, model config, skills config, tool config
- Connection types: `internal` (built-in LLM), `acp` (external ACP agent), `stdio`, `remote`
- Managed by `AgentProfileService` singleton (`agent-profile-service.ts`)
- UI: single flat list at `/settings/agents` (`settings-agents.tsx`)
- Legacy types (`Persona`, `Profile`, `ACPAgentConfig`) kept for migration only

### MCP tool config semantics (Option B)

- Built-in MCP tools (`speakmcp-settings:*` and `speakmcp-builtin:*`) are controlled via `AgentProfile.toolConfig.enabledBuiltinTools` (allowlist).
  - `enabledBuiltinTools: []` is treated as **unconfigured** → allow all built-ins.
  - Essential built-in is always enabled: `speakmcp-settings:mark_work_complete`.
- External MCP tools are controlled via `disabledTools` / `config.mcpDisabledTools` (denylist).

### Memories

Memories are **global** (not scoped to profiles/agents):
- `memoryService.getAllMemories()` — returns all memories
- `memoryService.deleteMemory(id)` — deletes by ID, no ownership check
- The `profileId` field on `AgentMemory` exists for future per-agent scoping but is not required
- Built-in tools (`save_memory`, `list_memories`, `delete_memory`, etc.) operate globally

## Config System

### config.json (global settings)
Config is a flat JSON object persisted at `~/Library/Application Support/app.speakmcp/config.json` (macOS).
- Read: `configStore.get()` returns full `Config` object
- Write: renderer IPC `saveConfig` merges partial updates, then `configStore.save(merged)` persists
- Migration logic in `config.ts` handles schema evolution (e.g., Groq TTS model renames)
- Config type defined in `apps/desktop/src/shared/types.ts` as `Config`
- **Config merge order**: `defaults ← config.json ← .agents` (config.json is always loaded as base)

### .agents/ modular config (canonical)
SpeakMCP stores agent-related configuration and content as files under a `.agents/` folder.

**Two layers** with overlay semantics (workspace overrides global):
- **Global (canonical):** `~/.agents/` — via `globalAgentsFolder` in `apps/desktop/src/main/config.ts`
  - The app creates missing config files here on startup (`ConfigStore` calls `writeAgentsLayerFromConfig(..., onlyIfMissing: true)`).
  - When settings change in the UI, the app rewrites the **global** `.agents` files.
- **Workspace (optional overlay):** `<workspace>/.agents/` — via `resolveWorkspaceAgentsFolder()`
  - If `SPEAKMCP_WORKSPACE_DIR` is set, the workspace layer is `<SPEAKMCP_WORKSPACE_DIR>/.agents`.
  - Otherwise we do an upward search from `process.cwd()` **only if a `.agents` folder already exists** (safe-by-default).

**Directory structure (current):**
```
.agents/
├── speakmcp-settings.json        # general settings (subset of Config)
├── mcp.json                      # MCP server + tool config (subset of Config)
├── models.json                   # model presets + provider keys (subset of Config)
├── system-prompt.md              # stored as Config.mcpCustomSystemPrompt
├── agents.md                     # stored as Config.mcpToolsSystemPrompt
├── layouts/
│   └── ui.json                   # UI/layout settings (subset of Config)
├── agents/                       # agent profile definitions
│   └── <agent-id>/
│       ├── agent.md              # frontmatter (metadata) + body (system prompt)
│       └── config.json           # optional: complex nested config (toolConfig, modelConfig, etc.)
├── tasks/                        # repeat task definitions
│   └── <task-id>/
│       └── task.md               # frontmatter (schedule/metadata) + body (prompt)
├── skills/
│   └── <skill-id>/skill.md       # skill instructions + frontmatter
├── memories/
│   └── <memory-id>.md            # memory entry + frontmatter
└── .backups/                     # timestamped backups (auto-rotated)
    ├── agents/
    ├── tasks/
    ├── skills/
    └── memories/
```

**Merge semantics:**
- **Config files** are shallow-merged by key (`merged = { ...global, ...workspace }`).
- **Skills**, **memories**, **agents**, and **tasks** are merged by `id` (workspace wins on conflicts).

**Infrastructure** (`apps/desktop/src/main/agents-files/`):
- `frontmatter.ts` — simple `key: value` parser/serializer (no YAML dependency)
- `safe-file.ts` — atomic writes (temp+rename), timestamped backups with rotation, auto-recovery
- `modular-config.ts` — `AgentsLayerPaths` type, layer path calculations
- `agent-profiles.ts` — agent profile `.md` + `config.json` read/write, directory scanning
- `tasks.ts` — repeat task `.md` read/write, directory scanning
- `skills.ts` — skill `.md` read/write, directory scanning, `writeAgentsSkillFile()`
- `memories.ts` — memory `.md` read/write

**Frontmatter format:**
- Uses `---` fences and *simple* `key: value` lines (**not** full YAML)
- Lines starting with `#` are comments
- Values can be quoted with `'` or `"` (recommended if they contain `:`)
- For memories, list-ish fields like `tags` / `keyFindings` accept either:
  - CSV: `tags: one, two, three`
  - JSON array: `tags: ["one", "two"]`

**Agent profile template** (`.agents/agents/<agent-id>/agent.md`):
```
---
kind: agent
id: my-agent-id              # optional (defaults to folder name)
name: my-agent-id
displayName: My Agent
description: What this agent does
connection-type: internal    # internal | acp | stdio | remote
role: delegation-target      # user-profile | delegation-target | external-agent
enabled: true
isBuiltIn: false
createdAt: 1700000000000
updatedAt: 1700000000000
guidelines: Follow clean code practices
---

You are a helpful assistant specialized in...
```

Complex config (tool/model/skills/connection details) lives in a sibling `config.json`:
```json
{
  "toolConfig": { "enabledServers": ["my-server"], "disabledTools": [] },
  "modelConfig": { "mcpToolsProviderId": "openai", "mcpToolsOpenaiModel": "gpt-4o" },
  "connection": { "command": "node", "args": ["agent.js"] }
}
```

**Repeat task template** (`.agents/tasks/<task-id>/task.md`):
```
---
kind: task
id: my-task-id                # optional (defaults to folder name)
name: Daily Code Review
intervalMinutes: 60
enabled: true
runOnStartup: false
profileId: abc-123            # optional: agent profile to use
lastRunAt: 1700000000000      # updated automatically after each run
---

Review all open pull requests and summarize their status.
Check for any failing CI pipelines and report issues.
```

**Skill template** (`.agents/skills/<skill-id>/skill.md`):
```
---
id: my-skill-id              # optional (defaults to folder name)
name: My Skill
description: What this skill does
enabled: true
---

Your instructions here in markdown...
```

**Memory template** (`.agents/memories/<memory-id>.md`):
```
---
id: memory_123               # optional (defaults to filename without .md)
title: How we gate MCP tools
content: Built-in tools use enabledBuiltinTools allowlist; external tools use disabledTools denylist.
importance: medium           # low | medium | high | critical
tags: mcp, tools
keyFindings: ["Option B", "mark_work_complete always enabled"]
---

Optional notes (go in the markdown body).
```

## Key Type Hierarchy

```
@speakmcp/shared (packages/shared/src/types.ts)
  └─ ToolCall, ToolResult, BaseChatMessage, ChatApiResponse, QueuedMessage

src/shared/types.ts (apps/desktop/src/shared/types.ts)
  └─ Re-exports from @speakmcp/shared
  └─ Config, MCPConfig, MCPServerConfig, OAuthConfig
  └─ AgentProfile (unified agent type — replaces Profile, Persona, ACPAgentConfig)
  └─ AgentProfileConnection, AgentProfileConnectionType, AgentProfileToolConfig
  └─ AgentMemory, AgentStepSummary
  └─ SessionProfileSnapshot, ModelPreset
  └─ Persona, Profile, PersonasData (legacy — kept for migration only)
  └─ ConversationMessage, Conversation

src/main/agents-files/ (layer types)
  └─ AgentsLayerPaths (modular-config.ts)
  └─ AgentsSkillOrigin, LoadedAgentsSkillsLayer (skills.ts)
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
