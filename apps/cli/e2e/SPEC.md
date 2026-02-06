# CLI E2E Testing Specification

## Overview

This document specifies the end-to-end (E2E) testing framework for `@speakmcp/cli`. The goal is to create automated tests that verify feature parity between the CLI and the Electron desktop app by simulating real user interactions.

## Goals

1. **Full-stack testing**: CLI → Server → LLM → Response (no mocks for critical path)
2. **User-like interaction**: PTY-based terminal simulation with real keystrokes
3. **Feature parity verification**: Test against both PRD spec and desktop app behavior
4. **Regression prevention**: Catch breaking changes before they reach users

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Test Runner (Vitest)                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │  PTY Driver  │───▶│  CLI (Bun)   │───▶│   Server     │       │
│  │  (node-pty)  │◀───│  (OpenTUI)   │◀───│  (Fastify)   │       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
│         │                                       │                │
│         │                                       ▼                │
│         │                              ┌──────────────┐          │
│         │                              │   LLM API    │          │
│         │                              │ (OpenRouter) │          │
│         │                              └──────────────┘          │
│         ▼                                                        │
│  ┌──────────────┐                                               │
│  │  Assertions  │                                               │
│  │  (Output)    │                                               │
│  └──────────────┘                                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Test Infrastructure

### 1. PTY Driver (`helpers/pty-driver.ts`)

A wrapper around `node-pty` that provides a high-level API for interacting with the CLI.

#### Interface

```typescript
interface PtyDriver {
  // Lifecycle
  spawn(options?: SpawnOptions): Promise<void>
  kill(): Promise<void>
  
  // Input
  write(text: string): void
  writeLine(text: string): void  // Appends \r
  sendKey(key: SpecialKey): void  // F1, Ctrl+C, etc.
  
  // Output
  waitForText(pattern: string | RegExp, timeout?: number): Promise<string>
  waitForPrompt(timeout?: number): Promise<void>
  getOutput(): string
  clearOutput(): void
  
  // State
  isRunning(): boolean
  getExitCode(): number | null
}

interface SpawnOptions {
  serverUrl?: string
  apiKey?: string
  conversationId?: string
  env?: Record<string, string>
  cols?: number
  rows?: number
}

type SpecialKey = 
  | 'F1' | 'F2' | 'F3' | 'F4' | 'F12'
  | 'Enter' | 'Escape' | 'Tab'
  | 'Up' | 'Down' | 'Left' | 'Right'
  | 'PageUp' | 'PageDown'
  | 'Ctrl+C' | 'Ctrl+N' | 'Ctrl+P'
```

#### Key Sequences

| Key | Escape Sequence |
|-----|-----------------|
| F1 | `\x1bOP` or `\x1b[11~` |
| F2 | `\x1bOQ` or `\x1b[12~` |
| F3 | `\x1bOR` or `\x1b[13~` |
| F4 | `\x1bOS` or `\x1b[14~` |
| F12 | `\x1b[24~` |
| Enter | `\r` |
| Escape | `\x1b` |
| Ctrl+C | `\x03` |
| Ctrl+N | `\x0e` |
| Up | `\x1b[A` |
| Down | `\x1b[B` |

### 2. Server Manager (`helpers/server.ts`)

Manages the lifecycle of `@speakmcp/server` for tests.

```typescript
interface ServerManager {
  start(options?: ServerOptions): Promise<ServerInfo>
  stop(): Promise<void>
  isRunning(): boolean
  getUrl(): string
  getApiKey(): string
}

interface ServerOptions {
  port?: number          // Default: 3299 (test port)
  apiKey?: string        // Default: 'test-e2e-key'
  configPath?: string    // Custom config file
  debug?: boolean
}

interface ServerInfo {
  url: string
  port: number
  apiKey: string
  pid: number
}
```

### 3. Assertions (`helpers/assertions.ts`)

Custom assertion helpers for terminal output validation.

```typescript
// Check if output contains text (strips ANSI codes)
function expectOutput(driver: PtyDriver): {
  toContain(text: string): void
  toMatch(pattern: RegExp): void
  toHaveView(view: 'Chat' | 'Sessions' | 'Settings' | 'Tools'): void
  toShowMessage(role: 'user' | 'assistant', content?: string): void
  toShowToolCall(toolName: string): void
  toShowError(message?: string): void
}
```

### 4. Fixtures (`fixtures/`)

Pre-created data for tests that need existing state.

