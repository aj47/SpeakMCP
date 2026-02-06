# SpeakMCP CLI — Feature Parity PRD

## 1. Executive Summary

The SpeakMCP CLI (`apps/cli/`) is a terminal user interface (TUI) client that must achieve **1:1 feature parity** with the Electron desktop app (`apps/desktop/`). Both clients consume the same `@speakmcp/server` HTTP API. The Electron app currently exposes 19 HTTP endpoints via its remote server and 150+ IPC handlers — the CLI must surface every user-facing feature accessible through those APIs.

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

This section compares **every** user-facing feature in the Electron app against the CLI. Features are derived from the Electron remote server's 19 HTTP endpoints and the 150+ IPC handlers in `tipc.ts`.

### 4.1 Server API Endpoint Parity

| # | Endpoint | Electron | CLI Client | CLI UI | Status |
|---|----------|----------|------------|--------|--------|
| 1 | `POST /v1/chat/completions` (non-streaming) | ✅ | ✅ `chat()` | ✅ Chat view | ✅ Parity |
| 2 | `POST /v1/chat/completions` (SSE streaming) | ✅ | ✅ `chatStream()` | ✅ Chat view | ⚠️ Partial — no tool approval UI |
| 3 | `GET /v1/models` | ✅ | ✅ `getModels()` | ✅ Settings view | ✅ Parity |
| 4 | `GET /v1/models/:providerId` | ✅ | ✅ `getModelsForProvider()` | ✅ Settings view | ✅ Parity |
| 5 | `GET /v1/profiles` | ✅ | ✅ `getProfiles()` | ✅ Ctrl+P popup | ✅ Parity |
| 6 | `GET /v1/profiles/current` | ✅ | ✅ `getCurrentProfile()` | ✅ Status bar | ✅ Parity |
| 7 | `POST /v1/profiles/current` | ✅ | ✅ `switchProfile()` | ✅ Ctrl+P popup | ✅ Parity |
| 8 | `GET /v1/profiles/:id/export` | ✅ | ✅ `exportProfile()` | ❌ No UI | **GAP** |
| 9 | `POST /v1/profiles/import` | ✅ | ✅ `importProfile()` | ❌ No UI | **GAP** |
| 10 | `GET /v1/mcp/servers` | ✅ | ✅ `getMcpServers()` | ✅ Settings + Tools | ✅ Parity |
| 11 | `POST /v1/mcp/servers/:name/toggle` | ✅ | ✅ `toggleMcpServer()` | ✅ Settings view | ✅ Parity |
| 12 | `GET /v1/settings` | ✅ | ✅ `getSettings()` | ⚠️ Partial UI | **GAP** — missing many fields |
| 13 | `PATCH /v1/settings` | ✅ | ✅ `patchSettings()` | ⚠️ Partial UI | **GAP** — can't set all fields |
| 14 | `GET /v1/conversations` | ✅ | ✅ `getConversations()` | ✅ Sessions view | ✅ Parity |
| 15 | `GET /v1/conversations/:id` | ✅ | ✅ `getConversation()` | ✅ Resume in chat | ✅ Parity |
| 16 | `POST /v1/conversations` | ✅ | ✅ `createConversation()` | ❌ No explicit create UI | **GAP** |
| 17 | `PUT /v1/conversations/:id` | ✅ | ❌ Missing | ❌ No UI | **GAP** |
| 18 | `POST /v1/emergency-stop` | ✅ | ✅ `emergencyStop()` | ✅ Ctrl+C | ✅ Parity |
| 19 | `POST /mcp/tools/list` | ✅ | ✅ `listMcpTools()` | ✅ Tools view | ✅ Parity |
| 20 | `POST /mcp/tools/call` | ✅ | ✅ `callMcpTool()` | ❌ No manual tool call UI | **GAP** |

**Summary**: 12/20 at parity, 8 gaps (2 partial, 6 missing).

### 4.2 Feature-Level Gap Inventory

