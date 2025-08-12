# Dynamic MCP Tool Management

This document describes the dynamic tool management system that allows AI agents to discover, control, and manage MCP (Model Context Protocol) tools during runtime.

## Overview

The dynamic tool management system provides:

1. **Tool Discovery**: Agents can discover what MCP tools are available and their current status
2. **Runtime Control**: Agents can enable/disable specific tools during execution
3. **Permission Management**: Fine-grained control over what operations agents can perform
4. **Usage Tracking**: Comprehensive statistics and audit logging
5. **Security Controls**: Validation, approval workflows, and rollback capabilities

## Architecture

### Core Components

- **DynamicToolManager**: Core service managing tool states, permissions, and operations
- **Tool Manager MCP Tools**: Built-in MCP tools that expose management capabilities to agents
- **IPC Layer**: Communication between main and renderer processes
- **Configuration System**: Persistent storage of tool states and settings

### Data Structures

```typescript
interface DynamicToolState {
  toolName: string
  serverName: string
  enabled: boolean
  dynamicallyControlled: boolean
  lastModified: number
  modifiedBy: 'user' | 'agent' | 'system'
  permissions: ToolPermissions
  usageStats: ToolUsageStats
  temporaryDisableUntil?: number
  disableReason?: string
}

interface ToolPermissions {
  canBeDisabledByAgent: boolean
  canBeEnabledByAgent: boolean
  requiresApproval: boolean
  maxDisableDuration?: number
  allowedOperations: ('enable' | 'disable' | 'query')[]
}
```

## Agent-Accessible Tools

The system provides the following MCP tools that agents can use:

### `tool_manager:list_tools`

Lists all available MCP tools and their current status.

**Parameters:**
- `includeDisabled` (boolean, optional): Whether to include disabled tools (default: true)
- `serverFilter` (string, optional): Filter tools by server name

**Example:**
```json
{
  "name": "tool_manager:list_tools",
  "arguments": {
    "includeDisabled": true,
    "serverFilter": "filesystem"
  }
}
```

**Response:**
```json
{
  "totalTools": 15,
  "enabledTools": 12,
  "disabledTools": 3,
  "tools": [
    {
      "name": "filesystem:read_file",
      "description": "Read contents of a file",
      "serverName": "filesystem",
      "enabled": true,
      "dynamicallyControlled": false,
      "permissions": {
        "canBeDisabledByAgent": true,
        "canBeEnabledByAgent": true,
        "requiresApproval": false,
        "maxDisableDuration": 1800000,
        "allowedOperations": ["enable", "disable", "query"]
      },
      "usageStats": {
        "totalCalls": 45,
        "successfulCalls": 43,
        "failedCalls": 2,
        "lastUsed": 1692123456789,
        "averageExecutionTime": 150
      }
    }
  ]
}
```

### `tool_manager:get_tool_status`

Get detailed status information for a specific tool.

**Parameters:**
- `toolName` (string, required): Full name of the tool including server prefix

**Example:**
```json
{
  "name": "tool_manager:get_tool_status",
  "arguments": {
    "toolName": "filesystem:read_file"
  }
}
```

### `tool_manager:enable_tool`

Enable a specific MCP tool.

**Parameters:**
- `toolName` (string, required): Full name of the tool to enable
- `reason` (string, optional): Reason for enabling the tool

**Example:**
```json
{
  "name": "tool_manager:enable_tool",
  "arguments": {
    "toolName": "filesystem:read_file",
    "reason": "Need to read configuration files"
  }
}
```

### `tool_manager:disable_tool`

Disable a specific MCP tool.

**Parameters:**
- `toolName` (string, required): Full name of the tool to disable
- `reason` (string, optional): Reason for disabling the tool
- `duration` (number, optional): Duration in milliseconds for temporary disable

**Example:**
```json
{
  "name": "tool_manager:disable_tool",
  "arguments": {
    "toolName": "filesystem:write_file",
    "reason": "Preventing accidental file modifications",
    "duration": 300000
  }
}
```

### `tool_manager:get_tool_permissions`

Check what operations are allowed for a specific tool.

**Parameters:**
- `toolName` (string, required): Full name of the tool

