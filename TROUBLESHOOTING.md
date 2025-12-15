# SpeakMCP Troubleshooting Guide

## macOS Permissions Issues

### Hotkeys Not Working After Installing a New/Signed Build

When you install a signed build or update SpeakMCP, macOS treats it as a new application because the code signature has changed. This means:
- Previous accessibility permissions don't apply to the new binary
- The app silently fails to register keyboard listeners

**To fix:**

1. Go to **System Settings → Privacy & Security → Accessibility**
2. Look for **SpeakMCP** in the list
3. If it exists but isn't working:
   - **Remove it** (click the minus button)
   - **Re-add it** (click the plus button and select the new SpeakMCP app)
4. Also check **System Settings → Privacy & Security → Input Monitoring** and do the same
5. **Restart SpeakMCP** completely (quit from the menu bar tray icon)

> **Note**: The app uses a helper binary (`speakmcp-rs`) to capture global keyboard events. Both the main app and this helper need accessibility permissions.

### Hotkeys Stopped Working Suddenly

If hotkeys were working but suddenly stopped:

1. Check if accessibility permissions were revoked (System Settings → Privacy & Security → Accessibility)
2. Restart SpeakMCP from the menu bar tray icon
3. If still not working, try logging out and back into macOS

### Microphone Not Working

1. Go to **System Settings → Privacy & Security → Microphone**
2. Ensure **SpeakMCP** is listed and enabled
3. Restart the app after granting permission

### Verifying Permissions Are Granted

To check if the app has the required permissions:

1. Open SpeakMCP
2. Go to Settings (or use the settings hotkey `Ctrl+Shift+S`)
3. Check the permission status indicators
4. If any show as not granted, click to request access

## Debug Mode

If you're experiencing issues, enable debug logging to get more information:

1. Quit SpeakMCP
2. Open Terminal and run:
   ```bash
   # Enable all debug logging
   /Applications/SpeakMCP.app/Contents/MacOS/SpeakMCP --debug
   
   # Or enable specific debug modes
   /Applications/SpeakMCP.app/Contents/MacOS/SpeakMCP --debug-keybinds  # Keyboard issues
   /Applications/SpeakMCP.app/Contents/MacOS/SpeakMCP --debug-app       # App lifecycle
   ```
3. Reproduce the issue and check the terminal output

See [DEBUGGING.md](apps/desktop/DEBUGGING.md) for more detailed debugging instructions.

## Common Issues

### App Not Appearing in Menu Bar

1. Check if another instance is already running (Activity Monitor → search "SpeakMCP")
2. Kill any existing instances and restart the app
3. Make sure the app is in your Applications folder

### Recording Doesn't Start

1. Verify microphone permissions are granted
2. Check that accessibility permissions are granted (required for hotkeys)
3. Try using the click-to-record button in the panel instead of hotkeys
4. Check if another app is using the microphone exclusively

### Text Not Being Inserted

1. Verify accessibility permissions are granted
2. Make sure the target application accepts keyboard input
3. Some applications (like Terminal with secure input) may block text insertion
4. Try copying to clipboard instead (check settings)

## Getting Help

If you're still experiencing issues:

1. **Check existing issues**: [GitHub Issues](https://github.com/aj47/SpeakMCP/issues)
2. **Join our Discord**: [Discord Server](https://discord.gg/cK9WeQ7jPq)
3. **Open a new issue**: Include debug logs and steps to reproduce

