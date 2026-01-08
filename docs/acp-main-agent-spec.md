# ACP Agent as Main Agent - Implementation Specification

## Overview

This feature allows users to use an external ACP (Agent Client Protocol) agent (like Claude Code) as the "brain" for SpeakMCP instead of calling an external LLM API directly. SpeakMCP becomes a voice/UI frontend that routes prompts to the ACP agent.

### Goals
- **Optional mode**: Users can choose between API mode (current) or ACP mode
- **Works with any ACP agent**: Primarily Claude Code, but compatible with any ACP-compliant agent
- **Session persistence**: Maintain conversation context across multiple prompts within the same session
- **Simplified MCP**: ACP agent uses its own MCP tools, not SpeakMCP's configured tools

---

## Architecture Comparison

### Current (API Mode)
```
User Voice → SpeakMCP → Vercel AI SDK → OpenAI/Groq/Gemini API
                ↓
            MCP Tools (managed by SpeakMCP)
```

### Proposed (ACP Mode)
```
User Voice → SpeakMCP → ACP Agent (e.g., Claude Code)
                ↓              ↓
            Progress UI    Agent's own LLM + MCP Tools
```

---

## ACP Protocol Reference

Based on the official ACP specification at https://agentclientprotocol.com/

### Transport
- **JSON-RPC 2.0** over stdio (newline-delimited JSON)
- Bidirectional: Both client and agent can send requests

### Connection Lifecycle

1. **Initialize** (Client → Agent)
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "clientInfo": { "name": "SpeakMCP", "version": "1.2.0" },
    "capabilities": {
      "fileSystem": { "readTextFile": true, "writeTextFile": true }
    }
  }
}
```

Response includes `agentCapabilities` with `loadSession` boolean.

2. **Session/New** (Client → Agent)
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "session/new",
  "params": {
    "cwd": "/path/to/project",
    "mcpServers": []
  }
}
```

Response: `{ "sessionId": "sess_abc123" }`

3. **Session/Prompt** (Client → Agent)
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "session/prompt",
  "params": {
    "sessionId": "sess_abc123",
    "prompt": [
      { "type": "text", "text": "User's message here" }
    ]
  }
}
```

4. **Session/Update** (Agent → Client, Notification)
```json
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "sess_abc123",
    "update": {
      "sessionUpdate": "agent_message_chunk",
      "content": { "type": "text", "text": "Agent's response..." }
    }
  }
}
```

5. **Prompt Response** (Agent → Client)
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": { "stopReason": "end_turn" }
}
```

### Session/Load (Optional)
If agent supports `loadSession` capability, can resume previous sessions:
```json
{
  "method": "session/load",
  "params": {
    "sessionId": "sess_previous",
    "cwd": "/path/to/project",
    "mcpServers": []
  }
}
```

### Session/Cancel (Notification)
```json
{
  "method": "session/cancel",
  "params": { "sessionId": "sess_abc123" }
}
```

### Stop Reasons
- `end_turn` - Model finished responding
- `max_tokens` - Token limit reached
- `cancelled` - Client cancelled
- `refusal` - Agent refused

---

## Implementation Plan

### 1. Configuration Changes

**File: `apps/desktop/src/shared/types.ts`**

Add to `AppConfig` interface:
```typescript
// Main agent mode: "api" uses external LLM API, "acp" uses an ACP agent
mainAgentMode?: "api" | "acp"
// Name of the ACP agent to use when mainAgentMode is "acp"
mainAgentName?: string
```

### 2. New Module: ACP Main Agent Handler

**File: `apps/desktop/src/main/acp-main-agent.ts`**

Core function signature:
```typescript
export interface ACPMainAgentOptions {
  agentName: string
  conversationId: string
  sessionId?: string  // Reuse existing session for context
  onProgress?: (update: AgentProgressUpdate) => void
}

export interface ACPMainAgentResult {
  success: boolean
  response?: string
  sessionId?: string  // Return session ID for future prompts
  stopReason?: string
  error?: string
}

export async function processTranscriptWithACPAgent(
  transcript: string,
  options: ACPMainAgentOptions
): Promise<ACPMainAgentResult>
```

