# @speakmcp/cli - Agent Knowledge Base

## Overview

Terminal UI (TUI) client for SpeakMCP using OpenTUI framework. Connects to `@speakmcp/server` via HTTP API.

```
src/
├── index.ts       # CLI entry point (arg parsing, bootstrap)
├── app.ts         # Main TUI application (OpenTUI setup)
├── client.ts      # HTTP client for server API
├── config.ts      # Configuration (CLI args, env, auto-discover)
├── types.ts       # TypeScript interfaces
└── views/         # TUI screens
    ├── base.ts    # Base view class
    ├── chat.ts    # Chat/conversation view
    ├── sessions.ts # Session list
    ├── settings.ts # Settings view
    └── tools.ts   # MCP tools view
```

## Runtime

**Requires Bun** - OpenTUI uses `.scm` tree-sitter files that only work with Bun runtime.

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Run CLI
cd apps/cli && bun run src/index.ts --help
```

## Configuration Priority

1. CLI flags (highest)
2. Environment variables (`SPEAKMCP_*`)
3. Config file (`~/.speakmcp/cli-config.json`)
4. Auto-discover from Electron app config

### CLI Flags
```bash
speakmcp --url http://127.0.0.1:3211 --api-key <key>
speakmcp --profile work
speakmcp --debug
```

### Environment Variables
```bash
export SPEAKMCP_URL=http://127.0.0.1:3211
export SPEAKMCP_API_KEY=your-key
```

## HTTP Client (`client.ts`)

Connects to `@speakmcp/server` endpoints:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/v1/models` | List available models |
| GET | `/v1/profiles/current` | Get active profile |
| POST | `/v1/chat/completions` | Send message (supports SSE streaming) |
| GET | `/v1/conversations` | List conversations |
| GET | `/v1/settings` | Get current settings |

### Authentication
```typescript
headers: {
  'Authorization': `Bearer ${apiKey}`,
  'Content-Type': 'application/json'
}
```

## OpenTUI Patterns

### Key Classes
- `BoxRenderable` - Container (no `GroupRenderable` in OpenTUI)
- `TextRenderable` - Text display
- `InputRenderable` - Text input
- `TabSelectRenderable` - Tab navigation

### Property Updates (not `.update()`)
```typescript
// Wrong
textElement.update({ content: 'new text' })

// Correct
textElement.content = 'new text'
tabSelect.setSelectedIndex(2)
inputField.value = ''
```

### Children Access
```typescript
// Wrong
container.children

// Correct  
container.getChildren()
```

### Remove Elements
```typescript
// Wrong
container.remove(element)

// Correct
container.remove(element.id)  // Takes string ID
```

## Key Bindings

| Key | Action |
|-----|--------|
| F1 | Chat view |
| F2 | Sessions view |
| F3 | Settings view |
| F4 | Tools view |
| Ctrl+C | Quit |
| Enter | Send message (in chat) |
| Tab | Next field |

## Testing Workflow

```bash
# Terminal 1: Start server
cd packages/server && npx tsx src/index.ts --port 3211 --api-key test-key --debug

# Terminal 2: Start CLI
export PATH="$HOME/.bun/bin:$PATH"
cd apps/cli && bun run src/index.ts --url http://127.0.0.1:3211 --api-key test-key
```

## Gotchas

- **Bun required** - `tsx`/Node.js won't work due to OpenTUI's tree-sitter dependencies
- **Server must be running** - CLI is just a client, needs `@speakmcp/server` 
- **Auto-discover limitation** - Only works if Electron app has saved config
- **SSE streaming** - Use `fetch` with `getReader()` for streaming responses
- **Tab nav index** - `setSelectedIndex()` is 0-based

