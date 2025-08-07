# Keybind Debug System

## Overview

The keybind debug system provides comprehensive logging for keyboard event handling, shortcut detection, and keybind triggering. This helps diagnose issues with keyboard shortcuts, especially complex multi-key combinations like kill switches.

## Enabling Keybind Debug

### CLI Flags (Recommended)

```bash
# Keybind logs only
pnpm run dev -- --debug-keybinds

# Multiple debug types
pnpm run dev -- --debug-llm --debug-tools --debug-keybinds

# All debug logs
pnpm run dev -- --debug-all
```

### Environment Variables

```bash
# Enable keybind logs
DEBUG_KEYBINDS=1 pnpm run dev

# Enable all debug logs
DEBUG=all pnpm run dev

# Multiple types with comma separation
DEBUG=keybinds,llm,tools pnpm run dev
```

## What You'll See

When keybind debug is enabled, you'll see targeted logging for:

### 1. Configuration Changes

```
[DEBUG][KEYBINDS] Config change #1: { agentKillSwitchEnabled: true, agentKillSwitchHotkey: "ctrl-shift-escape", textInputEnabled: true, textInputShortcut: "ctrl-t", mcpToolsEnabled: true, mcpToolsShortcut: "ctrl-alt-slash", shortcut: "hold-ctrl" }
```

### 2. Modifier State Changes

```
[DEBUG][KEYBINDS] Ctrl key pressed, isPressedCtrlKey = true
[DEBUG][KEYBINDS] Shift key pressed, isPressedShiftKey = true
[DEBUG][KEYBINDS] Alt key pressed, isPressedAltKey = true isPressedCtrlAltKey = true
```

### 3. Potential Shortcut Matches (Only when modifiers are active)

```
[DEBUG][KEYBINDS] Escape key pressed with modifiers, checking kill switch conditions: { agentKillSwitchEnabled: true, agentKillSwitchHotkey: "ctrl-shift-escape", modifiers: { ctrl: true, shift: true, alt: false }, isAgentModeActive: true }
```

### 4. Triggered Actions

```
[DEBUG][KEYBINDS] Kill switch triggered: Ctrl+Shift+Escape
[DEBUG][KEYBINDS] MCP tools triggered: Ctrl+Alt+/
[DEBUG][KEYBINDS] Text input triggered: Ctrl+T
```

### 5. Custom Shortcut Matches (Only when they match)

```
[DEBUG][KEYBINDS] Kill switch triggered: Custom hotkey ctrl-alt-k
[DEBUG][KEYBINDS] Recording triggered: Custom hotkey ctrl-shift-r
```

## Issues Found and Fixed

### 1. Ctrl+Alt Key State Tracking Bug

**Problem**: The `isPressedCtrlAltKey` variable was incorrectly set to `isPressedCtrlKey && true` instead of `isPressedCtrlKey && isPressedAltKey`.

**Fix**: Corrected the logic to properly track when both Ctrl and Alt are pressed simultaneously.

**Before**:

```typescript
isPressedCtrlAltKey = isPressedCtrlKey && true // BUG!
```

**After**:

```typescript
isPressedCtrlAltKey = isPressedCtrlKey && isPressedAltKey
```

### 2. MCP Tools Shortcut Logic Error

**Problem**: The MCP tools shortcut for "ctrl-alt-slash" was checking `isPressedCtrlAltKey` instead of the individual modifier states.

**Fix**: Changed to check `isPressedCtrlKey && isPressedAltKey` directly.

**Before**:

```typescript
if (e.data.key === "Slash" && isPressedCtrlKey && isPressedCtrlAltKey)
```

**After**:

```typescript
if (e.data.key === "Slash" && isPressedCtrlKey && isPressedAltKey)
```

### 3. Lack of Debug Visibility

**Problem**: No way to see what was happening with keybind detection, making it impossible to debug issues.

**Fix**: Added comprehensive debug logging throughout the keyboard handling system.

## Debugging Common Issues

### Kill Switch Not Working

1. **Enable debug mode**: `pnpm run dev -- --debug-keybinds`
2. **Check modifier detection**: Look for "Ctrl key pressed", "Shift key pressed" messages
3. **Verify shortcut matching**: Look for "Checking kill switch hotkeys" messages
4. **Confirm trigger**: Look for "Kill switch triggered" messages

### MCP Tools Shortcut Not Working

1. **Check MCP tools enabled**: Look for `mcpToolsEnabled: true` in debug logs
2. **Verify shortcut config**: Check `mcpToolsShortcut` and `effectiveMcpToolsShortcut` values
3. **Monitor key detection**: Look for Ctrl+Alt+/ key sequence detection

### Custom Shortcuts Not Working

1. **Check effective shortcut**: Verify `effectiveXXXShortcut` values in debug logs
2. **Monitor matching logic**: Look for "Custom XXX check" messages with `matches: true/false`
3. **Verify key format**: Ensure custom shortcuts use correct format (e.g., "ctrl-alt-k")

## Architecture

### Debug Flag Integration

The keybind debug system follows the same pattern as existing LLM and tools debug:

- **Flag Definition**: Added `keybinds: boolean` to `DebugFlags` interface
- **Initialization**: Supports CLI flags (`--debug-keybinds`) and environment variables (`DEBUG_KEYBINDS=1`)
- **Check Function**: `isDebugKeybinds()` returns whether keybind debug is enabled
- **Log Function**: `logKeybinds()` outputs timestamped debug messages

### Event Flow

1. **Raw Event**: Rust binary sends JSON keyboard events via stdout
2. **Parsing**: `parseEvent()` converts JSON to `RdevEvent` objects
3. **State Tracking**: Modifier key states are tracked (`isPressedCtrlKey`, etc.)
4. **Shortcut Matching**: Each shortcut type is checked against current state
5. **Action Triggering**: Matching shortcuts trigger their associated actions

### Key Components

- **`src/main/keyboard.ts`**: Main keyboard event handling and shortcut detection
- **`src/shared/key-utils.ts`**: Utility functions for parsing and matching key combinations
- **`src/main/debug.ts`**: Debug flag management and logging functions
- **Rust Binary**: Low-level keyboard event capture (`speakmcp-rs`)

## Best Practices

1. **Always enable debug when troubleshooting**: Use `--debug-keybinds` to see what's happening
2. **Check modifier state consistency**: Ensure all required modifiers are properly detected
3. **Verify shortcut format**: Use correct format for custom shortcuts (e.g., "ctrl-shift-k")
4. **Test systematically**: Test each shortcut type individually to isolate issues
5. **Monitor process health**: Check for keyboard listener process errors in debug logs