```
fixtures/
├── conversations/
│   ├── simple-chat.json       # Basic Q&A conversation
│   └── with-tool-calls.json   # Conversation with tool usage
└── config/
    └── test-config.json       # Test configuration
```

---

## Test Configuration

### Vitest Config (`vitest.e2e.config.ts`)

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.ts'],
    testTimeout: 300_000,        // 5 minutes per test
    hookTimeout: 60_000,         // 1 minute for setup/teardown
    teardownTimeout: 30_000,
    sequence: {
      concurrent: false,         // Sequential execution
    },
    reporters: ['verbose'],
    globals: true,
  },
})
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `E2E_SERVER_PORT` | Port for test server | `3299` |
| `E2E_API_KEY` | API key for test server | `test-e2e-key-12345` |
| `E2E_TIMEOUT` | Default wait timeout (ms) | `30000` |
| `E2E_DEBUG` | Enable debug logging | `false` |
| `E2E_SKIP_LLM` | Skip tests requiring LLM | `false` |

---

## Test Cases

### Priority 1: Critical Path Tests

#### 1.1 Chat Flow (`critical-path/chat.e2e.ts`)

| Test | Description | Steps | Expected |
|------|-------------|-------|----------|
| `should start and show chat view` | CLI launches successfully | 1. Start CLI | Chat view visible, input field present |
| `should send message and receive response` | Basic chat works | 1. Type message 2. Press Enter 3. Wait for response | User message shown, assistant response received (non-empty) |
| `should display streaming response` | Tokens appear progressively | 1. Send message 2. Observe output | Response builds up character by character |
| `should show tool call visualization` | Tool usage displayed | 1. Send "List MCP servers" 2. Wait for response | Shows "🔧 Using: speakmcp-settings:list_mcp_servers" or similar |
| `should create new conversation` | Ctrl+N works | 1. Send message 2. Press Ctrl+N 3. Verify | New empty chat, previous messages gone |

#### 1.2 Sessions (`critical-path/sessions.e2e.ts`)

| Test | Description | Steps | Expected |
|------|-------------|-------|----------|
| `should switch to sessions view` | F2 navigation | 1. Press F2 | Sessions view visible with header |
| `should list existing sessions` | Sessions displayed | 1. Create conversation 2. Press F2 | At least one session listed |
| `should resume session` | Navigate and Enter | 1. F2 2. Select session 3. Enter | Chat view with previous messages |
| `should delete session` | D key deletes | 1. F2 2. Select session 3. Press D | Session removed from list |
| `should create new session from sessions view` | N key | 1. F2 2. Press N | New chat view, empty conversation |

#### 1.3 Settings (`critical-path/settings.e2e.ts`)

| Test | Description | Steps | Expected |
|------|-------------|-------|----------|
| `should switch to settings view` | F3 navigation | 1. Press F3 | Settings view with provider/model |
| `should display current provider` | Provider shown | 1. F3 | Shows "LLM Provider" with value |
| `should display current model` | Model shown | 1. F3 | Shows "Model" with value |
| `should list MCP servers` | Servers displayed | 1. F3 2. Scroll to MCP section | MCP servers listed with status |
| `should modify setting` | Change and save | 1. F3 2. Change value 3. Save | Setting persisted |

---

## Desktop Feature Parity Matrix

The following is a comprehensive list of Electron desktop app settings that CLI should support for full feature parity. Tests should verify CLI can view/modify these settings via the Settings view (F3) or via API calls.

### General Settings (Desktop: `settings-general.tsx`)

#### App Settings
| Feature | Desktop | CLI Status | Test |
|---------|---------|------------|------|
| Hide Dock Icon | Yes (macOS) | N/A (no dock) | Skip |
| Launch at Login | Yes | N/A (server) | Skip |
| Streamer Mode | Yes | N/A (no sensitive display) | Skip |
| Theme (System/Light/Dark) | Yes | TBD | Optional |

#### Shortcuts
| Feature | Desktop | CLI Status | Test |
|---------|---------|------------|------|
| Recording shortcut | Yes | N/A (no voice) | Skip |
| Toggle Voice Dictation | Yes | N/A (no voice) | Skip |
| Text Input shortcut | Yes | N/A | Skip |
| Show Main Window hotkey | Yes | N/A | Skip |
| Agent Mode shortcut | Yes | N/A (always agent mode) | Skip |

#### Speech-to-Text (STT)
| Feature | Desktop | CLI Status | Test |
|---------|---------|------------|------|
| STT Language | Yes | N/A (no voice) | Skip |
| STT Post-Processing | Yes | N/A (no voice) | Skip |

