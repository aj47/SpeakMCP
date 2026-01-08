# SpeakMCP Debugging Guide

## 🔧 Quick Start: Enable Debug Logging

**Always start with debug logging enabled** - this captures LLM calls, tool execution, UI events, and app lifecycle:

```bash
pnpm dev -- -d              # Enable ALL debug logging (recommended)
```

Selective flags:
| Flag | Description |
|------|-------------|
| `--debug-llm` / `-dl` | LLM API calls and responses |
| `--debug-tools` / `-dt` | MCP tool execution |
| `--debug-ui` / `-dui` | UI/renderer console logs |
| `--debug-app` / `-dapp` | App lifecycle events |
| `--debug-keybinds` / `-dk` | Keyboard shortcut handling |

Environment variable alternative: `DEBUG=* pnpm dev`

---

## CDP (Chrome DevTools Protocol)

For browser-style debugging with DevTools:

```bash
REMOTE_DEBUGGING_PORT=9222 pnpm dev -- -d
```

> ⚠️ **Note**: The `--remote-debugging-port` flag must be passed via the `REMOTE_DEBUGGING_PORT` env var,
> not as a CLI argument. Using `pnpm dev -- --remote-debugging-port=9222` will NOT work.

Chrome → `chrome://inspect` → Configure → add `localhost:9222` → inspect

---

## Agent UI Tests (For AI Agents)

After connecting via CDP: `list_electron_targets_electron-native` → `connect_to_electron_target_electron-native`

### Test 1: Click Settings Button
```javascript
// execute_javascript_electron-native
window.location.hash = '/settings/general';
setTimeout(() => document.querySelector('[data-state]')?.click(), 500);
```

### Test 2: Send 'hi' to Agent
```javascript
// execute_javascript_electron-native
await window.electron.ipcRenderer.invoke('createMcpTextInput', { text: 'hi', conversationId: null });
```
Verify: `window.electron.ipcRenderer.invoke('getAgentStatus')`

---

## IPC Methods
```javascript
window.electron.ipcRenderer.invoke('emergencyStopAgent')
window.electron.ipcRenderer.invoke('getConfig')
window.electron.ipcRenderer.invoke('saveConfig', { config: {...} })
window.electron.ipcRenderer.invoke('getAgentSessions')
```
> All procedures in `apps/desktop/src/main/tipc.ts`

## Mobile App
```bash
pnpm dev:mobile  # Press 'w' for web → localhost:8081
```

---

## ACP Subagent Debugging

### Key Files
| File | Purpose |
|------|---------|
| `src/main/acp/acp-router-tools.ts` | Delegation logic, session→runId mapping, progress emission |
| `src/main/acp-service.ts` | ACP agent spawning, session management, event emission |
| `src/main/emit-agent-progress.ts` | Emits progress updates to UI via TIPC |
| `src/main/mcp-service.ts` | Tool execution, passes sessionId to builtin tools |
| `src/renderer/src/components/agent-progress.tsx` | Renders `DelegationBubble` for subagent streams |

### Common Issues

#### Subagent streams not visible in UI
**Symptoms**: Delegation runs but no streaming output appears in the conversation.

**Debug checklist**:
1. Check `sessionToRunId` mapping - session updates need to map to the correct runId
2. Verify `parentSessionId` is passed through the call chain:
   - `llm.ts` → `mcp-service.ts` → `executeBuiltinTool()` → `executeACPRouterTool()`
3. Look for "Session update" logs with `-d` flag
4. Check `emitAgentProgress` is called with correct `sessionId`

**Key data structures**:
```typescript
// acp-router-tools.ts
sessionToRunId: Map<sessionId, runId>        // Maps ACP session → delegation run
agentNameToActiveRunId: Map<agentName, runId> // Fallback for race conditions
delegatedRuns: Map<runId, ACPSubAgentState>   // Tracks all delegations
```

**Race condition**: Session updates may arrive before `sessionToRunId` is populated.
The fallback `agentNameToActiveRunId` handles this by looking up the active run by agent name.

#### Delegation progress not routing to correct UI session
Check that `parentSessionId` flows through:
```
processTranscriptWithAgentMode(sessionId)
  → mcpService.executeToolCall(..., sessionId)
    → executeBuiltinTool(toolName, args, sessionId)  // ← sessionId must be passed!
      → executeACPRouterTool(toolName, args, sessionId)
        → handleDelegateToAgent(args, parentSessionId)
```

### Debug Logging
```bash
# Watch for these log patterns:
grep -E "(Session update|Mapped session|Registered active run|Fallback mapping)"
```
