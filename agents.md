# Agent Architecture Documentation

This document explains the agent session system, UI variants, and mobile connectivity to help developers and AI agents understand the architecture.

## Agent Session Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MAIN PROCESS                                       │
│  ┌─────────────────────┐     ┌─────────────────────┐     ┌───────────────┐  │
│  │ AgentSessionTracker │────▶│  emit-agent-progress │────▶│   WINDOWS     │  │
│  │ (agent-session-     │     │  emitAgentProgress() │     │  main + panel │  │
│  │  tracker.ts)        │     └─────────────────────┘     └───────────────┘  │
│  │                     │                                                     │
│  │ • startSession()    │     AgentProgressUpdate                            │
│  │ • updateSession()   │     ─────────────────────                          │
│  │ • completeSession() │     • sessionId                                    │
│  └─────────────────────┘     • conversationId                               │
│                              • steps[]                                       │
│                              • isSnoozed                                    │
│                              • stepSummaries[]                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼ IPC (agentProgressUpdate)
┌─────────────────────────────────────────────────────────────────────────────┐
│                         RENDERER PROCESS(ES)                                 │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        agent-store.ts (Zustand)                      │    │
│  │  • agentProgressById: Map<sessionId, AgentProgressUpdate>            │    │
│  │  • focusedSessionId: string | null                                   │    │
│  │  • updateSessionProgress(), setFocusedSessionId()                    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                              │                                               │
│              ┌───────────────┼───────────────────┐                          │
│              ▼               ▼                   ▼                          │
│    ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐             │
│    │  variant="tile" │ │variant="overlay"│ │variant="default"│             │
│    │  (sessions.tsx) │ │  (panel.tsx)    │ │ (ConversationDi │             │
│    │                 │ │                 │ │  splay)         │             │
│    │ Sessions Page   │ │ Floating Panel  │ │ Main Window     │             │
│    │ Grid/List/Kanban│ │ Compact overlay │ │ Full detail     │             │
│    └─────────────────┘ └─────────────────┘ └─────────────────┘             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## AgentProgress Component Variants

### Location: `apps/desktop/src/renderer/src/components/agent-progress.tsx`

| Variant   | Used In            | Purpose                                    | Features                                    |
|-----------|--------------------|--------------------------------------------|---------------------------------------------|
| `tile`    | `sessions.tsx`     | Session cards in grid/list/kanban views   | Compact, snooze/dismiss buttons, clickable  |
| `overlay` | `panel.tsx`        | Floating panel overlay                     | Full-featured, TTS auto-play, close button  |
| `default` | ConversationDisplay| Main window conversation view              | Full details, integrated in conversation    |

### Key Differences

1. **tile variant**: 
   - Shows session cards in the Sessions page
   - Click to focus/expand a session
   - Has snooze (run in background) and dismiss buttons
   - Chat/Summary tabs toggle (added recently)

2. **overlay variant**:
   - Shows in the floating panel window
   - Auto-shows when non-snoozed sessions are active
   - Has close button to dismiss overlay
   - Chat/Summary tabs toggle
   - `MultiAgentProgressView` shows when multiple sessions active

3. **default variant**:
   - Used in the main conversation display
   - Full conversation context
   - No snooze/dismiss controls (session managed elsewhere)

## Snoozed State

Sessions start **snoozed by default** (`startSnoozed = true`):
- Snoozed sessions run in the background without showing the floating panel
- User must explicitly focus/unsnooze to see progress in the floating panel
- The Sessions page (`sessions.tsx`) always shows all sessions regardless of snoozed state

```typescript
// From agent-session-tracker.ts
startSession(
  conversationId?: string,
  conversationTitle?: string,
  startSnoozed: boolean = true,  // ← Default is snoozed
  profileSnapshot?: SessionProfileSnapshot
): string
```

## Mobile App Connection

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         MOBILE APP (React Native/Expo)                   │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  tunnelConnectionManager.ts                                       │   │
│  │  • Connects to desktop's remote server via URL + API key          │   │
│  │  • Handles reconnection, health checks                            │   │
│  │  • Supports Cloudflare tunnel detection                           │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                              │                                           │
│                              ▼                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  openaiClient.ts                                                  │   │
│  │  • OpenAI-compatible HTTP client                                  │   │
│  │  • chat() → POST /v1/chat/completions                             │   │
│  │  • Sends conversation_id for continuing sessions                  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                              │                                           │
│                              ▼                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  sessions.ts (Zustand store)                                      │   │
│  │  • serverConversationId: links mobile session to desktop convo    │   │
│  │  • setServerConversationId(), getServerConversationId()           │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ HTTP (Bearer token auth)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         DESKTOP APP (Electron)                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  remote-server.ts (Fastify)                                       │   │
│  │  • POST /v1/chat/completions → runAgent() → LLM + MCP tools       │   │
│  │  • Returns conversation_id in response for session continuity     │   │
│  │  • Auth via Bearer token matching remoteServerApiKey              │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Session Continuity

Mobile sessions track `serverConversationId` to continue conversations:

```typescript
// Mobile: Session type (apps/mobile/src/types/session.ts)
interface Session {
  id: string;                    // Mobile-local session ID
  serverConversationId?: string; // Desktop conversation ID for continuity
  messages: ChatMessage[];
  // ...
}

// Desktop: API response includes conversation_id
// (apps/desktop/src/main/remote-server.ts)
return reply.send({
  ...response,
  conversation_id: result.conversationId, // ← Mobile saves this
});
```

## Dual-Model Summarization

When enabled, a "weak" model generates summaries for UI display:

```
Strong Model (planning/execution)  →  Agent Steps  →  Weak Model (summarization)
                                                              │
                                                              ▼
                                                      AgentStepSummary
                                                      • actionSummary
                                                      • keyFindings[]
                                                      • importance level
                                                              │
                                                              ▼
                                              ┌───────────────────────────────┐
                                              │  Chat/Summary Tab Toggle      │
                                              │  • Chat: normal message stream │
                                              │  • Summary: AgentSummaryView   │
                                              │    with "Save to Memory" btns  │
                                              └───────────────────────────────┘
```

Summaries appear in both `tile` and `overlay` variants when `stepSummaries` exists.

## Key Files Reference

| File                              | Purpose                                      |
|-----------------------------------|----------------------------------------------|
| `main/agent-session-tracker.ts`   | Session lifecycle management                 |
| `main/emit-agent-progress.ts`     | IPC emission to renderer windows             |
| `main/remote-server.ts`           | HTTP API for mobile connectivity             |
| `renderer/stores/agent-store.ts`  | Zustand store for agent progress state       |
| `renderer/components/agent-progress.tsx` | Main UI component (3 variants)         |
| `renderer/pages/sessions.tsx`     | Sessions page (uses tile variant)            |
| `renderer/pages/panel.tsx`        | Floating panel (uses overlay variant)        |
| `shared/types.ts`                 | AgentProgressUpdate, AgentStepSummary types  |
| `mobile/src/lib/tunnelConnectionManager.ts` | Mobile→Desktop connection       |
| `mobile/src/store/sessions.ts`    | Mobile session store with serverConversationId |

