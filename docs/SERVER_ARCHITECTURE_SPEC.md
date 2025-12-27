# SpeakMCP Server Architecture Specification

## Overview

This document provides a comprehensive audit of the SpeakMCP desktop application functionality and serves as a specification for refactoring to a central server architecture that can support multiple client interfaces (Electron, Mobile, Web, Tauri, etc.).

## Current Architecture

The desktop app is built with Electron and uses:
- **Main Process**: Core business logic, IPC handlers, native integrations
- **Renderer Process**: React-based UI
- **TIPC (@egoist/tipc)**: Type-safe IPC communication
- **MCP SDK**: Model Context Protocol for AI tool calling

---

## Functionality Audit

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

### 5. Platform-Specific Features (Client-Side Only)

#### 5.1 Keyboard & Input (`keyboard.ts`)
| Feature | Description | Notes |
|---------|-------------|-------|
| Global keyboard hooks | Native `speakmcp-rs` binary | Platform-specific |
| Hold-to-record shortcuts | Configurable key combinations | Platform-specific |
| Kill switch hotkeys | Ctrl+Shift+Escape, etc. | Platform-specific |
| Text input shortcuts | Quick text entry | Platform-specific |
| Focus capture/restore | Track focused app | Platform-specific |
| `writeText()` | Type text into focused app | Platform-specific |

#### 5.2 Window Management (`window.ts`)
| Feature | Description | Notes |
|---------|-------------|-------|
| Panel window | Floating overlay for recording/agent | Electron-specific |
| Main window | Settings and history | Electron-specific |
| Panel positioning | Custom position/size | Electron-specific |
| Panel modes | Normal/agent/textInput | Electron-specific |
| Always-on-top | Panel stays visible | Electron-specific |

#### 5.3 System Tray (`tray.ts`)
| Feature | Description | Notes |
|---------|-------------|-------|
| Tray icon | System tray presence | Platform-specific |
| Context menu | Quick actions | Platform-specific |
| Recording indicator | Visual feedback | Platform-specific |

#### 5.4 Auto-Update (`updater.ts`)
| Feature | Description | Notes |
|---------|-------------|-------|
| Check for updates | GitHub releases | Electron-specific |
| Download updates | Background download | Electron-specific |
| Quit and install | Apply updates | Electron-specific |

#### 5.5 Accessibility & Permissions
| Feature | Description | Notes |
|---------|-------------|-------|
| Microphone access | Request/check permission | Platform-specific |
| Accessibility access | For keyboard hooks | macOS-specific |
| Clipboard access | Copy/paste operations | Platform-specific |

#### 5.6 Audio Recording
| Feature | Description | Notes |
|---------|-------------|-------|
| MediaRecorder API | Capture audio | Browser/Electron |
| Waveform visualization | Audio feedback | Client UI |
| Recording history | Local file storage | Could be server |

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

## Migration Strategy

### Phase 1: Extract Core Services
1. Create standalone Node.js/Bun server package
2. Move conversation-service, profile-service, mcp-service
3. Implement REST API layer
4. Add WebSocket support for real-time updates

### Phase 2: Database Migration
1. Replace JSON file storage with SQLite/PostgreSQL
2. Implement proper data migrations
3. Add user authentication layer

### Phase 3: Client Adaptation
1. Create shared API client package
2. Update Electron app to use HTTP/WebSocket
3. Keep platform-specific features in Electron

### Phase 4: Multi-Client Support
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

---

## Appendix: TIPC Procedure Mapping

Complete mapping of all 100+ TIPC procedures to server API endpoints is available in the detailed audit above. Key categories:

1. **App Lifecycle** (5 procedures): restart, update, quit
2. **Window Management** (15 procedures): panel, main window, positioning
3. **Agent Operations** (12 procedures): process, stop, sessions, approval
4. **Conversations** (8 procedures): CRUD, messages
5. **Message Queue** (10 procedures): queue management
6. **Profiles** (15 procedures): CRUD, MCP/model config
7. **MCP Servers** (12 procedures): lifecycle, tools, OAuth
8. **Configuration** (8 procedures): get/save, validation
9. **Speech** (3 procedures): STT, TTS
10. **Diagnostics** (5 procedures): health, errors, reports
11. **Platform-Specific** (10+ procedures): keyboard, accessibility, clipboard

