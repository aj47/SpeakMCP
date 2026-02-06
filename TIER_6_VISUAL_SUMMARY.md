# Tier 6 Gaps - Visual Summary

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    SpeakMCP Desktop App                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │   OAuth (G-22)   │  │ MCP Extensions   │  │  Sessions    │  │
│  │                  │  │    (G-23)        │  │   (G-24)     │  │
│  │ • OAuthStorage   │  │                  │  │              │  │
│  │ • OAuthClient    │  │ • Elicitation    │  │ • State Mgr  │  │
│  │ • Callback Srv   │  │ • Sampling       │  │ • Tracker    │  │
│  └──────────────────┘  └──────────────────┘  └──────────────┘  │
│           │                    │                     │          │
│           └────────────────────┼─────────────────────┘          │
│                                │                                │
│                        ┌───────▼────────┐                       │
│                        │  MCP Service   │                       │
│                        │  (mcp-service) │                       │
│                        └────────────────┘                       │
│                                │                                │
│           ┌────────────────────┼────────────────────┐           │
│           │                    │                    │           │
│  ┌────────▼────────┐  ┌────────▼────────┐  ┌──────▼──────┐    │
│  │  ACP Delegation │  │ Message Queue   │  │  Agent Loop │    │
│  │     (G-19)      │  │    (G-18)       │  │             │    │
│  │                 │  │                 │  │ • Iterate   │    │
│  │ • ACPService    │  │ • Queue Service │  │ • Execute   │    │
│  │ • Sub-Sessions  │  │ • Pause/Resume  │  │ • Check Stop│    │
│  │ • Delegation    │  │ • Lock Mgmt     │  │             │    │
│  └─────────────────┘  └─────────────────┘  └─────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow Diagrams

### OAuth Flow (G-22)
```
User Input
    │
    ▼
OAuthClient.startAuthorizationFlow()
    │
    ├─→ discoverServerMetadata()
    ├─→ registerClient()
    └─→ Generate PKCE (codeVerifier, codeChallenge)
    │
    ▼
Open Browser → Authorization URL
    │
    ▼
User Authorizes
    │
    ▼
OAuth Callback Server / Deep Link
    │
    ▼
OAuthClient.exchangeCodeForToken()
    │
    ├─→ POST to token_endpoint
    └─→ Receive access_token
    │
    ▼
OAuthStorage.storeTokens()
    │
    ├─→ Encrypt (safeStorage or AES-256-GCM)
    └─→ Save to disk
    │
    ▼
Use in Authorization Header
```

### Elicitation/Sampling Flow (G-23)
```
MCP Server Request
    │
    ├─→ ElicitRequest
    │   │
    │   ├─→ Form Mode: Show UI Dialog
    │   │   │
    │   │   ▼
    │   │   User Submits Form
    │   │   │
    │   │   ▼
    │   │   resolveElicitation()
    │   │
    │   └─→ URL Mode: Open Browser
    │       │
    │       ▼
    │       User Completes on URL
    │       │
    │       ▼
    │       Server sends completion notification
    │       │
    │       ▼
    │       handleElicitationComplete()
    │
    └─→ CreateMessageRequest (Sampling)
        │
        ├─→ Check approval required?
        │   │
        │   ├─→ Yes: Send to UI for approval
        │   │
        │   └─→ No: Auto-approve
        │
        ▼
        executeSampling()
        │
        ├─→ Call LLM (makeLLMCallWithFetch)
        └─→ Return result
        │
        ▼
        Return to MCP Server
```

### Session Lifecycle (G-24)
```
Agent Start
    │
    ▼
createSession(sessionId, profileSnapshot)
    │
    ├─→ Create AgentSessionState
    ├─→ Register abort controllers
    └─→ Register child processes
    │
    ▼
Agent Loop
    │
    ├─→ Check shouldStopSession()
    │   │
    │   ├─→ Yes: Break loop
    │   │
    │   └─→ No: Continue
    │
    ├─→ Execute tools
    ├─→ Update iteration count
    └─→ Loop back
    │
    ▼
Agent Complete / Error
    │
    ▼
cleanupSession(sessionId)
    │
    ├─→ Abort all controllers
    ├─→ Kill all processes
    └─→ Remove from map
    │
    ▼
Agent End
```

