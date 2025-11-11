# CDP Debugging Guide for SpeakMCP

## What is This?

**CDP (Chrome DevTools Protocol)** is a built-in Chromium debugging protocol that lets you programmatically control and inspect Electron apps.

**Why you need electron-native tools:** You don't have direct access to the DevTools console, so you use the `electron-native` (github.com/aj47/electron-native-mcp) tools to interact with CDP.

## Quick Start

### 1. Start the App with CDP Enabled

Use the `launch-process` tool:

```javascript
launch_process({
  command: "pnpm dev dui --remote-debugging-port=9222",
  wait: false,
  max_wait_seconds: 30,
  cwd: "/Users/ajjoobandi/Development/SpeakMCP-Workspaces/slot-1"
})
```

**Flags explained:**
- `dui` - Enable debug UI logging (shows all renderer console logs)
- `--remote-debugging-port=9222` - Enable Chrome DevTools Protocol on port 9222

### 2. Verify CDP is Running

Use the `read-process` tool:

```javascript
read_process({
  terminal_id: 5,  // Use the terminal ID from launch-process
  wait: true,
  max_wait_seconds: 10
})
```

You should see this in the output:
```
DevTools listening on ws://127.0.0.1:9222/devtools/browser/...
```

### 3. List Available Targets

Use the `list_electron_targets_electron-native` electron-native tool:

```javascript
list_electron_targets_electron-native()
```

You should see 2 targets:
- **Main Window** - `http://localhost:5173/`
- **Panel Window** - `http://localhost:5173/panel`

**Example response:**
```json
[
  {
    "id": "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
    "type": "page",
    "title": "SpeakMCP",
    "url": "http://localhost:5173/"
  },
  {
    "id": "B10A2E2D017499B23AA317EDB5AAC5A4",
    "type": "page",
    "title": "SpeakMCP",
    "url": "http://localhost:5173/panel"
  }
]
```

### 4. Connect to a Target

Use the `connect_to_electron_target_electron-native` electron-native tool:

```javascript
connect_to_electron_target_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0"  // Use ID from step 3
})
```

### 5. Execute JavaScript

Use the `execute_javascript_electron-native` electron-native tool:

```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: "window.electron.ipcRenderer.invoke('debugPanelState')"
})
```

---

## How to Call TIPC Methods

### Important Discovery

**TIPC methods are accessible via `window.electron.ipcRenderer.invoke()`**, NOT via `window.electronAPI`.

- ❌ `window.electronAPI` - Only has OAuth methods (manually exposed in preload)
- ✅ `window.electron.ipcRenderer.invoke()` - Has ALL TIPC router methods

### Example: Trigger an Agent Session

Use the `execute_javascript_electron-native` electron-native tool:

```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('createMcpTextInput', {
      text: 'What is 2+2? Just answer with the number.'
    }).then(result => {
      console.log('[TEST] Agent session result:', result);
      return result;
    }).catch(error => {
      console.error('[TEST] Error:', error);
      return { error: error.message };
    })
  `
})
```

### Example: Check Panel State

Use the `execute_javascript_electron-native` electron-native tool:

```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('debugPanelState').then(result => {
      console.log('[TEST] Panel state:', result);
      return result;
    })
  `
})
```

### Example: Show Panel Window

Use the `execute_javascript_electron-native` electron-native tool:

```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: "window.electron.ipcRenderer.invoke('showPanelWindow')"
})
```

---

## Available TIPC Methods for Testing

### Panel Control
- `debugPanelState()` - Get current panel state
- `showPanelWindow()` - Show the panel
- `hidePanelWindow()` - Hide the panel (if exists)

### Agent Sessions
- `createMcpTextInput({ text, conversationId? })` - Trigger agent session with text
- `getAgentSessions()` - Get all active/snoozed sessions
- `stopAgentSession({ sessionId })` - Stop a specific session
- `snoozeAgentSession({ sessionId })` - Snooze a session
- `unsnoozeAgentSession({ sessionId })` - Unsnooze a session
- `clearAgentProgress()` - Clear all agent progress

### Text Input
- `createTextInput({ text })` - Process text without agent mode

### Configuration
- `getConfig()` - Get current configuration
- `updateConfig({ ...config })` - Update configuration

---

## Common Testing Patterns

### Pattern 1: Trigger Agent Session and Monitor

**Step 1:** Connect to main window using `connect_to_electron_target_electron-native`:
```javascript
connect_to_electron_target_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0"
})
```

**Step 2:** Trigger agent session using `execute_javascript_electron-native`:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('createMcpTextInput', {
      text: 'Test agent session'
    }).then(result => {
      console.log('[TEST] Session started:', result);
      return result;
    })
  `
})
```

**Step 3:** Watch terminal output for logs:
```
[AgentSessionTracker] Started session: session_XXX
[WINDOW PANEL] show
[llm.ts emitAgentProgress] Called for session...
[AgentSessionTracker] Completing session: session_XXX
```

### Pattern 2: Check UI State

Use the `execute_javascript_electron-native` electron-native tool:

```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: "window.electron.ipcRenderer.invoke('debugPanelState')"
})
```

