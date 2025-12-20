# SpeakMCP Debugging Guide

## ⚠️ REQUIRED: Agent UI Tests (Do These First!)

Before any debugging work, **AI agents MUST run these tests** to verify UI interaction:

### Setup
```bash
pnpm dev -- --remote-debugging-port=9222
```
Then: `list_electron_targets_electron-native` → `connect_to_electron_target_electron-native`

### Test 1: Click Settings Button
```javascript
// execute_javascript_electron-native - Navigate & click toggle
window.location.hash = '/settings/general';
setTimeout(() => document.querySelector('[data-state]')?.click(), 500);
```
Take screenshot to verify toggle changed.

### Test 2: Send 'hi' to Agent
```javascript
// execute_javascript_electron-native - Send message via IPC
await window.electron.ipcRenderer.invoke('createMcpTextInput', { text: 'hi', conversationId: null });
```
Verify: `window.electron.ipcRenderer.invoke('getAgentStatus')`

---

## Desktop App (Electron)

### Debug Logging

```bash
pnpm dev -- -d              # Enable all debug logging (short form)
pnpm dev -- --debug         # Enable all debug logging (long form)
pnpm dev -- --debug-llm     # LLM calls and responses
pnpm dev -- --debug-tools   # MCP tool execution
pnpm dev -- --debug-ui      # UI state changes
pnpm dev -- --debug-app     # App lifecycle events
pnpm dev -- --debug-keybinds # Keybind handling
```

You can also use environment variables:
```bash
DEBUG=llm pnpm dev          # LLM debugging
DEBUG=tools,llm pnpm dev    # Multiple debug flags
DEBUG=* pnpm dev            # All debugging
DEBUG_LLM=1 pnpm dev        # Alternative env format
```

### Chrome DevTools Protocol (CDP)

```bash
pnpm dev -- --remote-debugging-port=9222
```

Connect: Chrome → `chrome://inspect` → Configure → add `localhost:9222` → inspect

### IPC Methods

Invoke TIPC procedures in DevTools console:

```javascript
window.electron.ipcRenderer.invoke('createMcpTextInput', { text: 'Hello', conversationId: null })
window.electron.ipcRenderer.invoke('emergencyStopAgent')
window.electron.ipcRenderer.invoke('debugPanelState')
window.electron.ipcRenderer.invoke('getConfig')
window.electron.ipcRenderer.invoke('saveConfig', { config: { /* ... */ } })
window.electron.ipcRenderer.invoke('getAgentStatus')
window.electron.ipcRenderer.invoke('getAgentSessions')
```

> Procedures defined in `apps/desktop/src/main/tipc.ts`. Direct `invoke()` works because TIPC registers individual `ipcMain.handle` handlers.

---

## Mobile App (Expo Web)

Debug the mobile app by running it as a web app with full Chrome DevTools access.

### Start in Web Mode

```bash
pnpm dev:mobile           # Then press 'w' for web
# or
pnpm --filter @speakmcp/mobile web
```

Opens at `http://localhost:8081`. Use Chrome DevTools (`F12`) to debug.

### Voice Features

Web uses the Web Speech API fallback (Chrome/Edge required). Grant microphone permissions when prompted.
