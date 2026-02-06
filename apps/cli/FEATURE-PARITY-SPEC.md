# CLI Feature Parity Specification

This document specifies the work required to bring the CLI (`@speakmcp/cli`) to full feature parity with the Electron desktop app's settings and configuration capabilities.

## Current State

### CLI Settings View (Implemented)
The CLI currently supports only 4 settings in `apps/cli/src/views/settings.ts`:

| Setting | Type | Status |
|---------|------|--------|
| LLM Provider | Select (OpenAI/Groq/Gemini) | ✅ Implemented |
| Model | Select (per-provider) | ✅ Implemented |
| Max Iterations | Number input | ✅ Implemented |
| MCP Server Enable/Disable | Toggle list | ✅ Implemented |

### Desktop Settings (Full Feature Set)
The desktop app has 10+ settings pages with 50+ configurable options.

---

## Gap Analysis

### Priority 1: Critical Agent Settings (MUST HAVE)

These settings directly affect agent behavior and are essential for CLI users.

| Setting | Desktop Location | Server API | CLI Work Required |
|---------|-----------------|------------|-------------------|
| **Require Tool Approval** | `settings-general.tsx` | `PATCH /v1/settings` ✅ | Add toggle to Settings view |
| **Message Queuing** | `settings-general.tsx` | Need to add | Add toggle + server endpoint |
| **Verify Task Completion** | `settings-general.tsx` | Need to add | Add toggle + server endpoint |
| **Final Summary** | `settings-general.tsx` | Need to add | Add toggle + server endpoint |
| **Enable Memory System** | `settings-general.tsx` | Need to add | Add toggle + server endpoint |
| **Inject Memories** | `settings-general.tsx` | Need to add | Add toggle + server endpoint |
| **Enable Summarization** | `settings-general.tsx` | Need to add | Add toggle + server endpoint |

**Server API Changes Required:**
```typescript
// GET /v1/settings should return:
{
  mcpMessageQueueEnabled: boolean,        // default: true
  mcpVerifyCompletionEnabled: boolean,    // default: true
  mcpFinalSummaryEnabled: boolean,        // default: true
  memoriesEnabled: boolean,               // default: true
  dualModelInjectMemories: boolean,       // default: false
  dualModelEnabled: boolean,              // default: false
}

// PATCH /v1/settings should accept all above fields
```

### Priority 2: Profile Management (SHOULD HAVE)

Profiles allow users to switch between different agent configurations.

| Feature | Server API | CLI Work Required |
|---------|------------|-------------------|
| List profiles | `GET /v1/profiles` ✅ | Add Profiles view (F5?) |
| View current profile | `GET /v1/profiles/current` ✅ | Show in Settings header |
| Switch profile | `POST /v1/profiles/current` ✅ | Add profile selector |
| View guidelines | `GET /v1/profiles/current` ✅ | Display in profile view |
| View system prompt | `GET /v1/profiles/current` ✅ | Display in profile view |
| Edit guidelines | Need to add | Add edit capability + endpoint |
| Edit system prompt | Need to add | Add edit capability + endpoint |
| Create profile | Need to add | Add create dialog + endpoint |
| Delete profile | Need to add | Add delete action + endpoint |
| Export profile | `GET /v1/profiles/:id/export` ✅ | Add export action |
| Import profile | `POST /v1/profiles/import` ✅ | Add import action |

**Server API Changes Required:**
```typescript
// PATCH /v1/profiles/:id - Update profile
{
  guidelines?: string,
  systemPrompt?: string,
  name?: string,
}

// POST /v1/profiles - Create profile
{
  name: string,
  guidelines?: string,
  systemPrompt?: string,
}

// DELETE /v1/profiles/:id - Delete profile (non-default only)
```

### Priority 3: Provider Configuration (SHOULD HAVE)

API keys and base URLs for LLM providers.

