# SpeakMCP Debugging Guide

## Debug All

Enable all debug logging with a single command:

```bash
pnpm dev d
```

## CDP (Chrome DevTools Protocol)

For programmatic control of the Electron app:

### Start with CDP

```bash
pnpm dev d --remote-debugging-port=9222
```

You should see: `DevTools listening on ws://127.0.0.1:9222/devtools/browser/...`

### Connect via Chrome

1. Open Chrome → `chrome://inspect`
2. Click "Configure" → add `localhost:9222`
3. Click "inspect" on your Electron windows

### IPC Methods

Access via `window.electron.ipcRenderer.invoke()` in DevTools console:

```javascript
// Agent sessions
window.electron.ipcRenderer.invoke('createMcpTextInput', { text: 'Hello' })
window.electron.ipcRenderer.invoke('getAgentSessions')
window.electron.ipcRenderer.invoke('stopAgentSession', { sessionId })
window.electron.ipcRenderer.invoke('emergencyStopAgent')

// Panel control
window.electron.ipcRenderer.invoke('debugPanelState')
window.electron.ipcRenderer.invoke('showPanelWindow')
window.electron.ipcRenderer.invoke('hidePanelWindow')

// Configuration
window.electron.ipcRenderer.invoke('getConfig')
window.electron.ipcRenderer.invoke('updateConfig', { ...options })
```
