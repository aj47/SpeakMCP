# Zoom Functionality Test Guide

## Changes Made

1. **Removed duplicate zoom handlers** - The panel window had two identical zoom event handlers which could cause conflicts
2. **Added debug logging** - Zoom events now log to console when debug mode is enabled
3. **Fixed global keyboard interference** - Added exceptions in the global keyboard listener to allow zoom shortcuts to pass through
4. **Enhanced key detection** - Added support for various key representations (Equal, Plus, Minus, etc.)

## Testing Instructions

### 1. Enable Debug Mode
Run the app with debug flags to see zoom event logging:
```bash
npm run dev -- --debug-keybinds
```
or
```bash
DEBUG=keybinds npm run dev
```

### 2. Test Zoom Shortcuts
Try these keyboard combinations in different windows:

**Main Window:**
- `Cmd+` or `Ctrl+=` (zoom in)
- `Cmd-` or `Ctrl+-` (zoom out) 
- `Cmd+0` or `Ctrl+0` (reset zoom)

**Panel Window:**
- Same shortcuts as above

### 3. Check Debug Output
When debug mode is enabled, you should see console output like:
```
[DEBUG][KEYBINDS] Zoom event received: { key: '=', meta: true, control: false, shift: false, windowId: 1 }
[DEBUG][KEYBINDS] Executing zoom in (=)
```

### 4. Verify Global Keyboard Handler
The global keyboard handler should now log when it allows zoom shortcuts to pass through:
```
[DEBUG][KEYBINDS] Allowing zoom shortcut to pass through: Equal
```

## Troubleshooting

If zoom still doesn't work:

1. **Check window focus** - Make sure the window you're trying to zoom has focus
2. **Check accessibility permissions** - Ensure the app has accessibility permissions on macOS
3. **Try different key combinations** - Some keyboards may send different key codes
4. **Check for other apps intercepting shortcuts** - Other apps might be capturing these shortcuts

## Key Code Variations Handled

The fix now handles these key representations:
- `Equal`, `=` (for zoom in)
- `Plus`, `+` (for zoom in with Shift)
- `Minus`, `-` (for zoom out)
- `Digit0`, `0` (for zoom reset)
- `NumpadAdd`, `NumpadSubtract` (numpad keys)

## Next Steps

If this fixes the issue:
1. Remove debug logging from production code
2. Test on different operating systems
3. Consider adding zoom level persistence
4. Add zoom shortcuts to the application menu for discoverability
