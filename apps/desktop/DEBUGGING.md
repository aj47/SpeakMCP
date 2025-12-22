# SpeakMCP Debugging Guide

## ⚠️ REQUIRED: Agent UI Tests (Do These First!)

Before any debugging work, **AI agents MUST run these tests** to verify UI interaction:

### Setup
```bash
# Option 1: Set environment variable (recommended)
ELECTRON_ARGS="--remote-debugging-port=9222" pnpm dev

# Option 2: Or run electron directly with the flag
npx electron . --remote-debugging-port=9222
```

> ⚠️ **Note**: The `--remote-debugging-port` flag must be passed directly to Electron/Chromium,
> not as an app argument after `--`. Using `pnpm dev -- --remote-debugging-port=9222` will NOT work
> because the flag gets passed to the app instead of Electron itself.

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

## Debug Flags
```bash
pnpm dev -- -d              # All debug logging
pnpm dev -- --debug-llm     # LLM calls | --debug-tools | --debug-ui | --debug-app
DEBUG=* pnpm dev            # Via env var
```

## IPC Methods
```javascript
window.electron.ipcRenderer.invoke('emergencyStopAgent')
window.electron.ipcRenderer.invoke('getConfig')
window.electron.ipcRenderer.invoke('saveConfig', { config: {...} })
window.electron.ipcRenderer.invoke('getAgentSessions')
```
> All procedures in `apps/desktop/src/main/tipc.ts`

## CDP (Chrome DevTools Protocol)
```bash
# Start app with CDP enabled
ELECTRON_ARGS="--remote-debugging-port=9222" pnpm dev
```
Chrome → `chrome://inspect` → Configure → add `localhost:9222` → inspect

## Mobile App
```bash
pnpm dev:mobile  # Press 'w' for web → localhost:8081
```
