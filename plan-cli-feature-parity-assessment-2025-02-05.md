# CLI Feature Parity Assessment Plan

**Date:** 2025-02-05
**Branch:** `cli-feature-parity`
**Scope:** Assessment of readiness for all 25 PRD gaps (G-01 through G-25), phases 5-11

---

## 1. Overview

This document assesses the **readiness** of each PRD gap for implementation. It categorizes every gap into one of four readiness states:

| State | Meaning |
|-------|---------|
| 🟢 **READY** | Server API exists; only CLI-side work needed |
| 🟡 **MINOR SERVER WORK** | Service layer exists; needs small endpoint addition or field support |
| 🟠 **SERVER WORK NEEDED** | Service layer exists; needs new HTTP endpoint(s) |
| 🔴 **SIGNIFICANT WORK** | Needs new service layer + endpoints + CLI implementation |
| ⚫ **OUT OF SCOPE** | Desktop-only feature; not feasible in CLI |

### Current API Surface

**Standalone server (`packages/server/src/server.ts`) — 15 endpoints:**

| # | Endpoint | Notes |
|---|----------|-------|
| 1 | `POST /v1/chat/completions` | Streaming + non-streaming |
| 2 | `GET /v1/models` | Returns active model only |
| 3 | `GET /v1/profiles` | List all profiles |
| 4 | `GET /v1/profiles/current` | Get active profile |
| 5 | `POST /v1/profiles/current` | Switch profile |
| 6 | `GET /v1/mcp/servers` | MCP server status |
| 7 | `POST /v1/mcp/servers/:name/toggle` | Enable/disable server |
| 8 | `GET /v1/settings` | Get settings (7 fields) |
| 9 | `PATCH /v1/settings` | Update settings (7 fields) |
| 10 | `GET /v1/conversations` | List conversations |
| 11 | `GET /v1/conversations/:id` | Load conversation |
| 12 | `POST /v1/conversations` | Create conversation |
| 13 | `POST /v1/emergency-stop` | Kill all agents |
| 14 | `POST /mcp/tools/list` | List MCP tools |
| 15 | `POST /mcp/tools/call` | Execute MCP tool |

**CLI client (`apps/cli/src/client.ts`) — 22 methods:**
All 15 server endpoints are covered, plus 7 methods that call endpoints that **don't exist yet** on the standalone server:
- `getModelsForProvider()` → `GET /v1/models/:providerId` ❌
- `exportProfile()` → `GET /v1/profiles/:id/export` ❌
- `importProfile()` → `POST /v1/profiles/import` ❌
- `deleteConversation()` → `DELETE /v1/conversations/:id` ❌
- No `updateConversation()` method exists yet

---

## 2. Gap-by-Gap Readiness Assessment

### Phase 5: Tool Approval & Agent Progress (P0)

#### G-01: Tool Approval Workflow
| Attribute | Value |
|-----------|-------|
| **Priority** | P0 — Critical |
| **Readiness** | 🟠 SERVER WORK NEEDED |
| **Server Status** | `toolApprovalManager` exists in `packages/server/src/services/state.ts` with `requestApproval()`, `respondToApproval()`, `getPendingApproval()`, `cancelSessionApprovals()`, `cancelAllApprovals()`. **No HTTP endpoint** exposes `respondToApproval()`. |
| **CLI Status** | Receives SSE progress events including `tool_approval_required` type, but has no interactive prompt. Agent hangs waiting for approval. |
| **Server Work** | Add `POST /v1/tool-approval` endpoint accepting `{ approvalId, approved }` body → calls `toolApprovalManager.respondToApproval()` |
| **CLI Work** | Detect `tool_approval_required` step in chat view SSE → overlay Y/N/A prompt → POST approval response |
| **Blockers** | Server endpoint must exist before CLI can function |
| **Complexity** | HIGH — Requires SSE event handling + interactive overlay + server endpoint |

