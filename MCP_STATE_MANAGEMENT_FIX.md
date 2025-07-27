# MCP Server State Management Fix

## Problem Summary

The MCP server state management system had a critical bug where user-disabled servers were being automatically re-enabled when agent mode was triggered. This violated user preferences and caused unwanted server activations.

## Root Cause

The issue was in the `processWithAgentMode` function in `src/main/tipc.ts` (lines 33-34), which **always** called `mcpService.initialize()` without considering:

1. **User runtime preferences** - When users manually disabled servers through the UI
2. **Current initialization state** - Whether servers were already properly initialized
3. **State persistence** - Runtime disabled state was not preserved across agent mode triggers

## Solution Implementation

### 1. Enhanced State Tracking (`src/main/mcp-service.ts`)

Added three new private properties to track server states:

```typescript
// Track runtime server states - separate from config disabled flag
private runtimeDisabledServers: Set<string> = new Set()
private initializedServers: Set<string> = new Set()
private hasBeenInitialized = false
```

### 2. Smart Initialization Logic

Modified `initialize()` method to implement proper state management:

- **First initialization**: Initialize all non-config-disabled servers
- **Subsequent calls**: Only initialize servers that are:
  - Not disabled in config AND
  - Not runtime-disabled by user AND
  - Not already initialized

### 3. Runtime State Management Methods

Added new methods for managing server runtime state:

- `setServerRuntimeEnabled(serverName, enabled)` - Set user preference
- `isServerRuntimeEnabled(serverName)` - Check runtime state
- `isServerAvailable(serverName)` - Check overall availability (config + runtime)

### 4. Enhanced Server Status

Updated `getServerStatus()` to include runtime state information:

```typescript
{
  connected: boolean,
  toolCount: number,
  runtimeEnabled: boolean,    // NEW: User runtime preference
  configDisabled: boolean     // NEW: Config-level disabled state
}
```

### 5. New TIPC Endpoints

Added endpoints for UI to manage server runtime state:

- `setMcpServerRuntimeEnabled` - Allow UI to enable/disable servers
- `getMcpServerRuntimeState` - Get current runtime state

### 6. App Startup Initialization

Added automatic MCP service initialization on app startup in `src/main/index.ts`:

```typescript
// Initialize MCP service on app startup
mcpService.initialize().catch((error) => {
  console.error("Failed to initialize MCP service on startup:", error)
})
```

## Behavior Changes

### Before Fix
- ❌ Agent mode always re-enabled all non-config-disabled servers
- ❌ User preferences were ignored during agent mode
- ❌ No distinction between config and runtime disabled states

### After Fix
- ✅ **User-disabled servers stay disabled** during agent mode
- ✅ **Config-disabled servers are never enabled**
- ✅ **Runtime state persists** across initialization calls
- ✅ **Auto-initialization on app startup**
- ✅ **Uninitialized servers can be auto-enabled** when needed

## Testing

### Manual Testing Steps

1. **Start the application** - MCP servers should auto-initialize
2. **Disable a server** through the UI
3. **Trigger agent mode** - Disabled server should remain disabled
4. **Re-enable the server** - Should work normally
5. **Restart app** - Server states should be preserved

### Automated Testing

Updated test suite in `src/main/__tests__/mcp-service.test.ts` with:

- Runtime state management tests
- Initialization behavior verification
- State persistence validation

## Files Modified

1. **`src/main/mcp-service.ts`** - Core state management logic
2. **`src/main/tipc.ts`** - Agent mode processing and new endpoints
3. **`src/main/index.ts`** - App startup initialization
4. **`tsconfig.node.json`** - Excluded test files from compilation
5. **`src/main/__tests__/mcp-service.test.ts`** - Updated tests

## Backward Compatibility

- ✅ Existing MCP server configurations work unchanged
- ✅ No breaking changes to existing APIs
- ✅ New features are additive only

## Future Enhancements

1. **Persistent state storage** - Save runtime preferences to disk
2. **UI indicators** - Show runtime vs config disabled states
3. **Bulk operations** - Enable/disable multiple servers at once
4. **Server groups** - Manage related servers together

## Verification

The fix ensures that:

1. **User preferences are respected** - Manually disabled servers stay disabled
2. **Agent mode works correctly** - Only initializes appropriate servers
3. **State is consistent** - Runtime and config states are properly tracked
4. **Performance is maintained** - No unnecessary re-initializations
