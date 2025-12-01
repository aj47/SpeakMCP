# SpeakMCP Debugging Guide

## Quick Start

```bash
pnpm dev d          # Enable all debug modes
pnpm dev dl         # LLM debug only
pnpm dev dt         # Tools debug only
pnpm dev dk         # Keybinds debug only
pnpm dev dapp       # App debug only
pnpm dev dui        # UI debug only
pnpm dev dl dt      # Combine multiple modes
```

## Debug Modes Reference

| Mode | Command | What It Logs |
|------|---------|--------------|
| LLM | `dl` | Request/response cycles, token counts, tool calls, errors |
| Tools | `dt` | MCP server connections, tool discovery, execution results |
| Keybinds | `dk` | Keyboard events, hotkey activation, recording state |
| App | `dapp` | Lifecycle events, window management, config changes |
| UI | `dui` | Component renders, focus/blur events, state changes, console logs from all windows |

## CDP (Chrome DevTools Protocol)

For programmatic control or automated testing:

```bash
pnpm dev dui --remote-debugging-port=9222
```

### Available IPC Methods

Access via `window.electron.ipcRenderer.invoke()` in DevTools console:

| Category | Methods |
|----------|---------|
| Agent | `createMcpTextInput`, `getAgentSessions`, `stopAgentSession`, `emergencyStopAgent` |
| Panel | `debugPanelState`, `showPanelWindow`, `hidePanelWindow` |
| Config | `getConfig`, `updateConfig` |

### Chrome DevTools Access

1. Start app: `pnpm dev dui --remote-debugging-port=9222`
2. Open Chrome → `chrome://inspect` → Configure → add `localhost:9222`
3. Click "inspect" on your Electron windows

## Troubleshooting

**Debug flags not working?**
```bash
pnpm dev d           # ✅ Correct
pnpm dev -- d        # ❌ Wrong
```

**No output?** Debug logs go to terminal, not the app UI. Look for `[DEBUG INIT]` on startup.

**Production debugging:**
```bash
DEBUG=* ./dist/SpeakMCP.app/Contents/MacOS/SpeakMCP
```
