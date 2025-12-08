# SpeakMCP Debugging Guide

## Desktop App (Electron)

### Debug Logging

```bash
pnpm dev d                # Enable all debug logging
pnpm dev debug-llm        # LLM calls and responses
pnpm dev debug-tools      # MCP tool execution
pnpm dev debug-ui         # UI state changes
```

### Chrome DevTools Protocol (CDP)

```bash
pnpm dev d --remote-debugging-port=9222
```

Connect: Chrome → `chrome://inspect` → Configure → add `localhost:9222` → inspect

### IPC Methods

Invoke TIPC procedures in DevTools console:

```javascript
window.electron.ipcRenderer.invoke('createMcpTextInput', { text: 'Hello' })
window.electron.ipcRenderer.invoke('emergencyStopAgent')
window.electron.ipcRenderer.invoke('debugPanelState')
window.electron.ipcRenderer.invoke('getConfig')
window.electron.ipcRenderer.invoke('saveConfig', { config: { /* ... */ } })
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