#### Text-to-Speech (TTS)
| Feature | Desktop | CLI Status | Test |
|---------|---------|------------|------|
| TTS Enabled | Yes | N/A (no audio) | Skip |
| TTS Voice selection | Yes | N/A | Skip |
| TTS Auto-play | Yes | N/A | Skip |

#### Panel Position
| Feature | Desktop | CLI Status | Test |
|---------|---------|------------|------|
| Panel position | Yes | N/A (no floating panel) | Skip |
| Panel dragging | Yes | N/A | Skip |
| Auto-show panel | Yes | N/A | Skip |

#### Agent Settings (CRITICAL - must be testable)
| Feature | Desktop | CLI Status | Test |
|---------|---------|------------|------|
| Main Agent Mode (API/ACP) | Yes | Required | `should show main agent mode` |
| Message Queuing | Yes | Required | `should show message queue setting` |
| Require Tool Approval | Yes | Required | `should show tool approval setting` |
| Verify Task Completion | Yes | Required | `should show completion verification` |
| Final Summary | Yes | Required | `should show final summary setting` |
| Enable Memory System | Yes | Required | `should show memory system setting` |
| Inject Memories | Yes | Required | `should show inject memories setting` |
| Enable Summarization | Yes | Required | `should show summarization setting` |
| Max Iterations | Yes | Required | `should show max iterations` |
| Emergency Kill Switch | Yes | N/A (use Ctrl+C) | Skip |

#### Langfuse Observability
| Feature | Desktop | CLI Status | Test |
|---------|---------|------------|------|
| Langfuse Enabled | Yes | Optional | `should show langfuse settings` |
| Langfuse Keys | Yes | Optional | |

### Providers & Models (Desktop: `settings-providers.tsx`)

| Feature | Desktop | CLI Status | Test |
|---------|---------|------------|------|
| STT Provider | Yes | N/A (no voice) | Skip |
| Transcript Provider | Yes | N/A | Skip |
| Agent (MCP) Provider | Yes | Required | `should select agent provider` |
| TTS Provider | Yes | N/A (no voice) | Skip |
| OpenAI API Key | Yes | Required | `should configure openai key` |
| OpenAI Base URL | Yes | Required | `should configure openai url` |
| OpenAI Models | Yes | Required | `should select openai model` |
| Groq API Key | Yes | Required | `should configure groq key` |
| Groq Base URL | Yes | Optional | |
| Groq Models | Yes | Required | |
| Gemini API Key | Yes | Required | `should configure gemini key` |
| Gemini Base URL | Yes | Optional | |
| Gemini Models | Yes | Required | |
| Model Presets | Yes | Required | `should list model presets` |
| Custom Presets | Yes | Optional | |

### MCP Tools (Desktop: `settings-mcp-tools.tsx`)

| Feature | Desktop | CLI Status | Test |
|---------|---------|------------|------|
| List MCP Servers | Yes | Required | `should list mcp servers` |
| Enable/Disable Server | Yes | Required | `should toggle mcp server` |
| Server Status | Yes | Required | `should show server status` |
| Tool Count per Server | Yes | Required | `should show tool count` |
| Enable/Disable Tool | Yes | Optional | |
| Server Configuration | Yes | Optional | |

### Remote Server (Desktop: `settings-remote-server.tsx`)

| Feature | Desktop | CLI Status | Test |
|---------|---------|------------|------|
| Enable Remote Server | Yes | Required* | `should show remote server status` |
| Port | Yes | Required | `should show server port` |
| Bind Address | Yes | Required | |
| API Key | Yes | Required | |
| CORS Origins | Yes | Optional | |
| Cloudflare Tunnel | Yes | N/A (desktop only) | Skip |

*Note: CLI connects to a remote server, so these settings verify the server config.

### Agent Personas (Desktop: `settings-agent-personas.tsx`)

| Feature | Desktop | CLI Status | Test |
|---------|---------|------------|------|
| List Personas | Yes | Optional | `should list agent personas` |
| Create Persona | Yes | Optional | |
| Edit Persona | Yes | Optional | |
| Delete Persona | Yes | Optional | |
| System Prompt | Yes | Optional | |
| Guidelines | Yes | Optional | |

### External Agents (Desktop: `settings-external-agents.tsx`)

