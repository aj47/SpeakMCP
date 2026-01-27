# SpeakMCP CLI - Product Requirements Document

## Overview

A terminal user interface (TUI) client for SpeakMCP that provides feature parity with the Electron desktop app. Built with OpenTUI and interfaces with `@speakmcp/server` via HTTP API.

## Goals

1. **Feature parity** with Electron app's core functionality
2. **Cross-platform** support (macOS, Linux, Windows)
3. **Streaming responses** with real-time token display
4. **Session continuity** for conversation context
5. **Single binary** distribution via Bun compilation

## Technical Stack

| Component | Technology |
|-----------|------------|
| Framework | OpenTUI (`@opentui/core`) |
| Runtime | Bun |
| Language | TypeScript |
| Backend | `@speakmcp/server` HTTP API |
| Package Location | `apps/cli/` |
| Binary Name | `speakmcp` |

## Architecture

```
┌─────────────────┐     HTTP/SSE      ┌──────────────────┐
│   speakmcp CLI  │ ◄───────────────► │ @speakmcp/server │
│   (OpenTUI)     │                   │   (Fastify)      │
└─────────────────┘                   └──────────────────┘
```

## Project Structure

```
apps/cli/
├── package.json
├── tsconfig.json
├── prd.md                 # This document
├── src/
│   ├── index.ts           # CLI entry point + arg parsing
│   ├── app.ts             # Main TUI application
│   ├── client.ts          # HTTP client for server API
│   ├── config.ts          # Configuration management
│   ├── types.ts           # TypeScript types
│   ├── views/
│   │   ├── chat.ts        # Chat/conversation view (primary)
│   │   ├── sessions.ts    # Sessions list view
│   │   ├── settings.ts    # Settings view
│   │   ├── profiles.ts    # Profile selector view
│   │   └── tools.ts       # MCP tools view
│   └── components/
│       ├── status-bar.ts  # Bottom status bar
│       ├── message.ts     # Chat message component
│       └── help-overlay.ts # Help/keybindings overlay
└── README.md
```

## Configuration

### Priority Order (highest to lowest)

1. CLI flags (`--url`, `--api-key`)
2. Environment variables (`SPEAKMCP_URL`, `SPEAKMCP_API_KEY`)
3. Config file (`~/.speakmcp/cli.json`)
4. Auto-discovery (probe common ports: 3210, 3211, 3212)

### CLI Arguments

```
speakmcp [options]

Options:
  -h, --help              Show help
  -v, --version           Show version
  -u, --url <url>         Server URL (default: auto-discover)
  -k, --api-key <key>     API key for authentication
  -c, --conversation <id> Resume specific conversation
  --no-color              Disable colors
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `SPEAKMCP_URL` | Server URL |
| `SPEAKMCP_API_KEY` | API key for authentication |
| `SPEAKMCP_CONVERSATION` | Default conversation ID |

## UI Layout

### Main Layout

```
┌─────────────────────────────────────────────────────────┐
│ [F1] Chat  [F2] Sessions  [F3] Settings  [F4] Tools     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│                    (Active View)                        │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ Profile: default  │  Model: gpt-4o  │  Server: ●        │
└─────────────────────────────────────────────────────────┘
```

### Views

#### 1. Chat View (F1) - Primary

The main interaction view for conversing with the agent.

**Features:**
- Text input field at bottom
- Scrollable message history
- Real-time streaming response display
- Tool call visualization (show tool name + result summary)
- Session continuity (maintains conversation_id)

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│ 💬 Chat                                    [Ctrl+N] New │
├─────────────────────────────────────────────────────────┤
│ ┌─ User ────────────────────────────────────────────┐   │
│ │ What files are in the current directory?          │   │
│ └───────────────────────────────────────────────────┘   │
│ ┌─ Assistant ───────────────────────────────────────┐   │
│ │ 🔧 Using: filesystem:list_directory               │   │
│ │ ─────────────────────────────────────────────────  │   │
│ │ The current directory contains:                   │   │
│ │ - package.json                                    │   │
│ │ - src/                                            │   │
│ └───────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────┤
│ > Type message...                         [Enter] Send  │
└─────────────────────────────────────────────────────────┘
```

#### 2. Sessions View (F2)

Browse and manage conversation history.

**Features:**
- List all conversations with status indicators
- Resume previous conversations
- Delete conversations
- Show last message preview

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│ 📋 Sessions                                [N] New      │
├─────────────────────────────────────────────────────────┤
│ > ● What files are in the directory?           2m ago   │
│   ✓ Write a hello world script                 1h ago   │
│   ✓ Explain this code                          2h ago   │
│   ✗ Failed task                                1d ago   │
├─────────────────────────────────────────────────────────┤
│ [Enter] Resume  [D] Delete  [/] Search                  │
└─────────────────────────────────────────────────────────┘
```

#### 3. Settings View (F3)

View and modify configuration.

**Features:**
- Display current LLM provider and model
- Show MCP server status
- Modify key settings

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│ ⚙️  Settings                                            │
├─────────────────────────────────────────────────────────┤
│ LLM Provider      [OpenAI ▼]                            │
│ Model             [gpt-4o-mini ▼]                       │
│ Max Iterations    [10]                                  │
│ ──────────────────────────────────────────────────────  │
│ MCP Servers                                             │
│   ✓ filesystem         3 tools    stdio                 │
│   ✓ speakmcp-settings  8 tools    builtin               │
│   ✗ whatsapp           disabled                         │
└─────────────────────────────────────────────────────────┘
```

#### 4. Tools View (F4)

Browse available MCP tools.