### `tool_manager:get_tool_usage_stats`

Get usage statistics for a specific tool.

**Parameters:**
- `toolName` (string, required): Full name of the tool

## Security Model

### Permission Levels

1. **System Tools**: Cannot be disabled by agents (e.g., tool_manager tools)
2. **User Tools**: Can be controlled with user permission
3. **Agent Tools**: Full agent control allowed
4. **Restricted Tools**: Require explicit approval for changes

### Security Controls

- **Whitelist/Blacklist**: Control which tools can be managed by agents
- **Time-based Restrictions**: Temporary disables with automatic re-enable
- **Audit Logging**: Complete log of all tool state changes
- **Approval Workflows**: User approval required for sensitive operations
- **Rollback Capabilities**: Ability to revert unauthorized changes

### Configuration

```typescript
interface DynamicToolManagerConfig {
  enableAgentToolControl: boolean
  defaultToolPermissions: ToolPermissions
  auditLogging: boolean
  maxTemporaryDisableDuration: number
  allowedAgentOperations: ('enable' | 'disable' | 'query')[]
}
```

## Usage Examples

### Agent Discovering Available Tools

```typescript
// Agent discovers what tools are available
const toolsResponse = await executeToolCall({
  name: "tool_manager:list_tools",
  arguments: { includeDisabled: false }
})

const availableTools = JSON.parse(toolsResponse.content[0].text)
console.log(`Found ${availableTools.totalTools} tools`)
```

### Agent Temporarily Disabling a Tool

```typescript
// Agent disables a tool for 5 minutes
const disableResponse = await executeToolCall({
  name: "tool_manager:disable_tool",
  arguments: {
    toolName: "web:fetch_url",
    reason: "Avoiding external network calls during sensitive operation",
    duration: 5 * 60 * 1000 // 5 minutes
  }
})

if (disableResponse.success) {
  console.log("Tool disabled successfully")
}
```

### Agent Checking Tool Permissions

```typescript
// Agent checks if it can disable a tool
const permissionsResponse = await executeToolCall({
  name: "tool_manager:get_tool_permissions",
  arguments: {
    toolName: "filesystem:delete_file"
  }
})

const permissions = JSON.parse(permissionsResponse.content[0].text)
if (permissions.permissions.canBeDisabledByAgent) {
  console.log("Agent can disable this tool")
}
```

## Best Practices

### For Agent Developers

1. **Check Permissions First**: Always check tool permissions before attempting control operations
2. **Provide Clear Reasons**: Include descriptive reasons when disabling tools
3. **Use Temporary Disables**: Prefer temporary disables over permanent ones
4. **Handle Failures Gracefully**: Tool control operations may fail due to permissions

### For System Administrators

1. **Configure Default Permissions**: Set appropriate default permissions for different tool types
2. **Enable Audit Logging**: Keep audit logging enabled for security monitoring
3. **Review Tool Usage**: Regularly review tool usage statistics and audit logs
4. **Set Reasonable Limits**: Configure appropriate maximum disable durations

## Integration with Existing Systems

The dynamic tool management system integrates seamlessly with:

- **Existing MCP Tools**: All existing tools automatically get management capabilities
- **Configuration System**: Tool states are persisted across application restarts
- **UI Components**: Management interface shows dynamic state changes
- **Agent Mode**: Full integration with agent execution workflows

## Troubleshooting

### Common Issues

1. **Tool Not Found**: Ensure the tool name includes the server prefix (e.g., "server:tool")
2. **Permission Denied**: Check tool permissions and configuration settings
3. **Temporary Disable Not Working**: Verify duration is within allowed limits
4. **State Not Persisting**: Check configuration file permissions and storage

### Debug Information

Enable debug logging to see detailed tool management operations:

```typescript
// In debug mode, tool management operations are logged
const config = {
  debugTools: true
}
```

## API Reference

See the TypeScript interfaces in `src/shared/types.ts` for complete API documentation:

- `DynamicToolState`
- `ToolPermissions`
- `ToolUsageStats`
- `ToolControlRequest`
- `ToolControlResponse`
- `DynamicToolManagerConfig`
