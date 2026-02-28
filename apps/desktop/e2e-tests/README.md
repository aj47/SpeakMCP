# SpeakMCP Desktop E2E Test Suite

End-to-end tests for the SpeakMCP Electron desktop application using the **electron-native MCP** approach via Chrome DevTools Protocol (CDP).

## Overview

This test suite leverages the `electron-native` MCP server to execute JavaScript directly in Electron's renderer process, providing:

- Direct DOM manipulation and UI testing
- IPC procedure testing via `window.electron.ipcRenderer.invoke()`
- Real-time state inspection
- No external test runner dependencies (Playwright, Cypress, etc.)

## Test Categories

| Category | Tests | Description |
|----------|-------|-------------|
| Core Infrastructure | 20 | App lifecycle, config, window management |
| Navigation & Routing | 18 | Page navigation, route handling |
| IPC Communication | 30 | TIPC procedures between renderer/main |
| Agent Sessions | 28 | Session lifecycle, multi-session support |
| MCP Tools | 32 | Tool discovery, execution, configuration |
| UI Components | 35 | Forms, buttons, dialogs, accessibility |

**Total: ~163 test cases**

## Prerequisites

1. **SpeakMCP Desktop App** - The Electron app must be running with CDP enabled
2. **electron-native MCP Server** - Configured in your MCP settings

## Quick Start

### 1. Start the App with CDP Enabled

```bash
cd apps/desktop
REMOTE_DEBUGGING_PORT=9222 pnpm dev -- -d
```

The `-d` flag enables all debug flags. `REMOTE_DEBUGGING_PORT=9222` enables Chrome DevTools Protocol.

### 2. Run Tests via MCP

Using Claude Code or any MCP client, execute tests via the `electron_execute` tool:

```javascript
// Run a single quick test
const result = await electron_execute({
  code: `
    const config = await window.electron.ipcRenderer.invoke('getConfig');
    return { hasConfig: !!config, keys: Object.keys(config) };
  `
});
```

### 3. Run Full Test Suite

Use the test runner to generate executable code for complete suites:

```javascript
// Example: Run all Core Infrastructure tests
const code = generateSuiteRunner('appLifecycle');
const results = await electron_execute({ code });
```

## Test Structure

```
e2e-tests/
├── core/
│   └── app-lifecycle.tests.ts     # App startup, config, window
├── navigation/
│   └── routing.tests.ts           # Route handling, navigation
├── ipc/
│   └── tipc-procedures.tests.ts   # All IPC procedures
├── sessions/
│   └── agent-sessions.tests.ts    # Session management
├── mcp/
│   └── mcp-tools.tests.ts         # MCP tool testing
├── ui/
│   └── ui-components.tests.ts     # UI component testing
├── utils/
│   └── test-framework.ts          # Test utilities
├── index.ts                       # Main export
├── run-tests.ts                   # Test runner generation
└── README.md
```

## Writing Tests

Tests are defined as objects with `name`, `description`, and `code` properties:

```typescript
{
  name: "getConfig returns valid configuration",
  description: "Verify app config is accessible",
  code: `
    const config = await helpers.ipc('getConfig');
    assert.isObject(config, 'Config should be object');
    return Object.keys(config);
  `
}
```

### Available Assertions

```javascript
assert.equal(actual, expected, message)
assert.deepEqual(actual, expected, message)
assert.truthy(value, message)
assert.falsy(value, message)
assert.hasProperty(obj, prop, message)
assert.isArray(value, message)
assert.isObject(value, message)
assert.isString(value, message)
assert.isNumber(value, message)
assert.isBoolean(value, message)
assert.isFunction(value, message)
assert.exists(value, message)
```

### Available Helpers

```javascript
// Wait for condition
await helpers.waitFor(() => someCondition, timeout);

// Wait for element
await helpers.waitForElement('#my-element');

// DOM interaction
helpers.click('#button');
helpers.type('#input', 'value');
helpers.getText('#element');
helpers.getAll('.items');
helpers.isVisible('#element');

// Navigation
await helpers.navigate('/settings/general');
helpers.getRoute();

// IPC calls
await helpers.ipc('getConfig');
await helpers.ipc('getMcpServerStatus');

// State persistence (across tests)
helpers.setState('key', value);
helpers.getState('key');
```

## Running Individual Tests

### Via MCP Tool Call

```javascript
// Execute directly in renderer
const result = await mcp__electron-native__electron_execute({
  code: `
    const assert = { /* assertions */ };
    const helpers = { /* helpers */ };

    const config = await helpers.ipc('getConfig');
    assert.isObject(config);
    return config;
  `
});
```