#### G-02: Agent Progress Display (Complete)
| Attribute | Value |
|-----------|-------|
| **Priority** | P0 — Critical |
| **Readiness** | 🟢 READY |
| **Server Status** | SSE stream already sends typed progress events with all 11 `AgentProgressStep` types |
| **CLI Status** | Partial — shows iteration count and some progress, but rendering incomplete for all step types |
| **Server Work** | None |
| **CLI Work** | Complete progress rendering in `apps/cli/src/views/chat.ts` for all step types: thinking, running_tool, tool_complete, tool_error, retry, complete, etc. |
| **Blockers** | None |
| **Complexity** | MEDIUM — Pure UI rendering work |

### Phase 6: Settings Completeness (P1)

#### G-04: Settings: API Key Configuration
| Attribute | Value |
|-----------|-------|
| **Priority** | P1 |
| **Readiness** | 🟠 SERVER WORK NEEDED |
| **Server Status** | `GET /v1/settings` does NOT return API key fields. `PATCH /v1/settings` does NOT handle API key fields. Config store has them (e.g., `openaiApiKey`, `groqApiKey`, `geminiApiKey`) but they're not exposed via HTTP. |
| **CLI Status** | Settings view (`apps/cli/src/views/settings.ts`) only shows provider selector, model selector, max iterations, MCP server toggles |
| **Server Work** | Add API key fields to GET/PATCH settings (masked in GET response for security) |
| **CLI Work** | Add per-provider API key input fields in settings view |
| **Blockers** | Server must expose API key fields |
| **Complexity** | MEDIUM — Security consideration for key masking |

#### G-05: Settings: TTS Toggle
| Attribute | Value |
|-----------|-------|
| **Priority** | P1 |
| **Readiness** | 🟢 READY |
| **Server Status** | `GET /v1/settings` returns `ttsEnabled` ✅. `PATCH /v1/settings` handles `ttsEnabled` (boolean) ✅ |
| **CLI Status** | Not shown in settings view |
| **Server Work** | None |
| **CLI Work** | Add toggle in `apps/cli/src/views/settings.ts` |
| **Blockers** | None |
| **Complexity** | LOW |

#### G-06: Settings: Require Tool Approval Toggle
| Attribute | Value |
|-----------|-------|
| **Priority** | P1 |
| **Readiness** | 🟢 READY |
| **Server Status** | `GET /v1/settings` returns `mcpRequireApprovalBeforeToolCall` ✅. `PATCH /v1/settings` handles it ✅ |
| **CLI Status** | Not exposed in CLI settings UI |
| **Server Work** | None |
| **CLI Work** | Add toggle in settings view (prerequisite for G-01 to be useful) |
| **Blockers** | None |
| **Complexity** | LOW |


#### G-07: Settings: Transcript Post-Processing
| Attribute | Value |
|-----------|-------|
| **Priority** | P1 |
| **Readiness** | 🟡 MINOR SERVER WORK |
| **Server Status** | `GET /v1/settings` returns `transcriptPostProcessingEnabled` ✅. `PATCH /v1/settings` does **NOT** handle it ❌ — field is present in GET but silently ignored in PATCH |
| **CLI Status** | Not shown in settings view |
| **Server Work** | Add ~3 lines to PATCH handler in `packages/server/src/server.ts` line ~596: `if (typeof body.transcriptPostProcessingEnabled === "boolean") { updates.transcriptPostProcessingEnabled = body.transcriptPostProcessingEnabled }` |
| **CLI Work** | Add toggle in settings view |
| **Blockers** | Trivial server fix needed |
| **Complexity** | LOW |

#### G-08: Settings: Model Preset Selection
| Attribute | Value |
|-----------|-------|
| **Priority** | P1 |
| **Readiness** | 🟠 SERVER WORK NEEDED |
| **Server Status** | `GET /v1/settings` does NOT return `currentModelPresetId` or `availablePresets[]`. Not in PATCH handler either. Desktop has this in remote-server.ts. |
| **CLI Status** | Not shown in settings view |
| **Server Work** | Add model preset fields to GET/PATCH settings endpoints |
| **CLI Work** | Add preset selector dropdown in settings view |
| **Blockers** | Server must expose preset data |
| **Complexity** | MEDIUM |

