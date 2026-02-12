# MCP Server Integration Guide

SpeakMCP leverages the Model Context Protocol (MCP) to create a powerful voice-controlled personal AI assistant. This guide covers how to configure and use MCP servers with SpeakMCP.

## 🎯 Overview

SpeakMCP acts as an **MCP Client** that connects to any **MCP Server**, enabling:
- Voice-controlled file operations
- GitHub repository management via voice
- Database queries through conversation
- Custom tool integration

## 📦 Pre-built MCP Servers

### Core Servers (npm-based)

#### 1. Filesystem Server
Access and modify files via voice commands.

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/your/files"]
    }
  }
}
```

**Voice Commands:**
- "Read the README.md file"
- "Create a new file called notes.txt"
- "List all files in the project directory"

#### 2. GitHub Server
Manage repositories, issues, and pull requests.

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "your-token-here"
      }
    }
  }
}
```

**Voice Commands:**
- "Create a new issue titled 'Bug found'"
- "Show me open pull requests"
- "List recent commits"

> **Note:** The example shows a token placeholder for illustration. In practice, use environment variables or your system's secure credential storage. This JSON config file is local-only and should never be committed to version control.

#### 3. PostgreSQL Server
Query databases through conversation.

```json
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://user:password@localhost:5432/database"]
    }
  }
}
```

**Voice Commands:**
- "Show me all users from the database"
- "Count how many orders we have today"

## 🔧 Configuration

### Adding MCP Servers

1. Open SpeakMCP settings
2. Navigate to **MCP Servers**
3. Add your server configuration in JSON format:

```json
{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["-y", "@package/name", "--flag", "value"],
      "env": {
        "API_KEY": "your-key"
      }
    }
  }
}
```

### Server Options

| Option | Type | Description |
|--------|------|-------------|
| `command` | string | Executable command (npx, path/to/binary) |
| `args` | string[] | Command arguments |
| `env` | object | Environment variables |
| `disabled` | boolean | Disable server without removing |

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      SpeakMCP                           │
│  ┌─────────────┐  ┌─────────────┐  ┌───────────────┐   │
│  │ Voice Input │→│   MCP Client │→│ MCP Server(s)  │   │
│  └─────────────┘  └─────────────┘  └───────────────┘   │
│         ↓                ↓                ↓             │
│  ┌─────────────────────────────────────────────────┐   │
│  │              AI Processing Layer                │   │
│  │   OpenAI / Groq / Gemini / Anthropic           │   │
│  └─────────────────────────────────────────────────┘   │
│                      ↓                                 │
│              Output to Active App                      │
└─────────────────────────────────────────────────────────┘
```

## 🛠️ Custom MCP Server Development

### Quick Start

```typescript
// server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "my-custom-server", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Define your tools
const TOOLS = {
  my_tool: {
    name: "my_tool",
    description: "Does something useful",
    inputSchema: {
      type: "object",
      properties: {
        param1: { type: "string", description: "First parameter" },
      },
      required: ["param1"],
    },
  },
};

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: Object.values(TOOLS) };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "my_tool") {
    const result = await myToolFunction(args.param1);
    return { content: [{ type: "text", text: result }] };
  }

  throw new Error(`Unknown tool: ${name}`);
});

async function myToolFunction(param1: string) {
  // Your logic here
  return `Processed: ${param1}`;
}

// Start the server
const transport = new StdioServerTransport();
server.connect(transport);
```

### Register Custom Server in SpeakMCP

```json
{
  "mcpServers": {
    "my-custom": {
      "command": "node",
      "args": ["/path/to/your/server.js"]
    }
  }
}
```

## 📚 Use Cases

### 1. Developer Workflow
```
Voice: "Create a new React component for user profile"
→ MCP filesystem server creates file
→ MCP GitHub server creates branch
→ SpeakMCP outputs: Component ready for editing
```

### 2. Data Analysis
```
Voice: "Show me sales data from last week"
→ MCP PostgreSQL server runs query
→ AI summarizes: "Revenue up 15%..."
```

### 3. Content Creation
```
Voice: "Write a blog post about MCP Protocol"
→ MCP filesystem reads reference files
→ AI generates draft
→ Output to your editor
```

## 🔐 Security

- **Local execution**: MCP servers run locally. Tool results are sent to your configured AI provider (OpenAI, Anthropic, etc.) for processing—only the data you explicitly request through MCP tools is transmitted beyond your machine.
- **OAuth 2.1**: Secure authentication for cloud services
- **Environment variables**: Keep API keys out of config files

## 🚀 Community Servers

| Server | Purpose | Install |
|--------|---------|---------|
| `@modelcontextprotocol/server-filesystem` | File operations | `npx -y @modelcontextprotocol/server-filesystem /path` |
| `@modelcontextprotocol/server-github` | GitHub integration | `npx -y @modelcontextprotocol/server-github` |
| `@modelcontextprotocol/server-postgres` | PostgreSQL queries | `npx -y @modelcontextprotocol/server-postgres <connection>` |
| `@modelcontextprotocol/server-google-maps` | Maps & location | `npx -y @modelcontextprotocol/server-google-maps` |

## 📖 Resources

- [MCP Protocol Documentation](https://modelcontextprotocol.io/)
- [SpeakMCP GitHub](https://github.com/aj47/SpeakMCP)
- [MCP Server Registry](https://github.com/modelcontextprotocol/servers)

---

*Part of the SpeakMCP Documentation Suite*