Key responsibilities:
- Spawn/connect to the ACP agent if not already running
- Initialize the agent (if not already initialized)
- Create or reuse a session
- Send `session/prompt` with the transcript
- Listen for `session/update` notifications and emit progress updates
- Return the final response when `session/prompt` completes

### 3. Session Management

**Session-to-Conversation Mapping**

Store mapping in memory (or persist to config):
```typescript
// Map conversationId → ACP sessionId
const conversationSessions: Map<string, string> = new Map()
```

**New Session Logic**:
- When user starts a new conversation → create new ACP session
- When user continues conversation → reuse existing session
- When user explicitly requests "new session" → create new session

### 4. Routing Logic

**File: `apps/desktop/src/main/tipc.ts`**

Modify `processWithAgentMode` function (around line 328):

```typescript
// Check if ACP main agent mode is enabled
const config = configStore.get()
if (config.mainAgentMode === "acp" && config.mainAgentName) {
  // Route to ACP agent instead of API
  const result = await processTranscriptWithACPAgent(text, {
    agentName: config.mainAgentName,
    conversationId: conversationId,
    sessionId: getSessionForConversation(conversationId),
    onProgress: (update) => emitAgentProgress(update),
  })

  // Store session for future prompts in this conversation
  if (result.sessionId) {
    setSessionForConversation(conversationId, result.sessionId)
  }

  return {
    success: result.success,
    response: result.response,
    error: result.error,
  }
}

// Existing API mode logic...
await processTranscriptWithAgentMode(text, availableTools, executeToolCall, ...)
```

### 5. Progress Updates

Map ACP `session/update` notifications to `AgentProgressUpdate`:

| ACP Update Type | AgentProgressUpdate Step Type |
|-----------------|------------------------------|
| `agent_message_chunk` | `thinking` or `response` |
| `agent_thought_chunk` | `thinking` |
| `tool_call` | `tool_call` |
| `tool_call_update` | `tool_result` |
| `plan` | `planning` |

### 6. UI Changes

**File: `apps/desktop/src/renderer/src/pages/settings-*.tsx`**

Add settings section:
```tsx
<Section title="Main Agent Mode">
  <Select
    value={config.mainAgentMode || "api"}
    onChange={(value) => updateConfig({ mainAgentMode: value })}
  >
    <Option value="api">API (OpenAI, Groq, Gemini)</Option>
    <Option value="acp">ACP Agent</Option>
  </Select>

  {config.mainAgentMode === "acp" && (
    <Select
      value={config.mainAgentName}
      onChange={(value) => updateConfig({ mainAgentName: value })}
    >
      {acpAgents.map(agent => (
        <Option key={agent.name} value={agent.name}>
          {agent.name}
        </Option>
      ))}
    </Select>
  )}
</Section>
```

---

## Parallel Implementation Phases

The implementation is structured into 5 phases that can be worked on in parallel by different sub-agents. Each phase owns specific files to avoid conflicts.

### Dependency Graph

```
Phase A (Types) ─────────────────────────────────┐
                                                 │
Phase B (ACP Service) ──────────────────────────┼──→ Phase E (Integration)
                                                 │
Phase C (Session State) ────────────────────────┤
                                                 │
Phase D (UI) ───────────────────────────────────┘
```

**Phases A, B, C, D** can run in parallel (no file conflicts).
**Phase E** depends on A, B, C completing first.

---

## Phase A: Configuration Types

**Owner:** Sub-agent A
**Files:** `apps/desktop/src/shared/types.ts` (EXCLUSIVE)
**Dependencies:** None
**Can run in parallel with:** B, C, D

### Task

Add new config options to the `AppConfig` interface:

```typescript
// Add to AppConfig interface in types.ts

// Main agent mode: "api" uses external LLM API, "acp" uses an ACP agent
mainAgentMode?: "api" | "acp"

// Name of the ACP agent to use when mainAgentMode is "acp"
mainAgentName?: string
```