#### G-15: Dual Model / Model Preset Config
| Attribute | Value |
|-----------|-------|
| **Priority** | P2 |
| **Readiness** | 🟠 SERVER WORK NEEDED |
| **Server Status** | No model preset configuration support in standalone server |
| **CLI Status** | Only basic provider + model selection |
| **Server Work** | Extend settings with preset CRUD or config, support base URL + API key per preset |
| **CLI Work** | Extend settings view with preset configuration UI |
| **Blockers** | G-08 should be done first as prerequisite |
| **Complexity** | HIGH |

### Phase 7: Conversation & Profile Management (P1)

#### G-03: Conversation Update
| Attribute | Value |
|-----------|-------|
| **Priority** | P1 |
| **Readiness** | 🟠 SERVER WORK NEEDED |
| **Server Status** | `conversationService.saveConversation()` exists ✅. **No `PUT /v1/conversations/:id` endpoint** in standalone server. Desktop's remote-server.ts has it (lines 1022-1146) as reference implementation. |
| **CLI Status** | No `updateConversation()` method in client.ts. No UI for editing conversation title. |
| **Server Work** | Add `PUT /v1/conversations/:id` endpoint (reference desktop implementation) |
| **CLI Work** | Add `updateConversation()` to client.ts + title edit UI (E key) in sessions view |
| **Blockers** | Server endpoint must exist first |
| **Complexity** | MEDIUM |

#### G-09: Profile Export/Import UI
| Attribute | Value |
|-----------|-------|
| **Priority** | P1 |
| **Readiness** | 🟠 SERVER WORK NEEDED |
| **Server Status** | `profileService.exportProfile()` ✅ and `profileService.importProfile()` ✅ exist in service layer. **No HTTP endpoints**: `GET /v1/profiles/:id/export` and `POST /v1/profiles/import` are NOT registered. Desktop's remote-server.ts has both. |
| **CLI Status** | Client methods `exportProfile()` and `importProfile()` exist in client.ts but call endpoints that don't exist yet on standalone server |
| **Server Work** | Add `GET /v1/profiles/:id/export` and `POST /v1/profiles/import` endpoints |
| **CLI Work** | Add E/I keybindings in profile switcher popup |
| **Blockers** | Server endpoints needed |
| **Complexity** | MEDIUM |

#### G-10: Profile Management (Create/Edit/Delete)
| Attribute | Value |
|-----------|-------|
| **Priority** | P1 |
| **Readiness** | 🟠 SERVER WORK NEEDED |
| **Server Status** | `profileService.createProfile()` ✅, `updateProfile()` ✅, `deleteProfile()` ✅ all exist in service layer. **No HTTP endpoints** for CRUD (only GET list, GET current, POST switch exist). |
| **CLI Status** | Only `switchProfile()` works via Ctrl+P |
| **Server Work** | Add `POST /v1/profiles` (create), `PATCH /v1/profiles/:id` (update), `DELETE /v1/profiles/:id` (delete) endpoints |
| **CLI Work** | Add C (create), E (edit), X (delete) keybindings in profile switcher |
| **Blockers** | Server endpoints needed |
| **Complexity** | HIGH — Multiple new endpoints + full CRUD UI |

### Phase 8: MCP & Tools Enhancement (P1-P2)

#### G-11: Manual MCP Tool Execution
| Attribute | Value |
|-----------|-------|
| **Priority** | P1 |
| **Readiness** | 🟢 READY |
| **Server Status** | `POST /mcp/tools/call` exists ✅. CLI client `callMcpTool()` method exists ✅. |
| **CLI Status** | Tools view is read-only — can browse tools but cannot execute them |
| **Server Work** | None |
| **CLI Work** | Add Enter key → input form for tool arguments → display results |
| **Blockers** | None |
| **Complexity** | MEDIUM — Needs dynamic form generation based on tool inputSchema |

#### G-14: Conversation Search
| Attribute | Value |
|-----------|-------|
| **Priority** | P2 |
| **Readiness** | 🟢 READY |
| **Server Status** | `GET /v1/conversations` returns all conversations ✅. Client-side filtering is sufficient. |
| **CLI Status** | Sessions view has `/` shortcut but search is placeholder only |
| **Server Work** | None |
| **CLI Work** | Implement title filtering on the conversation list in sessions view |
| **Blockers** | None |
| **Complexity** | LOW-MEDIUM |