Each gap below is tagged with a priority:
- **P0** — Core functionality; blocks basic usage patterns
- **P1** — Important functionality; users will notice absence
- **P2** — Secondary functionality; enhances experience
- **P3** — Advanced/niche; nice-to-have

#### P0 — Critical Gaps

| ID | Feature | Electron Behavior | CLI Current State | Required Work |
|----|---------|-------------------|-------------------|---------------|
| G-01 | **Tool approval workflow** | SSE stream sends `tool_approval_required` progress events; UI shows approve/deny buttons; blocks agent until user responds via `respondToToolApproval()` IPC | CLI receives progress events but has no interactive approval prompt. Agent hangs waiting for approval. | Add approval overlay in `chat.ts`: detect `tool_approval_required` step type → show tool name + args → Y/N prompt → POST approval response |
| G-02 | **Agent progress display (complete)** | Rich progress panel showing each step: 💭 thinking, ▶ running tool, ✓ complete, ❌ error, 🔄 retry, with tool names and durations | Partial — shows iteration count and some progress, but rendering is incomplete for all 11 step types | Complete the progress rendering in `chat.ts` for all `AgentProgressStep` types |

#### P1 — Important Gaps

| ID | Feature | Electron Behavior | CLI Current State | Required Work |
|----|---------|-------------------|-------------------|---------------|
| G-03 | **Conversation update** | `PUT /v1/conversations/:id` — update title, add messages | No `updateConversation()` in client, no UI | Add client method + UI for editing conversation title |
| G-04 | **Settings: API key configuration** | Settings page has fields per provider for API keys and base URLs | Settings view only shows provider selector, model selector, max iterations | Add API key input fields per provider in settings view |
| G-05 | **Settings: TTS toggle** | `ttsEnabled` toggle in settings | Not shown in CLI settings | Add toggle in settings view |
| G-06 | **Settings: Require tool approval toggle** | `mcpRequireApprovalBeforeToolCall` toggle | Not exposed in CLI settings UI | Add toggle in settings view (prerequisite for G-01) |
| G-07 | **Settings: Transcript post-processing** | `transcriptPostProcessingEnabled` toggle | Not shown | Add toggle in settings view |
| G-08 | **Settings: Model preset selection** | `currentModelPresetId` + `availablePresets[]` dropdown | Not shown | Add preset selector in settings view |
| G-09 | **Profile export/import UI** | Export button saves JSON, Import button loads JSON | Client methods exist (`exportProfile()`, `importProfile()`) but no TUI to trigger them | Add E/I keybindings in profile switcher or settings view |
| G-10 | **Profile management (create/edit/delete)** | Full CRUD via IPC: `createProfile()`, `updateProfile()`, `deleteProfile()` | Only `switchProfile()` works via Ctrl+P | Add profile management sub-view or popup |
| G-11 | **Manual MCP tool execution** | Can call tools directly from tool browser | Tools view is read-only | Add Enter to execute selected tool with input form |

#### P2 — Secondary Gaps

| ID | Feature | Electron Behavior | CLI Current State | Required Work |
|----|---------|-------------------|-------------------|---------------|
| G-12 | **Memory management** | Full CRUD: `getAllMemories()`, `saveMemoryFromSummary()`, `updateMemory()`, `deleteMemory()`, `searchMemories()` | No dedicated view, no client methods | Add memory view (F5 or sub-view) + client methods for memory endpoints |
| G-13 | **Skills management** | Full CRUD: `getSkills()`, `createSkill()`, `updateSkill()`, `deleteSkill()`, `toggleSkill()`, import from GitHub/markdown | No dedicated view | Add skills view + client methods |
| G-14 | **Conversation search** | Full text search across conversations | Sessions view has `/` shortcut but search is placeholder only | Implement actual search (client-side filtering or server endpoint) |
| G-15 | **Dual model / model preset config** | Separate model settings for different providers, custom presets with base URL + API key | Only basic provider + model selection | Extend settings view with preset configuration |
| G-16 | **Diagnostics view** | `getDiagnosticReport()`, `performHealthCheck()`, `getRecentErrors()` | No diagnostics | Add diagnostics view or command |
| G-17 | **MCP server detailed management** | Restart server, stop server, view logs, clear logs, test connection | Only toggle enable/disable | Add server context menu or sub-view in tools/settings |

