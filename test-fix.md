# Test Plan for MCP Server Removal UI Sync Fix

## Issue Description
When an MCP server is turned off or deleted, it is not being removed from the tool management section as expected. This creates inconsistency between the actual server state and the UI representation.

## Changes Made

### 1. MCP Service Changes (`src/main/mcp-service.ts`)
- Added `syncWithConfig()` method that:
  - Compares currently tracked servers with configured servers
  - Cleans up servers no longer in configuration
  - Removes orphaned tools from deleted servers
  - Cleans up runtime disabled state for deleted servers

### 2. TIPC Endpoint (`src/main/tipc.ts`)
- Added `syncMcpWithConfig` endpoint to expose sync functionality to renderer

### 3. MCP Config Manager (`src/renderer/src/components/mcp-config-manager.tsx`)
- Updated `handleDeleteServer` to call sync after server deletion
- Made function async to handle the sync call

### 4. Tool Manager (`src/renderer/src/components/mcp-tool-manager.tsx`)
- Added server status fetching alongside tool list fetching
- Filter tools to only show those from available servers
- Available servers are those that are:
  - Not config-disabled AND
  - Runtime-enabled (not turned off by user)

## Test Scenarios

### Scenario 1: Server Deletion
1. Configure an MCP server and verify it appears in tool management
2. Delete the server from configuration
3. Verify the server and its tools disappear from tool management immediately

### Scenario 2: Server Runtime Disable (Turn Off)
1. Configure an MCP server and verify it appears in tool management
2. Turn off the server (runtime disable)
3. Verify the server and its tools disappear from tool management

### Scenario 3: Server Re-enable
1. Turn off a server (should disappear from tool management)
2. Turn the server back on
3. Verify the server and its tools reappear in tool management

### Scenario 4: Config Disable
1. Configure a server and verify it appears in tool management
2. Mark the server as disabled in configuration
3. Verify the server and its tools disappear from tool management

## Expected Behavior
- Tool management section should only show tools from servers that are:
  - Present in the configuration
  - Not marked as disabled in configuration
  - Not runtime-disabled by the user
- When servers are deleted or disabled, their tools should immediately disappear
- When servers are re-enabled, their tools should reappear

## Implementation Notes
- The sync happens automatically when servers are deleted
- Tool filtering happens on every refresh (every 5 seconds)
- Server status is fetched alongside tool list for efficient filtering
- No breaking changes to existing functionality
