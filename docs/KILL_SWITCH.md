# Agent Mode Kill Switch

## Overview

The Agent Mode Kill Switch is a safety feature that provides an emergency stop mechanism for the SpeakMCP agent mode. When triggered, it immediately stops the agent and gracefully terminates all agent-created processes.

## Features

- **Global Hotkey**: Configurable keyboard shortcut that works system-wide
- **Process Tracking**: Automatically tracks all processes spawned during agent mode
- **Graceful Termination**: Attempts graceful shutdown before force-killing processes
- **Emergency Stop**: Immediate termination when needed
- **State Management**: Properly cleans up agent state and iteration counters

## Configuration

### Default Settings

- **Enabled**: `true` (enabled by default for safety)
- **Hotkey**: `Ctrl + Shift + Escape` (emergency stop pattern)

### Available Hotkeys

1. **Ctrl + Shift + Escape** (Recommended) - Standard emergency stop pattern
2. **Ctrl + Alt + Q** - Alternative for users who prefer Q for "quit"
3. **Ctrl + Shift + Q** - Another quit-based alternative

### Settings Location

Configure the kill switch in **Settings → Tools → Agent Mode → Emergency Kill Switch**

## How It Works

### Process Tracking

The system automatically tracks processes created during agent mode:

- **MCP Server Processes**: All spawned MCP tool server processes
- **Keyboard/Text Injection**: Processes for text writing and focus management
- **Tool Execution**: Any child processes spawned by tools

### Kill Switch Activation

When the kill switch hotkey is pressed:

1. **Immediate Stop Signal**: Sets `shouldStopAgent` flag to stop current iterations
2. **Process Termination**: 
   - First attempts graceful shutdown (SIGTERM)
   - After 3-second timeout, force kills (SIGKILL)
3. **State Cleanup**: Resets agent mode state and counters
4. **UI Update**: Closes agent panel and shows stop message

### Integration Points

The kill switch is integrated at multiple levels:

- **Keyboard Handler**: Global hotkey detection in `src/main/keyboard.ts`
- **Agent Loop**: Stop signal checks in `src/main/llm.ts`
- **Process Manager**: Process tracking in `src/main/state.ts`
- **MCP Service**: Server process management in `src/main/mcp-service.ts`
- **UI**: Emergency stop button and status in renderer

## Usage

### During Agent Mode

1. Start agent mode normally (voice input or text input with tools)
2. If you need to stop the agent immediately, press the configured hotkey
3. The agent will stop and all processes will be terminated
4. The panel will show a "stopped by kill switch" message

### Emergency Situations

The kill switch is designed for situations where:

- Agent is stuck in an infinite loop
- Agent is consuming too many resources
- Agent is performing unintended actions
- You need to immediately stop all agent activity

## Technical Implementation

### Files Modified

- `src/main/state.ts` - Process tracking and management
- `src/main/keyboard.ts` - Global hotkey handling
- `src/main/llm.ts` - Stop signal checks in agent loop
- `src/main/mcp-service.ts` - MCP server process tracking
- `src/main/tipc.ts` - IPC endpoints for kill switch
- `src/main/window.ts` - Emergency stop function
- `src/shared/types.ts` - Configuration types
- `src/main/config.ts` - Default configuration
- `src/renderer/src/pages/settings-tools.tsx` - UI configuration

### Key Components

1. **Agent Process Manager** (`state.ts`)
   - Tracks all agent-spawned processes
   - Provides graceful and emergency termination
   - Manages process lifecycle

2. **Kill Switch Handler** (`keyboard.ts`)
   - Detects global hotkey combinations
   - Triggers emergency stop sequence
   - Supports multiple hotkey options

3. **Agent Loop Integration** (`llm.ts`)
   - Checks stop signals between iterations
   - Checks stop signals before tool execution
   - Provides clean exit with status messages

## Safety Considerations

- **Default Enabled**: The kill switch is enabled by default for safety
- **Multiple Hotkeys**: Different options to avoid conflicts
- **Graceful First**: Always attempts graceful shutdown before force-kill
- **State Cleanup**: Ensures proper cleanup of all agent state
- **Process Isolation**: Only kills agent-related processes

## Troubleshooting

### Kill Switch Not Working

1. Check if the feature is enabled in Settings → Tools
2. Verify the hotkey isn't conflicting with other applications
3. Try a different hotkey combination
4. Restart the application if hotkey detection fails

### Processes Not Terminating

1. The system tries graceful shutdown first (3-second timeout)
2. If processes don't respond, they are force-killed
3. Check system process monitor to verify termination
4. Some system processes may require manual cleanup

### Configuration Issues

1. Settings are stored in the application config file
2. Reset to defaults by toggling the kill switch off/on
3. Check console logs for any configuration errors

## Future Enhancements

- **Process Tree Tracking**: Track entire process trees, not just direct children
- **Resource Monitoring**: Monitor CPU/memory usage and auto-trigger kill switch
- **Custom Hotkeys**: Allow users to define custom key combinations
- **Kill Switch History**: Log when and why the kill switch was activated
- **Selective Termination**: Option to kill only specific types of processes
