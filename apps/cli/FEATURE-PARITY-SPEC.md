# CLI Feature Parity Specification

> **Last Updated:** 2026-02-06
>
> **Parent Document:** [`prd.md`](./prd.md) — Comprehensive PRD with all 25 gaps, testing framework, and keybindings
> **Related:** [`../../plan-cli-feature-parity-assessment-2025-02-05.md`](../../plan-cli-feature-parity-assessment-2025-02-05.md) — Gap-by-gap readiness assessment
>
> **Scope:** This is a **settings-focused sub-spec** of the main PRD. It covers CLI settings, provider config, and profile management in detail. For the full gap inventory (G-01–G-25) and MCP testing framework, see the parent PRD.

This document specifies the work required to bring the CLI (`@speakmcp/cli`) to full feature parity with the Electron desktop app's settings and configuration capabilities.

## Current State (Updated 2026-02-06)

### CLI Settings View (Implemented)
The CLI settings view in `apps/cli/src/views/settings.ts` (930 lines) is comprehensive:

| Setting | Type | Status |
|---------|------|--------|
| Model Preset | Select dropdown | ✅ Implemented |
| LLM Provider | Select (OpenAI/Groq/Gemini) | ✅ Implemented |
| Model | Select (per-provider) | ✅ Implemented |
| Max Iterations | Number input | ✅ Implemented |
| API Keys (OpenAI/Groq/Gemini) | Secure input fields | ✅ Implemented |
| Text-to-Speech toggle | Checkbox | ✅ Implemented |
| Require Tool Approval toggle | Checkbox | ✅ Implemented |
| Transcript Post-Processing toggle | Checkbox | ✅ Implemented |
| MCP Server Enable/Disable | Toggle list | ✅ Implemented |

### Other Implemented Features
| Feature | Location | Status |
|---------|----------|--------|
| Tool approval workflow (Y/N/A) | Chat view | ✅ Implemented |
| Agent progress (all 11 step types) | Chat view | ✅ Implemented |
| Profile CRUD (create/edit/delete) | Ctrl+P overlay | ✅ Implemented |
| Profile export/import | Ctrl+P overlay | ✅ Implemented |
| Conversation search | Sessions view (/) | ✅ Implemented |
| Conversation rename | Sessions view (R) | ✅ Implemented |
| Manual tool execution | Tools view (Enter) | ✅ Implemented |
| MCP server management (restart/stop/logs/test) | Tools view | ✅ Implemented |

### Desktop Settings (Full Feature Set)
The desktop app has 10+ settings pages with 50+ configurable options.

---

## Gap Analysis

### Priority 1: Critical Agent Settings (MUST HAVE)

These settings directly affect agent behavior and are essential for CLI users.

| Setting | Desktop Location | Server API | CLI Status |
|---------|-----------------|------------|------------|
| **Require Tool Approval** | `settings-general.tsx` | `PATCH /v1/settings` ✅ | ✅ **Implemented** — toggle in Settings view |
| **Message Queuing** | `settings-general.tsx` | Server likely supports via `PATCH /v1/settings` | ⚠️ **Verify** — add toggle to Settings view if field exists |
| **Verify Task Completion** | `settings-general.tsx` | Server likely supports via `PATCH /v1/settings` | ⚠️ **Verify** — add toggle to Settings view if field exists |
| **Final Summary** | `settings-general.tsx` | Server likely supports via `PATCH /v1/settings` | ⚠️ **Verify** — add toggle to Settings view if field exists |
| **Enable Memory System** | `settings-general.tsx` | Memory service ✅ ported to server | ⚠️ **Verify** — add toggle to Settings view |
| **Inject Memories** | `settings-general.tsx` | Memory service ✅ ported to server | ⚠️ **Verify** — add toggle to Settings view |
| **Enable Summarization** | `settings-general.tsx` | Server likely supports via `PATCH /v1/settings` | ⚠️ **Verify** — add toggle to Settings view |