**Expected result:**
```json
{
  "exists": true,
  "isVisible": false,
  "isDestroyed": false,
  "bounds": { "x": 376, "y": 45, "width": 600, "height": 443 },
  "isAlwaysOnTop": true
}
```

### Pattern 3: Test Multiple Sessions

**Start first session** using `execute_javascript_electron-native`:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('createMcpTextInput', {
      text: 'First session'
    })
  `
})
```

**Start second session (while first is running)** using `execute_javascript_electron-native`:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('createMcpTextInput', {
      text: 'Second session'
    })
  `
})
```

**Check active sessions** using `execute_javascript_electron-native`:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: "window.electron.ipcRenderer.invoke('getAgentSessions')"
})
```

---

## Debugging Tips

### 1. Watch Terminal Output

The `dui` flag enables debug logging. Watch for:
- `[DEBUG][UI] [MAIN]` - Main window logs
- `[DEBUG][UI] [PANEL]` - Panel window logs
- `[AgentSessionTracker]` - Session lifecycle
- `[llm.ts emitAgentProgress]` - Agent progress updates
- `[WINDOW PANEL] show/hide` - Panel visibility changes

### 2. Check What's Available

Use the `execute_javascript_electron-native` electron-native tool:

```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: "Object.keys(window.electronAPI).join(', ')"
})
```

**Returns:** `"initiateOAuthFlow, completeOAuthFlow, getOAuthStatus, revokeOAuthTokens, testMCPServer"`

### 3. Take Screenshots

Use the `take_electron_screenshot_electron-native` electron-native tool:

```javascript
take_electron_screenshot_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0"
})
```

This captures the current state of the window.

### 4. Inspect DOM

Use the `execute_javascript_electron-native` electron-native tool:

```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: "document.querySelector('.agent-progress')?.textContent"
})
```

---

## Troubleshooting

### Problem: "Failed to list CDP targets"

**Solution:** Make sure app is running with `--remote-debugging-port=9222`

### Problem: "No handler registered for 'methodName'"

**Solution:** Check the method name. Common mistakes:
- ❌ `processWithAgentMode` - This is a helper function, not a TIPC method
- ✅ `createMcpTextInput` - This is the correct TIPC method

### Problem: "Error invoking remote method"

**Solution:** Check the parameters. TIPC methods expect specific input shapes:
```javascript
// ❌ Wrong
invoke('createMcpTextInput', 'text here')

// ✅ Correct
invoke('createMcpTextInput', { text: 'text here' })
```

### Problem: Agent session doesn't start

**Check:**
1. Is `mcpToolsEnabled: true` in config?
2. Is an API key configured?
3. Check terminal for error messages

---

## Architecture Notes

### Why This Works

The app uses **TIPC (Type-safe IPC)** which automatically exposes all router methods via `window.electron.ipcRenderer.invoke()`.

**Two separate APIs:**
1. **`window.electronAPI`** - Custom OAuth methods (manually exposed in `src/preload/index.ts`)
2. **`window.electron.ipcRenderer`** - All TIPC methods (automatically exposed by `@electron-toolkit/preload`)

### Security

This is the **intended design**. The renderer can call TIPC methods, but:
- Methods validate inputs
- Methods check permissions
- Methods enforce business logic
- Context isolation prevents direct main process access

---

## Quick Reference

### Start App

Use `launch-process`:
```javascript
launch_process({
  command: "pnpm dev dui --remote-debugging-port=9222",
  wait: false,
  max_wait_seconds: 30,
  cwd: "/path/to/your/project"
})
```

### List Targets

Use `list_electron_targets_electron-native` electron-native tool:
```javascript
list_electron_targets_electron-native()
```

### Connect

Use `connect_to_electron_target_electron-native` electron-native tool:
```javascript
connect_to_electron_target_electron-native({
  targetId: "YOUR_TARGET_ID"
})
```

### Execute JavaScript

Use `execute_javascript_electron-native` electron-native tool:
```javascript
execute_javascript_electron-native({
  targetId: "YOUR_TARGET_ID",
  code: "window.electron.ipcRenderer.invoke('methodName', { params })"
})
```

### Common Methods
- `createMcpTextInput({ text })` - Trigger agent
- `debugPanelState()` - Check panel
- `getAgentSessions()` - List sessions
- `getConfig()` - Get config

---

## Alternative: Manual DevTools Access

If you have direct access to the app (not using electron-native tools), you can also:

1. Start app with CDP: `pnpm dev dui --remote-debugging-port=9222`
2. Open Chrome browser
3. Go to `chrome://inspect`
4. Click "Configure" and add `localhost:9222`
5. Click "inspect" on your Electron app windows
6. Use the DevTools console directly

This gives you the same capabilities but through Chrome's DevTools UI instead of programmatic tool calls.

---

## Related Files

- **TIPC Router:** `src/main/tipc.ts` - All available methods
- **Preload Script:** `src/preload/index.ts` - What's exposed to renderer
- **TIPC Client:** `src/renderer/src/lib/tipc-client.ts` - How renderer calls TIPC
- **Test Cases:** `tests/ui-state-test-cases.md` - What to test
- **CDP Results:** `tests/CDP_TESTING_RESULTS.md` - Detailed findings

---

**Last Updated:** November 11, 2025
**Status:** ✅ Working - CDP debugging fully functional