| Feature | Desktop | CLI Status | Test |
|---------|---------|------------|------|
| List External Agents | Yes | Optional | `should list external agents` |
| Add ACP Agent | Yes | Optional | |
| Add Stdio Agent | Yes | Optional | |
| Add Remote Agent | Yes | Optional | |
| Agent Presets | Yes | Optional | |
| Auto-spawn | Yes | Optional | |

### Skills (Desktop: `settings-skills.tsx`)

| Feature | Desktop | CLI Status | Test |
|---------|---------|------------|------|
| List Skills | Yes | Optional | `should list skills` |
| Enable/Disable Skill | Yes | Optional | |
| Create Skill | Yes | Optional | |
| Edit Skill | Yes | Optional | |
| Delete Skill | Yes | Optional | |
| Import from GitHub | Yes | Optional | |
| Import SKILL.md | Yes | Optional | |

### WhatsApp Integration (Desktop: `settings-whatsapp.tsx`)

| Feature | Desktop | CLI Status | Test |
|---------|---------|------------|------|
| Enable WhatsApp | Yes | N/A (desktop only) | Skip |
| WhatsApp QR Code | Yes | N/A | Skip |
| Allowed Senders | Yes | N/A | Skip |
| Auto-Reply | Yes | N/A | Skip |

### Agent Profiles (Desktop: `settings-tools.tsx`)

| Feature | Desktop | CLI Status | Test |
|---------|---------|------------|------|
| Active Profile | Yes | Required | `should show active profile` |
| Switch Profile | Yes | Required | `should switch profile` |
| Create Profile | Yes | Optional | |
| Export Profile | Yes | Optional | |
| Import Profile | Yes | Optional | |
| Additional Guidelines | Yes | Required | `should show guidelines` |
| Base System Prompt | Yes | Required | `should show system prompt` |

### Memories (Desktop: `memories.tsx`)

| Feature | Desktop | CLI Status | Test |
|---------|---------|------------|------|
| View Memories | Yes | Optional | |
| Add Memory | Yes | Optional | |
| Delete Memory | Yes | Optional | |
| Memory Categories | Yes | Optional | |

### Priority 2: Feature Tests

#### 2.1 Navigation (`features/navigation.e2e.ts`)

| Test | Description | Steps | Expected |
|------|-------------|-------|----------|
| `should navigate with F1-F4` | Tab switching | 1. F1 2. F2 3. F3 4. F4 | Correct view for each key |
| `should show tab bar with active indicator` | Visual feedback | 1. Navigate views | Active tab highlighted |
| `should maintain state when switching` | State preserved | 1. Type in chat 2. F2 3. F1 | Input text preserved |

#### 2.2 Tools View (`features/tools.e2e.ts`)

| Test | Description | Steps | Expected |
|------|-------------|-------|----------|
| `should switch to tools view` | F4 navigation | 1. Press F4 | Tools view visible |
| `should list MCP servers` | Servers shown | 1. F4 | At least speakmcp-settings listed |
| `should expand server to show tools` | Tool listing | 1. F4 2. Select server 3. Expand | Individual tools listed |
| `should show tool descriptions` | Detail display | 1. F4 2. Expand server | Tool descriptions visible |

#### 2.3 Keyboard Shortcuts (`features/keyboard.e2e.ts`)

| Test | Description | Steps | Expected |
|------|-------------|-------|----------|
| `should show help with ?` | Help overlay | 1. Press ? | Help overlay visible |
| `should show help with F12` | Alternative | 1. Press F12 | Help overlay visible |
| `should close help with Escape` | Dismiss | 1. ? 2. Escape | Help overlay hidden |
| `should handle Ctrl+C during agent` | Emergency stop | 1. Send long task 2. Ctrl+C | Agent stops, control returned |
| `should handle Escape to cancel` | Cancel action | 1. Start action 2. Escape | Action cancelled |

#### 2.4 Error Handling (`features/error-handling.e2e.ts`)

| Test | Description | Steps | Expected |
|------|-------------|-------|----------|
| `should show error on server disconnect` | Connection lost | 1. Stop server 2. Send message | Error message displayed |
| `should reconnect after server restart` | Auto reconnect | 1. Stop server 2. Start server 3. Send message | Connection restored |
| `should handle invalid API key` | Auth failure | 1. Start with wrong key | Auth error shown |
| `should show connection status` | Status indicator | 1. Observe status bar | Connection status visible |

---

## Test Execution

### Directory Structure