### Message Queue Processing (G-18)
```
User Submits Message
    │
    ▼
enqueue(conversationId, text)
    │
    ├─→ Create QueuedMessage
    └─→ Add to queue
    │
    ▼
Agent Session Active?
    │
    ├─→ Yes: Queue waits
    │
    └─→ No: Process immediately
        │
        ▼
        tryAcquireProcessingLock()
        │
        ├─→ Lock acquired?
        │   │
        │   ├─→ No: Skip (already processing)
        │   │
        │   └─→ Yes: Continue
        │
        ▼
        While queue not paused:
        │
        ├─→ peekQueue() → get next message
        ├─→ markProcessing()
        ├─→ processWithAgentMode()
        ├─→ markProcessed()
        └─→ Loop
        │
        ▼
        releaseProcessingLock()
```

### ACP Delegation (G-19)
```
Main Agent Decision
    │
    ▼
Delegate to Sub-Agent?
    │
    ├─→ Async: executeACPAgentAsync()
    │   │
    │   ├─→ Start background polling
    │   └─→ Return immediately
    │
    └─→ Sync: runTask()
        │
        ▼
        spawnAgent() [if needed]
        │
        ├─→ Spawn stdio process
        └─→ Wait for ready
        │
        ▼
        getOrCreateSession()
        │
        ├─→ Create isolated session
        └─→ Capture profile snapshot
        │
        ▼
        sendPrompt()
        │
        ├─→ Send task to agent
        └─→ Wait for response
        │
        ▼
        Return result to main agent
```

## Component Interaction Matrix

```
         │ OAuth │ Elicit │ Sample │ Session │ ACP  │ Queue
─────────┼───────┼────────┼────────┼─────────┼──────┼──────
OAuth    │   -   │   -    │   -    │    -    │  -   │  -
Elicit   │   -   │   -    │   -    │    ✓    │  -   │  -
Sample   │   -   │   -    │   -    │    ✓    │  -   │  -
Session  │   ✓   │   ✓    │   ✓    │    -    │  ✓   │  ✓
ACP      │   -   │   -    │   -    │    ✓    │  -   │  -
Queue    │   -   │   -    │   -    │    ✓    │  -   │  -
```

Legend: ✓ = Direct interaction, - = No direct interaction

## File Organization

```
apps/desktop/src/main/
├── oauth-storage.ts          ← G-22: Token storage
├── oauth-client.ts           ← G-22: OAuth flow
├── oauth-callback-server.ts  ← G-22: Callback handling
├── mcp-elicitation.ts        ← G-23: Elicitation
├── mcp-sampling.ts           ← G-23: Sampling
├── mcp-service.ts            ← G-22, G-23: Integration
├── state.ts                  ← G-24: Session state
├── agent-session-tracker.ts  ← G-24: Session tracking
├── message-queue-service.ts  ← G-18: Queue management
├── acp-service.ts            ← G-19: ACP spawning
└── acp/
    ├── acp-router-tools.ts   ← G-19: Delegation
    ├── internal-agent.ts     ← G-19: Sub-sessions
    └── acp-process-manager.ts ← G-19: Process mgmt

packages/server/src/services/
├── mcp-service.ts            ← G-22, G-23: Stubs
└── state.ts                  ← G-24: Session state

apps/mobile/src/store/
└── message-queue.ts          ← G-18: Mobile queue
```

## Summary Statistics

- **Total Classes/Services**: 12
- **Total Methods**: 60+
- **Total Files**: 15+
- **Lines of Code**: 5000+
- **Documentation Pages**: 7