**Features:**
- List all MCP servers and their tools
- Show tool descriptions
- Display server connection status

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│ 🔧 MCP Tools                                            │
├─────────────────────────────────────────────────────────┤
│ ▼ filesystem (stdio) ─ connected                        │
│   ├─ read_file        Read contents of a file           │
│   ├─ write_file       Write content to a file           │
│   └─ list_directory   List directory contents           │
│ ▼ speakmcp-settings (builtin)                           │
│   ├─ list_profiles    List all profiles                 │
│   ├─ get_settings     Get current settings              │
│   └─ ...                                                │
└─────────────────────────────────────────────────────────┘
```

## Key Bindings

### Global

| Key | Action |
|-----|--------|
| `F1` | Switch to Chat view |
| `F2` | Switch to Sessions view |
| `F3` | Switch to Settings view |
| `F4` | Switch to Tools view |
| `Ctrl+C` | Emergency stop (during agent) / Exit |
| `Ctrl+P` | Quick profile switcher popup |
| `?` or `F12` | Show help overlay |
| `Esc` | Cancel / Close popup / Go back |

### Chat View

| Key | Action |
|-----|--------|
| `Enter` | Send message |
| `Ctrl+N` | New conversation |
| `Up/Down` | Scroll history |
| `PgUp/PgDn` | Scroll page |

### Sessions View

| Key | Action |
|-----|--------|
| `Enter` | Resume selected conversation |
| `N` | New conversation |
| `D` | Delete selected |
| `Up/Down` | Navigate list |

## API Integration

### HTTP Client Methods

| Method | Endpoint | Description |
|--------|----------|-------------|
| `getModels()` | `GET /v1/models` | List available models |
| `getProfiles()` | `GET /v1/profiles` | List profiles |
| `getCurrentProfile()` | `GET /v1/profiles/current` | Get active profile |
| `switchProfile(id)` | `POST /v1/profiles/switch` | Switch profile |
| `getSettings()` | `GET /v1/settings` | Get settings |
| `patchSettings(data)` | `PATCH /v1/settings` | Update settings |
| `getConversations()` | `GET /v1/conversations` | List conversations |
| `getConversation(id)` | `GET /v1/conversations/:id` | Get conversation |
| `createConversation(data)` | `POST /v1/conversations` | Create conversation |
| `chat(messages, opts)` | `POST /v1/chat/completions` | Chat (with SSE streaming) |
| `getMcpServers()` | `GET /v1/mcp/servers` | MCP server status |
| `listMcpTools()` | `POST /mcp/tools/list` | List MCP tools |
| `emergencyStop()` | `POST /v1/emergency-stop` | Kill all agents |

### SSE Streaming

Chat completions use Server-Sent Events for real-time token streaming:

```typescript
const response = await fetch(`${url}/v1/chat/completions`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    messages,
    stream: true,
    conversation_id: conversationId
  })
});

for await (const chunk of parseSSE(response.body)) {
  // Update UI with streaming token
  appendToken(chunk.choices[0]?.delta?.content);
}
```

## Build & Distribution

### Development

```bash
cd apps/cli
bun install
bun run dev
```

### Build

```bash
# JavaScript bundle
bun run build

# Standalone binary (current platform)
bun run build:binary

# Cross-platform binaries
bun run build:macos
bun run build:linux
bun run build:windows
```

### Package Scripts

```json
{
  "scripts": {
    "dev": "bun run src/index.ts",
    "build": "bun build src/index.ts --outdir dist --target bun",
    "build:binary": "bun build src/index.ts --compile --outfile speakmcp",
    "build:macos": "bun build src/index.ts --compile --outfile speakmcp-macos",
    "build:linux": "bun build src/index.ts --compile --target=bun-linux-x64 --outfile speakmcp-linux",
    "build:windows": "bun build src/index.ts --compile --target=bun-windows-x64 --outfile speakmcp.exe"
  }
}
```

## Implementation Phases

### Phase 1: Foundation
- [ ] Project setup (package.json, tsconfig.json)
- [ ] HTTP client with all endpoints
- [ ] SSE streaming support
- [ ] Config management

### Phase 2: Core TUI
- [ ] Main app shell with OpenTUI
- [ ] Tab navigation (F1-F4)
- [ ] Status bar component
- [ ] Help overlay

### Phase 3: Chat View
- [ ] Message display with scrolling
- [ ] Text input field
- [ ] Streaming response rendering
- [ ] Tool call visualization
- [ ] Session continuity

### Phase 4: Supporting Views
- [ ] Sessions view (list, resume, delete)
- [ ] Settings view (display + basic editing)
- [ ] Tools view (browse MCP tools)
- [ ] Profiles view (switch profiles)

### Phase 5: Polish
- [ ] Error handling and recovery
- [ ] Loading states
- [ ] Keyboard shortcuts refinement
- [ ] Color theming

### Phase 6: Distribution
- [ ] Build scripts
- [ ] Cross-platform binaries
- [ ] README documentation

## Dependencies

```json
{
  "dependencies": {
    "@opentui/core": "^0.1.0"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "^5.0.0"
  }
}
```

## Success Criteria

1. **Functional**: Can send messages and receive streaming responses
2. **Parity**: Covers core Electron app features (chat, sessions, settings, profiles)
3. **Portable**: Single binary works on macOS, Linux, Windows
4. **Responsive**: Sub-100ms UI response, real-time streaming
5. **Robust**: Graceful error handling, reconnection logic

## Future Enhancements (Out of Scope)

- Voice input (requires audio capture)
- Plugin/extension system
- Custom themes
- Multi-window support
- Scripting/automation mode