#### G-17: MCP Server Detailed Management
| Attribute | Value |
|-----------|-------|
| **Priority** | P2 |
| **Readiness** | 🟠 SERVER WORK NEEDED |
| **Server Status** | MCPService has `getServerLogs()` ✅, `clearServerLogs()` ✅, `testServerConnection()` ✅. **Missing**: `restartServer()` ❌ and `stopServer()` ❌ (only in desktop's mcp-service.ts). No HTTP endpoints for any of these. |
| **CLI Status** | Only toggle enable/disable |
| **Server Work** | 1) Port `restartServer()` and `stopServer()` to standalone MCPService 2) Add HTTP endpoints for restart, stop, logs, clear logs, test |
| **CLI Work** | Add R (restart), S (stop), L (logs), T (test) keybindings |
| **Blockers** | Server methods + endpoints needed |
| **Complexity** | HIGH |

### Phase 9: Memory & Skills (P2)

#### G-12: Memory Management
| Attribute | Value |
|-----------|-------|
| **Priority** | P2 |
| **Readiness** | 🔴 SIGNIFICANT WORK |
| **Server Status** | **No memory service** in standalone server (`packages/server/`). Memory service only exists in desktop (`apps/desktop/src/main/memory-service.ts`). No HTTP endpoints. |
| **CLI Status** | No dedicated view, no client methods |
| **Server Work** | 1) Port `MemoryService` from desktop to standalone server 2) Add HTTP endpoints: `GET /v1/memories`, `POST /v1/memories`, `PATCH /v1/memories/:id`, `DELETE /v1/memories/:id`, `GET /v1/memories/search?q=...` |
| **CLI Work** | Add memory client methods + memory management view (list, search, create, edit, delete) |
| **Blockers** | Entire service + endpoints must be ported |
| **Complexity** | HIGH |

#### G-13: Skills Management
| Attribute | Value |
|-----------|-------|
| **Priority** | P2 |
| **Readiness** | 🔴 SIGNIFICANT WORK |
| **Server Status** | **No skills service** in standalone server. Skills service only exists in desktop (`apps/desktop/src/main/skills-service.ts`). No HTTP endpoints. |
| **CLI Status** | No dedicated view, no client methods |
| **Server Work** | 1) Port `SkillsService` from desktop to standalone server 2) Add HTTP endpoints: `GET /v1/skills`, `POST /v1/skills`, `PATCH /v1/skills/:id`, `DELETE /v1/skills/:id`, `POST /v1/skills/:id/toggle` |
| **CLI Work** | Add skills client methods + skills management view (list, create, edit, delete, toggle, import) |
| **Blockers** | Entire service + endpoints must be ported |
| **Complexity** | HIGH |

### Phase 10: Diagnostics & Advanced (P2-P3)

#### G-16: Diagnostics View
| Attribute | Value |
|-----------|-------|
| **Priority** | P2 |
| **Readiness** | 🟠 SERVER WORK NEEDED |
| **Server Status** | `diagnosticsService` exists with `generateDiagnosticReport()` ✅, `performHealthCheck()` ✅, `getRecentErrors()` ✅, `clearErrorLog()` ✅. **No HTTP endpoints** expose these. |
| **CLI Status** | No diagnostics view or client methods |
| **Server Work** | Add endpoints: `GET /v1/diagnostics/report`, `GET /v1/diagnostics/health`, `GET /v1/diagnostics/errors`, `POST /v1/diagnostics/errors/clear` |
| **CLI Work** | Add diagnostics client methods + diagnostics view or `--diagnostics` command flag |
| **Blockers** | Server endpoints needed (service is ready) |
| **Complexity** | MEDIUM |

#### G-18: Message Queue Management
| Attribute | Value |
|-----------|-------|
| **Priority** | P3 |
| **Readiness** | 🔴 SIGNIFICANT WORK |
| **Server Status** | No message queue management in standalone server. Desktop has complex IPC-based queue management. Mobile has its own queue store. |
| **CLI Status** | Not implemented |
| **Server Work** | Design + implement message queue service + HTTP endpoints |
| **CLI Work** | Queue display in chat view |
| **Blockers** | Service design needed |
| **Complexity** | HIGH |

