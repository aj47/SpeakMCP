# Remote Server – Phase 1 Implementation Plan (Fastify, non‑streaming)

Status: Design approved by product (Fastify, ignore client model, treat prompt as if user submitted)
Owner: SpeakMCP core
Target version: 0.3.x

## Summary
Implement a local HTTP server (Fastify) that exposes an OpenAI‑compatible endpoint at `/v1/chat/completions` on port 3210. The server authenticates via API key, extracts only the user prompt from incoming requests, ignores client‑provided `model` and other tuning params, and routes the prompt into our existing agent workflow (`processWithAgentMode`). Return a standard OpenAI chat completion JSON (non‑streaming). Add a Settings page to enable/disable the server and configure port/bind/API key.

## Scope (Phase 1)
- Server: Fastify, non‑streaming only
- Endpoints: `POST /v1/chat/completions` (required), `GET /v1/models` (simple compatibility)
- Security: localhost bind by default, API key required, optional LAN binding with warning
- Settings UI: Enable toggle, Port, Bind Address, API Key (copy/regenerate), Status
- Lifecycle: Start at app launch if enabled; restart/stop on config changes
- Logging: Basic request lifecycle + errors via diagnosticsService
- History: Treat requests “as if user submitted prompt” (record an item, duration=0)

Out of scope for Phase 1: streaming SSE, rate limiting, CORS allowlists (can add later), legacy `/v1/completions`, embeddings.

## Behavior and compatibility
- Client sends OpenAI‑style body. We only use the user prompt:
  - If `messages` array present, take the last `role:"user"` message’s `content` string.
  - Else use `prompt` or `input` if present.
  - If none found, return HTTP 400.
- Ignore any `model` or sampling params; the app’s own settings/provider select the final model.
- Route prompt into `processWithAgentMode(prompt, undefined)` and return its final string response in OpenAI chat format.
- If the app is configured to use Gemini or other providers, the internal workflow already handles that; we still return OpenAI chat JSON.

## Architecture

### New module: `src/main/remote-server.ts`
- Dependencies: `fastify` (runtime), optionally `@fastify/cors` (later phases)
- Responsibilities:
  - Create and hold a singleton Fastify instance
  - Auth middleware (API key)
  - Route handlers for `/v1/chat/completions` and `/v1/models`
  - Start/stop/restart, status reporting
  - Convert agent result into OpenAI chat completion JSON

### Main process integration
- `src/main/index.ts`:
  - On app ready, if `remoteServerEnabled`, call `startRemoteServer()` and log result
- `src/main/tipc.ts`:
  - In `saveConfig`, detect if remote server settings changed; start/stop/restart accordingly
  - Add routes: `getRemoteServerStatus`, `regenerateRemoteServerApiKey`

### Request flow
HTTP → API Key check → extract user prompt → `processWithAgentMode(prompt)` → format OpenAI JSON → 200 OK

## Endpoint specs

### POST /v1/chat/completions (non‑streaming)
- Auth: `Authorization: Bearer <API_KEY>` (required)
- Request body (OpenAI schema subset):
  - `messages`?: Array<{ role: string; content: string }>
  - `prompt`?: string
  - `input`?: string | Array
  - `stream`?: boolean (ignored; we always respond non‑streaming)
- Response (OpenAI chat completion):
```
{
  "id": "chatcmpl-<id>",
  "object": "chat.completion",
  "created": 1731620000,
  "model": "<active-model-from-settings>",
  "choices": [
    {
      "index": 0,
      "message": { "role": "assistant", "content": "<finalResponse>" },
      "finish_reason": "stop"
    }
  ]
}
```
- Error codes:
  - 400: invalid JSON or no user prompt provided
  - 401: missing/invalid API key
  - 500: internal error; message sanitized

### GET /v1/models (compatibility)
- Auth required
- Returns a minimal models list with the app’s active model:
```
{
  "object": "list",
  "data": [ { "id": "<active-model>", "object": "model", "owned_by": "system" } ]
}
```

## Config changes
Modify `src/shared/types.ts` (Config):
- `remoteServerEnabled?: boolean`
- `remoteServerPort?: number`
- `remoteServerBindAddress?: "127.0.0.1" | "0.0.0.0"`
- `remoteServerApiKey?: string`
- `remoteServerLogLevel?: "error" | "info" | "debug"`
- `remoteServerCorsOrigins?: string[]` (reserved for later)

Defaults in `src/main/config.ts`:
- `remoteServerEnabled: false`
- `remoteServerPort: 3210`
- `remoteServerBindAddress: "127.0.0.1"`
- `remoteServerLogLevel: "info"`
- `remoteServerApiKey`: not set by default; generate on first enable/start if missing

API key generation:
- On `startRemoteServer()`, if enabled and `remoteServerApiKey` missing, generate `crypto.randomBytes(32).toString("hex")`, persist via `configStore.save`, and proceed.

## Server lifecycle
- `startRemoteServer()`
  - Read config; ensure enabled; ensure API key present (generate if missing)
  - Create Fastify instance with `logger: { level: remoteServerLogLevel }`
  - Register routes; listen on `remoteServerBindAddress:remoteServerPort`
  - Keep internal state: running, address, lastError
- `stopRemoteServer()`
  - Close Fastify instance if running; clear state
- `restartRemoteServer()`
  - `await stop()` then `await start()`
- Port conflict handling (v1):
  - If listen fails with EADDRINUSE, record `lastError` and surface in status; do not auto‑scan ports in v1 (keep behavior deterministic)