**Server API Status (Updated 2026-02-06):**
The server now has memory, skills, and other services ported. The `PATCH /v1/settings` endpoint needs verification for these specific fields:
```typescript
// Verify these fields are in GET /v1/settings and PATCH /v1/settings:
{
  mcpMessageQueueEnabled: boolean,        // default: true
  mcpVerifyCompletionEnabled: boolean,    // default: true
  mcpFinalSummaryEnabled: boolean,        // default: true
  memoriesEnabled: boolean,               // default: true
  dualModelInjectMemories: boolean,       // default: false
  dualModelEnabled: boolean,              // default: false
}
```

### Priority 2: Profile Management (SHOULD HAVE)

Profiles allow users to switch between different agent configurations.

| Feature | Server API | CLI Status |
|---------|------------|------------|
| List profiles | `GET /v1/profiles` ✅ | ✅ **Implemented** — Ctrl+P overlay |
| View current profile | `GET /v1/profiles/current` ✅ | ✅ **Implemented** — Status bar |
| Switch profile | `POST /v1/profiles/current` ✅ | ✅ **Implemented** — Ctrl+P → Enter |
| View guidelines | `GET /v1/profiles/current` ✅ | ✅ **Implemented** — in profile view |
| View system prompt | `GET /v1/profiles/current` ✅ | ✅ **Implemented** — in profile view |
| Edit guidelines | `PATCH /v1/profiles/:id` ✅ | ✅ **Implemented** — [E]dit in Ctrl+P |
| Edit system prompt | `PATCH /v1/profiles/:id` ✅ | ✅ **Implemented** — [E]dit in Ctrl+P |
| Create profile | `POST /v1/profiles` ✅ | ✅ **Implemented** — [C]reate in Ctrl+P |
| Delete profile | `DELETE /v1/profiles/:id` ✅ | ✅ **Implemented** — [D]elete in Ctrl+P |
| Export profile | `GET /v1/profiles/:id/export` ✅ | ✅ **Implemented** — [X]port in Ctrl+P |
| Import profile | `POST /v1/profiles/import` ✅ | ✅ **Implemented** — [I]mport in Ctrl+P |

**Server API Status:** ✅ All profile endpoints implemented and working. No changes needed.

### Priority 3: Provider Configuration (SHOULD HAVE)

API keys and base URLs for LLM providers.

| Setting | Server API | CLI Status |
|---------|------------|------------|
| OpenAI API Key | `PATCH /v1/settings` ✅ | ✅ **Implemented** — secure input in Settings |
| OpenAI Base URL | Verify in `PATCH /v1/settings` | ⚠️ **Verify** — may already be in settings schema |
| Groq API Key | `PATCH /v1/settings` ✅ | ✅ **Implemented** — secure input in Settings |
| Groq Base URL | Verify in `PATCH /v1/settings` | ⚠️ **Verify** — may already be in settings schema |
| Gemini API Key | `PATCH /v1/settings` ✅ | ✅ **Implemented** — secure input in Settings |
| Model Presets | `GET /v1/settings` ✅ | ✅ **Implemented** — preset selector in Settings |

**Server API Status:** API keys are implemented. Base URLs need verification in server settings schema. Model presets have dedicated CRUD endpoints (`/v1/model-presets`).

**Security Note:** API keys should be write-only (accept on PATCH, return masked on GET).

### Priority 4: Remote Server Status (NICE TO HAVE)

View server configuration (read-only for CLI since it connects to remote server).

| Setting | Server API | CLI Work Required |
|---------|------------|-------------------|
| Server URL | N/A (CLI knows this) | Display in status bar |
| Server Port | `GET /v1/diagnostics/health` ✅ | Display in status |
| API Key status | N/A | Show connected/authenticated |
| Server version | `GET /v1/diagnostics/health` ✅ | Display in About section |

**Server API Status:** Diagnostics endpoints now exist. Health check likely returns server info.

### Priority 5: Optional Features (NICE TO HAVE)

These features are lower priority but would complete feature parity.