#### P3 — Advanced / Niche Gaps

| ID | Feature | Electron Behavior | CLI Current State | Required Work |
|----|---------|-------------------|-------------------|---------------|
| G-18 | **Message queue management** | `getMessageQueue()`, `clearMessageQueue()`, `reorderMessageQueue()`, pause/resume | Not implemented | Add queue display in chat view |
| G-19 | **ACP agent delegation** | `spawnAcpAgent()`, `runAcpTask()`, `getAcpAgentStatuses()` | Not implemented | Add ACP agent view + client methods |
| G-20 | **Cloudflare tunnel** | `startCloudflareTunnel()`, `getCloudflareTunnelStatus()` | Not implemented | Add tunnel toggle in settings |
| G-21 | **WhatsApp integration** | `whatsappConnect()`, `whatsappGetStatus()` | Not in scope for TUI | Assess feasibility — may be desktop-only |
| G-22 | **OAuth flow** | `initiateOAuthFlow()`, `completeOAuthFlow()` for MCP servers | Not implemented | Add OAuth flow for protected MCP servers |
| G-23 | **MCP protocol extensions** | `resolveElicitation()`, `resolveSampling()` | Not implemented | Add prompts for elicitation/sampling |
| G-24 | **Agent sessions (multi-session)** | Multiple concurrent agent sessions, snooze/unsnooze, focus | CLI runs single session | Assess priority — may be desktop-only UX |
| G-25 | **Text-to-speech** | `generateSpeech()` with multiple providers | Not feasible in TUI (no audio output) | Out of scope — desktop-only |

---

## 5. Implementation Phases

### Phase 5: Tool Approval & Agent Progress (P0)
- [ ] **G-01**: Tool approval overlay in chat view
  - Detect `tool_approval_required` in SSE progress events
  - Display tool name, server, and arguments summary
  - Y/N/Always prompt (Y = approve, N = deny, A = approve all for session)
  - Send approval response back via appropriate endpoint
- [ ] **G-02**: Complete agent progress rendering
  - Render all 11 `AgentProgressStep` types with appropriate icons
  - Show tool execution duration
  - Show error details with retry indication

### Phase 6: Settings Completeness (P1)
- [ ] **G-06**: Add `mcpRequireApprovalBeforeToolCall` toggle to settings
- [ ] **G-05**: Add `ttsEnabled` toggle
- [ ] **G-07**: Add `transcriptPostProcessingEnabled` toggle
- [ ] **G-08**: Add model preset selector (`currentModelPresetId` + `availablePresets[]`)
- [ ] **G-04**: Add per-provider API key input fields
- [ ] **G-15**: Add dual model / custom preset configuration

### Phase 7: Conversation & Profile Management (P1)
- [ ] **G-03**: Add `updateConversation()` client method + title edit UI
- [ ] **G-09**: Profile export (E key) / import (I key) in profile switcher
- [ ] **G-10**: Profile create/edit/delete popup

### Phase 8: MCP & Tools Enhancement (P1-P2)
- [ ] **G-11**: Manual tool execution from tools view (Enter → input form → results)
- [ ] **G-17**: MCP server management (restart, stop, logs, test connection)
- [ ] **G-14**: Implement real conversation search in sessions view

### Phase 9: Memory & Skills (P2)
- [ ] **G-12**: Memory management view (list, search, create, edit, delete)
- [ ] **G-13**: Skills management view (list, create, edit, delete, toggle, import)

### Phase 10: Diagnostics & Advanced (P2-P3)
- [ ] **G-16**: Diagnostics view (health check, error log, diagnostic report)
- [ ] **G-18**: Message queue display and management
- [ ] **G-22**: OAuth flow for MCP servers
- [ ] **G-23**: Elicitation/sampling resolution prompts

