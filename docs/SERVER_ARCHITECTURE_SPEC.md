# SpeakMCP Server Architecture Specification

## Overview

This document provides a comprehensive audit of the SpeakMCP desktop application functionality and serves as a specification for refactoring to a central server architecture that can support multiple client interfaces (Electron, Mobile, Web, Tauri, etc.).

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Core Services (Server-Side)](#core-services-server-side)
3. [Platform-Specific Features (Client-Side)](#platform-specific-features-client-side)
4. [API Endpoints](#api-endpoints)
5. [Data Models](#data-models)
6. [Real-Time Communication](#real-time-communication)
7. [Built-in Tools](#built-in-tools)
8. [Data Persistence](#data-persistence)
9. [Migration Strategy](#migration-strategy)
10. [Security Considerations](#security-considerations)
11. [Implementation Checklist](#implementation-checklist)
12. [Client SDK](#client-sdk)
13. [Notes & Recommendations](#notes--recommendations)

---

## Architecture Overview

### Current Architecture
```
+------------------+     IPC (tipc)     +------------------+
|   Renderer       | <----------------> |   Main Process   |
|   (React UI)     |                    |   (Electron)     |
+------------------+                    +------------------+
                                              |
                                              v
                                        +----------+
                                        |  MCP     |
                                        |  Servers |
                                        +----------+
```

The desktop app is built with Electron and uses:
- **Main Process**: Core business logic, IPC handlers, native integrations
- **Renderer Process**: React-based UI
- **TIPC (@egoist/tipc)**: Type-safe IPC communication (100+ procedures)
- **MCP SDK**: Model Context Protocol for AI tool calling

### Target Architecture
```
+------------------+     HTTP/WS      +------------------+
|   Any UI Client  | <--------------> |   Central Server |
|   (Electron,     |                  |   (Node.js/Bun)  |
|    Mobile,       |                  +------------------+
|    Web,          |                        |
|    Tauri, etc.)  |                        v
+------------------+                  +----------+
                                      |  MCP     |
                                      |  Servers |
                                      +----------+
```

---

## Core Services (Server-Side)

### 1. Core AI/LLM Services

#### 1.1 Agent Mode Processing (`llm.ts`)
| Feature | Description | Server-Side | Client-Side |
|---------|-------------|-------------|-------------|
| `processTranscriptWithAgentMode()` | Multi-iteration LLM processing with tool calling | ✅ | |
| `executeToolWithRetries()` | Tool execution with retry logic | ✅ | |
| Context extraction from history | Extract relevant context for LLM | ✅ | |
| Verification loop | Schema-based completion checking | ✅ | |
| Streaming callbacks | Real-time response streaming | ✅ | WebSocket/SSE |
| Kill switch integration | Emergency stop functionality | ✅ | Trigger only |
| Context budget management | Token estimation and summarization | ✅ | |

#### 1.2 MCP Service (`mcp-service.ts`)
| Feature | Description | Server-Side | Client-Side |
|---------|-------------|-------------|-------------|
| Server initialization | Connect to MCP servers (stdio/websocket/http) | ✅ | |
| Tool discovery | List available tools from servers | ✅ | |
| Tool execution | Execute MCP tool calls | ✅ | |
| OAuth 2.1 support | Authentication for remote MCP servers | ✅ | |
| Elicitation handling | Form/URL mode user input requests | ✅ | UI only |
| Sampling requests | Server-initiated LLM completions | ✅ | Approval UI |
| Server lifecycle | Start/stop/restart servers | ✅ | |
| Resource tracking | Track active sessions/connections | ✅ | |
| Response processing | Summarize large tool responses | ✅ | |

#### 1.3 Speech-to-Text (STT)
| Feature | Description | Server-Side | Client-Side |
|---------|-------------|-------------|-------------|
| OpenAI Whisper | Transcription via OpenAI API | ✅ | |
| Groq Whisper | Transcription via Groq API | ✅ | |
| Language selection | Configure transcription language | ✅ | |
| Prompt customization | Custom prompts for Groq STT | ✅ | |

#### 1.4 Text-to-Speech (TTS)
| Feature | Description | Server-Side | Client-Side |
|---------|-------------|-------------|-------------|
| OpenAI TTS | Speech synthesis via OpenAI | ✅ | |
| Groq TTS (Orpheus) | Speech synthesis via Groq | ✅ | |
| Gemini TTS | Speech synthesis via Google | ✅ | |
| Text preprocessing | LLM or regex-based text cleanup | ✅ | |
| Voice/model selection | Configure voice and model | ✅ | |

#### 1.5 Transcript Post-Processing
| Feature | Description | Server-Side | Client-Side |
|---------|-------------|-------------|-------------|
| LLM post-processing | Clean up transcripts with LLM | ✅ | |
| Provider selection | OpenAI/Groq/Gemini for processing | ✅ | |

---

### 2. Data Management Services

#### 2.1 Conversation Service (`conversation-service.ts`)
| Feature | Description | Server-Side | Client-Side |
|---------|-------------|-------------|-------------|
| `createConversation()` | Create new conversation | ✅ | |
| `loadConversation()` | Load conversation by ID | ✅ | |
| `saveConversation()` | Persist conversation | ✅ | |
| `addMessageToConversation()` | Add message with tool calls/results | ✅ | |
| `deleteConversation()` | Delete conversation | ✅ | |
| `getConversationHistory()` | List all conversations | ✅ | |
| JSON file storage | Filesystem persistence | ✅ (DB) | |

#### 2.2 Profile Service (`profile-service.ts`)
| Feature | Description | Server-Side | Client-Side |
|---------|-------------|-------------|-------------|
| Profile CRUD | Create/read/update/delete profiles | ✅ | |
| Current profile management | Set/get active profile | ✅ | |
| MCP config per profile | Server/tool enable/disable per profile | ✅ | |
| Model config per profile | Provider/model settings per profile | ✅ | |
| Import/export profiles | JSON serialization | ✅ | |
| Session profile snapshots | Freeze profile at session start | ✅ | |

#### 2.3 Configuration Store (`config.ts`)
| Feature | Description | Server-Side | Client-Side |
|---------|-------------|-------------|-------------|
| App configuration | All settings storage | ✅ | |
| Migration logic | Config version upgrades | ✅ | |
| Model presets | Custom OpenAI-compatible endpoints | ✅ | |
| Default values | Sensible defaults for all settings | ✅ | |

---

### 3. Session Management

#### 3.1 Agent Session Tracker (`agent-session-tracker.ts`)
| Feature | Description | Server-Side | Client-Side |
|---------|-------------|-------------|-------------|
| Session lifecycle | Start/complete/error/stop sessions | ✅ | |
| Multiple concurrent sessions | Track many active sessions | ✅ | |
| Session snoozing | Background execution without UI | ✅ | |
| Session revival | Resume completed sessions | ✅ | |
| Profile snapshot binding | Isolate sessions from profile changes | ✅ | |

#### 3.2 Agent Session State (`state.ts`)
| Feature | Description | Server-Side | Client-Side |
|---------|-------------|-------------|-------------|
| Per-session state | Abort controllers, processes, iteration count | ✅ | |
| Kill switch per session | Stop individual sessions | ✅ | |
| Process management | Track child processes per session | ✅ | |
| Tool approval management | Inline approval for tool calls | ✅ | UI only |

#### 3.3 Message Queue Service (`message-queue-service.ts`)
| Feature | Description | Server-Side | Client-Side |
|---------|-------------|-------------|-------------|
| Queue messages | Queue while agent is processing | ✅ | |
| Sequential processing | Process queued messages in order | ✅ | |
| Queue pause/resume | Control queue execution | ✅ | |
| Failed message retry | Retry failed queued messages | ✅ | |

---

### 4. External APIs

#### 4.1 Remote Server (`remote-server.ts`)
| Feature | Description | Server-Side | Client-Side |
|---------|-------------|-------------|-------------|
| HTTP API (Fastify) | REST API for external access | ✅ | |
| OpenAI-compatible endpoint | `/v1/chat/completions` | ✅ | |
| SSE streaming | Real-time response streaming | ✅ | |
| Bearer token auth | API key authentication | ✅ | |
| Profile management API | List/set profiles | ✅ | |
| MCP server management API | List/toggle servers | ✅ | |
| Settings API | Get/update settings | ✅ | |
| Emergency stop API | Kill switch endpoint | ✅ | |

---

## Platform-Specific Features (Client-Side Only)

These features are inherently client-side and should NOT be extracted to the server. Each client platform implements its own version.

### 1. Keyboard Shortcuts (`keyboard.ts`)

| Feature | Description | Migration Notes |
|---------|-------------|-----------------|
| Global keyboard hooks | Native `speakmcp-rs` Rust binary | Each platform needs native implementation |
| Hold-to-record | Ctrl, Ctrl+Alt combinations | Platform keyboard APIs |
| Toggle shortcuts | Fn, F1-F12 keys | Platform keyboard APIs |
| Kill switch | Ctrl+Shift+Escape, etc. | Platform keyboard APIs |
| Text input mode | Ctrl+T quick text entry | Platform keyboard APIs |
| Settings hotkey | Quick settings access | Platform keyboard APIs |

**Native Paste (`writeText`)**: Uses Rust binary for native keyboard simulation to type text into focused app. Mobile/web can use clipboard API, native apps need platform-specific code.

### 2. Window Management (`window.ts`)

| Feature | Description | Migration Notes |
|---------|-------------|-----------------|
| Panel window | Floating overlay for recording/agent | Each platform's window system |
| Main window | Settings and history | Standard app window |
| Panel positioning | Custom position/size persistence | Platform window APIs |
| Panel modes | Normal/agent/textInput modes | State management |
| Always-on-top | Panel stays visible over other apps | Platform window flags |
| Tray icon | System tray presence | Platform system tray APIs |
| Context menu | Quick actions from tray | Platform menu APIs |

### 3. Audio Recording (`recorder.ts` in renderer)

| Feature | Description | Migration Notes |
|---------|-------------|-----------------|
| Web Audio API | Capture audio from microphone | Web: MediaRecorder, Native: platform APIs |
| Waveform visualization | Real-time audio feedback | Client-side rendering |
| Recording history | Local audio file storage | Could move to server (object storage) |

### 4. Audio Playback (`tts-manager.ts`, `audio-player.tsx`)

| Feature | Description | Migration Notes |
|---------|-------------|-----------------|
| TTS playback | Play synthesized speech | Each platform's audio APIs |
| Sound effects | begin-record, end-record sounds | Platform audio playback |
| Queue management | Sequential audio playback | Client-side state |

### 5. Focus Management

| Feature | Description | Migration Notes |
|---------|-------------|-----------------|
| Track focused app | Remember app before recording | macOS/Windows APIs only |
| Restore focus | Return to original app after paste | Platform-specific |
| Auto-paste | Type transcribed text into target app | Native keyboard simulation |

**Note**: Web clients cannot access focus information outside the browser.

### 6. System Integration

| Feature | Description | Migration Notes |
|---------|-------------|-----------------|
| Accessibility permissions | Required for keyboard hooks (macOS) | macOS-specific |
| Microphone permissions | Request/check permission | Platform permission APIs |
| Login item (auto-start) | Launch on system boot | Platform-specific |
| Dock icon visibility | Show/hide dock icon (macOS) | macOS-specific |

### 7. Auto-Update (`updater.ts`)

| Feature | Description | Migration Notes |
|---------|-------------|-----------------|
| Check for updates | Query GitHub releases | Electron-updater, each platform different |
| Download updates | Background download | Platform-specific |
| Quit and install | Apply updates | Platform-specific |

---

### 6. Diagnostics & Monitoring

#### 6.1 Diagnostics Service (`diagnostics.ts`)
| Feature | Description | Server-Side | Client-Side |
|---------|-------------|-------------|-------------|
| Error logging | In-memory error log | ✅ | |
| Health checks | System health status | ✅ | |
| Diagnostic reports | System info, config, MCP status | ✅ | |
| Save reports | Export to file | ✅ | File dialog |

---

## API Endpoints to Implement

Based on the TIPC router analysis, here are all procedures that need server API equivalents:

### Authentication & App Lifecycle
- `POST /api/auth/login` - User authentication (new)
- `POST /api/auth/logout` - User logout (new)
- `GET /api/health` - Health check

### Agent/LLM Operations
- `POST /api/agent/process` - Process text with agent mode
- `POST /api/agent/process-audio` - Process audio recording
- `POST /api/agent/stop/{sessionId}` - Stop specific session
- `POST /api/agent/stop-all` - Emergency stop all sessions
- `GET /api/agent/sessions` - List active sessions
- `GET /api/agent/sessions/{sessionId}` - Get session details
- `POST /api/agent/sessions/{sessionId}/snooze` - Snooze session
- `POST /api/agent/sessions/{sessionId}/unsnooze` - Unsnooze session
- `POST /api/agent/tool-approval/{approvalId}` - Respond to tool approval
- `WebSocket /api/agent/progress` - Real-time progress updates

### Conversations
- `GET /api/conversations` - List conversations
- `POST /api/conversations` - Create conversation
- `GET /api/conversations/{id}` - Load conversation
- `PUT /api/conversations/{id}` - Save conversation
- `DELETE /api/conversations/{id}` - Delete conversation
- `POST /api/conversations/{id}/messages` - Add message
- `DELETE /api/conversations` - Delete all conversations

### Message Queue
- `GET /api/conversations/{id}/queue` - Get message queue
- `POST /api/conversations/{id}/queue` - Add to queue
- `DELETE /api/conversations/{id}/queue/{messageId}` - Remove from queue
- `POST /api/conversations/{id}/queue/pause` - Pause queue
- `POST /api/conversations/{id}/queue/resume` - Resume queue
- `POST /api/conversations/{id}/queue/{messageId}/retry` - Retry failed message

### Profiles
- `GET /api/profiles` - List profiles
- `POST /api/profiles` - Create profile
- `GET /api/profiles/{id}` - Get profile
- `PUT /api/profiles/{id}` - Update profile
- `DELETE /api/profiles/{id}` - Delete profile
- `POST /api/profiles/{id}/activate` - Set current profile
- `GET /api/profiles/current` - Get current profile
- `POST /api/profiles/{id}/export` - Export profile
- `POST /api/profiles/import` - Import profile
- `PUT /api/profiles/{id}/mcp-config` - Update MCP config
- `PUT /api/profiles/{id}/model-config` - Update model config

### MCP Servers
- `GET /api/mcp/servers` - List MCP servers with status
- `POST /api/mcp/servers/{name}/toggle` - Enable/disable server
- `POST /api/mcp/servers/{name}/restart` - Restart server
- `POST /api/mcp/servers/{name}/stop` - Stop server
- `GET /api/mcp/servers/{name}/logs` - Get server logs
- `DELETE /api/mcp/servers/{name}/logs` - Clear server logs
- `POST /api/mcp/servers/{name}/test` - Test connection
- `GET /api/mcp/tools` - List all tools with status
- `POST /api/mcp/tools/{name}/toggle` - Enable/disable tool
- `GET /api/mcp/initialization-status` - Get init progress

### MCP OAuth
- `POST /api/mcp/oauth/{serverName}/initiate` - Start OAuth flow
- `POST /api/mcp/oauth/{serverName}/complete` - Complete OAuth
- `GET /api/mcp/oauth/{serverName}/status` - Get OAuth status
- `POST /api/mcp/oauth/{serverName}/revoke` - Revoke tokens

### MCP Elicitation & Sampling
- `POST /api/mcp/elicitation/{requestId}/resolve` - Resolve elicitation
- `POST /api/mcp/sampling/{requestId}/resolve` - Resolve sampling

### Configuration
- `GET /api/config` - Get configuration
- `PUT /api/config` - Update configuration
- `POST /api/config/validate-mcp` - Validate MCP config
- `POST /api/config/load-mcp-file` - Load MCP config from file
- `POST /api/config/save-mcp-file` - Save MCP config to file

### Models
- `GET /api/models/{providerId}` - Fetch available models
- `POST /api/models/fetch-for-preset` - Fetch models for custom preset

### Speech
- `POST /api/speech/transcribe` - Transcribe audio (STT)
- `POST /api/speech/synthesize` - Generate speech (TTS)

### Diagnostics
- `GET /api/diagnostics/report` - Generate diagnostic report
- `GET /api/diagnostics/health` - Perform health check
- `GET /api/diagnostics/errors` - Get recent errors
- `DELETE /api/diagnostics/errors` - Clear error log

### MCP Registry
- `GET /api/mcp/registry` - Fetch registry servers
- `DELETE /api/mcp/registry/cache` - Clear registry cache

---

## Data Models

### Core Types (from `shared/types.ts`)

```typescript
// Configuration
interface Config {
  // API Keys & Endpoints
  openaiApiKey?: string
  openaiBaseUrl?: string
  groqApiKey?: string
  groqBaseUrl?: string
  geminiApiKey?: string
  geminiBaseUrl?: string
  
  // MCP Configuration
  mcpConfig?: MCPConfig
  mcpRuntimeDisabledServers?: string[]
  mcpDisabledTools?: string[]
  mcpMaxIterations?: number
  mcpRequireApprovalBeforeToolCall?: boolean
  mcpMessageQueueEnabled?: boolean
  
  // STT Settings
  sttProviderId?: "openai" | "groq"
  sttLanguage?: string
  
  // TTS Settings
  ttsEnabled?: boolean
  ttsProviderId?: "openai" | "groq" | "gemini"
  
  // Agent Settings
  mcpToolsProviderId?: "openai" | "groq" | "gemini"
  mcpToolsSystemPrompt?: string
  mcpCustomSystemPrompt?: string
  
  // Model Presets
  modelPresets?: ModelPreset[]
  currentModelPresetId?: string
  
  // Remote Server
  remoteServerEnabled?: boolean
  remoteServerPort?: number
  remoteServerApiKey?: string
}

// MCP Configuration
interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>
}

interface MCPServerConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  transport?: MCPTransportType
  timeout?: number
  disabled?: boolean
}

// Profiles
interface Profile {
  id: string
  name: string
  guidelines: string
  systemPrompt?: string
  mcpServerConfig?: ProfileMcpServerConfig
  modelConfig?: ProfileModelConfig
  createdAt: number
  updatedAt: number
}

interface SessionProfileSnapshot {
  profileId: string
  profileName: string
  guidelines?: string
  systemPrompt?: string
  mcpServerConfig?: ProfileMcpServerConfig
  modelConfig?: ProfileModelConfig
}

// Conversations
interface Conversation {
  id: string
  title: string
  messages: ConversationMessage[]
  createdAt: number
  updatedAt: number
}

interface ConversationMessage {
  id: string
  role: "user" | "assistant" | "tool"
  content: string
  timestamp: number
  toolCalls?: Array<{ name: string; arguments: any }>
  toolResults?: Array<{ success: boolean; content: string; error?: string }>
}

// Agent Progress
interface AgentProgressUpdate {
  sessionId: string
  conversationId?: string
  conversationTitle?: string
  currentIteration: number
  maxIterations: number
  steps: AgentProgressStep[]
  isComplete: boolean
  isSnoozed?: boolean
  finalContent?: string
  conversationHistory?: Array<{...}>
  pendingToolApproval?: {...}
}

// Message Queue
interface QueuedMessage {
  id: string
  conversationId: string
  text: string
  status: "pending" | "processing" | "failed"
  createdAt: number
  error?: string
  addedToHistory?: boolean
}
```

---

## Real-Time Communication

### WebSocket Events

The server should support WebSocket connections for real-time updates:

```typescript
// Client -> Server
interface ClientMessage {
  type: "subscribe" | "unsubscribe"
  channel: "agent-progress" | "sessions" | "queue"
  sessionId?: string
  conversationId?: string
}

// Server -> Client
interface ServerMessage {
  type: "agent-progress" | "session-update" | "queue-update" | "elicitation-request" | "sampling-request"
  data: AgentProgressUpdate | AgentSession | QueuedMessage[] | ElicitationRequest | SamplingRequest
}
```

### SSE Endpoints (Alternative)

For simpler clients, Server-Sent Events can be used:
- `GET /api/agent/progress/{sessionId}/stream` - Stream progress updates
- `GET /api/conversations/{id}/queue/stream` - Stream queue updates

---

## Built-in Tools

SpeakMCP provides its own built-in tools for settings management via MCP. These become native server endpoints:

| Tool | Description | Server Endpoint |
|------|-------------|-----------------|
| `list_mcp_servers` | List MCP servers and status | `GET /api/mcp/servers` |
| `toggle_mcp_server` | Enable/disable MCP server | `POST /api/mcp/servers/{name}/toggle` |
| `list_profiles` | List profiles | `GET /api/profiles` |
| `switch_profile` | Switch active profile | `POST /api/profiles/{id}/activate` |
| `get_current_profile` | Get current profile | `GET /api/profiles/current` |
| `list_running_agents` | List active agent sessions | `GET /api/agent/sessions` |
| `kill_agent` | Kill specific agent | `POST /api/agent/stop/{sessionId}` |
| `kill_all_agents` | Emergency stop all | `POST /api/agent/stop-all` |
| `get_settings` | Get app settings | `GET /api/config` |
| `toggle_post_processing` | Toggle post-processing | `PATCH /api/config` |
| `toggle_tts` | Toggle TTS | `PATCH /api/config` |
| `toggle_tool_approval` | Toggle tool approval | `PATCH /api/config` |

---

## Data Persistence

### Current Storage Locations

| Data | Location | Format | Migration Target |
|------|----------|--------|------------------|
| Config | `{appData}/config.json` | JSON | SQLite for atomic updates |
| Profiles | `{appData}/profiles.json` | JSON | SQLite for relationships |
| Conversations | `{appData}/conversations/*.json` | JSON files | SQLite for querying |
| Recordings | `{appData}/recordings/*.webm` | Audio files | Object storage (S3-compatible) |
| Recording History | `{appData}/recordings/history.json` | JSON | SQLite |
| OAuth Tokens | `{appData}/oauth/*.json` | JSON | Encrypted secure storage |

### Migration Considerations
- Config could use SQLite for atomic updates
- Conversations would benefit from SQLite for better querying
- OAuth tokens need secure encrypted storage
- Recordings could use object storage (S3-compatible) for scalability

---

## Migration Strategy

### Priority Matrix

#### Phase 1: Essential (MVP)
| Feature | Priority | Effort | Notes |
|---------|----------|--------|-------|
| Configuration API | P0 | Low | Foundation for everything |
| Profile Service | P0 | Medium | Controls MCP/model config |
| MCP Service | P0 | High | Core functionality |
| Agent Processing (SSE) | P0 | High | Main value prop |
| Conversation Service | P0 | Medium | State management |
| STT API | P0 | Medium | Voice input |

#### Phase 2: Enhanced
| Feature | Priority | Effort | Notes |
|---------|----------|--------|-------|
| TTS API | P1 | Medium | Voice output |
| Session Tracking | P1 | Medium | Multi-session support |
| Message Queue | P1 | Low | Async message handling |
| Models Service | P1 | Low | Model selection |
| OAuth Flow | P1 | Medium | MCP authentication |

#### Phase 3: Polish
| Feature | Priority | Effort | Notes |
|---------|----------|--------|-------|
| Diagnostics | P2 | Low | Debug/support |
| MCP Registry | P2 | Low | Discovery |
| Built-in Tools | P2 | Medium | Settings management |

### Implementation Phases

#### Phase 1: Extract Core Services
1. Create standalone Node.js/Bun server package (`packages/server`)
2. Move conversation-service, profile-service, mcp-service
3. Implement REST API layer with Fastify
4. Add WebSocket/SSE support for real-time updates

#### Phase 2: Database Migration
1. Replace JSON file storage with SQLite/PostgreSQL
2. Implement proper data migrations
3. Add user authentication layer

#### Phase 3: Client Adaptation
1. Create shared API client package (`packages/client`)
2. Update Electron app to use HTTP/WebSocket
3. Keep platform-specific features in Electron

#### Phase 4: Multi-Client Support
1. Build web client
2. Build mobile client (React Native)
3. Build Tauri client

---

## Security Considerations

### Authentication
- JWT-based authentication for API access
- API key support for programmatic access
- Session management with refresh tokens

### Authorization
- User-scoped data access
- Profile-level permissions
- MCP server access control

### Data Protection
- Encrypt API keys at rest
- Secure WebSocket connections (WSS)
- Rate limiting on API endpoints
- CORS configuration for web clients

---

## Implementation Checklist

### Server Setup
- [ ] Create new `packages/server` package
- [ ] Set up Fastify with TypeScript
- [ ] Move existing `remote-server.ts` as base
- [ ] Add SQLite for persistence
- [ ] Implement authentication middleware
- [ ] Add request validation (Zod/TypeBox)
- [ ] Add error handling middleware
- [ ] Add rate limiting
- [ ] Add CORS configuration

### Core Services Migration
- [ ] Extract `config-service.ts`
- [ ] Extract `profile-service.ts` (already mostly standalone)
- [ ] Extract `mcp-service.ts` (complex, careful refactoring)
- [ ] Extract `conversation-service.ts`
- [ ] Extract `llm-service.ts`
- [ ] Extract `agent-service.ts` (agent loop logic)
- [ ] Extract `message-queue-service.ts`

### API Implementation
- [ ] Implement all REST endpoints (~60 endpoints)
- [ ] Add SSE streaming for agent progress
- [ ] Add WebSocket support for bidirectional communication
- [ ] Implement tool approval flow over WebSocket
- [ ] Implement elicitation/sampling flow

### Client SDK
- [ ] Create `packages/client` package
- [ ] Implement TypeScript SDK
- [ ] Add retry logic with exponential backoff
- [ ] Add streaming support (SSE/WebSocket)
- [ ] Add offline queue support

### Desktop Client Refactor
- [ ] Create HTTP client wrapper
- [ ] Replace IPC calls with HTTP/WebSocket
- [ ] Keep UI-specific code in renderer
- [ ] Maintain offline fallback (optional)

### Mobile Client
- [ ] Use client SDK
- [ ] Implement audio recording (platform APIs)
- [ ] Implement audio playback
- [ ] Handle background processing
- [ ] Push notifications for agent completion

---

## Client SDK

### TypeScript SDK Interface

```typescript
interface SpeakMCPClient {
  // Agent
  processAgent(input: string | Blob, options?: AgentOptions): AsyncIterable<AgentProgress>
  stopAgent(sessionId?: string): Promise<void>
  stopAllAgents(): Promise<void>
  getAgentSessions(): Promise<AgentSession[]>
  respondToToolApproval(approvalId: string, approved: boolean): Promise<void>

  // STT/TTS
  transcribe(audio: Blob, options?: STTOptions): Promise<string>
  speak(text: string, options?: TTSOptions): Promise<Blob>

  // Config
  getConfig(): Promise<Config>
  updateConfig(patch: Partial<Config>): Promise<Config>

  // Profiles
  getProfiles(): Promise<Profile[]>
  getProfile(id: string): Promise<Profile>
  createProfile(data: CreateProfileInput): Promise<Profile>
  updateProfile(id: string, data: UpdateProfileInput): Promise<Profile>
  deleteProfile(id: string): Promise<void>
  switchProfile(id: string): Promise<Profile>
  getCurrentProfile(): Promise<Profile>

  // MCP
  getServers(): Promise<MCPServer[]>
  toggleServer(name: string, enabled: boolean): Promise<void>
  restartServer(name: string): Promise<void>
  getTools(): Promise<MCPTool[]>
  toggleTool(name: string, enabled: boolean): Promise<void>

  // Conversations
  getConversations(): Promise<ConversationSummary[]>
  getConversation(id: string): Promise<Conversation>
  createConversation(firstMessage: string): Promise<Conversation>
  deleteConversation(id: string): Promise<void>
  addMessage(conversationId: string, message: MessageInput): Promise<ConversationMessage>

  // Message Queue
  getQueue(conversationId: string): Promise<QueuedMessage[]>
  enqueue(conversationId: string, text: string): Promise<QueuedMessage>
  removeFromQueue(conversationId: string, messageId: string): Promise<void>
  pauseQueue(conversationId: string): Promise<void>
  resumeQueue(conversationId: string): Promise<void>

  // Real-time subscriptions
  onProgress(callback: (update: AgentProgress) => void): Unsubscribe
  onSessionUpdate(callback: (session: AgentSession) => void): Unsubscribe
  onElicitation(callback: (request: ElicitationRequest) => void): Unsubscribe
  onSampling(callback: (request: SamplingRequest) => void): Unsubscribe
}

// Factory function
function createSpeakMCPClient(options: {
  baseUrl: string
  apiKey?: string
  onAuthError?: () => void
}): SpeakMCPClient
```

---

## Notes & Recommendations

### What Already Works
The `remote-server.ts` already provides a good foundation with:
- OpenAI-compatible `/v1/chat/completions` endpoint
- SSE streaming for agent progress
- Profile and MCP server management
- Settings API
- Bearer token authentication

**Recommendation**: Start by expanding `remote-server.ts` rather than rewriting from scratch.

### Key Challenges

1. **MCP Server Management**: MCP servers are child processes; need to handle lifecycle across network boundary. Consider:
   - Running MCP servers on the server
   - Proxy model where server manages connections

2. **Audio Streaming**: Large audio files need chunked upload/download. Consider:
   - Multipart upload for audio
   - Streaming response for TTS

3. **Session State**: Agent sessions need to be tracked server-side with proper cleanup on disconnect.

4. **Real-time Updates**: SSE works for uni-directional updates, but WebSocket may be better for:
   - Tool approval requests
   - Elicitation requests
   - Sampling approval
   - Bidirectional message queue

5. **Profile Snapshots**: Sessions freeze profile at start; need to maintain this isolation in server architecture.

### Technology Recommendations

- **Runtime**: Node.js or Bun for performance
- **Framework**: Fastify (already in use, proven)
- **Database**: SQLite for single-instance, PostgreSQL for multi-instance
- **Real-time**: SSE for simple clients, WebSocket for full functionality
- **Authentication**: API Key (current) + optional JWT/OAuth2 for user accounts

---

## Appendix: TIPC Procedure Mapping

Complete mapping of all 100+ TIPC procedures to server API endpoints. Key categories:

| Category | Count | Description |
|----------|-------|-------------|
| App Lifecycle | 5 | restart, update, quit |
| Window Management | 15 | panel, main window, positioning |
| Agent Operations | 12 | process, stop, sessions, approval |
| Conversations | 8 | CRUD, messages |
| Message Queue | 10 | queue management |
| Profiles | 15 | CRUD, MCP/model config |
| MCP Servers | 12 | lifecycle, tools, OAuth |
| Configuration | 8 | get/save, validation |
| Speech | 3 | STT, TTS |
| Diagnostics | 5 | health, errors, reports |
| Platform-Specific | 10+ | keyboard, accessibility, clipboard |

**Note**: Platform-specific procedures (Window Management, some App Lifecycle) remain client-side. All others migrate to server API endpoints.