| Feature | Desktop Location | Server Status | Notes |
|---------|-----------------|---------------|-------|
| Skills management | `settings-skills.tsx` | ✅ 5 endpoints + client methods | Needs CLI view |
| Memories view | `memories.tsx` | ✅ 5 endpoints + client methods | Needs CLI view |
| Agent Personas | `settings-agent-personas.tsx` | ✅ ACP endpoints exist | Needs CLI view |
| External Agents | `settings-external-agents.tsx` | ✅ ACP endpoints exist | Needs CLI view |
| Langfuse config | `settings-general.tsx` | Verify in settings schema | May need settings fields |
| Theme selection | `settings-general.tsx` | N/A for TUI | Not applicable to CLI |

---

## Implementation Plan

> **Status Update (2026-02-06):** Phases 1-5 are largely complete. The settings view, profile management,
> API client, and types have all been implemented. Remaining work is listed below.

### Phase 1: Server API Enhancements ✅ MOSTLY COMPLETE

Profile mutation endpoints are implemented. Settings API handles core fields.

**Remaining server work:**
- Add `mcpMessageQueueEnabled`, `mcpVerifyCompletionEnabled`, `mcpFinalSummaryEnabled` to settings
- Add `memoriesEnabled`, `dualModelInjectMemories`, `dualModelEnabled` to settings
- Verify `transcriptPostProcessingEnabled` in PATCH handler

### Phase 2: CLI Types Update ✅ COMPLETE

`apps/cli/src/types.ts` (354 lines) includes comprehensive type definitions for Settings, Profile, and all related types.

### Phase 3: CLI API Client Update ✅ COMPLETE

`apps/cli/src/client.ts` (630 lines) includes all needed methods: `getProfiles()`, `getCurrentProfile()`, `switchProfile()`, `exportProfile()`, `importProfile()`, `createProfile()`, `updateProfile()`, `deleteProfile()`, `renameConversation()`, and more.

### Phase 4: CLI Settings View Enhancement ✅ COMPLETE

`apps/cli/src/views/settings.ts` (930 lines) is fully implemented with:

```
┌─────────────────────────────────────────────────────────────┐
│ ⚙️  Settings                                                │
├─────────────────────────────────────────────────────────────┤
│ ─ Model ─                                                   │
│   Model Preset   ▶ GPT-4o Mini                              │
│   Max Iterations  15                                        │
│                                                             │
│ ─ API Keys ─ (enter key, leave blank to keep current)       │
│   OpenAI Key     [................]                          │
│   Groq Key       [................]                          │
│   Gemini Key     [................]                          │
│                                                             │
│ ─ General Settings ─                                        │
│   [✓] Text-to-Speech                                        │
│   [○] Require Tool Approval                                 │
│   [✓] Transcript Post-Processing                            │
│                                                             │
│ ─ MCP Servers ─ [Space] Toggle                              │
│   [✓] filesystem          12 tools                          │
│   [✓] browser-use          8 tools                          │
├─────────────────────────────────────────────────────────────┤
│ [S] Save  [R] Reset  [Space] Toggle  [Tab] Next  [↑↓] Nav  │
└─────────────────────────────────────────────────────────────┘
```

### Phase 5: Profiles View ✅ COMPLETE

Profile management is implemented as a Ctrl+P overlay in `apps/cli/src/app.ts`:

```
┌─────────────────────────────────────────────────────────────┐
│                    ─ Profiles ─                              │
│                                                             │
│                    ▶ Default                                 │
│                                                             │
│  [Enter] Select [C]reate [E]dit [D]elete [X]port [I]mport  │
└─────────────────────────────────────────────────────────────┘
```

### Phase 6: E2E Tests Update (TODO)

Add tests for new settings in `apps/cli/e2e/critical-path/settings.e2e.ts`:

```typescript
describe('Agent Behavior Settings', () => {
  it('should toggle tool approval setting', async () => { ... })
  it('should toggle message queuing', async () => { ... })
  it('should toggle verify completion', async () => { ... })
  it('should toggle final summary', async () => { ... })
  it('should toggle memory system', async () => { ... })
})

describe('Profile Management', () => {
  it('should list profiles', async () => { ... })
  it('should switch profiles', async () => { ... })
  it('should show current profile in header', async () => { ... })
})
```

---

## Out of Scope (Desktop-Only Features)