### Acceptance Criteria
- [ ] `mainAgentMode` field added to `AppConfig` with type `"api" | "acp" | undefined`
- [ ] `mainAgentName` field added to `AppConfig` with type `string | undefined`
- [ ] TypeScript compiles without errors

---

## Phase B: ACP Service Session Management

**Owner:** Sub-agent B
**Files:** `apps/desktop/src/main/acp-service.ts` (EXCLUSIVE)
**Dependencies:** None
**Can run in parallel with:** A, C, D

### Task

Add new public methods to `ACPService` class for main agent session management:

```typescript
// Add these methods to ACPService class

/**
 * Get or create a session for main agent use.
 * Unlike runTask(), this gives fine-grained control over session lifecycle.
 */
async getOrCreateSession(agentName: string, forceNew?: boolean): Promise<string | undefined>

/**
 * Send a prompt to an existing session and return when complete.
 * Emits 'sessionUpdate' events during execution for progress tracking.
 */
async sendPrompt(
  agentName: string,
  sessionId: string,
  prompt: string
): Promise<{
  success: boolean
  response?: string
  stopReason?: string
  error?: string
}>

/**
 * Cancel an in-progress prompt.
 */
async cancelPrompt(agentName: string, sessionId: string): Promise<void>

/**
 * Check if an agent supports session loading (for resuming sessions).
 */
getAgentCapabilities(agentName: string): { loadSession?: boolean } | undefined
```

### Implementation Notes

1. `getOrCreateSession`:
   - Ensure agent is spawned and initialized
   - If `forceNew` is true, always create new session
   - Otherwise reuse existing session from `instance.sessionId`
   - Return the sessionId

2. `sendPrompt`:
   - Format prompt as content blocks per ACP spec
   - Call `session/prompt` method
   - Collect response from both direct result and `session/update` notifications
   - Return aggregated text response

3. `cancelPrompt`:
   - Send `session/cancel` notification to agent
   ```typescript
   private sendNotification(agentName: string, method: string, params?: unknown): void
   ```

4. Store agent capabilities from `initialize` response:
   ```typescript
   // Add to ACPAgentInstance interface
   agentCapabilities?: {
     loadSession?: boolean
   }
   ```

### Acceptance Criteria
- [ ] `getOrCreateSession` method implemented
- [ ] `sendPrompt` method implemented
- [ ] `cancelPrompt` method implemented
- [ ] `getAgentCapabilities` method implemented
- [ ] `sendNotification` private helper added
- [ ] Agent capabilities stored from initialize response
- [ ] TypeScript compiles without errors

---

## Phase C: Session State Management

**Owner:** Sub-agent C
**Files:** `apps/desktop/src/main/acp-session-state.ts` (NEW FILE - EXCLUSIVE)
**Dependencies:** None
**Can run in parallel with:** A, B, D

### Task

Create a new module to manage conversation-to-session mapping:

```typescript
// apps/desktop/src/main/acp-session-state.ts

/**
 * Manages mapping between SpeakMCP conversations and ACP sessions.
 * Allows maintaining context across multiple prompts in the same conversation.
 */

export interface ACPSessionInfo {
  sessionId: string
  agentName: string
  createdAt: number
  lastUsedAt: number
}

/**
 * Get the ACP session for a conversation (if any).
 */
export function getSessionForConversation(conversationId: string): ACPSessionInfo | undefined

/**
 * Set/update the ACP session for a conversation.
 */
export function setSessionForConversation(
  conversationId: string,
  sessionId: string,
  agentName: string
): void

/**
 * Clear the session for a conversation (e.g., user requested new session).
 */
export function clearSessionForConversation(conversationId: string): void

/**
 * Clear all sessions (e.g., on app shutdown or agent restart).
 */
export function clearAllSessions(): void

/**
 * Get all active sessions (for debugging/UI).
 */
export function getAllSessions(): Map<string, ACPSessionInfo>
```

### Implementation Notes

- Use a simple `Map<string, ACPSessionInfo>` for storage
- Sessions are in-memory only (not persisted to disk in v1)
- Export a singleton or functions that operate on module-level state