| Setting | Server API | CLI Work Required |
|---------|------------|-------------------|
| OpenAI API Key | Need to add | Add secure input field |
| OpenAI Base URL | Need to add | Add input field |
| Groq API Key | Need to add | Add secure input field |
| Groq Base URL | Need to add | Add input field |
| Gemini API Key | Need to add | Add secure input field |
| Model Presets | `GET /v1/settings` ✅ | Add preset selector |

**Server API Changes Required:**
```typescript
// GET /v1/settings should return:
{
  openaiApiKey: string | null,      // masked or null
  openaiBaseUrl: string | null,
  groqApiKey: string | null,        // masked or null
  groqBaseUrl: string | null,
  geminiApiKey: string | null,      // masked or null
  currentModelPresetId: string,
  availablePresets: ModelPreset[],
}

// PATCH /v1/settings should accept:
{
  openaiApiKey?: string,
  openaiBaseUrl?: string,
  groqApiKey?: string,
  groqBaseUrl?: string,
  geminiApiKey?: string,
  currentModelPresetId?: string,
}
```

**Security Note:** API keys should be write-only (accept on PATCH, return masked on GET).

### Priority 4: Remote Server Status (NICE TO HAVE)

View server configuration (read-only for CLI since it connects to remote server).

| Setting | Server API | CLI Work Required |
|---------|------------|-------------------|
| Server URL | N/A (CLI knows this) | Display in status bar |
| Server Port | Need to add | Display in status |
| API Key status | N/A | Show connected/authenticated |
| Server version | Need to add | Display in About section |

**Server API Changes Required:**
```typescript
// GET /v1/status or /health should return:
{
  version: string,
  port: number,
  bindAddress: string,
  uptime: number,
}
```

### Priority 5: Optional Features (NICE TO HAVE)

These features are lower priority but would complete feature parity.

| Feature | Desktop Location | Notes |
|---------|-----------------|-------|
| Skills management | `settings-skills.tsx` | List, enable/disable, create, import |
| Memories view | `memories.tsx` | View, add, delete memories |
| Agent Personas | `settings-agent-personas.tsx` | CRUD for personas |
| External Agents | `settings-external-agents.tsx` | ACP/Stdio/Remote agents |
| Langfuse config | `settings-general.tsx` | Observability settings |
| Theme selection | `settings-general.tsx` | Light/Dark/System |

---

## Implementation Plan

### Phase 1: Server API Enhancements (1-2 days)

Update `packages/server/src/server.ts` to expose missing settings:

1. **Extend GET /v1/settings response:**
   ```typescript
   // Add to existing response:
   mcpMessageQueueEnabled: cfg.mcpMessageQueueEnabled ?? true,
   mcpVerifyCompletionEnabled: cfg.mcpVerifyCompletionEnabled ?? true,
   mcpFinalSummaryEnabled: cfg.mcpFinalSummaryEnabled ?? true,
   memoriesEnabled: cfg.memoriesEnabled ?? true,
   dualModelInjectMemories: cfg.dualModelInjectMemories ?? false,
   dualModelEnabled: cfg.dualModelEnabled ?? false,
   mainAgentMode: cfg.mainAgentMode ?? 'api',
   ```

2. **Extend PATCH /v1/settings handler:**
   ```typescript
   // Add validation and updates for each new field
   if (typeof body.mcpMessageQueueEnabled === "boolean") {
     updates.mcpMessageQueueEnabled = body.mcpMessageQueueEnabled
   }
   // ... repeat for each field
   ```

3. **Add profile mutation endpoints:**
   - `PATCH /v1/profiles/:id` - Update profile
   - `POST /v1/profiles` - Create profile
   - `DELETE /v1/profiles/:id` - Delete profile

### Phase 2: CLI Types Update (0.5 day)

Update `apps/cli/src/types.ts`:

```typescript
export interface Settings {
  // Existing
  mcpToolsProviderId?: string
  mcpToolsOpenaiModel?: string
  mcpToolsGroqModel?: string
  mcpToolsGeminiModel?: string
  mcpMaxIterations?: number

  // Add these
  mcpRequireApprovalBeforeToolCall?: boolean
  mcpMessageQueueEnabled?: boolean
  mcpVerifyCompletionEnabled?: boolean
  mcpFinalSummaryEnabled?: boolean
  memoriesEnabled?: boolean
  dualModelInjectMemories?: boolean
  dualModelEnabled?: boolean
  mainAgentMode?: 'api' | 'acp'
}

export interface Profile {
  id: string
  name: string
  isDefault?: boolean
  guidelines?: string
  systemPrompt?: string
  createdAt?: number
  updatedAt?: number
}
```

### Phase 3: CLI API Client Update (0.5 day)

Update `apps/cli/src/api-client.ts`:

```typescript
// Add methods:
async getProfiles(): Promise<{ profiles: Profile[], currentProfileId?: string }>
async getCurrentProfile(): Promise<Profile>
async setCurrentProfile(profileId: string): Promise<void>
async updateProfile(id: string, updates: Partial<Profile>): Promise<Profile>
async createProfile(data: { name: string, guidelines?: string }): Promise<Profile>
async deleteProfile(id: string): Promise<void>
```

### Phase 4: CLI Settings View Enhancement (2-3 days)

Restructure `apps/cli/src/views/settings.ts` into sections:

```
┌─────────────────────────────────────────────────────────────┐
│ ⚙️  Settings                              Profile: Default  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ ─ LLM Configuration ─                                       │
│   Provider        [OpenAI    ▼]                             │
│   Model           [gpt-4o-mini ▼]                           │
│   Max Iterations  [10        ]                              │
│                                                             │
│ ─ Agent Behavior ─                                          │
│   [✓] Require Tool Approval                                 │
│   [✓] Message Queuing                                       │
│   [✓] Verify Task Completion                                │
│   [✓] Final Summary                                         │
│   [✓] Enable Memory System                                  │
│   [ ] Inject Memories                                       │
│   [ ] Enable Summarization                                  │
│                                                             │
│ ─ MCP Servers ─                                             │
│   [✓] filesystem          12 tools                          │
│   [✓] browser-use          8 tools                          │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ [S] Save  [R] Reset  [P] Profiles  [Tab] Navigate           │
└─────────────────────────────────────────────────────────────┘
```

### Phase 5: Profiles View (1-2 days)

Create new `apps/cli/src/views/profiles.ts`:

```
┌─────────────────────────────────────────────────────────────┐
│ 👤 Profiles                                    [N] New      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ ► Default (active)                                          │
│     No custom guidelines                                    │
│                                                             │
│   Work                                                      │
│     "Focus on code quality and testing..."                  │
│                                                             │
│   Personal                                                  │
│     "Be casual and friendly..."                             │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ [Enter] Switch  [E] Edit  [D] Delete  [X] Export  [I] Import│
└─────────────────────────────────────────────────────────────┘
```

### Phase 6: E2E Tests Update (1 day)

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
| Voice/STT/TTS | CLI has no audio I/O |
| WhatsApp integration | Requires QR code scanning |
| Keyboard shortcuts config | CLI uses its own key bindings |
| Panel position/dragging | No floating panel in CLI |
| Dock icon/launch at login | Desktop OS integration |
| Cloudflare Tunnel | Desktop-specific networking |
| Streamer mode | No sensitive display in CLI |
| Emergency kill switch hotkey | CLI uses Ctrl+C |

---

## Success Criteria

1. **All Priority 1 settings** are viewable and editable in CLI
2. **Profile switching** works from CLI
3. **E2E tests pass** for all new settings
4. **Server API** is backwards compatible (no breaking changes)
5. **CLI types** match server response types

---

## Estimated Effort

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| Phase 1: Server API | 1-2 days | None |
| Phase 2: CLI Types | 0.5 day | Phase 1 |
| Phase 3: API Client | 0.5 day | Phase 1 |
| Phase 4: Settings View | 2-3 days | Phase 2, 3 |
| Phase 5: Profiles View | 1-2 days | Phase 2, 3 |
| Phase 6: E2E Tests | 1 day | Phase 4, 5 |

**Total: 6-9 days**

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