## Settings UI (renderer)
- New page: `src/renderer/src/pages/settings-remote-server.tsx`
  - Controls:
    - Enable Remote Server (toggle)
    - Port (number, min 1, max 65535)
    - Bind Address (select: 127.0.0.1, 0.0.0.0)
    - API Key (masked), [Copy], [Regenerate]
    - Status: Running/Stopped; Base URL shown e.g. `http://127.0.0.1:3210/v1`
    - Last Error (if any)
  - Notes/warnings:
    - LAN binding (0.0.0.0) exposes your API key protected endpoint on the network
  - Wiring pattern mirrors existing settings pages using `useConfigQuery` + `useSaveConfigMutation`
- Router & Nav:
  - Add route: `/settings/remote-server`
  - Add nav link: “Remote Server” with suitable icon

## IPC additions (main tipc)
- `getRemoteServerStatus`: returns `{ running: boolean; url?: string; bind: string; port: number; lastError?: string }`
- `regenerateRemoteServerApiKey`: regenerates key, saves config, restarts server (if enabled)
- Enhance `saveConfig`: detect changes to any of `[remoteServerEnabled, port, bind, apiKey, logLevel]` and start/stop/restart accordingly
  - Compare input vs current config before saving to decide action

## Implementation details

### File: `src/main/remote-server.ts` (new)
- Pseudocode outline:
```
let server: FastifyInstance | null = null
let lastError: string | undefined
export async function startRemoteServer() { /* read cfg, ensure apiKey, build fastify, add hooks, register routes, listen */ }
export async function stopRemoteServer() { /* close if running */ }
export async function restartRemoteServer() { await stopRemoteServer(); await startRemoteServer() }
export function getRemoteServerStatus() { /* return running, url, bind, port, lastError */ }
```
- Auth hook:
```
fastify.addHook("onRequest", async (req, reply) => {
  const auth = req.headers["authorization"] || ""
  const token = auth.toString().startsWith("Bearer ") ? auth.slice(7) : ""
  if (!token || token !== config.remoteServerApiKey) return reply.code(401).send({ error: "Unauthorized" })
})
```
- Prompt extraction helper:
```
function extractUserPrompt(body: any): string | null { /* prefer last user message; else prompt/input */ }
```
- Handler:
```
fastify.post("/v1/chat/completions", async (req, reply) => {
  const prompt = extractUserPrompt(req.body)
  if (!prompt) return reply.code(400).send({ error: "Missing user prompt" })
  const text = await processWithAgentMode(prompt, undefined)
  const model = getModel(config.mcpToolsProviderId || "openai", "mcp")
  return toOpenAIChatResponse(text, model)
})
```
- Models endpoint:
```
fastify.get("/v1/models", async () => ({ object: "list", data: [{ id: model, object: "model", owned_by: "system" }] }))
```

### File: `src/main/index.ts`
- Import and call `startRemoteServer()` if enabled after app is ready
- Log via `logApp` and `diagnosticsService`

### File: `src/main/tipc.ts`
- Extend `saveConfig` to manage remote server lifecycle based on diffs
- Add procedures: `getRemoteServerStatus`, `regenerateRemoteServerApiKey`

### File: `src/shared/types.ts`
- Add config fields described above

### File: `src/main/config.ts`
- Add defaults and API key generation on demand within `startRemoteServer()` path

### File: `src/renderer/src/pages/settings-remote-server.tsx`
- Implement form + actions using `useConfigQuery` and `useSaveConfigMutation`
- Add buttons wired to tipc: `regenerateRemoteServerApiKey`, `getRemoteServerStatus`

### File: `src/renderer/src/components/app-layout.tsx` and `src/renderer/src/router.tsx`
- Add nav link and route for the new Settings section

## Error handling
- Map Fastify errors to 500 with `{ error: "Internal Server Error" }` and log the message/stack internally
- 401 for auth failures; 400 for invalid payloads
- EADDRINUSE, EACCES: store `lastError`, expose in status, and render in UI

## Logging/diagnostics
- Category: `remote-server`
- Log start/stop, bind/port, per-request start/end with minimal metadata
- Do not log API key or prompt content unless debug level is set; redact if present

## Testing plan
- Unit tests (Vitest):
  - `extractUserPrompt` cases (messages/prompt/input; malformed)
  - Response shaping `toOpenAIChatResponse`
  - Auth middleware (accepts valid, rejects invalid/missing)
- Integration tests:
  - Spin up Fastify instance with a temp config; call `/v1/chat/completions` with a stubbed `processWithAgentMode` that returns a fixed string; assert JSON shape
  - `/v1/models` returns active model
- Manual verification:
  - curl `-H "Authorization: Bearer <key>"` `http://127.0.0.1:3210/v1/chat/completions` with a minimal body
  - Test invalid key, missing prompt, port in use

## Package management (to be run when implementing)
- pnpm add fastify
- (later) pnpm add @fastify/cors

## Rollout and gating
- Feature defaults to disabled; user must opt‑in in Settings
- MAS builds: plan to disable or hide the feature if store guidelines conflict; can guard by build target

## Acceptance criteria
- With server enabled and API key set, a POST to `/v1/chat/completions` returns a valid OpenAI chat JSON with assistant content produced by the agent workflow
- Client‑provided `model` does not affect provider/model used by the app
- Unauthorized requests are rejected with 401
- Server starts/stops/restarts appropriately on settings changes
- Status and last error visible in the Settings page

## Future phases (not part of Phase 1)
- Streaming SSE for `stream: true`
- Rate limiting and request concurrency caps
- CORS allowlist + LAN mode guidance
- Legacy `/v1/completions`, embeddings
- Health endpoint and richer diagnostics panel

