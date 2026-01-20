# @speakmcp/server

Standalone SpeakMCP server - AI agent with MCP (Model Context Protocol) tool integration.

This package provides a headless HTTP server that exposes the core SpeakMCP agent capabilities via an OpenAI-compatible API, allowing any frontend (web, mobile, CLI) to interact with MCP tools through a unified interface.

## Features

- 🤖 **Agent Mode** - Iterative LLM processing with MCP tool calling
- 🔧 **MCP Integration** - Connect to any MCP-compatible tool server
- 🌐 **OpenAI-Compatible API** - Drop-in replacement for OpenAI chat completions
- 📡 **Streaming Support** - Server-Sent Events for real-time progress updates
- 🔐 **OAuth Support** - Secure authentication with protected MCP servers
- 💬 **Conversation Persistence** - Save and resume conversations
- 👤 **Profile System** - Multiple profiles with different configurations
- 🛑 **Emergency Stop** - Kill switch for long-running agent sessions

## Installation

```bash
# Install from npm (when published)
npm install @speakmcp/server

# Or use within the monorepo
pnpm add @speakmcp/server
```

## Quick Start

### CLI Usage

```bash
# Start the server with default settings
speakmcp-server

# Specify port and API key
speakmcp-server --port 8080 --api-key your-secret-key

# Enable debug logging
speakmcp-server --debug

# Configure LLM provider
OPENAI_API_KEY=sk-xxx speakmcp-server
```

### Programmatic Usage

```typescript
import { startServer, stopServer, loadConfig } from '@speakmcp/server'

// Load configuration from default paths
const config = loadConfig()

// Start the server
await startServer({
  port: 3000,
  bind: '0.0.0.0',
  apiKey: 'optional-api-key',
  corsOrigins: ['http://localhost:3000'],
})

// Stop the server gracefully
await stopServer()
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | OpenAI API key for GPT models | - |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google API key for Gemini models | - |
| `GROQ_API_KEY` | Groq API key for fast inference | - |
| `SPEAKMCP_API_KEY` | API key for server authentication | - |
| `SPEAKMCP_PORT` | Server port | `3000` |
| `SPEAKMCP_BIND` | Bind address | `127.0.0.1` |

### Config File

The server loads configuration from `~/.speakmcp/config.json`:

```json
{
  "mcpToolsProviderId": "openai",
  "mcpToolsOpenaiModel": "gpt-4o-mini",
  "mcpMaxIterations": 25,
  "mcpParallelToolExecution": true,
  "mcpConfig": {
    "mcpServers": {
      "filesystem": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
      }
    }
  }
}
```

## API Endpoints

### Chat Completions

`POST /v1/chat/completions`

OpenAI-compatible chat completions endpoint with agent mode support.

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [{"role": "user", "content": "List files in /tmp"}],
    "stream": true
  }'
```

### Health Check

`GET /health`

Returns server status and configuration info.

### Agent Control

- `POST /agent/stop` - Stop all running agent sessions
- `POST /agent/stop/:sessionId` - Stop a specific session

### MCP Management

- `GET /mcp/servers` - List configured MCP servers
- `GET /mcp/tools` - List available tools
- `POST /mcp/tool/:name` - Execute a specific tool

### Conversations

- `GET /conversations` - List all conversations
- `GET /conversations/:id` - Get a specific conversation
- `DELETE /conversations/:id` - Delete a conversation

### Profiles

- `GET /profiles` - List all profiles
- `GET /profiles/current` - Get current profile
- `POST /profiles/current/:id` - Set current profile

## Development

```bash
# Install dependencies
pnpm install

# Build the package
pnpm build

# Run in development mode (with watch)
pnpm dev

# Run tests
pnpm test

# Type check
pnpm typecheck
```

## Architecture

The server is built with:
- **Fastify** - High-performance HTTP framework
- **AI SDK** - Unified LLM provider interface (OpenAI, Google, Groq)
- **MCP SDK** - Model Context Protocol client implementation
- **TypeScript** - Full type safety

## License

MIT

