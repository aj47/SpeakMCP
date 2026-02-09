# SpeakMCP CLI — Feature Parity PRD

> **Last Updated:** 2026-02-06 | **Status:** 84% complete (12 done, 9 partial, 1 TODO, 3 OOS)
>
> **Related Documents:**
> - [`FEATURE-PARITY-SPEC.md`](./FEATURE-PARITY-SPEC.md) — Settings-focused sub-spec with desktop settings reference
> - [`../../plan-cli-feature-parity-assessment-2025-02-05.md`](../../plan-cli-feature-parity-assessment-2025-02-05.md) — Gap-by-gap readiness assessment with per-gap server/client status details

## 1. Executive Summary

The SpeakMCP CLI (`apps/cli/`) is a terminal user interface (TUI) client that must achieve **1:1 feature parity** with the Electron desktop app (`apps/desktop/`). Both clients consume the same `@speakmcp/server` HTTP API. The standalone server now exposes **65+ HTTP endpoints** and the Electron app has 150+ IPC handlers — the CLI must surface every user-facing feature accessible through those APIs.

This PRD serves as:
1. An **exhaustive gap inventory** between CLI and Electron
2. A **prioritized implementation plan** to close every gap
3. A **testing framework specification** using `electron-mcp-server` + `iterm-mcp` as an automated parity verification loop

### Success Criteria

- Every feature testable via the Electron UI has a CLI equivalent
- An AI agent using `electron-mcp` + `iterm-mcp` can execute the same workflow in both clients and get equivalent results
- Zero P0/P1 gaps remain

## 2. Technical Context