### Acceptance Criteria
- [ ] New file created at `apps/desktop/src/main/acp-session-state.ts`
- [ ] All 5 functions implemented
- [ ] `ACPSessionInfo` interface exported
- [ ] TypeScript compiles without errors

---

## Phase D: Settings UI

**Owner:** Sub-agent D
**Files:** `apps/desktop/src/renderer/src/pages/settings-agent.tsx` (EXCLUSIVE)
**Dependencies:** None (can use placeholder types, will compile after Phase A)
**Can run in parallel with:** A, B, C

### Task

Add UI controls for selecting main agent mode:

1. Add a new section "Main Agent Mode" in agent settings
2. Show a toggle/select between "API" and "ACP Agent" modes
3. When ACP mode is selected, show dropdown of configured ACP agents
4. Show status indicator for selected ACP agent

### UI Components

```tsx
// Add to settings-agent.tsx

// New section after existing LLM settings
<div className="settings-section">
  <h3>Main Agent Mode</h3>
  <p className="settings-description">
    Choose how the main agent processes your requests.
  </p>

  <div className="settings-row">
    <label>Mode</label>
    <select
      value={config.mainAgentMode || "api"}
      onChange={(e) => updateConfig({ mainAgentMode: e.target.value as "api" | "acp" })}
    >
      <option value="api">API (OpenAI, Groq, Gemini, etc.)</option>
      <option value="acp">ACP Agent (Claude Code, etc.)</option>
    </select>
  </div>

  {config.mainAgentMode === "acp" && (
    <>
      <div className="settings-row">
        <label>ACP Agent</label>
        <select
          value={config.mainAgentName || ""}
          onChange={(e) => updateConfig({ mainAgentName: e.target.value })}
        >
          <option value="">Select an agent...</option>
          {acpAgents.map(agent => (
            <option key={agent.name} value={agent.name}>
              {agent.name} ({agent.status})
            </option>
          ))}
        </select>
      </div>

      {config.mainAgentName && (
        <div className="settings-info">
          Agent will use its own MCP tools, not SpeakMCP's configured tools.
        </div>
      )}
    </>
  )}
</div>
```

### Implementation Notes

- Fetch ACP agents list using existing TIPC call (check existing code pattern)
- Follow existing styling patterns in the settings page
- The new config fields may show TypeScript errors until Phase A completes - this is OK

### Acceptance Criteria
- [ ] Main Agent Mode section added to settings
- [ ] Mode selector (API vs ACP) implemented
- [ ] ACP agent dropdown shown when ACP mode selected
- [ ] Status indicator for selected agent
- [ ] Info text about MCP tools shown
- [ ] Follows existing UI patterns and styling

---

## Phase E: Integration (Routing Logic)

**Owner:** Sub-agent E
**Files:**
- `apps/desktop/src/main/acp-main-agent.ts` (NEW FILE - EXCLUSIVE)
- `apps/desktop/src/main/tipc.ts` (SHARED - specific function only)
**Dependencies:** Phases A, B, C must complete first
**Cannot run in parallel with:** A, B, C

### Task 1: Create Main Agent Handler

Create `apps/desktop/src/main/acp-main-agent.ts`:

```typescript
import { acpService } from "./acp-service"
import {
  getSessionForConversation,
  setSessionForConversation,
  clearSessionForConversation
} from "./acp-session-state"
import { emitAgentProgress } from "./emit-agent-progress"
import { AgentProgressUpdate } from "../shared/types"

export interface ACPMainAgentOptions {
  agentName: string
  conversationId: string
  forceNewSession?: boolean
  onProgress?: (update: AgentProgressUpdate) => void
}

export interface ACPMainAgentResult {
  success: boolean
  response?: string
  sessionId?: string
  stopReason?: string
  error?: string
}

/**
 * Process a transcript using an ACP agent as the main agent.
 * This bypasses the normal LLM API call and routes directly to the ACP agent.
 */
export async function processTranscriptWithACPAgent(
  transcript: string,
  options: ACPMainAgentOptions
): Promise<ACPMainAgentResult> {
  const { agentName, conversationId, forceNewSession, onProgress } = options

  // 1. Get or create session
  const existingSession = forceNewSession ? undefined : getSessionForConversation(conversationId)
  const sessionId = existingSession?.sessionId || await acpService.getOrCreateSession(agentName, forceNewSession)

  if (!sessionId) {
    return {
      success: false,
      error: `Failed to create session with agent ${agentName}`
    }
  }

  // 2. Store session mapping
  setSessionForConversation(conversationId, sessionId, agentName)

  // 3. Set up progress listener
  const progressHandler = (event: { sessionId: string; content?: unknown[]; isComplete?: boolean }) => {
    if (event.sessionId === sessionId && onProgress) {
      // Map ACP updates to AgentProgressUpdate format
      // ... implementation details
    }
  }
  acpService.on("sessionUpdate", progressHandler)

  try {
    // 4. Send prompt
    const result = await acpService.sendPrompt(agentName, sessionId, transcript)

    return {
      success: result.success,
      response: result.response,
      sessionId,
      stopReason: result.stopReason,
      error: result.error
    }
  } finally {
    acpService.off("sessionUpdate", progressHandler)
  }
}

/**
 * Start a new session for a conversation, discarding previous context.
 */
export function startNewSession(conversationId: string): void {
  clearSessionForConversation(conversationId)
}
```

### Task 2: Add Routing in tipc.ts

Modify the `processWithAgentMode` function in `tipc.ts`:

```typescript
// At the start of processWithAgentMode function, add:

import { processTranscriptWithACPAgent } from "./acp-main-agent"
import { configStore } from "./config"

// Inside processWithAgentMode, before existing LLM call:

const config = configStore.get()

// Check if ACP main agent mode is enabled
if (config.mainAgentMode === "acp" && config.mainAgentName) {
  const result = await processTranscriptWithACPAgent(text, {
    agentName: config.mainAgentName,
    conversationId: conversationId,
    onProgress: (update) => {
      // Emit progress to renderer
      emitAgentProgress(update)
    },
  })

  return {
    success: result.success,
    response: result.response || "",
    error: result.error,
  }
}

// Existing API mode logic continues below...
```

### Acceptance Criteria
- [ ] `acp-main-agent.ts` created with `processTranscriptWithACPAgent` function
- [ ] `startNewSession` helper function implemented
- [ ] Progress events mapped from ACP to AgentProgressUpdate format
- [ ] Routing logic added to `tipc.ts`
- [ ] ACP mode works end-to-end when configured
- [ ] API mode still works (no regression)
- [ ] TypeScript compiles without errors

---

## Phase Summary Table

| Phase | Files (Exclusive) | Dependencies | Parallel With |
|-------|-------------------|--------------|---------------|
| **A** | `types.ts` | None | B, C, D |
| **B** | `acp-service.ts` | None | A, C, D |
| **C** | `acp-session-state.ts` (new) | None | A, B, D |
| **D** | `settings-agent.tsx` | None* | A, B, C |
| **E** | `acp-main-agent.ts` (new), `tipc.ts` | A, B, C | None |

*Phase D may have temporary TypeScript errors until Phase A completes, but can proceed with implementation.

---

## Error Handling

1. **Agent not running**: Auto-spawn when ACP mode is selected
2. **Session creation fails**: Fall back to creating new session
3. **Prompt timeout**: Return error with partial response if available
4. **Agent crashes**: Detect via process exit, show error, offer to restart

---

## Testing Strategy

1. **Unit tests**: Mock ACP agent responses, test session management
2. **Integration tests**: Test with actual Claude Code ACP
3. **Manual testing**:
   - Start conversation in ACP mode
   - Verify context is maintained across prompts
   - Test "new session" functionality
   - Test switching between API and ACP modes

---

## Future Enhancements

1. **Session persistence**: Save session IDs to disk for resuming after app restart
2. **Multiple agents**: Allow different agents for different conversation types
3. **Hybrid mode**: Use ACP agent for complex tasks, API for simple queries
4. **MCP tool bridging**: Optionally expose SpeakMCP's MCP tools to ACP agent