#### G-22: OAuth Flow
| Attribute | Value |
|-----------|-------|
| **Priority** | P3 |
| **Readiness** | 🟠 SERVER WORK NEEDED |
| **Server Status** | MCPService has `OAuthStorage` class and OAuth flow support for MCP server connections. No HTTP endpoints to initiate/complete OAuth from external clients. |
| **CLI Status** | Not implemented |
| **Server Work** | Add endpoints: `POST /v1/oauth/initiate`, `POST /v1/oauth/callback` |
| **CLI Work** | CLI would need to open browser for OAuth redirect, listen for callback |
| **Blockers** | Complex interaction pattern for TUI |
| **Complexity** | VERY HIGH |

#### G-23: MCP Protocol Extensions (Elicitation/Sampling)
| Attribute | Value |
|-----------|-------|
| **Priority** | P3 |
| **Readiness** | 🟠 SERVER WORK NEEDED |
| **Server Status** | Has placeholder implementations in mcp-service.ts: `requestSampling()` rejects all requests, `requestElicitation()` likely similar. No HTTP endpoints for user interaction. |
| **CLI Status** | Not implemented |
| **Server Work** | Implement proper elicitation/sampling handlers with HTTP endpoints for user prompts |
| **CLI Work** | Add interactive prompts for elicitation/sampling requests in chat view |
| **Blockers** | Server-side design needed |
| **Complexity** | HIGH |

### Phase 11: ACP & Networking (P3)

#### G-19: ACP Agent Delegation
| Attribute | Value |
|-----------|-------|
| **Priority** | P3 |
| **Readiness** | 🔴 SIGNIFICANT WORK |
| **Server Status** | No ACP support in standalone server. Desktop has `spawnAcpAgent()`, `runAcpTask()`, `getAcpAgentStatuses()` via IPC. |
| **CLI Status** | Not implemented |
| **Server Work** | Port ACP agent service + add HTTP endpoints |
| **CLI Work** | ACP agent view + client methods |
| **Blockers** | Entire service must be ported |
| **Complexity** | VERY HIGH |

#### G-20: Cloudflare Tunnel
| Attribute | Value |
|-----------|-------|
| **Priority** | P3 |
| **Readiness** | ⚫ OUT OF SCOPE |
| **Server Status** | Desktop-only (`apps/desktop/src/main/cloudflare-tunnel.ts`). Relies on local `cloudflared` binary and Electron IPC. No HTTP endpoints. |
| **CLI Status** | Not implemented |
| **Rationale** | Cloudflare tunnel management is inherently a desktop feature. The CLI connects TO a server — it doesn't need to expose the server via tunnel. |
| **Complexity** | N/A |

#### G-21: WhatsApp Integration
| Attribute | Value |
|-----------|-------|
| **Priority** | P3 |
| **Readiness** | ⚫ OUT OF SCOPE |
| **Server Status** | Desktop handles WhatsApp toggle via IPC, manages MCP WhatsApp server. Standalone server's `handleWhatsAppToggle()` is a stub that logs only. |
| **CLI Status** | Not in scope for TUI |
| **Rationale** | Requires QR code scanning UI, real-time phone pairing — fundamentally a graphical feature |
| **Complexity** | N/A |

#### G-24: Agent Sessions (Multi-Session)
| Attribute | Value |
|-----------|-------|
| **Priority** | P3 |
| **Readiness** | 🔴 SIGNIFICANT WORK |
| **Server Status** | `agentSessionStateManager` exists in `packages/server/src/services/state.ts` for tracking session state. No HTTP endpoints for multi-session management. |
| **CLI Status** | Single session only |
| **Server Work** | Multi-session HTTP endpoints + session management |
| **CLI Work** | Session switching UI, snooze/unsnooze |
| **Blockers** | Fundamental UX question: does multi-session make sense in a TUI? |
| **Complexity** | VERY HIGH |

#### G-25: Text-to-Speech
| Attribute | Value |
|-----------|-------|
| **Priority** | P3 |
| **Readiness** | ⚫ OUT OF SCOPE |
| **Rationale** | TUI has no audio output capability. Desktop-only by definition. |
| **Complexity** | N/A |

---

## 3. Phase-by-Phase Readiness Summary