| Component | Technology |
|-----------|------------|
| Framework | OpenTUI (`@opentui/core` ^0.1.74) |
| Runtime | Bun (required — Node.js/tsx won't work due to OpenTUI tree-sitter deps) |
| Language | TypeScript |
| Backend | `@speakmcp/server` (Fastify HTTP API) — embedded or external |
| Package Location | `apps/cli/` |
| Binary Name | `speakmcp` |

## 3. Architecture

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

### External Mode (connect to running server)

```
┌─────────────────┐     HTTP/SSE      ┌──────────────────┐
│   speakmcp CLI  │ ◄───────────────► │ @speakmcp/server │
│   (OpenTUI)     │                   │   (separate)     │
└─────────────────┘                   └──────────────────┘
```

### Configuration Priority

1. CLI flags (`--url`, `--api-key`, etc.)
2. Environment variables (`SPEAKMCP_URL`, `SPEAKMCP_API_KEY`)
3. Config file (`~/.speakmcp/cli-config.json`)
4. Auto-discovery (probe ports: 3210, 3211, 3212, 8080)
5. Embedded server (start one automatically if nothing found)

---

## 4. Exhaustive Feature Parity Audit

This section compares **every** user-facing feature in the Electron app against the CLI. The standalone server now has **65+ HTTP endpoints**. CLI client has matching methods for all of them.

### 4.1 Server API Endpoint Parity

#### Core Endpoints (all at parity)

| # | Endpoint Group | CLI Client | CLI UI | Status |
|---|----------------|------------|--------|--------|
| 1 | Chat (`POST /v1/chat/completions` stream + non-stream) | ✅ `chat()` / `chatStream()` | ✅ Chat view | ✅ Parity |
| 2 | Models (`GET /v1/models`, `/v1/models/:providerId`) | ✅ `getModels()` / `getModelsForProvider()` | ✅ Settings view | ✅ Parity |
| 3 | Profiles (CRUD, switch, export, import — 8 endpoints) | ✅ All methods | ✅ Ctrl+P overlay | ✅ Parity |
| 4 | Settings (`GET/PATCH /v1/settings`) | ✅ `getSettings()` / `patchSettings()` | ✅ Settings view | ✅ Parity |
| 5 | MCP Servers (toggle, restart, stop, logs, test — 7 endpoints) | ✅ All methods | ✅ Settings + Tools views | ✅ Parity |
| 6 | Conversations (list, get, create — 3 endpoints) | ✅ All methods | ✅ Sessions + Chat views | ✅ Parity |
| 7 | Conversation rename | ✅ `renameConversation()` | ✅ [R] in Sessions | ⚠️ Partial (rename only) |
| 8 | Tool Approval (`POST /v1/tool-approval`) | ✅ via streaming | ✅ Y/N/A prompt | ✅ Parity |
| 9 | Emergency Stop (`POST /v1/emergency-stop`) | ✅ `emergencyStop()` | ✅ Ctrl+C | ✅ Parity |
| 10 | MCP Tools (list + call — 2 endpoints) | ✅ `listMcpTools()` / `callMcpTool()` | ✅ Tools view | ✅ Parity |
| 11 | Model Presets (CRUD — 4 endpoints) | ✅ `getModelPresets()` etc. | ✅ Settings view | ✅ Parity |

#### Partial Endpoints (server + client done, need CLI views)

| # | Endpoint Group | CLI Client | CLI UI | Status |
|---|----------------|------------|--------|--------|
| 12 | Diagnostics (4 endpoints) | ✅ Client methods | ❌ No view | ⚠️ Needs CLI view |
| 13 | Memories (5 endpoints) | ✅ Client methods | ❌ No view | ⚠️ Needs CLI view |
| 14 | Skills (5 endpoints) | ✅ Client methods | ❌ No view | ⚠️ Needs CLI view |
| 15 | Message Queue (4 endpoints) | ✅ Client methods | ❌ No view | ⚠️ Needs CLI view |
| 16 | OAuth (2 endpoints) | ✅ Client methods | ❌ No flow | ⚠️ Needs CLI flow |
| 17 | Elicitation/Sampling (4 endpoints) | ✅ Client methods | ❌ No prompts | ⚠️ Needs CLI prompts |
| 18 | Agent Sessions (4 endpoints) | ✅ Client methods | ❌ No view | ⚠️ Needs CLI view |
| 19 | ACP Agents (6 endpoints) | ✅ Client methods | ❌ No view | ⚠️ Needs CLI view |

**Summary**: 11/19 groups at full parity, 8 groups have server+client but need CLI views.

### 4.2 Feature-Level Gap Inventory

Each gap below is tagged with a priority:
- **P0** — Core functionality; blocks basic usage patterns
- **P1** — Important functionality; users will notice absence
- **P2** — Secondary functionality; enhances experience
- **P3** — Advanced/niche; nice-to-have

#### P0 — Critical Gaps

| ID | Feature | Electron Behavior | CLI Current State | Status |
|----|---------|-------------------|-------------------|--------|
| G-01 | **Tool approval workflow** | SSE stream sends `tool_approval_required` progress events; UI shows approve/deny buttons | ✅ Chat view detects `tool_approval_required` step → shows tool name + args → Y/N/A prompt → sends approval response | ✅ **DONE** |
| G-02 | **Agent progress display (complete)** | Rich progress panel showing each step: 💭 thinking, ▶ running tool, ✓ complete, ❌ error, 🔄 retry, with tool names and durations | ✅ All 11 `AgentProgressStep` types rendered with appropriate icons and formatting in `chat.ts` | ✅ **DONE** |

#### P1 — Important Gaps

| ID | Feature | Electron Behavior | CLI Current State | Status |
|----|---------|-------------------|-------------------|--------|
| G-03 | **Conversation update** | `PUT /v1/conversations/:id` — update title, add messages | ✅ `renameConversation()` client method + [R] Rename keybinding in Sessions view | ⚠️ **PARTIAL** — rename only, no full conversation update |
| G-04 | **Settings: API key configuration** | Settings page has fields per provider for API keys and base URLs | ✅ API key input fields for OpenAI, Groq, Gemini displayed in Settings view | ✅ **DONE** |
| G-05 | **Settings: TTS toggle** | `ttsEnabled` toggle in settings | ✅ `[✓] Text-to-Speech` toggle in Settings view | ✅ **DONE** |
| G-06 | **Settings: Require tool approval toggle** | `mcpRequireApprovalBeforeToolCall` toggle | ✅ `[○] Require Tool Approval` toggle in Settings view | ✅ **DONE** |
| G-07 | **Settings: Transcript post-processing** | `transcriptPostProcessingEnabled` toggle | ✅ `[✓] Transcript Post-Processing` toggle in Settings view | ✅ **DONE** |
| G-08 | **Settings: Model preset selection** | `currentModelPresetId` + `availablePresets[]` dropdown | ✅ Model preset selector implemented in Settings view header | ✅ **DONE** |
| G-09 | **Profile export/import UI** | Export button saves JSON, Import button loads JSON | ✅ [X]port and [I]mport keybindings in profile switcher (Ctrl+P) with full implementation | ✅ **DONE** |
| G-10 | **Profile management (create/edit/delete)** | Full CRUD via IPC: `createProfile()`, `updateProfile()`, `deleteProfile()` | ✅ [C]reate, [E]dit, [D]elete keybindings in profile switcher (Ctrl+P) with full CRUD | ✅ **DONE** |
| G-11 | **Manual MCP tool execution** | Can call tools directly from tool browser | ✅ [Enter] Execute in Tools view with JSON argument input + result display | ✅ **DONE** |

#### P2 — Secondary Gaps

| ID | Feature | Electron Behavior | CLI Current State | Status |
|----|---------|-------------------|-------------------|--------|
| G-12 | **Memory management** | Full CRUD: `getAllMemories()`, `saveMemoryFromSummary()`, `updateMemory()`, `deleteMemory()`, `searchMemories()` | Server endpoints ✅, client methods ✅, **no CLI view** | ⚠️ **PARTIAL** — needs CLI view only |
| G-13 | **Skills management** | Full CRUD: `getSkills()`, `createSkill()`, `updateSkill()`, `deleteSkill()`, `toggleSkill()`, import | Server endpoints ✅, client methods ✅, **no CLI view** | ⚠️ **PARTIAL** — needs CLI view only |
| G-14 | **Conversation search** | Full text search across conversations | ✅ Sessions view `/` shortcut with client-side title filtering implemented | ✅ **DONE** |
| G-15 | **Dual model / model preset config** | Separate model settings for different providers, custom presets with base URL + API key | Only basic provider + model selection | 🔲 **TODO** — needs extended settings UI |
| G-16 | **Diagnostics view** | `getDiagnosticReport()`, `performHealthCheck()`, `getRecentErrors()` | Server endpoints ✅, client methods ✅, **no CLI view** | ⚠️ **PARTIAL** — needs CLI view only |
| G-17 | **MCP server detailed management** | Restart server, stop server, view logs, clear logs, test connection | ✅ [R]estart, [S]top, [L]ogs, [T]est keybindings in Tools view with full implementation | ✅ **DONE** |

#### P3 — Advanced / Niche Gaps

| ID | Feature | Electron Behavior | CLI Current State | Status |
|----|---------|-------------------|-------------------|--------|
| G-18 | **Message queue management** | `getMessageQueue()`, `clearMessageQueue()`, `reorderMessageQueue()`, pause/resume | Server endpoints ✅, client methods ✅, no CLI view | ⚠️ **PARTIAL** — needs CLI view |
| G-19 | **ACP agent delegation** | `spawnAcpAgent()`, `runAcpTask()`, `getAcpAgentStatuses()` | Server endpoints ✅, client methods ✅, no CLI view | ⚠️ **PARTIAL** — needs CLI view |
| G-20 | **Cloudflare tunnel** | `startCloudflareTunnel()`, `getCloudflareTunnelStatus()` | Terminal-equivalent command palette actions (status/start/stop/list) | ✅ **DONE** — terminal-equivalent |
| G-21 | **WhatsApp integration** | `whatsappConnect()`, `whatsappGetStatus()` | Terminal-equivalent command palette actions with in-CLI QR rendering | ✅ **DONE** — terminal-equivalent |
| G-22 | **OAuth flow** | `initiateOAuthFlow()`, `completeOAuthFlow()` for MCP servers | Server endpoints ✅, client methods ✅, no CLI flow | ⚠️ **PARTIAL** — needs browser interaction |
| G-23 | **MCP protocol extensions** | `resolveElicitation()`, `resolveSampling()` | Server endpoints ✅, client methods ✅, no CLI prompts | ⚠️ **PARTIAL** — needs chat prompts |
| G-24 | **Agent sessions (multi-session)** | Multiple concurrent agent sessions, snooze/unsnooze, focus | Server endpoints ✅, client methods ✅, no CLI view | ⚠️ **PARTIAL** — needs UX design |
| G-25 | **Text-to-speech** | `generateSpeech()` with multiple providers | Terminal-equivalent TTS generation with file + playback handoff command | ✅ **DONE** — terminal-equivalent |

---

## 5. Implementation Phases

### Phase 5: Tool Approval & Agent Progress (P0) ✅ COMPLETE
- [x] **G-01**: Tool approval overlay in chat view
  - Detects `tool_approval_required` in SSE progress events
  - Displays tool name, server, and arguments summary
  - Y/N/A prompt (Y = approve, N = deny, A = approve all for session)
  - Sends approval response back via POST
- [x] **G-02**: Complete agent progress rendering
  - All 11 `AgentProgressStep` types rendered with appropriate icons
  - Tool execution duration shown
  - Error details with retry indication

### Phase 6: Settings Completeness (P1) ✅ MOSTLY COMPLETE
- [x] **G-06**: `mcpRequireApprovalBeforeToolCall` toggle in settings
- [x] **G-05**: `ttsEnabled` toggle in settings
- [x] **G-07**: `transcriptPostProcessingEnabled` toggle in settings
- [x] **G-08**: Model preset selector in settings
- [x] **G-04**: Per-provider API key input fields in settings
- [ ] **G-15**: Dual model / custom preset configuration — **TODO**

### Phase 7: Conversation & Profile Management (P1) ✅ MOSTLY COMPLETE
- [x] **G-03**: `renameConversation()` + [R] Rename in sessions (partial — rename only, no full update)
- [x] **G-09**: Profile export ([X]port key) / import ([I]mport key) in profile switcher
- [x] **G-10**: Profile create ([C]reate) / edit ([E]dit) / delete ([D]elete) in profile switcher

### Phase 8: MCP & Tools Enhancement (P1-P2) ✅ COMPLETE
- [x] **G-11**: Manual tool execution from tools view ([Enter] → JSON input → results)
- [x] **G-17**: MCP server management ([R]estart, [S]top, [L]ogs, [T]est)
- [x] **G-14**: Conversation search in sessions view ([/] → client-side title filtering)

### Phase 9: Memory & Skills (P2) — Server+Client ✅, needs CLI views
- [ ] **G-12**: Memory management **CLI view** (server endpoints + client methods already done)
- [ ] **G-13**: Skills management **CLI view** (server endpoints + client methods already done)

### Phase 10: Diagnostics & Advanced (P2-P3) — Server+Client ✅, needs CLI views
- [ ] **G-16**: Diagnostics **CLI view** (server endpoints + client methods already done)
- [ ] **G-18**: Message queue **CLI display** (server endpoints + client methods already done)
- [ ] **G-22**: OAuth **CLI flow** (server endpoints + client methods already done, needs browser interaction)
- [ ] **G-23**: Elicitation/sampling **CLI prompts** (server endpoints + client methods already done)

### Phase 11: ACP & Networking (P3) — Server+Client ✅, needs CLI views
- [ ] **G-19**: ACP agent **CLI view** (server endpoints + client methods already done)
- [ ] **G-24**: Multi-session agent **CLI view** (server endpoints + client methods already done)

### Out of Scope (Desktop-Only)
- Window/panel management (Electron-specific)
- System tray / dock integration
- Auto-updates
- Accessibility permission requests (macOS-specific)

---

## 6. MCP-Powered Testing Framework

### 6.1 Overview

Use `electron-mcp-server` and `iterm-mcp` as a dual-MCP feedback loop to systematically verify feature parity. An AI agent with access to both tools can:

1. Perform an action in the Electron app (via `electron-mcp`)
2. Perform the same action in the CLI (via `iterm-mcp`)
3. Compare the results
4. Report any discrepancies

### 6.2 Tool Inventory

#### electron-mcp-server (4 tools)

| Tool | Purpose in Testing |
|------|-------------------|
| `get_electron_window_info` | Verify Electron app is running and accessible |
| `take_screenshot` | Capture visual state for comparison |
| `send_command_to_electron` | Interact with UI (click, fill, navigate, get structure) |
| `read_electron_logs` | Check for errors during operations |

**Key `send_command_to_electron` sub-commands:**
- `find_elements` — Discover all interactive elements
- `click_by_text` / `click_by_selector` — Click buttons, tabs, menu items
- `fill_input` — Type into text fields
- `select_option` — Choose from dropdowns
- `send_keyboard_shortcut` — Trigger keyboard shortcuts
- `get_page_structure` — Get organized overview of page elements
- `verify_form_state` — Check form values
- `eval` — Execute arbitrary JavaScript

#### iterm-mcp (6 tools)

| Tool | Purpose in Testing |
|------|-------------------|
| `list_sessions` | Find the CLI's iTerm session |
| `write_to_terminal` | Send commands/keystrokes to CLI |
| `read_terminal_output` | Capture CLI's visual output |
| `send_control_character` | Send Ctrl+C, Ctrl+N, Ctrl+P, F-keys, etc. |
| `create_window` | Create isolated test environment |
| `create_tab` | Create new tabs for parallel testing |

### 6.3 Environment Setup

```bash
# Terminal 1: Start Electron with remote debugging
REMOTE_DEBUGGING_PORT=9222 pnpm dev

# Terminal 2: Start CLI connected to same server
cd apps/cli && bun run src/index.ts --url http://127.0.0.1:3210 --api-key <key>
```

Both MCP servers configured in the AI agent's MCP config:
```json
{
  "mcpServers": {
    "electron-mcp": {
      "command": "npx",
      "args": ["-y", "electron-mcp-server"],
      "env": { "SECURITY_LEVEL": "development" }
    },
    "iterm-mcp": {
      "command": "npx",
      "args": ["-y", "iterm-mcp"]
    }
  }
}
```

### 6.4 Test Suites

Each test follows this pattern:
1. **Electron**: Perform action → capture state (screenshot + page structure)
2. **CLI**: Perform equivalent action → capture state (terminal output)
3. **Compare**: Verify same data is displayed / same result achieved
4. **Report**: ✅ Parity | ⚠️ Partial | ❌ Missing

#### Suite 1: Navigation & Views

| Test | Electron (electron-mcp) | CLI (iterm-mcp) |
|------|------------------------|-----------------|
| 1.1 Main window loads | `take_screenshot` → verify UI rendered | `read_terminal_output` → verify TUI rendered |
| 1.2 Navigate to Settings | `send_command_to_electron` → click Settings tab | `send_control_character` → F3 |
| 1.3 Navigate to Conversations | Click Conversations tab | `send_control_character` → F2 |
| 1.4 Navigate to Tools | Click Tools tab | `send_control_character` → F4 |
| 1.5 Navigate back to Chat | Click Chat tab | `send_control_character` → F1 |
| 1.6 Help overlay | Send ? keystroke | `send_control_character` → ? |

#### Suite 2: Chat & Agent Execution

| Test | Electron | CLI |
|------|----------|-----|
| 2.1 Send message | `fill_input` → type message → `click_by_text` Send | `write_to_terminal` → type message + Enter |
| 2.2 Streaming response | `take_screenshot` during stream | `read_terminal_output` during stream |
| 2.3 Tool call display | Screenshot shows tool name + result | Terminal shows tool name + result |
| 2.4 Tool approval | Click Approve button | ✅ Y/N/A prompt in chat view |
| 2.5 Emergency stop | Send Ctrl+Shift+Esc or click stop | `send_control_character` → C (Ctrl+C) |
| 2.6 New conversation | Click New or send Ctrl+N | `send_control_character` → N (Ctrl+N) |
| 2.7 Agent progress | Screenshot progress panel | Terminal shows progress steps |

#### Suite 3: Profile Management

| Test | Electron | CLI |
|------|----------|-----|
| 3.1 View profiles | Navigate to profile picker | `send_control_character` → P (Ctrl+P) |
| 3.2 Switch profile | Click different profile | Select profile in popup |
| 3.3 Export profile | Click Export button | ✅ [X]port in Ctrl+P overlay |
| 3.4 Import profile | Click Import button | ✅ [I]mport in Ctrl+P overlay |
| 3.5 Create profile | Click Create button | ✅ [C]reate in Ctrl+P overlay |
| 3.6 Edit profile | Click Edit button | ✅ [E]dit in Ctrl+P overlay |
| 3.7 Delete profile | Click Delete button | ✅ [D]elete in Ctrl+P overlay |

#### Suite 4: Settings

| Test | Electron | CLI |
|------|----------|-----|
| 4.1 Provider selection | `select_option` → change provider | Select provider in settings |
| 4.2 Model selection | `select_option` → change model | Select model in settings |
| 4.3 Max iterations | `fill_input` → set iterations | Set iterations in settings |
| 4.4 Tool approval toggle | Toggle checkbox | ✅ Toggle in Settings view |
| 4.5 TTS toggle | Toggle checkbox | ✅ Toggle in Settings view |
| 4.6 API key config | Fill API key input | ✅ Secure input fields in Settings view |
| 4.7 Model preset | Select preset | ✅ Preset selector in Settings view |
| 4.8 Save settings | Click Save | Press S |

#### Suite 5: Conversation Management

| Test | Electron | CLI |
|------|----------|-----|
| 5.1 List conversations | Navigate to conversations | `send_control_character` → F2 |
| 5.2 Resume conversation | Click conversation | Select + Enter |
| 5.3 Delete conversation | Click delete | Press D |
| 5.4 Edit title | Click title → edit | **GAP TEST**: Verify edit UI exists |
| 5.5 Search conversations | Type in search | Press / → type query |

#### Suite 6: MCP Tools

| Test | Electron | CLI |
|------|----------|-----|
| 6.1 List tools by server | Navigate to tools page | `send_control_character` → F4 |
| 6.2 View tool details | Click tool | Navigate to tool |
| 6.3 Toggle MCP server | Toggle in settings | Toggle in settings |
| 6.4 Execute tool manually | Click Execute | ✅ [Enter] → JSON args → result display |
| 6.5 Server restart | Click Restart | ✅ [R]estart in Tools view |
| 6.6 View server logs | Click Logs | ✅ [L]ogs in Tools view |

### 6.5 Gap Report Format

After running all suites, the agent produces a structured report:

```markdown
# Parity Test Report — [Date]

## Summary
- Tests Run: X
- ✅ Parity: Y
- ⚠️ Partial: Z
- ❌ Missing: W

## Detailed Results

### [Test ID] [Test Name]
- **Electron**: [Screenshot reference] [Description of behavior]
- **CLI**: [Terminal output] [Description of behavior]
- **Status**: ✅ | ⚠️ | ❌
- **Gap ID**: G-XX (if applicable)
- **Notes**: [Any differences in presentation that are acceptable]
```

### 6.6 Iteration Loop

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Run Tests   │────►│ Gap Report   │────►│ Fix Code     │
│  (MCP tools) │     │ (prioritize) │     │ (implement)  │
└──────────────┘     └──────────────┘     └──────┬───────┘
       ▲                                         │
       └─────────────────────────────────────────┘
                    Re-run tests
```

1. Run full test suite using electron-mcp + iterm-mcp
2. Generate gap report with specific test failures
3. Fix the highest-priority gaps
4. Re-run only the affected test cases
5. Repeat until all tests pass

### 6.7 Agent Prompt Template

```
You have access to two MCP tools:
- electron-mcp: Controls the SpeakMCP Electron app (remote debugging on port 9222)
- iterm-mcp: Controls the SpeakMCP CLI running in iTerm

Run the following parity test suite. For each test:
1. First perform the action in the Electron app using electron-mcp
2. Take a screenshot of the result
3. Then perform the equivalent action in the CLI using iterm-mcp
4. Read the terminal output
5. Compare and report the result

Test Suite: [Suite Name]
[List of tests from Section 6.4]

Report format: For each test, state:
- Test ID and name
- What happened in Electron (with screenshot)
- What happened in CLI (with terminal output)
- Status: PARITY / PARTIAL / MISSING
- If gap found: which Gap ID from the PRD it corresponds to
```

---

## 7. HTTP Client Methods (Current)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `getModels()` | `GET /v1/models` | List available models |
| `getModelsForProvider(id)` | `GET /v1/models/:providerId` | Models for specific provider |
| `getProfiles()` | `GET /v1/profiles` | List profiles |
| `getCurrentProfile()` | `GET /v1/profiles/current` | Get active profile |
| `switchProfile(id)` | `POST /v1/profiles/current` | Switch profile |
| `exportProfile(id)` | `GET /v1/profiles/:id/export` | Export profile as JSON |
| `importProfile(json)` | `POST /v1/profiles/import` | Import profile from JSON |
| `getSettings()` | `GET /v1/settings` | Get settings |
| `patchSettings(data)` | `PATCH /v1/settings` | Update settings |
| `getConversations()` | `GET /v1/conversations` | List conversations |
| `getConversation(id)` | `GET /v1/conversations/:id` | Get conversation |
| `createConversation(data)` | `POST /v1/conversations` | Create conversation |
| `deleteConversation(id)` | `DELETE /v1/conversations/:id` | Delete conversation |
| `chat(messages, id)` | `POST /v1/chat/completions` | Chat (non-streaming) |
| `chatStream(messages, id)` | `POST /v1/chat/completions` | Chat with SSE streaming |
| `getMcpServers()` | `GET /v1/mcp/servers` | MCP server status |
| `toggleMcpServer(name, on)` | `POST /v1/mcp/servers/:name/toggle` | Enable/disable server |
| `listMcpTools()` | `POST /mcp/tools/list` | List MCP tools |
| `callMcpTool(name, args)` | `POST /mcp/tools/call` | Execute MCP tool |
| `emergencyStop()` | `POST /v1/emergency-stop` | Kill all agents |
| `renameConversation(id, title)` | `PUT /v1/conversations/:id` | Rename conversation |
| `isHealthy()` | `GET /v1/models` | Health check |
| `createProfile(data)` | `POST /v1/profiles` | Create profile |
| `updateProfile(id, data)` | `PATCH /v1/profiles/:id` | Update profile |
| `deleteProfile(id)` | `DELETE /v1/profiles/:id` | Delete profile |
| `getModelPresets()` | `GET /v1/model-presets` | List model presets |
| `getDiagnostics()` | `GET /v1/diagnostics/report` | Diagnostics report |
| `getHealthCheck()` | `GET /v1/diagnostics/health` | Health check |
| `restartMcpServer(name)` | `POST /v1/mcp/servers/:name/restart` | Restart MCP server |
| `stopMcpServer(name)` | `POST /v1/mcp/servers/:name/stop` | Stop MCP server |
| `getMcpServerLogs(name)` | `GET /v1/mcp/servers/:name/logs` | Get server logs |
| `testMcpServer(name)` | `POST /v1/mcp/servers/:name/test` | Test server connection |

### Additional Methods (server+client done, need CLI views)

| Method | Endpoint | For Gap |
|--------|----------|---------|
| `updateConversation(id, data)` | `PUT /v1/conversations/:id` | G-03 (full update beyond rename) |
| `getMemories()` / `searchMemories()` / `createMemory()` / `updateMemory()` / `deleteMemory()` | `/v1/memories/*` | G-12 |
| `getSkills()` / `createSkill()` / `updateSkill()` / `deleteSkill()` / `toggleSkill()` | `/v1/skills/*` | G-13 |
| `getDiagnosticReport()` / `getHealthCheck()` / `getRecentErrors()` | `/v1/diagnostics/*` | G-16 |
| `getMessageQueue()` / `enqueueMessage()` / `dequeueMessage()` | `/v1/queue/*` | G-18 |
| `getACPAgents()` / `createACPAgent()` / `runACPAgent()` | `/v1/acp/agents/*` | G-19 |
| `initiateOAuth()` / `completeOAuth()` | `/v1/oauth/*` | G-22 |
| `getPendingElicitations()` / `resolveSamplingRequest()` | `/v1/elicitation/*`, `/v1/sampling/*` | G-23 |
| `getAgentSessions()` / `stopAgentSession()` | `/v1/agent-sessions/*` | G-24 |

---

## 8. Key Bindings (Current + Planned)

### Global

| Key | Action | Status |
|-----|--------|--------|
| `F1` | Chat view | ✅ |
| `F2` | Sessions view | ✅ |
| `F3` | Settings view | ✅ |
| `F4` | Tools view | ✅ |
| `Ctrl+C` | Emergency stop / Exit | ✅ |
| `Ctrl+N` | New conversation | ✅ |
| `Ctrl+P` | Profile switcher | ✅ |
| `?` / `F12` | Help overlay | ✅ |
| `Esc` | Cancel / Close | ✅ |

### Chat View

| Key | Action | Status |
|-----|--------|--------|
| `Enter` | Send message | ✅ |
| `Up/Down` | Scroll history | ✅ |
| `PgUp/PgDn` | Scroll page | ✅ |
| `Y` / `N` | Tool approval (during approval prompt) | ✅ |
| `A` | Approve all tools for session | ✅ |

### Sessions View

| Key | Action | Status |
|-----|--------|--------|
| `Enter` | Resume conversation | ✅ |
| `N` | New conversation | ✅ |
| `D` | Delete selected | ✅ |
| `/` | Search | ✅ |
| `R` | Rename title | ✅ |
| `Up/Down` | Navigate list | ✅ |

### Settings View

| Key | Action | Status |
|-----|--------|--------|
| `Tab` | Navigate fields | ✅ |
| `Space` | Toggle | ✅ |
| `S` | Save | ✅ |
| `R` | Reset | ✅ |
| `Up/Down/J/K` | Navigate | ✅ |

### Profile Switcher (Ctrl+P)

| Key | Action | Status |
|-----|--------|--------|
| `Enter` | Select profile | ✅ |
| `Up/Down` | Navigate | ✅ |
| `X` | Export selected profile | ✅ |
| `I` | Import profile | ✅ |
| `C` | Create new profile | ✅ |
| `E` | Edit selected profile | ✅ |
| `D` | Delete selected profile | ✅ |
| `Esc` | Close | ✅ |

### Tools View

| Key | Action | Status |
|-----|--------|--------|
| `Enter` | Execute selected tool | ✅ |
| `Up/Down` | Navigate | ✅ |
| `R` | Restart selected server | ✅ |
| `S` | Stop selected server | ✅ |
| `L` | View server logs | ✅ |
| `T` | Test server connection | ✅ |
| `Esc` | Cancel execution | ✅ |

---

## 9. UI Layout

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

---

## 10. Dependencies

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

---

## 11. Completed Phases

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
