# SpeakMCP Desktop Application - Comprehensive Product Requirements Document (PRD)

**Purpose:** This document provides an exhaustive inventory of all features in the SpeakMCP Electron desktop application. Use this to cross-check feature parity with the new Rust CLI.

**Version:** 1.0
**Date:** January 2026
**Branch:** feature/625-rust-cli

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Core Architecture](#2-core-architecture)
3. [Voice & Audio Features](#3-voice--audio-features)
4. [Keyboard & Hotkey System](#4-keyboard--hotkey-system)
5. [MCP Integration](#5-mcp-integration)
6. [LLM Orchestration & Agent Loop](#6-llm-orchestration--agent-loop)
7. [Conversation Management](#7-conversation-management)
8. [Profile & Persona System](#8-profile--persona-system)
9. [Configuration System](#9-configuration-system)
10. [UI/UX Features](#10-uiux-features)
11. [Remote Server & API](#11-remote-server--api)
12. [External Integrations](#12-external-integrations)
13. [Memory System](#13-memory-system)
14. [Diagnostics & Observability](#14-diagnostics--observability)
15. [Rust CLI Feature Comparison](#15-rust-cli-feature-comparison)
16. [Feature Checklist for CLI Parity](#16-feature-checklist-for-cli-parity)

---

## 1. Executive Summary

SpeakMCP is a desktop application that enables voice-driven interaction with AI assistants through the Model Context Protocol (MCP). Key capabilities include:

- **Voice-to-AI interaction** via push-to-talk or toggle recording
- **Agent mode** with iterative tool calling through MCP servers
- **Multi-provider LLM support** (OpenAI, Groq, Gemini)
- **Profile-based configuration** for different use cases
- **Remote API access** for CLI and external integrations
- **WhatsApp integration** for mobile agent access
- **Memory system** for persistent context

---

## 2. Core Architecture

### 2.1 Process Architecture

| Process | Technology | Responsibilities |
|---------|-----------|------------------|
| **Main Process** | Electron + Node.js | IPC handlers, services, MCP clients, LLM orchestration |
| **Renderer Process** | React 18 + TypeScript | UI components, state management, user interaction |
| **Rust Binary** | speakmcp-rs | Global keyboard monitoring, text injection |

### 2.2 Key Services (Main Process)

| Service | File | Lines | Purpose |
|---------|------|-------|---------|
| mcp-service.ts | Main | ~2700 | MCP client management, tool execution, OAuth |
| llm.ts | Main | ~3250 | Agent loop, LLM orchestration |
| llm-fetch.ts | Main | ~1018 | Direct LLM API calls |
| config.ts | Main | ~500 | Configuration persistence |
| profile-service.ts | Main | ~800 | Profile management |
| agent-profile-service.ts | Main | ~600 | Unified agent profiles |
| conversation-service.ts | Main | ~400 | Conversation persistence |
| keyboard.ts | Main | ~1317 | Hotkey handling |
| window.ts | Main | ~900 | Window management |
| remote-server.ts | Main | ~800 | HTTP API for external access |
| acp-service.ts | Main | ~1500 | Agent Control Protocol |
| memory-service.ts | Main | ~300 | Memory persistence |
| diagnostics.ts | Main | ~200 | Error logging |

### 2.3 State Management

| Store | Library | Purpose |
|-------|---------|---------|
| conversation-store | Zustand | Current conversation tracking |
| agent-store | Zustand | Agent sessions, progress, UI state |

---

## 3. Voice & Audio Features

### 3.1 Audio Recording

| Feature | Implementation | Notes |
|---------|----------------|-------|
| **Recording Engine** | Web Audio API + MediaRecorder | WebM format, 128kbps |
| **Visualization** | RMS analysis | Real-time waveform display |
| **Minimum Duration** | 100ms | Prevents accidental captures |
| **Data Collection** | 100ms chunks | Periodic data capture |

### 3.2 Speech-to-Text (STT)

| Provider | Model | Features |
|----------|-------|----------|
| **OpenAI Whisper** | whisper-1 | Default provider, language detection |
| **Groq Whisper** | whisper-large-v3-turbo | Fast inference, custom prompts |

**Configuration Options:**
- `sttProviderId`: "openai" | "groq"
- `sttLanguage`: Language code (default: "auto")
- `groqSttPrompt`: Custom prompt for Groq
- `openaiSttLanguage` / `groqSttLanguage`: Provider-specific language

### 3.3 Text-to-Speech (TTS)

| Provider | Models | Voices |
|----------|--------|--------|
| **OpenAI** | tts-1, tts-1-hd | alloy, echo, fable, onyx, nova, shimmer |
| **Groq** | orpheus-english, orpheus-arabic | Multiple language-specific voices |
| **Gemini** | gemini-2.5-flash-preview-tts | Kore and others |

**TTS Configuration:**
- `ttsEnabled`: Feature toggle
- `ttsAutoPlay`: Auto-play generated speech
- `ttsPreprocessingEnabled`: Text cleanup before synthesis
- `ttsUseLLMPreprocessing`: Use LLM for intelligent preprocessing
- `ttsRemoveCodeBlocks`, `ttsRemoveUrls`, `ttsConvertMarkdown`: Preprocessing options

### 3.4 Transcript Post-Processing

| Feature | Purpose |
|---------|---------|
| Grammar correction | Fix transcription errors |
| Punctuation normalization | Consistent formatting |
| LLM-based enhancement | Intelligent text cleanup |

---

## 4. Keyboard & Hotkey System

### 4.1 Hotkey Architecture

- **Implementation:** Rust binary (speakmcp-rs) for native OS access
- **Platforms:** macOS (rdev), Windows (rdev), Linux (evdev)
- **Communication:** JSON events piped to TypeScript handler

### 4.2 Recording Hotkeys

| Function | Default (macOS/Linux) | Default (Windows) | Modes |
|----------|----------------------|-------------------|-------|
| **Voice Recording** | Hold Ctrl | Ctrl+/ | Hold, Toggle |
| **MCP Agent Mode** | Hold Ctrl+Alt | Hold Ctrl+Alt | Hold, Toggle |
| **Text Input** | Ctrl+T | Ctrl+Shift+T | Press |
| **Toggle Dictation** | Fn (disabled) | Fn (disabled) | Toggle |

### 4.3 System Hotkeys

| Function | Default | Configurable |
|----------|---------|--------------|
| **Emergency Stop** | Ctrl+Shift+Escape | Yes |
| **Settings Window** | Ctrl+Shift+S | Yes |
| **Escape** | Cancel recording | No |

### 4.4 Text Injection

| Feature | Implementation |
|---------|----------------|
| Focus capture | `speakmcp-rs get-focus` |
| Focus restore | `speakmcp-rs restore-focus` |
| Text injection | `speakmcp-rs write "text"` |
| Delay before injection | 100ms |

### 4.5 Custom Shortcuts

All major hotkeys support custom configuration:
- `customShortcut` / `customShortcutMode`
- `customMcpToolsShortcut` / `customMcpToolsShortcutMode`
- `customTextInputShortcut`
- `customSettingsHotkey`
- `customAgentKillSwitchHotkey`
- `customToggleVoiceDictationHotkey`

---

## 5. MCP Integration

### 5.1 Transport Types

| Transport | Use Case | Configuration |
|-----------|----------|---------------|
| **stdio** | Local command-based servers | `command`, `args`, `env` |
| **websocket** | Remote WS servers | `url` (ws://, wss://) |
| **streamableHttp** | Remote HTTP servers | `url` (http://, https://) |

### 5.2 OAuth 2.1 Support

| Feature | Implementation |
|---------|----------------|
| Server discovery | GET /.well-known/oauth-authorization-server |
| Dynamic registration | RFC 7591 |
| PKCE | S256 challenge method |
| Token storage | oauthStorage service |
| Auto-refresh | Token validation + refresh |
| 401 handling | Auto OAuth flow on unauthorized |

### 5.3 Tool Management

| Feature | Description |
|---------|-------------|
| Tool discovery | `client.listTools()` on connection |
| Tool naming | `{serverName}:{toolName}` format |
| Tool enable/disable | Per-profile, per-server |
| Runtime toggle | Without restart |
| Built-in tools | speakmcp-settings server |

### 5.4 Tool Execution

| Feature | Implementation |
|---------|----------------|
| Parameter fixing | Auto snake_case to camelCase |
| Type coercion | String to number, enum normalization |
| Response truncation | 50KB hard limit |
| Response summarization | 20KB+ = gentle, 50KB+ = aggressive |
| Chunked processing | 15KB chunks for large responses |
| Retry logic | 2 retries with exponential backoff |

### 5.5 MCP Protocol Extensions (2025-11-25)

| Feature | Purpose |
|---------|---------|
| Elicitation | Form-based or URL-based authentication |
| Sampling | Server-requested LLM completions |

### 5.6 Server Lifecycle

| State | Description |
|-------|-------------|
| stopped | Server not running |
| starting | Connection in progress |
| ready | Connected and tools discovered |
| error | Connection failed |

---

## 6. LLM Orchestration & Agent Loop

### 6.1 Supported Providers

| Provider | Default Model | Features |
|----------|---------------|----------|
| **OpenAI** | gpt-4o-mini | Full tool calling |
| **Groq** | llama-3.3-70b-versatile | OpenAI-compatible |
| **Gemini** | gemini-1.5-flash-002 | No streaming |

### 6.2 Agent Loop Architecture

```
1. Initialize → Load context (tools, memories, skills)
2. For each iteration (max 10):
   a) Shrink context (token budget)
   b) Make LLM call with streaming + tool calling
   c) Process response
   d) Execute tools if called
   e) Verify completion if enabled
   f) Continue or exit
```

### 6.3 Loop Termination Conditions

| Condition | Behavior |
|-----------|----------|
| `needsMoreWork: false` | Explicit completion |
| Verification passed | Task confirmed complete |
| Max iterations (10) | Forced completion |
| Empty response (3x) | Forced completion |
| Emergency stop | Immediate abort |
| Verification limit (5) | Forced completion |

### 6.4 Context Management

| Strategy | Trigger | Action |
|----------|---------|--------|
| **Truncation** | >5000 chars | Truncate tool responses |
| **Summarization** | >2000 chars | LLM summary |
| **Drop middle** | Budget exceeded | Keep first/last N messages |
| **Minimal prompt** | Critical | Reduced system prompt |

### 6.5 Streaming

| Feature | Implementation |
|---------|----------------|
| Dual-stream | Parallel streaming + structured calls |
| Throttling | 50ms emission intervals |
| Provider support | OpenAI, Groq (not Gemini) |

### 6.6 Completion Verification

| Check | Purpose |
|-------|---------|
| Intent detection | "Let me...", "I'll..." = incomplete |
| Tool results | Results exist but not presented |
| Direct answer | Question answered directly |
| Explicit confirmation | "Done", "Task complete" |

---

## 7. Conversation Management

### 7.1 Conversation Storage

| Field | Type | Description |
|-------|------|-------------|
| id | string | UUID |
| title | string | Auto-generated or manual |
| messages | Message[] | Conversation history |
| createdAt | number | Timestamp |
| updatedAt | number | Last modified |
| metadata | object | Additional data |

### 7.2 Message Format

| Field | Type | Description |
|-------|------|-------------|
| role | "user" | "assistant" | "tool" | Message type |
| content | string | Message text |
| toolCalls | ToolCall[] | Tool invocations |
| toolResults | ToolResult[] | Tool responses |
| timestamp | number | When sent |

### 7.3 Conversation Features

| Feature | Description |
|---------|-------------|
| Auto-save | Fire-and-forget persistence |
| History limit | Max 100 conversations (configurable) |
| Export | Open folder in file explorer |
| Delete | Single or bulk deletion |
| Continue | Resume existing conversation |

---

## 8. Profile & Persona System

### 8.1 Profile Structure

| Field | Type | Description |
|-------|------|-------------|
| id | string | UUID |
| name | string | Display name |
| guidelines | string | Custom instructions |
| mcpConfig | ProfileMcpServerConfig | Server/tool settings |
| modelConfig | ProfileModelConfig | Model preferences |
| skillsConfig | ProfileSkillsConfig | Enabled skills |
| isDefault | boolean | Default profile flag |

### 8.2 Profile MCP Configuration

| Field | Description |
|-------|-------------|
| disabledServers | Servers to disable |
| disabledTools | Tools to disable |
| allServersDisabledByDefault | Opt-in mode |
| enabledServers | Whitelist (opt-in mode) |
| enabledBuiltinTools | Built-in tool whitelist |

### 8.3 Agent Profiles (Unified)

| Feature | Description |
|---------|-------------|
| Profile + Persona merge | Unified agent profile system |
| System prompt | Per-profile custom prompt |
| Delegation targets | ACP agents for routing |
| Auto-spawn | Auto-start agents |

### 8.4 Skills System

| Feature | Description |
|---------|-------------|
| Skill creation | Custom instructions per skill |
| Per-profile enabling | Enable/disable per profile |
| GitHub import | Import from repositories |
| Folder scanning | Auto-import from skills folder |
| Export/import | JSON-based transfer |

---

## 9. Configuration System

### 9.1 Storage Locations

| File | Path | Purpose |
|------|------|---------|
| config.json | `[appData]/[APP_ID]/config.json` | Main settings |
| profiles.json | `userData/profiles.json` | Legacy profiles |
| agent-profiles.json | `userData/agent-profiles.json` | Unified profiles |
| conversations/ | `[appData]/[APP_ID]/conversations/` | Conversation files |
| recordings/ | `[appData]/[APP_ID]/recordings/` | Audio recordings |

### 9.2 Configuration Categories

#### Recording & Shortcuts
- `shortcut`, `customShortcut`, `customShortcutMode`
- `mcpToolsShortcut`, `customMcpToolsShortcut`
- `textInputEnabled`, `textInputShortcut`
- `settingsHotkeyEnabled`, `settingsHotkey`
- `agentKillSwitchEnabled`, `agentKillSwitchHotkey`
- `toggleVoiceDictationEnabled`, `toggleVoiceDictationHotkey`

#### API Credentials
- `openaiApiKey`, `openaiBaseUrl`
- `groqApiKey`, `groqBaseUrl`
- `geminiApiKey`, `geminiBaseUrl`
- `modelPresets[]` (new preset system)
- `currentModelPresetId`

#### Agent/MCP Configuration
- `mcpToolsProviderId`, `mcpToolsOpenaiModel`, etc.
- `mcpToolsSystemPrompt`, `mcpCustomSystemPrompt`
- `mcpRequireApprovalBeforeToolCall`
- `mcpAutoPasteEnabled`, `mcpAutoPasteDelay`
- `mcpMaxIterations`
- `mcpContextReductionEnabled`, `mcpContextTargetRatio`
- `mcpVerifyCompletionEnabled`, `mcpVerifyRetryCount`
- `mcpParallelToolExecution`
- `mcpMessageQueueEnabled`

#### UI & Appearance
- `themePreference`: system | light | dark
- `panelPosition`, `panelCustomPosition`
- `panelDragEnabled`, `panelCustomSize`
- `floatingPanelAutoShow`
- `streamerModeEnabled`

#### App Behavior
- `launchAtLogin`
- `hideDockIcon` (macOS)
- `onboardingCompleted`

### 9.3 Model Preset System

| Field | Description |
|-------|-------------|
| id | Preset UUID |
| name | Display name |
| baseUrl | API endpoint |
| apiKey | Authentication |
| isBuiltIn | System preset flag |
| mcpToolsModel | Agent model override |

### 9.4 Platform-Specific Defaults

| Setting | macOS/Linux | Windows |
|---------|-------------|---------|
| Recording shortcut | hold-ctrl | ctrl-slash |
| Text input shortcut | ctrl-t | ctrl-shift-t |

---

## 10. UI/UX Features

### 10.1 Windows

| Window | Size | Features |
|--------|------|----------|
| **Main** | 900x670 | Sidebar, content area, resizable |
| **Panel** | 200-400px | Floating, always-on-top, frameless |
| **Setup** | 800x600 | Permission setup, non-resizable |

### 10.2 Pages/Routes

| Route | Page | Purpose |
|-------|------|---------|
| `/` | Sessions | Active session grid/list/kanban |
| `/:id` | Session detail | Focus specific session |
| `/history` | Conversation history | Past conversations |
| `/settings` | Settings - General | App preferences |
| `/settings/providers` | Settings - Providers | API configuration |
| `/settings/mcp-tools` | Settings - MCP | Server management |
| `/settings/skills` | Settings - Skills | Skill management |
| `/settings/remote-server` | Settings - Remote | API server config |
| `/settings/whatsapp` | Settings - WhatsApp | WhatsApp integration |
| `/settings/agent-personas` | Settings - Personas | Agent profiles |
| `/settings/external-agents` | Settings - External | ACP agents |
| `/memories` | Memories | Memory management |
| `/panel` | Floating Panel | Recording/progress UI |
| `/onboarding` | Onboarding | First-time setup |
| `/setup` | Setup | Permission setup |

### 10.3 Session Views

| View | Description |
|------|-------------|
| **Grid** | Responsive tile layout |
| **List** | Compact list view |
| **Kanban** | Idle/In Progress/Done columns |

### 10.4 Session Tile Features

| Feature | Description |
|---------|-------------|
| Status indicator | Active spinner, checkmark, error X |
| Title | Conversation title or auto-generated |
| Tool summary | X tools called, Y succeeded |
| Timestamp | Last activity |
| Resize | Draggable height |
| Collapse | Header-only mode |
| Copy | Copy individual messages |
| Follow-up | In-tile message input |
| Snooze | Hide temporarily |
| Pin | Keep visible |

### 10.5 Panel Modes

| Mode | Content |
|------|---------|
| **Normal** | Waveform visualization |
| **Agent** | Progress view, tool execution |
| **TextInput** | Text entry UI |

### 10.6 Theme System

| Mode | Description |
|------|-------------|
| system | Match OS preference |
| light | Light theme |
| dark | Dark theme |

---

## 11. Remote Server & API

### 11.1 Server Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `remoteServerEnabled` | false | Feature toggle |
| `remoteServerPort` | 3210 | Listen port |
| `remoteServerBindAddress` | 127.0.0.1 | Bind address |
| `remoteServerApiKey` | (generated) | Authentication |
| `remoteServerCorsOrigins` | [] | CORS allowed origins |

### 11.2 API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/v1/chat/completions` | Agent execution (OpenAI-compatible) |
| GET | `/v1/models` | List available models |
| GET | `/v1/conversations` | List conversations |
| GET | `/v1/conversations/:id` | Get conversation |
| PUT | `/v1/conversations/:id` | Update conversation |
| GET | `/v1/mcp/servers` | List MCP servers |
| POST | `/v1/mcp/servers/:name/toggle` | Toggle server |
| GET | `/mcp/tools/list` | List available tools |
| POST | `/mcp/tools/call` | Call tool directly |
| POST | `/v1/emergency-stop` | Emergency stop |
| GET | `/v1/profiles` | List profiles |
| GET | `/v1/settings` | Get settings |

### 11.3 Cloudflare Tunnel

| Mode | Description |
|------|-------------|
| **Quick** | Auto-generated tunnel URL |
| **Named** | Persistent tunnel with custom domain |

**Configuration:**
- `cloudflareTunnelMode`: quick | named
- `cloudflareTunnelAutoStart`
- `cloudflareTunnelId`, `cloudflareTunnelHostname`
- `cloudflareTunnelCredentialsPath`

---

## 12. External Integrations

### 12.1 WhatsApp Integration

| Feature | Description |
|---------|-------------|
| QR code auth | Scan with WhatsApp |
| Auto-reply | Automatic agent responses |
| Phone filtering | Allowed numbers whitelist |
| Message logging | Debug logging |

**Configuration:**
- `whatsappEnabled`
- `whatsappAllowFrom[]`
- `whatsappAutoReply`
- `whatsappLogMessages`

### 12.2 ACP (Agent Control Protocol)

| Feature | Description |
|---------|-------------|
| Agent spawning | Launch external agents |
| Inter-agent communication | JSON-RPC protocol |
| Built-in presets | Auggie, Claude Code |
| Tool injection | SpeakMCP built-in tools to agents |

**Configuration:**
- `mainAgentMode`: api | acp
- `mainAgentName`: Routing target
- `acpInjectBuiltinTools`
- `acpAgents[]`: Agent configurations

### 12.3 Langfuse Observability

| Feature | Description |
|---------|-------------|
| LLM tracing | All model calls logged |
| Generation tracking | Input/output/tokens |
| Session grouping | By conversation ID |

**Configuration:**
- `langfuseEnabled`
- `langfusePublicKey`, `langfuseSecretKey`
- `langfuseBaseUrl`

---

## 13. Memory System

### 13.1 Memory Structure

| Field | Type | Description |
|-------|------|-------------|
| id | string | UUID |
| content | string | Memory text |
| importance | low | medium | high | critical | Priority level |
| tags | string[] | Categories |
| createdAt | number | Timestamp |
| profileId | string | Profile scope |

### 13.2 Memory Features

| Feature | Description |
|---------|-------------|
| Auto-save | Important info during sessions |
| Injection | Load into agent context |
| Filtering | By profile, importance, tags |
| Bulk delete | Clear multiple memories |
| Dual-model | Weak model summarizes for memory |

**Configuration:**
- `memoriesEnabled`
- `dualModelAutoSaveImportant`
- `dualModelInjectMemories`

---

## 14. Diagnostics & Observability

### 14.1 Debug Modes

| Flag | Description |
|------|-------------|
| `-d` | All debug logging |
| `-dl` | LLM calls only |
| `-dt` | MCP tool execution only |
| `-dui` | UI/renderer only |

### 14.2 Diagnostic Features

| Feature | Description |
|---------|-------------|
| Error logging | Track recent errors |
| Health check | System diagnostics |
| Server logs | MCP server stderr capture |
| Diagnostic report | Exportable system info |

### 14.3 Remote Debugging

| Method | Description |
|--------|-------------|
| CDP | `REMOTE_DEBUGGING_PORT=9222` |
| DevTools | View menu in dev mode |

---

## 15. Rust CLI Feature Comparison

### 15.1 CLI Implementation Status

| Feature | CLI Status | Notes |
|---------|------------|-------|
| Interactive chat | Implemented | REPL mode |
| Single message | Implemented | `speakmcp send` |
| Configuration | Implemented | TOML file |
| Conversation ID | Implemented | Continue sessions |
| Status check | Implemented | Server connectivity |

### 15.2 Feature Gap Analysis

| Electron Feature | CLI Status | Priority |
|------------------|------------|----------|
| **Voice Input** | Not implemented | N/A (Terminal limitation) |
| **TTS Output** | Not implemented | N/A (Terminal limitation) |
| **MCP Server Management** | Not implemented | High |
| **Profile Management** | Not implemented | High |
| **Settings UI** | CLI only (config file) | Medium |
| **Emergency Stop** | Not implemented | Medium |
| **Streaming Responses** | Prepared, not used | Medium |
| **Conversation History** | Current session only | Medium |
| **Tool Direct Calling** | Not implemented | Low |
| **WhatsApp** | Not implemented | N/A |
| **Memories** | Not implemented | Low |

### 15.3 CLI Architecture

```
CLI (Rust)
  ↓ HTTP (Bearer auth)
Electron Remote Server (Fastify)
  ↓ Internal services
- MCP Service
- LLM Module
- Conversation Service
```

---

## 16. Feature Checklist for CLI Parity

### 16.1 Core Features

| Feature | Electron | CLI | Notes |
|---------|----------|-----|-------|
| Send message to agent | Yes | Yes | Via remote server |
| Receive agent response | Yes | Yes | Via remote server |
| Tool execution (auto) | Yes | Delegated | Agent handles |
| Tool visualization | Yes | Yes (stderr) | Optional display |
| Conversation context | Yes | Yes | Via conversation_id |
| New conversation | Yes | Yes | /new command |

### 16.2 Configuration

| Feature | Electron | CLI | Notes |
|---------|----------|-----|-------|
| API key storage | config.json | cli.toml | Different locations |
| Server URL config | Yes | Yes | CLI + env + file |
| Provider selection | UI | Hardcoded | CLI sends "gpt-4o" |
| Model selection | UI | Not implemented | Server overrides |
| Profile switching | Yes | Not implemented | Gap |

### 16.3 MCP Features

| Feature | Electron | CLI | Notes |
|---------|----------|-----|-------|
| Server list | Yes | Not implemented | Gap |
| Server toggle | Yes | Not implemented | Gap |
| Tool list | Yes | Not implemented | Gap |
| Direct tool call | Yes | Not implemented | Gap |

### 16.4 Conversation Features

| Feature | Electron | CLI | Notes |
|---------|----------|-----|-------|
| History browsing | Yes | Not implemented | Gap |
| Load past conversation | Yes | Partial | Can continue with ID |
| Export conversation | Yes | Not implemented | Gap |
| Delete conversation | Yes | Not implemented | Gap |

### 16.5 Session Management

| Feature | Electron | CLI | Notes |
|---------|----------|-----|-------|
| Multiple sessions | Yes | One at a time | CLI limitation |
| Session snooze | Yes | N/A | UI feature |
| Session pin | Yes | N/A | UI feature |
| Emergency stop | Yes | Not implemented | Gap |

### 16.6 Recommended CLI Enhancements

**High Priority:**
1. `speakmcp servers list` - List MCP servers and status
2. `speakmcp servers toggle <name>` - Enable/disable server
3. `speakmcp profiles list` - List available profiles
4. `speakmcp profiles switch <name>` - Switch active profile
5. Streaming response consumption (SSE)

**Medium Priority:**
1. `speakmcp history` - Browse past conversations
2. `speakmcp history load <id>` - Load and display conversation
3. `speakmcp stop` - Emergency stop
4. `speakmcp tools list` - List available tools
5. `speakmcp settings show` - Display current settings

**Low Priority:**
1. `speakmcp tools call <name>` - Direct tool execution
2. `speakmcp memories list` - List memories
3. `speakmcp export <conversation_id>` - Export conversation

---

## Appendix A: IPC Handlers Reference

Total: 150+ IPC handlers in tipc.ts

### Categories:
- App Lifecycle (5)
- Window Management (20+)
- Recording & Text Input (15)
- Agent & Session Management (15)
- Tool Approval (1)
- Configuration (3)
- MCP Management (15)
- Conversations (10)
- Profiles (15)
- OAuth (4)
- Keyboard & Accessibility (5)
- TTS (1)
- Models (2)
- Diagnostics (5)
- WhatsApp (4)
- Cloudflare Tunnel (6)
- MCP Protocol Extensions (2)
- Message Queue (5)
- Langfuse (1)

---

## Appendix B: Configuration Defaults

See `apps/desktop/src/main/config.ts` for complete defaults.

Key defaults:
- Max iterations: 10
- Context target ratio: 0.7
- Tool response large threshold: 20KB
- Tool response critical threshold: 50KB
- API retry count: 3
- Remote server port: 3210
- Max conversations: 100

---

## Appendix C: File Locations

| Component | Path |
|-----------|------|
| Main Process | apps/desktop/src/main/ |
| Renderer | apps/desktop/src/renderer/ |
| Shared Types | apps/desktop/src/shared/ |
| Rust Binary | apps/desktop/speakmcp-rs/ |
| CLI | apps/cli/ |
| Shared Package | packages/shared/ |

---

*End of PRD Document*
