# Web Debugging Mode - Enhanced Features

This document describes the enhanced Web Debugging Mode features for SpeakMCP, including auto-session creation and comprehensive logging capabilities.

## Overview

The Web Debugging Mode now provides a production-like debugging experience with:

- **Auto-Session Creation**: Automatically creates sessions when users send messages without manual setup
- **Enhanced Logging**: Comprehensive, structured logging that mirrors `npm run dev d` verbosity
- **Session Lifecycle Management**: Better session state indicators and management controls
- **Production MCP Stack**: Uses the same MCP infrastructure as the main application

## Quick Start

### Starting the Web Debug Server

```bash
# Basic start
npm run dev:web

# With verbose logging
npm run debug:web

# With custom configuration
WEB_DEBUG_LOG_LEVEL=debug WEB_DEBUG_AUTO_SESSION=true npm run dev:web
```

### Accessing the Interface

Navigate to `http://localhost:3001` in your browser to access the Web Debugging interface.

## Auto-Session Creation

### How It Works

When auto-session is enabled (default), users can immediately type and send messages without manually creating a session. The system will:

1. Detect when no active session exists
2. Automatically create a new session with a timestamp-based name
3. Link the session to the current debugger context
4. Process the message under the new session

### Configuration

```bash
# Enable/disable auto-session creation
WEB_DEBUG_AUTO_SESSION=true  # default: true

# Sessions are created with names like "Auto Session 14:30:25"
```

### Manual Session Management

- **Create Session**: Click "New" in the Debug Sessions panel
- **Reset Session**: Click "Reset Session" to end current session and prepare for auto-creation
- **Toggle Auto-Session**: Use the ON/OFF toggle in the sessions panel

## Enhanced Logging System

### Log Categories

The logging system organizes entries into categories:

- **agent**: Agent processing steps and decisions
- **mcp-client**: MCP server initialization and communication
- **transport**: Low-level transport operations
- **tool-call**: Tool execution start/finish with timing
- **oauth/auth**: Authentication and authorization events
- **network**: HTTP requests and WebSocket connections
- **ui**: User interface interactions and state changes
- **session**: Session creation, deletion, and management

### Log Levels

Available log levels (from most to least verbose):

- **trace**: Extremely detailed debugging information
- **debug**: Detailed debugging information
- **info**: General information (default)
- **warn**: Warning conditions
- **error**: Error conditions

### Environment Configuration

```bash
# Set default log level
WEB_DEBUG_LOG_LEVEL=debug  # trace|debug|info|warn|error

# Control logging outputs
WEB_DEBUG_CONSOLE_LOGGING=true   # Enable console output
WEB_DEBUG_UI_LOGGING=true        # Enable UI panel logging
WEB_DEBUG_MAX_LOG_ENTRIES=1000   # Maximum entries in memory
```

### Debug Logs Panel

The collapsible Debug Logs Panel provides:

- **Real-time log streaming** with auto-scroll
- **Runtime log level adjustment** (trace through error)
- **Category filtering** (show only specific categories)
- **Text search** within log messages
- **Copy/Download functionality** for sharing logs
- **Structured display** with correlation IDs and timing

### Log Entry Structure

Each log entry includes:

```typescript
{
  timestamp: number,           // Unix timestamp in milliseconds
  level: LogLevel,            // trace|debug|info|warn|error
  category: LogCategory,      // agent|mcp-client|transport|etc
  message: string,            // Human-readable message
  sessionId?: string,         // Associated session (last 8 chars shown)
  messageId?: string,         // Associated message (last 8 chars shown)
  toolCallId?: string,        // Associated tool call (last 8 chars shown)
  duration?: number,          // Operation duration in milliseconds
  data?: any,                 // Structured data (redacted for secrets)
  error?: Error              // Error object if applicable
}
```

### Secret Redaction

The logging system automatically redacts sensitive information:

- Bearer tokens: `Bearer abc123` → `Bearer ***REDACTED***`
- API keys: `api_key: secret` → `api_key: ***REDACTED***`
- Passwords: `password: mypass` → `password: ***REDACTED***`
- Custom secrets matching common patterns

## Session Lifecycle Management

### Session State Indicators

Sessions now display enhanced state information:

- **Status Badge**: Active/Completed/Error with color coding
- **Current Session Badge**: Highlights the active session
- **Message Count**: Number of messages in the session
- **Session ID**: Last 8 characters for identification
- **Creation Time**: When the session was created

### Session Controls

- **Reset Session**: Ends current session and prepares for auto-creation
- **Auto-Session Toggle**: Enable/disable automatic session creation
- **Session Selection**: Click any session to make it active

## Production MCP Stack Integration

### Real MCP Processing

The Web Debugging Mode now uses the same MCP infrastructure as the production application:

- **Actual MCP Servers**: Connects to real MCP servers configured in your setup
- **Production Tool Calls**: Executes real tools with actual results
- **Agent Processing**: Uses the same agent logic as the main application
- **Progress Tracking**: Shows real-time agent progress with the production UI component

### MCP Configuration

The system loads MCP configuration from the same sources as the main application:

- Environment variables
- Configuration files
- Default recommended servers

### Tool Execution Logging

Tool calls are logged with detailed information:

```
[14:30:25.123] [INFO ] [TOOL-CALL   ] Starting tool call: filesystem:read_file [session:abc12345] [tool:def67890]
[14:30:25.456] [DEBUG] [TOOL-CALL   ] Tool result received: filesystem:read_file [333ms] [tool:def67890]
```

## Configuration Reference

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `WEB_DEBUG_LOG_LEVEL` | Set log level (trace/debug/info/warn/error) | `info` |
| `WEB_DEBUG_AUTO_SESSION` | Enable auto-session creation (true/false) | `true` |
| `WEB_DEBUG_PORT` | Web debug server port | `3001` |
| `WEB_DEBUG_HOST` | Web debug server host | `localhost` |
| `WEB_DEBUG_CONSOLE_LOGGING` | Enable console logging (true/false) | `true` |
| `WEB_DEBUG_UI_LOGGING` | Enable UI logging (true/false) | `true` |
| `WEB_DEBUG_MAX_LOG_ENTRIES` | Maximum log entries in memory | `1000` |
| `WEB_DEBUG_MOCK_TOOLS` | Enable mock MCP tools (true/false) | `true` |
| `WEB_DEBUG_MOCK_DELAY` | Mock tool execution delay in ms | `1000` |

### Runtime Configuration

Many settings can be adjusted at runtime through the UI:

- Log level via dropdown in Debug Logs Panel
- Auto-session toggle in Sessions panel
- Log filtering and search in Debug Logs Panel

## Troubleshooting

### Common Issues

**Auto-session not working**
- Check that `WEB_DEBUG_AUTO_SESSION=true`
- Verify the toggle is "ON" in the sessions panel
- Look for error messages in the Debug Logs Panel

**Missing logs**
- Increase log level to `debug` or `trace`
- Check that `WEB_DEBUG_UI_LOGGING=true`
- Verify the Debug Logs Panel is expanded

**MCP tools not available**
- Check MCP server configuration
- Look for initialization errors in logs at `debug` level
- Verify MCP servers are running and accessible

### Debug Information

To gather debug information for bug reports:

1. Set `WEB_DEBUG_LOG_LEVEL=debug`
2. Reproduce the issue
3. Use "Download logs" in the Debug Logs Panel
4. Include the downloaded log file with your report

## Development

### Adding New Log Categories

To add a new log category:

1. Update `LogCategory` type in `src/web-debug/utils/logger.ts`
2. Add color mapping in `DebugLogsPanel.tsx`
3. Use the new category in your code: `logger.info('new-category', 'message')`

### Testing

Run the test suite:

```bash
# Run all web debug tests
npm test src/web-debug/__tests__/

# Run specific test files
npm test src/web-debug/__tests__/logger.test.ts
npm test src/web-debug/__tests__/auto-session.test.ts
```

### Building

The web debug interface is built separately:

```bash
# Build the web debug interface
npm run build:web-debug

# Start server without building (uses existing build)
npm run serve:web-debug
```

## Migration from Previous Version

If you were using the previous Web Debugging Mode:

1. **Sessions**: Existing manual session creation still works
2. **Auto-session**: New feature, enabled by default
3. **Logging**: Much more detailed, use filters to reduce noise
4. **Configuration**: New environment variables available

The interface remains backward compatible while adding new capabilities.
