# MCP Testing Infrastructure

This document describes the automated testing infrastructure for the Model Context Protocol (MCP) functionality in SpeakMCP.

## Overview

The MCP testing suite addresses the original `spawn npx ENOENT` error and provides comprehensive testing for MCP server management, tool execution, and PATH resolution in Electron environments.

## Test Files

### Core Tests

- **`src/main/__tests__/mcp-path-resolution.test.ts`** - Tests PATH resolution and environment setup
- **`src/main/__tests__/mcp-e2e.test.ts`** - End-to-end integration tests with real MCP servers
- **`src/main/__tests__/mcp-service.test.ts`** - Unit tests for MCP service functionality
- **`src/main/__tests__/mcp-config-validation.test.ts`** - Configuration validation tests

### Mock Infrastructure

- **`scripts/mock-mcp-server.mjs`** - Lightweight MCP server for testing
- **`scripts/test-mcp-path-fix.mjs`** - Standalone PATH resolution testing
- **`src/test/mocks/mock-mcp-server.ts`** - TypeScript mock server implementation

## Key Features Fixed

### 1. PATH Resolution (`spawn npx ENOENT`)

**Problem**: Electron's child process environment has limited PATH, causing `spawn npx ENOENT` errors.

**Solution**:
- `resolveCommandPath()` - Cross-platform command resolution
- `prepareEnvironment()` - Proper environment variable setup
- Automatic addition of Node.js paths (`/usr/local/bin`, `/opt/homebrew/bin`, etc.)

### 2. Cross-Platform Support

- Windows: Handles `.exe`, `.cmd`, `.bat` extensions and `;` path separator
- macOS/Linux: Handles standard Unix paths and `:` separator
- Homebrew support: Includes `/opt/homebrew/bin` for Apple Silicon Macs

### 3. Robust Error Handling

- Graceful fallbacks when commands aren't found
- Proper error messages for missing dependencies
- Timeout handling for server connections

## Running Tests

### All MCP Tests
```bash
npm test src/main/__tests__/mcp-path-resolution.test.ts
npm test src/main/__tests__/mcp-e2e.test.ts
```

### Individual Test Suites
```bash
# PATH resolution tests (12 tests)
npm test src/main/__tests__/mcp-path-resolution.test.ts

# End-to-end integration tests (6 tests)
npm test src/main/__tests__/mcp-e2e.test.ts

# Service unit tests
npm test src/main/__tests__/mcp-service.test.ts
```

### Manual Testing
```bash
# Test PATH resolution manually
node scripts/test-mcp-path-fix.mjs

# Run mock MCP server
node scripts/mock-mcp-server.mjs
```

## Test Results

```
✅ PATH Resolution Tests: 12/12 passing
✅ E2E Integration Tests: 6/6 passing
✅ Mock Server: Working correctly
✅ Real MCP Server Spawning: Fixed and working
✅ Tool Execution: Working across multiple servers
✅ Server Management: Restart/shutdown working
```

## Mock MCP Server

The mock server (`scripts/mock-mcp-server.mjs`) provides:

- **Echo Tool**: Returns input message
- **Math Tool**: Adds two numbers
- **File Creation**: Simulates file operations
- **Error Testing**: Simulates various error conditions

### Usage
```bash
# Start mock server
node scripts/mock-mcp-server.mjs

# Test with MCP client
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node scripts/mock-mcp-server.mjs
```

## Test Coverage

### PATH Resolution
- ✅ Absolute path handling
- ✅ Command resolution in PATH
- ✅ Missing command handling
- ✅ Environment variable preparation
- ✅ Cross-platform compatibility

### MCP Server Management
- ✅ Server initialization
- ✅ Server restart functionality
- ✅ Multiple server support
- ✅ Disabled server handling
- ✅ Connection testing

### Tool Execution
- ✅ Successful tool calls
- ✅ Error handling
- ✅ Multiple server tool execution
- ✅ Fallback tool support

### Integration Testing
- ✅ Real process spawning
- ✅ JSON-RPC communication
- ✅ Server lifecycle management
- ✅ Configuration loading

## Troubleshooting

### Common Issues

1. **Mock server not found**: Ensure `scripts/mock-mcp-server.mjs` exists and is executable
2. **PATH issues**: Check that Node.js is properly installed and in PATH
3. **Permission errors**: Ensure scripts have execute permissions (`chmod +x`)

### Debug Mode

Enable debug logging by setting environment variables:
```bash
DEBUG=mcp* npm test
```

## Contributing

When adding new MCP functionality:

1. Add unit tests to appropriate test files
2. Update mock server if new tools are needed
3. Add integration tests for end-to-end workflows
4. Ensure cross-platform compatibility
5. Update this documentation

## Architecture

```
MCP Testing Infrastructure
├── Unit Tests (mcp-service.test.ts)
├── PATH Resolution (mcp-path-resolution.test.ts)
├── Integration Tests (mcp-e2e.test.ts)
├── Mock Infrastructure
│   ├── Mock MCP Server (scripts/mock-mcp-server.mjs)
│   └── Test Utilities (scripts/test-mcp-path-fix.mjs)
└── Configuration Tests (mcp-config-validation.test.ts)
```

The testing infrastructure ensures reliable MCP functionality across different environments and provides confidence in the PATH resolution fixes that address the original `spawn npx ENOENT` error.