| Phase | Gaps | 🟢 Ready | 🟡 Minor | 🟠 Server Work | 🔴 Significant | ⚫ OOS | Ready % |
|-------|------|----------|----------|----------------|----------------|--------|---------|
| **5: Tool Approval & Agent Progress** | G-01, G-02 | 1 | 0 | 1 | 0 | 0 | **50%** |
| **6: Settings Completeness** | G-04, G-05, G-06, G-07, G-08, G-15 | 2 | 1 | 3 | 0 | 0 | **33%** |
| **7: Conversation & Profile Mgmt** | G-03, G-09, G-10 | 0 | 0 | 3 | 0 | 0 | **0%** |
| **8: MCP & Tools Enhancement** | G-11, G-14, G-17 | 2 | 0 | 1 | 0 | 0 | **67%** |
| **9: Memory & Skills** | G-12, G-13 | 0 | 0 | 0 | 2 | 0 | **0%** |
| **10: Diagnostics & Advanced** | G-16, G-18, G-22, G-23 | 0 | 0 | 3 | 1 | 0 | **0%** |
| **11: ACP & Networking** | G-19, G-20, G-21, G-24, G-25 | 0 | 0 | 0 | 2 | 3 | **0%** |
| **TOTALS** | **25 gaps** | **5** | **1** | **11** | **5** | **3** | **20%** |

**Key Takeaways:**
- **Phase 8 is most ready** (67%) — 2 of 3 gaps need zero server work
- **Phase 5 is half ready** — G-02 can start now, G-01 needs one server endpoint
- **Phase 6 has easy wins** — G-05, G-06 are trivially ready; G-07 needs a 3-line server fix
- **Phase 7 is 100% blocked on server endpoints** — but all service-layer code exists
- **Phases 9-11 are the hardest** — require new services to be ported from desktop

---

## 4. Server API Gaps — Missing Endpoints

### Priority 1: Endpoints where service layer already exists (copy from desktop's remote-server.ts)

| # | Endpoint | Service Method | Reference | Needed By |
|---|----------|---------------|-----------|-----------|
| 1 | `DELETE /v1/conversations/:id` | `conversationService.deleteConversation(id)` | remote-server.ts (not shown but trivial) | **BUG FIX** — CLI already calls this |
| 2 | `PUT /v1/conversations/:id` | `conversationService.saveConversation(...)` | remote-server.ts lines 1022-1146 | G-03 |
| 3 | `POST /v1/profiles` | `profileService.createProfile(...)` | remote-server.ts | G-10 |
| 4 | `PATCH /v1/profiles/:id` | `profileService.updateProfile(...)` | remote-server.ts | G-10 |
| 5 | `DELETE /v1/profiles/:id` | `profileService.deleteProfile(id)` | remote-server.ts | G-10 |
| 6 | `GET /v1/profiles/:id/export` | `profileService.exportProfile(id)` | remote-server.ts lines 625-640 | G-09 |
| 7 | `POST /v1/profiles/import` | `profileService.importProfile(data)` | remote-server.ts lines 642-665 | G-09 |
| 8 | `GET /v1/models/:providerId` | Model listing per provider | remote-server.ts lines 525-551 | G-04 |
| 9 | `POST /v1/tool-approval` | `toolApprovalManager.respondToApproval(id, approved)` | state.ts lines 339-347 | G-01 |
| 10 | `GET /v1/diagnostics/report` | `diagnosticsService.generateDiagnosticReport()` | diagnostics.ts line 118 | G-16 |
| 11 | `GET /v1/diagnostics/health` | `diagnosticsService.performHealthCheck()` | diagnostics.ts line 184 | G-16 |
| 12 | `GET /v1/diagnostics/errors` | `diagnosticsService.getRecentErrors()` | diagnostics.ts line 176 | G-16 |
| 13 | `POST /v1/diagnostics/errors/clear` | `diagnosticsService.clearErrorLog()` | diagnostics.ts line 180 | G-16 |

### Priority 2: Endpoints needing service-layer changes