```
apps/cli/
├── e2e/
│   ├── SPEC.md                    # This document
│   ├── vitest.e2e.config.ts       # Vitest configuration
│   ├── setup.ts                   # Global setup (start server)
│   ├── teardown.ts                # Global teardown (stop server)
│   ├── helpers/
│   │   ├── pty-driver.ts          # PTY interaction wrapper
│   │   ├── server.ts              # Server lifecycle
│   │   ├── assertions.ts          # Custom assertions
│   │   └── keys.ts                # Key sequence constants
│   ├── fixtures/
│   │   ├── conversations/
│   │   │   └── simple-chat.json
│   │   └── config/
│   │       └── test-config.json
│   ├── critical-path/
│   │   ├── chat.e2e.ts
│   │   ├── sessions.e2e.ts
│   │   └── settings.e2e.ts
│   └── features/
│       ├── navigation.e2e.ts
│       ├── tools.e2e.ts
│       ├── keyboard.e2e.ts
│       └── error-handling.e2e.ts
└── package.json                   # Add test scripts
```

### NPM Scripts

```json
{
  "scripts": {
    "test:e2e": "vitest run --config e2e/vitest.e2e.config.ts",
    "test:e2e:watch": "vitest --config e2e/vitest.e2e.config.ts",
    "test:e2e:critical": "vitest run --config e2e/vitest.e2e.config.ts critical-path/",
    "test:e2e:debug": "E2E_DEBUG=true vitest run --config e2e/vitest.e2e.config.ts"
  }
}
```

### Running Tests

```bash
# Run all E2E tests
pnpm --filter @speakmcp/cli test:e2e

# Run only critical path tests
pnpm --filter @speakmcp/cli test:e2e:critical

# Run with debug output
pnpm --filter @speakmcp/cli test:e2e:debug

# Run specific test file
pnpm --filter @speakmcp/cli test:e2e -- chat.e2e.ts
```

---

## Implementation Notes

### ANSI Code Handling

Terminal output contains ANSI escape codes for colors and cursor movement. The PTY driver must:

1. **Store raw output** for debugging
2. **Provide stripped output** for assertions (remove `\x1b[...m` sequences)
3. **Handle cursor positioning** for accurate text location

```typescript
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
}
```

### Timing and Synchronization

Terminal applications are asynchronous. Tests must wait for:

1. **CLI startup**: Wait for initial render (status bar visible)
2. **View transitions**: Wait for new view header after F-key press
3. **LLM responses**: Wait for response completion (can take 10-60+ seconds)
4. **Tool execution**: Wait for tool result display

Use polling with timeout rather than fixed delays:

```typescript
async function waitForText(pattern: RegExp, timeout = 30000): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const output = stripAnsi(this.buffer)
    const match = output.match(pattern)
    if (match) return match[0]
    await sleep(100)  // Poll every 100ms
  }
  throw new Error(`Timeout waiting for: ${pattern}`)
}
```

### Bun Runtime Requirement

The CLI requires Bun due to OpenTUI's tree-sitter dependencies. The PTY driver spawns:

```typescript
const shell = 'bun'
const args = ['run', 'src/index.ts', '--url', serverUrl, '--api-key', apiKey]
```

Ensure Bun is installed and in PATH before running tests.

### Server Configuration

Tests use a dedicated config to avoid polluting user data:

```typescript
const testConfig = {
  dataDir: path.join(os.tmpdir(), 'speakmcp-e2e-test'),
  configPath: path.join(os.tmpdir(), 'speakmcp-e2e-config.json'),
}
```

Clean up after tests to prevent disk space accumulation.

---

## Success Criteria

### Minimum Viable Test Suite

- [ ] All critical path tests pass (chat, sessions, settings)
- [ ] Tests complete within 5 minutes total
- [ ] No flaky tests (consistent pass/fail)
- [ ] Clear failure messages with output context

### Full Test Suite

- [ ] All feature tests pass
- [ ] Code coverage for CLI views > 70%
- [ ] Tests documented in this spec
- [ ] Tests run successfully on fresh clone

---

## Dependencies to Add

```json
{
  "devDependencies": {
    "node-pty": "^1.0.0",
    "vitest": "^2.0.0",
    "strip-ansi": "^7.1.0"
  }
}
```

---

## Future Enhancements

1. **Visual regression testing**: Screenshot comparison for TUI layout
2. **Performance benchmarks**: Track response time trends
3. **Chaos testing**: Random network interruptions
4. **Cross-platform CI**: Test on macOS, Linux, Windows