### Quick Test Function

Import and use `generateQuickTest` for ad-hoc testing:

```typescript
import { generateQuickTest } from './run-tests';

const code = generateQuickTest(`
  const sessions = await helpers.ipc('getAgentSessions');
  return sessions.length;
`);
// Execute via electron_execute
```

## Test Results

Test results include:

```typescript
interface TestResult {
  name: string;
  category: string;
  passed: boolean;
  error?: string;
  duration: number;
  timestamp: string;
  result?: any;
}
```

Suite results include summary:

```typescript
{
  suite: "Application Lifecycle",
  category: "Core Infrastructure",
  results: [...],
  summary: {
    total: 20,
    passed: 18,
    failed: 2
  }
}
```

## IPC Procedures Tested

The test suite covers all major TIPC procedures:

### Configuration
- `getConfig` - App configuration
- `getDebugFlags` - Debug flag state
- `getDefaultSystemPrompt` - Default AI prompt

### Profiles
- `getProfiles` - List all profiles
- `getProfile` - Get specific profile
- `getCurrentProfile` - Active profile

### Agent Sessions
- `getAgentSessions` - List sessions
- `getAgentStatus` - Current agent status
- `focusAgentSession` - Focus session
- `snoozeAgentSession` / `unsnoozeAgentSession`
- `stopAgentSession` / `emergencyStopAgent`
- `clearAgentProgress` / `clearAgentSessionProgress`
- `respondToToolApproval`

### MCP
- `getMcpServerStatus` - Server statuses
- `getMcpInitializationStatus` - Init state
- `getMcpDetailedToolList` - All tools
- `validateMcpConfig` - Config validation
- `loadMcpConfigFile` - Load config
- `getMcpServerLogs` - Server logs
- `setMcpToolEnabled` - Enable/disable tools
- `restartMcpServer` / `stopMcpServer`
- `fetchMcpRegistryServers` - Browse registry
- `resolveElicitation` / `resolveSampling` - Protocol 2025-11-25

### Conversations
- `getConversationHistory`
- `getRecordingHistory`
- `getMessageQueue` / `getAllMessageQueues`

### Window Management
- `getPanelPosition` / `getPanelSize`
- `getMicrophoneStatus`

### Diagnostics
- `getDiagnosticReport`
- `performHealthCheck`
- `getRecentErrors`

### System
- `getUpdateInfo`
- `checkCloudflaredInstalled`
- `getCloudflareTunnelStatus`
- `fetchAvailableModels`

## Routes Tested

All application routes are tested:

| Route | Purpose |
|-------|---------|
| `/` | Sessions grid/kanban view |
| `/:id` | Specific session focused |
| `/history` | Past sessions view |
| `/history/:id` | Continue past conversation |
| `/settings/general` | General settings |
| `/settings/providers` | Provider settings |
| `/settings/models` | Model settings |
| `/settings/tools` | Built-in tools |
| `/settings/mcp-tools` | MCP server config |
| `/settings/remote-server` | Remote API |
| `/setup` | Permissions page |
| `/onboarding` | First-run wizard |

## Debugging Tips

1. **App won't connect**: Ensure `REMOTE_DEBUGGING_PORT=9222` is set
2. **Tests timeout**: Increase wait times or check if app is responsive
3. **IPC fails**: Check if procedure name is correct (case-sensitive)
4. **DOM not found**: Add wait time after navigation

## Extending Tests

To add new tests:

1. Create a new test file in the appropriate category folder
2. Define tests following the `TestCase` interface
3. Export as a `TestSuite`
4. Import and add to `testSuites` in `index.ts`

Example:

```typescript
// e2e-tests/my-feature/my-tests.ts
import { TestSuite } from '../utils/test-framework';

export const myTestSuite: TestSuite = {
  name: 'My Feature',
  category: 'Custom',
  tests: [
    {
      name: 'My first test',
      description: 'Tests something important',
      code: `
        const result = await helpers.ipc('someMethod');
        assert.truthy(result);
        return result;
      `
    }
  ]
};
```

## CI/CD Integration

These tests can be automated by:

1. Starting the app with CDP in a headless environment
2. Using a script to connect and run tests
3. Parsing JSON results for pass/fail status

```bash
# Example CI script
REMOTE_DEBUGGING_PORT=9222 pnpm dev -- -d &
sleep 5
node run-e2e-tests.js
```

## Related Documentation

- `DEBUGGING.md` - CDP debugging guide
- `electron.vite.config.ts` - Electron build config
- `src/main/tipc.ts` - IPC procedure definitions
- `src/renderer/src/router.tsx` - Route definitions