| # | Endpoint | Work Needed | Needed By |
|---|----------|-------------|-----------|
| 14 | `POST /v1/mcp/servers/:name/restart` | Port `restartServer()` from desktop mcp-service.ts | G-17 |
| 15 | `POST /v1/mcp/servers/:name/stop` | Port `stopServer()` from desktop mcp-service.ts | G-17 |
| 16 | `GET /v1/mcp/servers/:name/logs` | `mcpService.getServerLogs()` exists, needs HTTP wrapper | G-17 |
| 17 | `POST /v1/mcp/servers/:name/logs/clear` | `mcpService.clearServerLogs()` exists, needs HTTP wrapper | G-17 |
| 18 | `POST /v1/mcp/servers/:name/test` | `mcpService.testServerConnection()` exists, needs HTTP wrapper | G-17 |

### Priority 3: Endpoints needing PATCH /v1/settings extensions

| # | Field | Current State | Work |
|---|-------|---------------|------|
| 19 | `transcriptPostProcessingEnabled` | In GET but NOT in PATCH handler | Add 3 lines to PATCH handler |
| 20 | `whatsappEnabled` | ⚫ Out of scope | N/A |
| 21 | API key fields (`openaiApiKey`, etc.) | Not in GET or PATCH | Add to both (masked in GET) |
| 22 | Model preset fields | Not in GET or PATCH | Design + add to both |

### Priority 4: Entirely new services needed

| # | Service | Source | Needed By |
|---|---------|--------|-----------|
| 23 | Memory Service | `apps/desktop/src/main/memory-service.ts` | G-12 |
| 24 | Skills Service | `apps/desktop/src/main/skills-service.ts` | G-13 |
| 25 | ACP Agent Service | Desktop IPC handlers | G-19 |
| 26 | Message Queue Service | Desktop IPC + mobile store | G-18 |

---

## 5. Recommended Implementation Order

### Tier 1: Immediate — Zero Blockers (CLI-only work)

| Order | Gap | Description | Complexity | Impact |
|-------|-----|-------------|------------|--------|
| 1 | **G-02** | Agent Progress Display | MEDIUM | P0 — Critical for usability |
| 2 | **G-06** | Settings: Require Tool Approval Toggle | LOW | Prerequisite for G-01 |
| 3 | **G-05** | Settings: TTS Toggle | LOW | Easy settings parity win |
| 4 | **G-14** | Conversation Search | LOW-MEDIUM | Quality-of-life improvement |
| 5 | **G-11** | Manual MCP Tool Execution | MEDIUM | Power user feature |

### Tier 2: Trivial Server Fix First, Then CLI Work

| Order | Gap | Description | Server Work | CLI Work |
|-------|-----|-------------|-------------|----------|
| 6 | **G-07** | Settings: Transcript Post-Processing | 3-line PATCH fix | Toggle in settings |

### Tier 3: Server Endpoint Batch — Service Layer Ready

These gaps share a pattern: the service layer exists, endpoints just need to be registered in `packages/server/src/server.ts`. Can be batched as a single "server endpoint parity" PR.

| Order | Gap | Description | Endpoints to Add |
|-------|-----|-------------|-----------------|
| 7 | **BUG** | DELETE /v1/conversations/:id | 1 endpoint |
| 8 | **G-03** | Conversation Update | PUT /v1/conversations/:id |
| 9 | **G-09** | Profile Export/Import | GET export + POST import |
| 10 | **G-10** | Profile CRUD | POST + PATCH + DELETE profiles |
| 11 | **G-01** | Tool Approval Workflow | POST /v1/tool-approval |
| 12 | **G-04** | API Key Configuration | GET /v1/models/:providerId + settings fields |
| 13 | **G-16** | Diagnostics View | 4 diagnostics endpoints |

### Tier 4: Server + Service Layer Work

| Order | Gap | Description | Notes |
|-------|-----|-------------|-------|
| 14 | **G-08** | Model Preset Selection | Requires settings schema extension |
| 15 | **G-15** | Dual Model / Model Preset Config | Depends on G-08 |
| 16 | **G-17** | MCP Server Detailed Management | Port restart/stop methods + 5 endpoints |

### Tier 5: Major Service Porting

| Order | Gap | Description | Notes |
|-------|-----|-------------|-------|
| 17 | **G-12** | Memory Management | Port entire MemoryService |
| 18 | **G-13** | Skills Management | Port entire SkillsService |