### Phase 11: ACP & Networking (P3)
- [ ] **G-19**: ACP agent delegation
- [ ] **G-20**: Cloudflare tunnel management
- [ ] **G-24**: Multi-session agent management (assess feasibility)

### Out of Scope (Desktop-Only)
- G-21: WhatsApp integration (requires QR code scanning UI)
- G-25: Text-to-speech (requires audio output)
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
| 2.4 Tool approval | Click Approve button | **GAP TEST**: Verify approval prompt exists |
| 2.5 Emergency stop | Send Ctrl+Shift+Esc or click stop | `send_control_character` → C (Ctrl+C) |
| 2.6 New conversation | Click New or send Ctrl+N | `send_control_character` → N (Ctrl+N) |
| 2.7 Agent progress | Screenshot progress panel | Terminal shows progress steps |

#### Suite 3: Profile Management

| Test | Electron | CLI |
|------|----------|-----|
| 3.1 View profiles | Navigate to profile picker | `send_control_character` → P (Ctrl+P) |
| 3.2 Switch profile | Click different profile | Select profile in popup |
| 3.3 Export profile | Click Export button | **GAP TEST**: Verify export UI exists |
| 3.4 Import profile | Click Import button | **GAP TEST**: Verify import UI exists |
| 3.5 Create profile | Click Create button | **GAP TEST**: Verify create UI exists |
| 3.6 Edit profile | Click Edit button | **GAP TEST**: Verify edit UI exists |
| 3.7 Delete profile | Click Delete button | **GAP TEST**: Verify delete UI exists |

#### Suite 4: Settings

| Test | Electron | CLI |
|------|----------|-----|
| 4.1 Provider selection | `select_option` → change provider | Select provider in settings |
| 4.2 Model selection | `select_option` → change model | Select model in settings |
| 4.3 Max iterations | `fill_input` → set iterations | Set iterations in settings |
| 4.4 Tool approval toggle | Toggle checkbox | **GAP TEST**: Verify toggle exists |
| 4.5 TTS toggle | Toggle checkbox | **GAP TEST**: Verify toggle exists |
| 4.6 API key config | Fill API key input | **GAP TEST**: Verify input exists |
| 4.7 Model preset | Select preset | **GAP TEST**: Verify preset selector exists |
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
| 6.4 Execute tool manually | Click Execute | **GAP TEST**: Verify execution UI exists |
| 6.5 Server restart | Click Restart | **GAP TEST**: Verify restart UI exists |
| 6.6 View server logs | Click Logs | **GAP TEST**: Verify logs UI exists |

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
| `isHealthy()` | `GET /v1/models` | Health check |

### Methods to Add

| Method | Endpoint | For Gap |
|--------|----------|---------|
| `updateConversation(id, data)` | `PUT /v1/conversations/:id` | G-03 |

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
| `Y` / `N` | Tool approval (during approval prompt) | 🔲 G-01 |
| `A` | Approve all tools for session | 🔲 G-01 |

### Sessions View

| Key | Action | Status |
|-----|--------|--------|
| `Enter` | Resume conversation | ✅ |
| `N` | New conversation | ✅ |
| `D` | Delete selected | ✅ |
| `/` | Search | ⚠️ Placeholder |
| `E` | Edit title | 🔲 G-03 |
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
| `E` | Export selected profile | 🔲 G-09 |
| `I` | Import profile | 🔲 G-09 |
| `C` | Create new profile | 🔲 G-10 |
| `X` | Delete selected profile | 🔲 G-10 |
| `Esc` | Close | ✅ |

### Tools View

| Key | Action | Status |
|-----|--------|--------|
| `Enter` | Execute selected tool | 🔲 G-11 |
| `Up/Down` | Navigate | ✅ |
| `R` | Restart selected server | 🔲 G-17 |
| `L` | View server logs | 🔲 G-17 |

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