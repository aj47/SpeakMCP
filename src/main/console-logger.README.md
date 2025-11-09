# Console Logger for Renderer Processes

This module captures console messages from all Electron renderer windows and pipes them to the main process console with the `[DEBUG][UI]` prefix when the `--debug-ui` flag is enabled.

## Features

- **Automatic capture**: All console messages from renderer processes are automatically captured
- **Window identification**: Each log is prefixed with the window identifier ([MAIN], [PANEL], [SETUP])
- **Source tracking**: Shows the source file and line number for each log
- **Level support**: Captures all console levels (log, warn, error, info, debug)
- **Crash detection**: Also logs renderer process crashes and unresponsive events
- **Zero configuration**: Automatically enabled when `--debug-ui` flag is used

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

When you run the app with `--debug-ui`, you'll see logs like:

```
[2025-11-09T10:30:45.123Z] [DEBUG][UI] [MAIN] Component mounted (App.tsx:42)
[2025-11-09T10:30:45.234Z] [DEBUG][UI] [PANEL] [FOCUS] Input focus { activeElement: 'INPUT' } (panel.tsx:156)
[2025-11-09T10:30:45.345Z] [DEBUG][UI] [MAIN] [STATE] ModelSelector.searchQuery: { from: '', to: 'gpt' } (ModelSelector.tsx:89)
[2025-11-09T10:30:45.456Z] [DEBUG][UI] [PANEL] [ERROR] Failed to load data (panel.tsx:123)
[2025-11-09T10:30:45.567Z] [DEBUG][UI] [PANEL] [WARN] Deprecated API usage (TextInput.tsx:67)
```

### In Your Renderer Code

No changes needed! Just use console.log, console.warn, console.error as usual:

```typescript
// In any renderer component (main, panel, setup)
console.log('Component mounted')
console.warn('Deprecated API usage')
console.error('Failed to load data')

// Or use the debug helper from src/renderer/src/lib/debug.ts
import { logUI } from '@renderer/lib/debug'

logUI('[FOCUS] Input focus', { activeElement: 'INPUT' })
logUI('[STATE] ModelSelector.searchQuery:', { from: '', to: 'gpt' })
```

## How It Works

1. When a window is created in `src/main/window.ts`, the `setupConsoleLogger` function is called
2. It attaches a listener to the `console-message` event on the window's webContents
3. When the renderer process logs anything, the event fires with the message, level, source, and line number
4. The logger formats the message with window identifier and source info
5. The formatted message is passed to `logUI()` which outputs it to the main console if `--debug-ui` is enabled

## Architecture

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

## Implementation Details

### setupConsoleLogger

The primary implementation uses Electron's built-in `console-message` event:

```typescript
win.webContents.on("console-message", (event, level, message, line, sourceId) => {
  // Format and log the message
})
```

**Pros:**
- Simple and reliable
- No renderer-side code needed
- Captures all console output automatically
- Works immediately on window creation

**Cons:**
- Limited control over message formatting
- Cannot access original console.log arguments separately

### injectConsoleForwarder (Alternative)

An alternative implementation that injects JavaScript to intercept console methods:

```typescript
// Injects code into renderer to forward console calls via IPC
injectConsoleForwarder(win, windowId)
```

**Pros:**
- More detailed control over formatting
- Can capture console.log arguments separately
- Can add custom metadata

**Cons:**
- Requires IPC setup in preload
- More complex
- Timing issues (must wait for window to load)

Currently, we use `setupConsoleLogger` as it's simpler and more reliable. The `injectConsoleForwarder` is available for future enhancements if needed.

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

## Troubleshooting

### Logs not appearing

1. Make sure `--debug-ui` flag is enabled:
   ```bash
   pnpm dev dui
   ```

2. Check that the debug flag is recognized:
   ```
   [DEBUG] Enabled: UI (argv: debug-ui)
   ```

3. Verify the window is being created and the logger is attached

### Source file not showing

The source file and line number come from Electron's console-message event. If they're not showing:
- Check that source maps are enabled in development
- Verify the renderer is running in development mode

### Performance concerns

The console logger only runs when `--debug-ui` is enabled, so there's no performance impact in production or when debugging other subsystems.

## Related Files

- `src/main/console-logger.ts` - Main implementation
- `src/main/window.ts` - Integration point (calls setupConsoleLogger)
- `src/main/debug.ts` - Debug flag management and logUI function
- `src/renderer/src/lib/debug.ts` - Renderer-side debug helpers
- `DEBUGGING.md` - User-facing documentation

