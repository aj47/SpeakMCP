# SpeakMCP Debugging Guide

This guide covers debugging methods for both the **desktop app (Electron)** and the **mobile app (Expo)**. Use the appropriate method based on which part of SpeakMCP you're debugging.

---

## Desktop App (Electron)

The desktop app is built with Electron. Use these methods to debug the main process, renderer process, and IPC communication.

### Debug All

Enable all debug logging with a single command:

```bash
pnpm dev d
```

### Debug Specific Components

```bash
pnpm dev debug-llm       # LLM calls and responses
pnpm dev debug-tools     # MCP tool execution
pnpm dev debug-ui        # UI focus, renders, and state changes
pnpm dev debug-keybinds  # Keyboard shortcut handling
pnpm dev debug-app       # General app lifecycle
```

### CDP (Chrome DevTools Protocol)

For programmatic control of the Electron app:

#### Start with CDP

```bash
pnpm dev d --remote-debugging-port=9222
```

You should see: `DevTools listening on ws://127.0.0.1:9222/devtools/browser/...`

#### Connect via Chrome

1. Open Chrome → `chrome://inspect`
2. Click "Configure" → add `localhost:9222`
3. Click "inspect" on your Electron windows

#### IPC Methods

The app uses [@egoist/tipc](https://github.com/egoist/tipc) for type-safe IPC. In the DevTools console, you can invoke TIPC procedures directly:

```javascript
// Agent sessions
window.electron.ipcRenderer.invoke('createMcpTextInput', { text: 'Hello' })
window.electron.ipcRenderer.invoke('getAgentSessions')
window.electron.ipcRenderer.invoke('stopAgentSession', { sessionId: 'your-session-id' })
window.electron.ipcRenderer.invoke('emergencyStopAgent')

// Panel control
window.electron.ipcRenderer.invoke('debugPanelState')
window.electron.ipcRenderer.invoke('showPanelWindow')
window.electron.ipcRenderer.invoke('hidePanelWindow')

// Configuration
window.electron.ipcRenderer.invoke('getConfig')
window.electron.ipcRenderer.invoke('saveConfig', { config: { /* partial config */ } })
```

> **Note**: These procedure names are defined in `apps/desktop/src/main/tipc.ts`. The renderer code uses the `tipcClient` wrapper for type safety, but direct `invoke()` calls work for debugging.

---

## Mobile App (Expo Web)

The mobile app is built with React Native (Expo). The easiest way to debug the mobile app is by running it as a **web app** in your browser, which provides full access to Chrome DevTools.

### Why Use Expo Web for Debugging?

- **Full Chrome DevTools access** - Inspect elements, debug JavaScript, view network requests
- **No native module limitations** - Web Speech API fallback works for voice features
- **Faster iteration** - No need to rebuild native apps for UI/logic changes
- **Cross-platform testing** - Test mobile code in a desktop browser

### Start the Mobile App in Web Mode

From the repository root:

```bash
# Start Metro bundler (interactive mode - choose 'w' for web)
pnpm dev:mobile

# Or directly start in web mode
pnpm --filter @speakmcp/mobile web
```

Or from the mobile app directory:

```bash
cd apps/mobile
pnpm start      # Then press 'w' to open in web browser
pnpm web        # Directly start in web mode
```

The app will open at `http://localhost:8081` (or similar port).

### Debugging with Chrome DevTools

1. Open the app in Chrome
2. Press `F12` or `Cmd+Option+I` (Mac) / `Ctrl+Shift+I` (Windows/Linux)
3. Use the **Console** tab for JavaScript logs
4. Use the **Elements** tab to inspect React components
5. Use the **Network** tab to debug API calls
6. Use the **Sources** tab to set breakpoints

### Debugging Voice Features on Web

The mobile app uses `expo-speech-recognition` on native devices, but falls back to the **Web Speech API** when running in a browser:

- **Requirements**: Chrome or Edge over HTTPS (or localhost)
- **Voice input**: Hold-to-talk and hands-free modes work via Web Speech API
- **TTS playback**: Works via `expo-speech` web fallback

If speech recognition isn't working on web:
1. Ensure you're using Chrome or Edge
2. Check that the page is served over HTTPS (or localhost)
3. Grant microphone permissions when prompted

### Running Native Mobile Builds

For testing native-specific features that don't work on web:

```bash
# Android (requires Android Studio / emulator)
pnpm --filter @speakmcp/mobile android

# iOS (requires Xcode / macOS)
pnpm --filter @speakmcp/mobile ios
```

**Note**: The mobile app uses `expo-speech-recognition`, which requires a **development build** - it won't work in Expo Go. See `apps/mobile/README.md` for details.

---

## When to Use Each Method

| Debugging Target | Recommended Method |
|------------------|-------------------|
| Desktop app UI/renderer | Electron DevTools (`pnpm dev d`) |
| Desktop main process/IPC | CDP with Chrome (`--remote-debugging-port=9222`) |
| Desktop agent/LLM logic | `pnpm dev debug-llm` or `debug-tools` |
| Mobile app UI/logic | Expo Web (`pnpm dev:mobile` → press 'w') |
| Mobile voice features | Expo Web (uses Web Speech API fallback) |
| Mobile native-only bugs | Native build (`expo run:android` / `expo run:ios`) |