These features are intentionally excluded from CLI:

| Feature | Reason |
|---------|--------|
| Voice/STT live capture | CLI has no microphone capture pipeline |
| Keyboard shortcuts config | CLI uses its own key bindings |
| Panel position/dragging | No floating panel in CLI |
| Dock icon/launch at login | Desktop OS integration |
| Streamer mode | No sensitive display in CLI |
| Emergency kill switch hotkey | CLI uses Ctrl+C |

Note: WhatsApp, Cloudflare tunnel, and TTS generation flows are supported in CLI via terminal-equivalent command palette actions.

---

## Success Criteria

| Criterion | Status |
|-----------|--------|
| All Priority 1 settings viewable and editable in CLI | ⚠️ 1/7 fully done (tool approval); 6 need settings field verification (server may already support) |
| Profile switching works from CLI | ✅ Done — Ctrl+P overlay |
| Profile CRUD (create/edit/delete/export/import) | ✅ Done — all in Ctrl+P overlay |
| E2E tests pass for all new settings | 🔲 TODO |
| Server API is backwards compatible | ✅ No breaking changes |
| CLI types match server response types | ✅ Done — 354-line types.ts |
| Server has all needed endpoints | ✅ 65+ endpoints across 19 groups |
| CLI client has all needed methods | ✅ 40+ methods (630 lines) |

---

## Estimated Effort

| Phase | Effort | Status |
|-------|--------|--------|
| Phase 1: Server API | 1-2 days | ✅ Complete — 65+ endpoints, all services ported |
| Phase 2: CLI Types | 0.5 day | ✅ Complete |
| Phase 3: API Client | 0.5 day | ✅ Complete — 40+ methods |
| Phase 4: Settings View | 2-3 days | ✅ Complete — 930 lines |
| Phase 5: Profiles View | 1-2 days | ✅ Complete — Ctrl+P overlay |
| Phase 6: E2E Tests | 1 day | 🔲 TODO |
| Verify settings fields | 0.5 day | ⚠️ Verify message queue, completion, memory toggles |

**Remaining effort: ~1-2 days** (verify settings fields + E2E tests)

---

## Appendix: Desktop Settings Reference

### settings-general.tsx
- App: Hide Dock Icon, Launch at Login, Streamer Mode
- Appearance: Theme
- Shortcuts: Recording, Toggle Voice, Text Input, Show Main Window, Agent Mode
- Speech-to-Text: Language, Post-Processing
- Text-to-Speech: Enabled, Auto-play, Preprocessing options
- Panel Position: Default Position, Enable Dragging, Auto-Show
- WhatsApp: Enable WhatsApp
- Agent Settings: Main Agent Mode, Message Queuing, Tool Approval, Verify Completion, Final Summary, Memory System, Inject Memories, Summarization, Max Iterations, Kill Switch
- Langfuse: Enable, Public Key, Secret Key, Base URL

### settings-providers.tsx
- Provider selection (STT, Transcript, Agent, TTS)
- API Keys (OpenAI, Groq, Gemini)
- Base URLs
- Model selection per provider

### settings-tools.tsx (Agent Profiles)
- Active Profile selector
- Additional Guidelines editor
- Base System Prompt editor
- Create/Import/Export profile

### settings-mcp-tools.tsx
- MCP Server list with status
- Enable/disable servers
- Tool count per server

### settings-remote-server.tsx
- Enable Remote Server
- Port, Bind Address
- API Key
- CORS Origins
- Cloudflare Tunnel

### settings-agent-personas.tsx
- List personas
- Create/Edit/Delete persona
- System prompt per persona

### settings-external-agents.tsx
- List external agents
- Add ACP/Stdio/Remote agents
- Agent presets
- Auto-spawn settings

### settings-skills.tsx
- List skills
- Enable/disable skills
- Create/Edit/Delete skills
- Import from GitHub/SKILL.md

### settings-whatsapp.tsx
- Enable WhatsApp
- QR Code display
- Allowed senders
- Auto-reply settings

### memories.tsx
- View all memories
- Add/Delete memories
- Memory categories/tags
