# Console Logger Implementation Summary

## Overview

Created a script to supplement the debug mode that captures dev tools logs from each UI window (main, panel, setup) and pipes them into the debug logs in the console with the `[DEBUG][UI]` prefix when the `--debug-ui` flag is enabled.

## Files Created

### 1. `src/main/console-logger.ts`
Main implementation file that provides console logging functionality for all renderer processes.

**Key Features:**
- Captures console messages from all renderer windows (main, panel, setup)
- Automatically enabled when `--debug-ui` flag is used
- Adds window identifier prefix ([MAIN], [PANEL], [SETUP])
- Shows source file and line number for each log
- Supports all console levels (log, warn, error, info, debug)
- Also captures renderer crashes and unresponsive events

**Main Functions:**
- `setupConsoleLogger(win: BrowserWindow, windowId: string)` - Primary implementation using Electron's `console-message` event
- `injectConsoleForwarder(win: BrowserWindow, windowId: string)` - Alternative implementation (not currently used)
- `setupConsoleLoggersForAllWindows(windows: Map<string, BrowserWindow>)` - Batch setup for all windows

### 2. `src/main/console-logger.README.md`
Comprehensive documentation for the console logger feature.

**Contents:**
- Feature overview
- Usage instructions
- Example output
- Architecture diagram
- Implementation details
- Testing guide
- Troubleshooting tips

## Files Modified

### 1. `src/main/window.ts`
**Changes:**
- Added import: `import { setupConsoleLogger } from "./console-logger"`
- Added call to `setupConsoleLogger(win, id)` in `createBaseWindow()` function (line 54)

This ensures that every window created automatically gets console logging enabled when debug mode is active.

### 2. `DEBUGGING.md`
**Changes:**
- Updated the "UI Debug" section to document the new console logging feature
- Added examples showing window identifiers in log output
- Explained how console messages are captured from all renderer windows
- Added note about seeing all UI logs in one place without opening DevTools

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    Main Process                              │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  console-logger.ts                                    │  │
│  │  - setupConsoleLogger(win, windowId)                 │  │
│  │  - Listens to 'console-message' events              │  │
│  │  - Formats and forwards to logUI()                  │  │
│  └──────────────────────────────────────────────────────┘  │
│                          ▲                                   │
│                          │ console-message events            │
│                          │                                   │
└──────────────────────────┼───────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
┌───────▼────────┐  ┌──────▼──────┐  ┌───────▼────────┐
│ Main Window    │  │ Panel Window│  │ Setup Window   │
│ (Renderer)     │  │ (Renderer)  │  │ (Renderer)     │
│                │  │             │  │                │
│ console.log()  │  │ console.log()│  │ console.log()  │
│ console.warn() │  │ logUI()     │  │ console.error()│
│ console.error()│  │             │  │                │
└────────────────┘  └─────────────┘  └────────────────┘
```

## Usage

### Enable UI Debug Mode

```bash
# Enable UI debug mode
pnpm dev debug-ui
# or shorthand
pnpm dev dui

# Enable all debug modes (includes UI)
pnpm dev debug-all
# or shorthand
pnpm dev d
```

### Example Output

```
[2025-11-09T10:30:45.123Z] [DEBUG][UI] [MAIN] Component mounted (App.tsx:42)
[2025-11-09T10:30:45.234Z] [DEBUG][UI] [PANEL] [FOCUS] Input focus { activeElement: 'INPUT' } (panel.tsx:156)
[2025-11-09T10:30:45.345Z] [DEBUG][UI] [MAIN] [STATE] ModelSelector.searchQuery: { from: '', to: 'gpt' } (ModelSelector.tsx:89)
[2025-11-09T10:30:45.456Z] [DEBUG][UI] [PANEL] [ERROR] Failed to load data (panel.tsx:123)
[2025-11-09T10:30:45.567Z] [DEBUG][UI] [PANEL] [WARN] Deprecated API usage (TextInput.tsx:67)
```

## Benefits

1. **Centralized Logging**: All UI logs from all windows appear in one place (main console)
2. **No DevTools Required**: Don't need to open DevTools for each window separately
3. **Window Identification**: Easy to see which window generated each log
4. **Source Tracking**: File and line number included for easy debugging
5. **Zero Configuration**: Automatically works when debug mode is enabled
6. **No Performance Impact**: Only active when `--debug-ui` flag is used

## Testing

To test the console logger:

1. Enable UI debug mode:
   ```bash
   pnpm dev dui
   ```

2. Add some console logs in a renderer component:
   ```typescript
   // In src/renderer/src/App.tsx
   console.log('App mounted')
   console.warn('This is a warning')
   console.error('This is an error')
   ```

3. Run the app and check the terminal output for:
   ```
   [DEBUG][UI] [MAIN] App mounted (App.tsx:XX)
   [DEBUG][UI] [MAIN] [WARN] This is a warning (App.tsx:XX)
   [DEBUG][UI] [MAIN] [ERROR] This is an error (App.tsx:XX)
   ```

## Implementation Notes

### Why Use `console-message` Event?

The implementation uses Electron's built-in `console-message` event rather than injecting JavaScript to intercept console methods because:

1. **Simpler**: No need for IPC setup or preload modifications
2. **More Reliable**: Works immediately on window creation
3. **Automatic**: Captures all console output without renderer-side code
4. **Safer**: No risk of breaking existing console functionality

### Alternative Approach

An alternative implementation (`injectConsoleForwarder`) is available but not currently used. It injects JavaScript to intercept console methods, which provides:
- More detailed control over formatting
- Ability to capture console.log arguments separately
- Custom metadata support

However, it requires IPC setup and has timing issues, so the simpler `console-message` approach is preferred.

## Future Enhancements

Potential improvements:
1. Add filtering by window type (e.g., only show PANEL logs)
2. Add log level filtering (e.g., only show errors and warnings)
3. Add timestamp filtering (e.g., only show logs from last 5 minutes)
4. Add log export functionality
5. Add real-time log streaming to a web interface

## Related Documentation

- `src/main/console-logger.README.md` - Detailed technical documentation
- `DEBUGGING.md` - User-facing debug mode documentation
- `src/main/debug.ts` - Debug flag management
- `src/renderer/src/lib/debug.ts` - Renderer-side debug helpers

