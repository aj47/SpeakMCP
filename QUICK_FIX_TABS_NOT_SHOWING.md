# Quick Fix: Tabs Not Showing

## Issue 1: Tabs Not Visible

### Root Cause
The tabbed mode is **disabled by default** for backward compatibility. You need to enable it in settings.

### Solution

**Option A: Enable in Settings UI (Recommended)**
1. Open the main window (click the tray icon → Settings, or open the app)
2. Go to **Settings → General**
3. Scroll down to **"Agent Interface"** section
4. Toggle **"Tabbed Mode"** to **ON**
5. Close settings and open the panel (Ctrl+Alt)
6. You should now see tabs!

**Option B: Enable via Config File (Quick)**
1. Close the app
2. Open the config file:
   - Mac: `~/Library/Application Support/SpeakMCP/config.json`
   - Windows: `%APPDATA%\SpeakMCP\config.json`
   - Linux: `~/.config/SpeakMCP/config.json`
3. Add this line to the JSON:
   ```json
   "tabbedAgentMode": true
   ```
4. Save and restart the app
5. Open panel (Ctrl+Alt) - tabs should appear!

**Option C: Change Default (For Development)**
If you want tabs enabled by default, edit `src/main/config.ts`:
```typescript
// Line 29
tabbedAgentMode: true, // Changed from false
```
Then rebuild: `npm run dev`

---

## Issue 2: Can't Spawn New Input While Agent Running

### Root Cause
The panel window is designed to be **modal** - it hides after you finish recording and shows agent progress. This prevents starting new recordings while an agent is active.

This is actually the **core problem** that the tabbed interface was designed to solve!

### Current Behavior (Traditional Panel)
```
1. Press Ctrl+Alt → Panel shows, recording starts
2. Release Ctrl+Alt → Panel stays visible, agent processes
3. Try to press Ctrl+Alt again → Nothing happens (panel already visible)
4. Panel is "locked" until agent finishes
```

### Expected Behavior (With Tabs)
```
1. Press Ctrl+Alt → Tab 1 records
2. Release Ctrl+Alt → Tab 1 processes
3. Press Cmd/Ctrl+T → Create Tab 2
4. Press Ctrl+Alt in Tab 2 → Tab 2 records
5. Both agents run simultaneously!
```

### Why It's Not Working Yet

The tabbed interface needs to handle the panel visibility differently:

**Problem**: The panel window hides after recording finishes (traditional behavior)
**Solution**: When in tabbed mode, the panel should stay visible to allow new tabs

---

## Immediate Fix: Keep Panel Visible in Tabbed Mode

Let me implement a fix to keep the panel visible when in tabbed mode:

### Fix 1: Prevent Panel from Hiding

Edit `src/main/window.ts` - modify the `stopRecordingAndHidePanelWindow` function:

```typescript
export function stopRecordingAndHidePanelWindow() {
  const config = configStore.get()
  
  // In tabbed mode, don't hide the panel
  if (config.tabbedAgentMode) {
    // Just stop recording, keep panel visible
    getWindowRendererHandlers("panel")?.stopRecording.send()
    return
  }
  
  // Traditional behavior: hide panel
  const win = WINDOWS.get("panel")
  if (win) {
    win.hide()
    getWindowRendererHandlers("panel")?.stopRecording.send()
  }
}
```

### Fix 2: Allow Recording in Tabbed Mode Even When Panel Visible

Edit `src/main/keyboard.ts` - modify the keyboard handler:

```typescript
// Around line 388
const win = WINDOWS.get("panel")
if (win && win.isVisible()) {
  const config = configStore.get()
  
  // In tabbed mode, allow new recordings even when panel is visible
  if (config.tabbedAgentMode) {
    // Don't close panel, just start new recording
    return // Let the recording start
  }
  
  // Traditional behavior
  if (state.isRecording) {
    stopRecordingAndHidePanelWindow()
  } else {
    closeAgentModeAndHidePanelWindow()
  }
}
```

---

## Testing After Fixes

1. **Enable tabbed mode** (see Option A, B, or C above)
2. **Restart the app** (if you changed config manually)
3. **Open panel** (Ctrl+Alt) - should see tabs
4. **Start agent in Tab 1** (Ctrl+Alt, speak, release)
5. **Create Tab 2** (Cmd/Ctrl+T)
6. **Start agent in Tab 2** (Ctrl+Alt, speak, release)
7. **Both agents should run simultaneously!**

---

## Debug: Check If Tabbed Mode Is Enabled

Open DevTools (Cmd/Ctrl+Shift+I) and check the console:

You should see:
```
[Panel Wrapper] Config loaded: { tabbedMode: true, fullConfig: {...} }
[Panel Wrapper] Rendering AgentTabbedPanel
```

If you see:
```
[Panel Wrapper] Config loaded: { tabbedMode: false, fullConfig: {...} }
[Panel Wrapper] Rendering TraditionalPanel
```

Then tabbed mode is not enabled - follow Option A, B, or C above.

---

## Quick Test Script

Run this in the DevTools console to check config:

```javascript
// Check if tabbed mode is enabled
window.api.getConfig().then(config => {
  console.log('Tabbed Mode:', config.tabbedAgentMode)
  if (!config.tabbedAgentMode) {
    console.log('❌ Tabbed mode is DISABLED')
    console.log('Enable it in Settings → General → Agent Interface')
  } else {
    console.log('✅ Tabbed mode is ENABLED')
  }
})
```

---

## Summary

**Issue 1: Tabs not showing**
- **Cause**: Tabbed mode disabled by default
- **Fix**: Enable in Settings → General → Agent Interface

**Issue 2: Can't spawn new input**
- **Cause**: Panel hides after recording (modal behavior)
- **Fix**: Need to implement panel persistence in tabbed mode

**Next Steps**:
1. Enable tabbed mode
2. Implement the fixes above
3. Test multiple simultaneous agents

Let me implement these fixes now!