### Tier 6: Advanced / Speculative

| Order | Gap | Description | Notes |
|-------|-----|-------------|-------|
| 19 | **G-22** | OAuth Flow | Complex browser-based interaction |
| 20 | **G-23** | MCP Protocol Extensions | Server-side design needed |
| 21 | **G-18** | Message Queue Management | Needs architecture design |
| 22 | **G-24** | Agent Sessions (Multi-Session) | UX feasibility question |
| 23 | **G-19** | ACP Agent Delegation | Port entire ACP system |

### Out of Scope (No Action)

| Gap | Description | Reason |
|-----|-------------|--------|
| **G-20** | Cloudflare Tunnel | Desktop-only networking feature |
| **G-21** | WhatsApp Integration | Requires graphical UI for QR pairing |
| **G-25** | Text-to-Speech | No audio output in TUI |

---

## 6. Immediate Action Items

### 🚨 Bug Fix: DELETE /v1/conversations/:id

**The CLI client already calls `DELETE /v1/conversations/:id`** (in `client.ts` line ~270, used by sessions view line ~247), but this endpoint **does not exist** on the standalone server. This means conversation deletion silently fails.

**Fix:** Add ~10 lines to `packages/server/src/server.ts`:
```typescript
fastify.delete("/v1/conversations/:id", async (request, reply) => {
  const { id } = request.params as { id: string }
  const deleted = conversationService.deleteConversation(id)
  if (deleted) {
    reply.send({ success: true })
  } else {
    reply.code(404).send({ error: "Conversation not found" })
  }
})
```

### ✅ Start Now: 5 Zero-Blocker Gaps

These can begin immediately with no server changes:

1. **G-02** — Complete agent progress rendering in `apps/cli/src/views/chat.ts`
2. **G-06** — Add `mcpRequireApprovalBeforeToolCall` toggle in `apps/cli/src/views/settings.ts`
3. **G-05** — Add `ttsEnabled` toggle in `apps/cli/src/views/settings.ts`
4. **G-14** — Implement search filtering in `apps/cli/src/views/sessions.ts`
5. **G-11** — Add tool execution UI in `apps/cli/src/views/tools.ts`

### 🔧 Quick Win: G-07 Server Fix

Add `transcriptPostProcessingEnabled` support to PATCH handler in `packages/server/src/server.ts` (~line 596). This is a 3-line change.

### 📋 Next Server PR: Endpoint Parity Batch

Bundle these as a single PR to `packages/server/src/server.ts` (all have service-layer support already):
- `DELETE /v1/conversations/:id` (bug fix)
- `PUT /v1/conversations/:id` (G-03)
- `POST /v1/profiles`, `PATCH /v1/profiles/:id`, `DELETE /v1/profiles/:id` (G-10)
- `GET /v1/profiles/:id/export`, `POST /v1/profiles/import` (G-09)
- `POST /v1/tool-approval` (G-01)
- `GET /v1/models/:providerId` (G-04)
- 4 diagnostics endpoints (G-16)

**Estimated total: ~150-200 lines of new endpoint code**, all following patterns already established in the file.

---

## 7. Estimated Effort

| Tier | Gaps | Estimated Effort | Complexity |
|------|------|-----------------|------------|
| Tier 1 (CLI-only) | G-02, G-05, G-06, G-11, G-14 | 2-3 days | LOW-MEDIUM |
| Tier 2 (Trivial fix) | G-07 | 0.5 hours | LOW |
| Tier 3 (Server endpoints) | BUG, G-01, G-03, G-04, G-09, G-10, G-16 | 3-5 days | MEDIUM |
| Tier 4 (Server + service) | G-08, G-15, G-17 | 3-5 days | HIGH |
| Tier 5 (Service porting) | G-12, G-13 | 5-7 days | HIGH |
| Tier 6 (Advanced) | G-18, G-19, G-22, G-23, G-24 | 10+ days | VERY HIGH |
| Out of Scope | G-20, G-21, G-25 | N/A | N/A |

**Total actionable gaps:** 22 (excluding 3 out-of-scope)
**Estimated total effort:** 4-6 weeks for full parity across Tiers 1-5