# SpeakMCP Server Architecture Specification

## Overview

This document provides a comprehensive audit of the SpeakMCP desktop application functionality and serves as a specification for refactoring to a central server architecture that can support multiple client interfaces (Electron, Mobile, Web, Tauri, etc.).

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Core Services (Server-Side Candidates)](#core-services-server-side-candidates)
3. [UI/Platform-Specific Features](#uiplatform-specific-features)
4. [Complete API Endpoints](#complete-api-endpoints)
5. [Data Models](#data-models)
6. [Real-Time Communication](#real-time-communication)
7. [Data Persistence](#data-persistence)
8. [Security Considerations](#security-considerations)
9. [Migration Priority Matrix](#migration-priority-matrix)
10. [Proposed Server Architecture](#proposed-server-architecture)
11. [Implementation Checklist](#implementation-checklist)

---

## Architecture Overview

### Current Architecture

The desktop app is built with Electron and uses:
- **Main Process**: Core business logic, IPC handlers, native integrations
- **Renderer Process**: React-based UI
- **TIPC (@egoist/tipc)**: Type-safe IPC communication
- **MCP SDK**: Model Context Protocol for AI tool calling

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

### Target Architecture

```
+------------------+     HTTP/WS      +------------------+
|   Any UI Client  | <--------------> |   Central Server |
|   (Electron,     |                  |   (Node.js)      |
|    Mobile,       |                  +------------------+
|    Web,          |                        |
|    Tauri, etc.)  |                        v
+------------------+                  +----------+
                                      |  MCP     |
                                      |  Servers |
                                      +----------+
```

---

## Core Services (Server-Side Candidates)

### 1. MCP Service (`mcp-service.ts`)
**Purpose**: Manages connections to MCP (Model Context Protocol) servers and tool execution.

**Functions to Extract**:
| Function | Description | Server API |
|----------|-------------|------------|
| `initialize()` | Initialize all MCP servers | `POST /api/mcp/initialize` |
| `getAvailableTools()` | List available tools | `GET /api/mcp/tools` |
| `executeToolCall(toolCall, onProgress)` | Execute a tool | `POST /api/mcp/tools/:name/execute` |
| `getServerStatus()` | Get all server statuses | `GET /api/mcp/servers` |
| `setServerRuntimeEnabled(name, enabled)` | Enable/disable server | `PATCH /api/mcp/servers/:name` |
| `setToolEnabled(name, enabled)` | Enable/disable tool | `PATCH /api/mcp/tools/:name` |
| `testServerConnection(name, config)` | Test server connection | `POST /api/mcp/servers/:name/test` |
| `restartServer(name)` | Restart a server | `POST /api/mcp/servers/:name/restart` |
| `getServerLogs(name)` | Get server logs | `GET /api/mcp/servers/:name/logs` |
| `initiateOAuthFlow(serverName)` | Start OAuth for server | `POST /api/mcp/servers/:name/oauth/start` |
| `completeOAuthFlow(serverName, code, state)` | Complete OAuth | `POST /api/mcp/servers/:name/oauth/callback` |
| `getOAuthStatus(serverName)` | Check OAuth status | `GET /api/mcp/servers/:name/oauth/status` |

**Complexity**: HIGH - Core functionality, requires careful refactoring

**Detailed Feature Breakdown**:
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

---

### 2. LLM Service (`llm.ts`, `llm-fetch.ts`)
**Purpose**: Handles all LLM interactions including agent mode processing.

**Functions to Extract**:
| Function | Description | Server API |
|----------|-------------|------------|
| `postProcessTranscript(text)` | Post-process transcript | `POST /api/llm/post-process` |
| `processTranscriptWithTools(text, tools)` | Single tool call | `POST /api/llm/process` |
| `processTranscriptWithAgentMode(...)` | Full agent loop | `POST /api/agent/process` (SSE) |
| `makeLLMCallWithFetch(messages, provider)` | Raw LLM call | `POST /api/llm/chat` |
| `verifyCompletionWithFetch(messages, provider)` | Verify completion | `POST /api/llm/verify` |

**Complexity**: HIGH - Agent mode requires streaming support

**Detailed Feature Breakdown**:
| Feature | Description | Server-Side | Client-Side |
|---------|-------------|-------------|-------------|
| `processTranscriptWithAgentMode()` | Multi-iteration LLM processing with tool calling | ✅ | |
| `executeToolWithRetries()` | Tool execution with retry logic | ✅ | |
| Context extraction from history | Extract relevant context for LLM | ✅ | |
| Verification loop | Schema-based completion checking | ✅ | |
| Streaming callbacks | Real-time response streaming | ✅ | WebSocket/SSE |
| Kill switch integration | Emergency stop functionality | ✅ | Trigger only |
| Context budget management | Token estimation and summarization | ✅ | |

---

### 3. Conversation Service (`conversation-service.ts`)
**Purpose**: Manages conversation history and persistence.

**Functions to Extract**:
| Function | Description | Server API |
|----------|-------------|------------|
| `createConversation(firstMessage, role)` | Create conversation | `POST /api/conversations` |
| `loadConversation(id)` | Load conversation | `GET /api/conversations/:id` |
| `saveConversation(conversation)` | Save conversation | `PUT /api/conversations/:id` |
| `addMessageToConversation(id, content, role, ...)` | Add message | `POST /api/conversations/:id/messages` |
| `deleteConversation(id)` | Delete conversation | `DELETE /api/conversations/:id` |
| `getConversationHistory()` | List all conversations | `GET /api/conversations` |
| `deleteAllConversations()` | Clear all | `DELETE /api/conversations` |

**Complexity**: MEDIUM - Straightforward CRUD operations

---

### 4. Profile Service (`profile-service.ts`)
**Purpose**: Manages user profiles with MCP and model configurations.

**Functions to Extract**:
| Function | Description | Server API |
|----------|-------------|------------|
| `getProfiles()` | List profiles | `GET /api/profiles` |
| `getProfile(id)` | Get profile | `GET /api/profiles/:id` |
| `getCurrentProfile()` | Get active profile | `GET /api/profiles/current` |
| `createProfile(name, guidelines, systemPrompt)` | Create profile | `POST /api/profiles` |
| `updateProfile(id, updates)` | Update profile | `PATCH /api/profiles/:id` |
| `deleteProfile(id)` | Delete profile | `DELETE /api/profiles/:id` |
| `setCurrentProfile(id)` | Switch profile | `POST /api/profiles/:id/activate` |
| `exportProfile(id)` | Export profile | `GET /api/profiles/:id/export` |
| `importProfile(json)` | Import profile | `POST /api/profiles/import` |

**Complexity**: MEDIUM - Includes MCP state management

---

### 5. Configuration Service (`config.ts`)
**Purpose**: Manages app configuration and settings.

**Functions to Extract**:
| Function | Description | Server API |
|----------|-------------|------------|
| `get()` | Get all config | `GET /api/config` |
| `save(config)` | Save config | `PUT /api/config` |
| Specific settings | Individual settings | `PATCH /api/config/:key` |

**Complexity**: LOW - Simple key-value store

---

### 6. Speech-to-Text Service
**Purpose**: Transcribes audio to text.

**Current Implementation**: Inline in `tipc.ts` (createRecording, createMcpRecording)

**Functions to Extract**:
| Function | Description | Server API |
|----------|-------------|------------|
| `transcribeAudio(audioBuffer, config)` | Transcribe audio | `POST /api/stt/transcribe` |

**Supported Providers**:
- OpenAI Whisper
- Groq Whisper

**Complexity**: MEDIUM - Requires audio upload handling

---

### 7. Text-to-Speech Service
**Purpose**: Converts text to speech.

**Current Implementation**: Inline in `tipc.ts` (generateSpeech)

**Functions to Extract**:
| Function | Description | Server API |
|----------|-------------|------------|
| `generateSpeech(text, config)` | Generate speech | `POST /api/tts/generate` |
| `preprocessTextForTTS(text)` | Preprocess text | `POST /api/tts/preprocess` |

**Supported Providers**:
- OpenAI TTS (tts-1, tts-1-hd)
- Groq Orpheus
- Gemini TTS

**Complexity**: MEDIUM - Returns audio buffer

---

### 8. Agent Session Tracker (`agent-session-tracker.ts`)
**Purpose**: Tracks active agent sessions.

**Functions to Extract**:
| Function | Description | Server API |
|----------|-------------|------------|
| `startSession(conversationId, title, snoozed)` | Start session | `POST /api/sessions` |
| `getSession(id)` | Get session | `GET /api/sessions/:id` |
| `getActiveSessions()` | List active | `GET /api/sessions?status=active` |
| `completeSession(id)` | Complete session | `POST /api/sessions/:id/complete` |
| `stopSession(id)` | Stop session | `POST /api/sessions/:id/stop` |
| `snoozeSession(id)` | Snooze session | `POST /api/sessions/:id/snooze` |

**Complexity**: MEDIUM - Needs real-time updates (WebSocket)

---

### 9. Message Queue Service (`message-queue-service.ts`)
**Purpose**: Queues messages when agent is busy.

**Functions to Extract**:
| Function | Description | Server API |
|----------|-------------|------------|
| `enqueue(conversationId, text)` | Queue message | `POST /api/conversations/:id/queue` |
| `getQueue(conversationId)` | Get queue | `GET /api/conversations/:id/queue` |
| `removeFromQueue(conversationId, messageId)` | Remove from queue | `DELETE /api/conversations/:id/queue/:msgId` |
| `updateMessageText(conversationId, messageId, text)` | Edit queued | `PATCH /api/conversations/:id/queue/:msgId` |
| `pauseQueue(conversationId)` | Pause queue | `POST /api/conversations/:id/queue/pause` |
| `resumeQueue(conversationId)` | Resume queue | `POST /api/conversations/:id/queue/resume` |

**Complexity**: LOW - Simple queue operations

---

### 10. Models Service (`models-service.ts`)
**Purpose**: Fetches available models from providers.

**Functions to Extract**:
| Function | Description | Server API |
|----------|-------------|------------|
| `fetchAvailableModels(providerId)` | Get models | `GET /api/models/:providerId` |
| `fetchModelsForPreset(baseUrl, apiKey)` | Get preset models | `POST /api/models/preset` |
| `clearModelsCache()` | Clear cache | `DELETE /api/models/cache` |

**Complexity**: LOW - Simple API proxying

---

### 11. MCP Registry (`mcp-registry.ts`)
**Purpose**: Fetches available MCP servers from registry.

**Functions to Extract**:
| Function | Description | Server API |
|----------|-------------|------------|
| `fetchRegistryServers(options)` | Get registry | `GET /api/mcp/registry` |
| `clearRegistryCache()` | Clear cache | `DELETE /api/mcp/registry/cache` |

**Complexity**: LOW - External API proxy

---

### 12. Diagnostics Service (`diagnostics.ts`)
**Purpose**: Logs errors and generates diagnostic reports.

**Functions to Extract**:
| Function | Description | Server API |
|----------|-------------|------------|
| `generateDiagnosticReport()` | Generate report | `GET /api/diagnostics/report` |
| `performHealthCheck()` | Health check | `GET /api/health` |
| `getRecentErrors(count)` | Get errors | `GET /api/diagnostics/errors` |
| `clearErrorLog()` | Clear errors | `DELETE /api/diagnostics/errors` |

**Complexity**: LOW

---

### 13. Built-in Tools (`builtin-tools.ts`)
**Purpose**: SpeakMCP's own tools for settings management.

**Tools**:
| Tool | Description |
|------|-------------|
| `list_mcp_servers` | List MCP servers and status |
| `toggle_mcp_server` | Enable/disable MCP server |
| `list_profiles` | List profiles |
| `switch_profile` | Switch active profile |
| `get_current_profile` | Get current profile |
| `list_running_agents` | List active agent sessions |
| `kill_agent` | Kill specific agent |
| `kill_all_agents` | Emergency stop all |
| `get_settings` | Get app settings |
| `toggle_post_processing` | Toggle post-processing |
| `toggle_tts` | Toggle TTS |
| `toggle_tool_approval` | Toggle tool approval |

**Complexity**: MEDIUM - These become native server endpoints

---

### 14. Remote Server (`remote-server.ts`)
**Purpose**: HTTP API server (already exists!)

**Current Endpoints**:
- `POST /v1/chat/completions` - OpenAI-compatible chat (SSE streaming)
- `GET /v1/models` - List models
- `GET /v1/models/:providerId` - Provider models
- `GET /v1/profiles` - List profiles
- `GET /v1/profiles/current` - Current profile
- `POST /v1/profiles/current` - Switch profile
- `GET /v1/mcp/servers` - List MCP servers
- `POST /v1/mcp/servers/:name/toggle` - Toggle server
- `GET /v1/settings` - Get settings
- `PATCH /v1/settings` - Update settings
- `POST /v1/emergency-stop` - Kill all agents

**Note**: This is an EXCELLENT starting point for the central server!

---

## UI/Platform-Specific Features

These features are inherently client-side and should NOT be extracted:

### 1. Keyboard Shortcuts (`keyboard.ts`)
- Hold-to-record (Ctrl, Ctrl+Alt)
- Toggle shortcuts (Fn, F1-F12)
- Kill switch (Ctrl+Shift+Escape)
- Text input (Ctrl+T)
- Settings hotkey

**Migration**: Each client implements its own keyboard handling.

### 2. Window Management (`window.ts`)
- Panel window (floating recording UI)
- Main window (settings)
- Setup window (accessibility)
- Tray icon

**Migration**: Each client implements its own window system.

### 3. Audio Recording (`recorder.ts` in renderer)
- Web Audio API for recording
- Waveform visualization

**Migration**: Each client uses its platform's audio APIs.

### 4. Audio Playback (`tts-manager.ts`, `audio-player.tsx`)
- TTS playback
- Sound effects (begin-record, end-record)

**Migration**: Each client handles audio playback.

### 5. System Integration
- Accessibility permissions (macOS)
- Dock icon visibility (macOS)
- Login item (auto-start)
- System tray

**Migration**: Platform-specific implementations.

### 6. Focus Management
- Track focused app before recording
- Restore focus after paste
- Auto-paste to target app

**Migration**: Platform-specific where possible.

### 7. Native Paste (`keyboard.ts` - writeText)
- Uses Rust binary (`speakmcp-rs`) for native keyboard simulation
- Platform-specific text insertion

**Migration**: Mobile/web can use clipboard API, native apps need platform code.

---

## Complete API Endpoints

Based on the TIPC router analysis, here are all procedures that need server API equivalents:

### Authentication & App Lifecycle
```
POST   /api/auth/login              # User authentication (new)
POST   /api/auth/logout             # User logout (new)
GET    /api/health                  # Health check
```

### Agent/LLM Operations
```
POST   /api/agent/process           # Process text with agent mode (SSE stream)
POST   /api/agent/process-audio     # Process audio recording (SSE stream)
POST   /api/agent/stop              # Emergency stop all sessions
POST   /api/agent/stop/:sessionId   # Stop specific session
GET    /api/agent/sessions          # List active sessions
GET    /api/agent/sessions/:id      # Get session details
POST   /api/agent/sessions/:id/snooze    # Snooze session
POST   /api/agent/sessions/:id/unsnooze  # Unsnooze session
POST   /api/agent/tool-approval/:id # Respond to tool approval
```

### Conversations
```
GET    /api/conversations           # List conversations
POST   /api/conversations           # Create conversation
GET    /api/conversations/:id       # Load conversation
PUT    /api/conversations/:id       # Save conversation
DELETE /api/conversations/:id       # Delete conversation
DELETE /api/conversations           # Delete all conversations
POST   /api/conversations/:id/messages   # Add message
```

### Message Queue
```
GET    /api/conversations/:id/queue      # Get message queue
POST   /api/conversations/:id/queue      # Add to queue
DELETE /api/conversations/:id/queue/:msgId   # Remove from queue
PATCH  /api/conversations/:id/queue/:msgId   # Update message text
POST   /api/conversations/:id/queue/pause    # Pause queue
POST   /api/conversations/:id/queue/resume   # Resume queue
POST   /api/conversations/:id/queue/:msgId/retry  # Retry failed message
```

### Profiles
```
GET    /api/profiles                # List profiles
POST   /api/profiles                # Create profile
GET    /api/profiles/:id            # Get profile
PATCH  /api/profiles/:id            # Update profile
DELETE /api/profiles/:id            # Delete profile
POST   /api/profiles/:id/activate   # Set current profile
GET    /api/profiles/current        # Get current profile
GET    /api/profiles/:id/export     # Export profile
POST   /api/profiles/import         # Import profile
PUT    /api/profiles/:id/mcp-config     # Update MCP config
PUT    /api/profiles/:id/model-config   # Update model config
```

### MCP Servers
```
GET    /api/mcp/servers             # List MCP servers with status
GET    /api/mcp/initialization-status   # Get initialization progress
PATCH  /api/mcp/servers/:name       # Enable/disable server
POST   /api/mcp/servers/:name/restart   # Restart server
POST   /api/mcp/servers/:name/stop      # Stop server
POST   /api/mcp/servers/:name/test      # Test connection
GET    /api/mcp/servers/:name/logs      # Get server logs
DELETE /api/mcp/servers/:name/logs      # Clear server logs
```

### MCP Tools
```
GET    /api/mcp/tools               # List all tools with status
PATCH  /api/mcp/tools/:name         # Enable/disable tool
POST   /api/mcp/tools/:name/execute # Execute tool (internal use)
```

### MCP OAuth
```
POST   /api/mcp/oauth/:serverName/initiate  # Start OAuth flow
POST   /api/mcp/oauth/:serverName/complete  # Complete OAuth
GET    /api/mcp/oauth/:serverName/status    # Get OAuth status
POST   /api/mcp/oauth/:serverName/revoke    # Revoke tokens
```

### MCP Elicitation & Sampling
```
POST   /api/mcp/elicitation/:requestId/resolve  # Resolve elicitation
POST   /api/mcp/sampling/:requestId/resolve     # Resolve sampling
```

### Configuration
```
GET    /api/config                  # Get configuration
PATCH  /api/config                  # Update configuration
POST   /api/config/validate-mcp     # Validate MCP config JSON
```

### Models
```
GET    /api/models/:providerId      # Fetch available models
POST   /api/models/preset           # Fetch models for custom preset
DELETE /api/models/cache            # Clear models cache
```

### Speech
```
POST   /api/speech/transcribe       # Transcribe audio (STT)
POST   /api/speech/synthesize       # Generate speech (TTS)
POST   /api/speech/preprocess       # Preprocess text for TTS
```

### MCP Registry
```
GET    /api/mcp/registry            # Fetch registry servers
DELETE /api/mcp/registry/cache      # Clear registry cache
```

### Diagnostics
```
GET    /api/diagnostics/report      # Generate diagnostic report
GET    /api/diagnostics/health      # Perform health check
GET    /api/diagnostics/errors      # Get recent errors
DELETE /api/diagnostics/errors      # Clear error log
```

---

## TIPC Procedure Mapping Summary

### Current IPC Methods (tipc.ts)

Total methods: **~100+**

#### Core Agent Operations
- `createMcpRecording` - Voice input to agent
- `createMcpTextInput` - Text input to agent
- `createRecording` - Voice input (simple transcription)
- `createTextInput` - Text input (simple)
- `emergencyStopAgent` - Kill all
- `stopAgentSession` - Kill specific
- `snoozeAgentSession` / `unsnoozeAgentSession`
- `getAgentSessions` / `getAgentStatus`
- `respondToToolApproval` - Approve/deny tool

#### Configuration
- `getConfig` / `saveConfig`
- `getProfiles` / `createProfile` / `updateProfile` / `deleteProfile`
- `setCurrentProfile` / `getCurrentProfile`
- `exportProfile` / `importProfile`

#### MCP Management
- `getMcpServerStatus` / `getMcpInitializationStatus`
- `getMcpDetailedToolList` / `getMcpDisabledTools`
- `setMcpToolEnabled` / `setMcpServerRuntimeEnabled`
- `restartMcpServer` / `stopMcpServer`
- `getMcpServerLogs` / `clearMcpServerLogs`
- `testMcpServerConnection`
- `fetchMcpRegistryServers`
- `loadMcpConfigFile` / `saveMcpConfigFile` / `validateMcpConfig`

#### Conversation
- `getConversationHistory` / `loadConversation`
- `saveConversation` / `createConversation`
- `addMessageToConversation` / `deleteConversation`
- `deleteAllConversations`

#### Message Queue
- `getMessageQueue` / `getAllMessageQueues`
- `removeFromMessageQueue` / `clearMessageQueue`
- `reorderMessageQueue` / `updateQueuedMessageText`
- `retryQueuedMessage`
- `isMessageQueuePaused` / `resumeMessageQueue`

#### OAuth
- `initiateOAuthFlow` / `completeOAuthFlow`
- `getOAuthStatus` / `revokeOAuthTokens`

#### Speech
- `generateSpeech`

#### Models
- `fetchAvailableModels` / `fetchModelsForPreset`

#### Diagnostics
- `getDiagnosticReport` / `saveDiagnosticReport`
- `performHealthCheck`
- `getRecentErrors` / `clearErrorLog`

#### UI-Specific (don't extract)
- `showPanelWindow` / `hidePanelWindow`
- `showMainWindow`
- `resizePanelForAgentMode` / `resizePanelToNormal`
- `setPanelPosition` / `getPanelPosition`
- `setPanelFocusable` / `setPanelMode` / `getPanelMode`
- `showContextMenu`
- `displayError`

---

## Data Persistence

### Current Storage Locations

| Data | Location | Format |
|------|----------|--------|
| Config | `{appData}/config.json` | JSON |
| Profiles | `{appData}/profiles.json` | JSON |
| Conversations | `{appData}/conversations/*.json` | JSON files |
| Recordings | `{appData}/recordings/*.webm` | Audio files |
| Recording History | `{appData}/recordings/history.json` | JSON |
| OAuth Tokens | `{appData}/oauth/*.json` | JSON |

### Migration Considerations
- Config could use SQLite for atomic updates
- Conversations could use SQLite for better querying
- OAuth tokens need secure storage
- Recordings could use object storage (S3-compatible)

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
  transport?: "stdio" | "websocket" | "streamableHttp"
  timeout?: number
  disabled?: boolean
  oauth?: OAuthConfig
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
  isDefault?: boolean
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
  metadata?: {
    totalTokens?: number
    model?: string
    provider?: string
    agentMode?: boolean
  }
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
  conversationHistory?: Array<{
    role: "user" | "assistant" | "tool"
    content: string
    toolCalls?: ToolCall[]
    toolResults?: ToolResult[]
    timestamp?: number
  }>
  pendingToolApproval?: {
    approvalId: string
    toolName: string
    arguments: any
  }
  retryInfo?: {
    isRetrying: boolean
    attempt: number
    maxAttempts?: number
    delaySeconds: number
    reason: string
  }
  streamingContent?: {
    text: string
    isStreaming: boolean
  }
  contextInfo?: {
    estTokens: number
    maxTokens: number
  }
  modelInfo?: {
    provider: string
    model: string
  }
  profileName?: string
}

// Message Queue
interface QueuedMessage {
  id: string
  conversationId: string
  text: string
  status: "pending" | "processing" | "failed"
  createdAt: number
  errorMessage?: string
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
  type: "agent-progress" | "session-update" | "queue-update" | 
        "elicitation-request" | "sampling-request"
  data: AgentProgressUpdate | AgentSession | QueuedMessage[] | 
        ElicitationRequest | SamplingRequest
}
```

### SSE Endpoints (Alternative)

For simpler clients, Server-Sent Events can be used:
```
GET /api/agent/progress/:sessionId/stream   # Stream progress updates
GET /api/conversations/:id/queue/stream     # Stream queue updates
```

---

## Security Considerations

### Authentication
- JWT-based authentication for API access
- API key support for programmatic access (current implementation)
- Session management with refresh tokens
- Rate limiting per API key/user

### Authorization
- User-scoped data access
- Profile-level permissions
- MCP server access control per profile

### Data Protection
- Encrypt API keys at rest (provider keys: OpenAI, Groq, Gemini)
- Secure WebSocket connections (WSS)
- HTTPS required for production
- CORS configuration for web clients
- No sensitive data in logs

### OAuth Security
- PKCE flow for MCP server OAuth
- Secure token storage
- Token refresh handling
- Revocation support

---

## Migration Priority Matrix

### Phase 1: Essential (MVP)
| Feature | Priority | Effort | Notes |
|---------|----------|--------|-------|
| Configuration API | P0 | Low | Foundation for everything |
| Profile Service | P0 | Medium | Controls MCP/model config |
| MCP Service | P0 | High | Core functionality |
| Agent Processing (SSE) | P0 | High | Main value prop |
| Conversation Service | P0 | Medium | State management |
| STT API | P0 | Medium | Voice input |

### Phase 2: Enhanced
| Feature | Priority | Effort | Notes |
|---------|----------|--------|-------|
| TTS API | P1 | Medium | Voice output |
| Session Tracking | P1 | Medium | Multi-session support |
| Message Queue | P1 | Low | Async message handling |
| Models Service | P1 | Low | Model selection |
| OAuth Flow | P1 | Medium | MCP authentication |

### Phase 3: Polish
| Feature | Priority | Effort | Notes |
|---------|----------|--------|-------|
| Diagnostics | P2 | Low | Debug/support |
| MCP Registry | P2 | Low | Discovery |
| Built-in Tools | P2 | Medium | Settings management |

---

## Migration Strategy

### Phase 1: Extract Core Services
1. Create standalone Node.js/Bun server package (`packages/server`)
2. Move conversation-service, profile-service, mcp-service
3. Implement REST API layer using Fastify
4. Add WebSocket/SSE support for real-time updates

### Phase 2: Database Migration
1. Replace JSON file storage with SQLite/PostgreSQL
2. Implement proper data migrations
3. Add user authentication layer
4. Secure API key storage

### Phase 3: Client Adaptation
1. Create shared API client package (`packages/client`)
2. Update Electron app to use HTTP/WebSocket instead of IPC
3. Keep platform-specific features in Electron (keyboard, window management)
4. Optional: Maintain offline fallback

### Phase 4: Multi-Client Support
1. Build web client (React)
2. Build mobile client (React Native - already started in `apps/mobile`)
3. Build Tauri client (optional, for smaller desktop binary)

---

## Proposed Server Architecture

### Technology Stack
- **Runtime**: Node.js (or Bun for performance)
- **Framework**: Fastify (already in use)
- **Database**: SQLite (conversations, config) + JSON (profiles)
- **Real-time**: Server-Sent Events (SSE) for agent progress
- **Authentication**: API Key (current) + optional OAuth2

### API Design

#### RESTful Endpoints
```
# Core
POST   /api/agent/process          # Start agent (SSE stream)
POST   /api/agent/stop             # Emergency stop all
POST   /api/stt/transcribe         # Speech-to-text
POST   /api/tts/generate           # Text-to-speech

# Config
GET    /api/config
PATCH  /api/config

# Profiles
GET    /api/profiles
POST   /api/profiles
GET    /api/profiles/:id
PATCH  /api/profiles/:id
DELETE /api/profiles/:id
POST   /api/profiles/:id/activate

# MCP
GET    /api/mcp/servers
POST   /api/mcp/servers/:name/restart
PATCH  /api/mcp/servers/:name       # enable/disable
GET    /api/mcp/tools
PATCH  /api/mcp/tools/:name         # enable/disable
POST   /api/mcp/tools/:name/execute

# Conversations
GET    /api/conversations
POST   /api/conversations
GET    /api/conversations/:id
DELETE /api/conversations/:id
POST   /api/conversations/:id/messages
GET    /api/conversations/:id/queue
POST   /api/conversations/:id/queue

# Sessions
GET    /api/sessions
GET    /api/sessions/:id
POST   /api/sessions/:id/stop
POST   /api/sessions/:id/snooze

# Models
GET    /api/models/:providerId
```

#### WebSocket Events (Optional Enhancement)
```typescript
// Server -> Client
{ type: "agent:progress", sessionId, update }
{ type: "session:updated", session }
{ type: "mcp:status", servers }

// Client -> Server  
{ type: "agent:stop", sessionId }
{ type: "tool:approve", approvalId, approved }
```

### Client SDK (TypeScript)
```typescript
interface SpeakMCPClient {
  // Agent
  processAgent(input: string | Blob, options?): AsyncIterable<AgentProgress>
  stopAgent(sessionId?: string): Promise<void>
  
  // STT/TTS
  transcribe(audio: Blob): Promise<string>
  speak(text: string): Promise<Blob>
  
  // Config
  getConfig(): Promise<Config>
  updateConfig(patch: Partial<Config>): Promise<Config>
  
  // Profiles
  getProfiles(): Promise<Profile[]>
  switchProfile(id: string): Promise<Profile>
  
  // MCP
  getServers(): Promise<MCPServer[]>
  toggleServer(name: string, enabled: boolean): Promise<void>
  
  // Conversations
  getConversations(): Promise<ConversationSummary[]>
  getConversation(id: string): Promise<Conversation>
  
  // Real-time (optional)
  onProgress(callback: (update: AgentProgress) => void): Unsubscribe
}
```

---

## Implementation Checklist

### Server Setup
- [ ] Create new `packages/server` package
- [ ] Set up Fastify with TypeScript
- [ ] Move existing `remote-server.ts` as base
- [ ] Add SQLite for persistence
- [ ] Implement authentication middleware

### Core Services Migration
- [ ] Extract `config-service.ts`
- [ ] Extract `profile-service.ts` (already mostly standalone)
- [ ] Extract `mcp-service.ts` (complex, careful refactoring)
- [ ] Extract `conversation-service.ts`
- [ ] Extract `llm-service.ts`
- [ ] Extract `agent-service.ts` (agent loop logic)

### API Implementation
- [ ] Implement all REST endpoints
- [ ] Add SSE streaming for agent progress
- [ ] Add request validation (Zod/TypeBox)
- [ ] Add error handling middleware
- [ ] Add rate limiting
- [ ] Add CORS configuration

### Client SDK
- [ ] Create `packages/client` package
- [ ] Implement TypeScript SDK
- [ ] Add retry logic
- [ ] Add streaming support

### Desktop Client Refactor
- [ ] Create HTTP client wrapper
- [ ] Replace IPC calls with HTTP
- [ ] Keep UI-specific code in renderer
- [ ] Maintain offline fallback (optional)

### Mobile Client
- [ ] Use client SDK
- [ ] Implement audio recording
- [ ] Implement audio playback
- [ ] Handle background processing

---

## Notes

### What Already Works
The `remote-server.ts` already provides a good foundation with:
- OpenAI-compatible `/v1/chat/completions` endpoint
- SSE streaming for agent progress
- Profile and MCP server management
- Settings API

### Key Challenges
1. **MCP Server Management**: MCP servers are child processes; need to handle lifecycle across network boundary
2. **Audio Streaming**: Large audio files need chunked upload/download
3. **Session State**: Agent sessions need to be tracked server-side
4. **Real-time Updates**: SSE works but WebSocket might be better for bidirectional

### Recommendations
1. Start by expanding `remote-server.ts` rather than rewriting
2. Use the existing Fastify setup
3. Keep the OpenAI-compatible endpoint for LLM clients
4. Add proper authentication before exposing publicly
