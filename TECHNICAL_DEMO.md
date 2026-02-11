# SpeakMCP Technical Demo Guide

## Overview

SpeakMCP is an AI voice assistant that integrates MCP (Model Context Protocol) for agentic functionality beyond simple dictation.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    SpeakMCP Application                      │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐   │
│  │   Electron  │  │   React     │  │   MCP Client        │   │
│  │   Desktop   │  │   UI        │  │   (Agent Tools)     │   │
│  │   App       │  │             │  │                     │   │
│  └─────────────┘  └─────────────┘  └─────────────────────┘   │
│         │              │                   │                │
│         └──────────────┬───────────────────┘                │
│                        │                                   │
│              ┌────────▼────────┐                           │
│              │  Node.js Core   │                           │
│              │  (Transcrip-   │                           │
│              │   tion Engine) │                           │
│              └────────────────┘                           │
└─────────────────────────────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
   ┌────▼────┐     ┌────▼────┐     ┌────▼────┐
   │  Whisper│     │  OpenAI  │     │  MCP    │
   │  (STT)  │     │  (LLM)  │     │ Servers │
   └─────────┘     └─────────┘     └─────────┘
```

## Key Features

### 1. Voice-First Agent Interactions
- Hold `Ctrl` to record voice commands
- Automatic transcription via Whisper
- LLM processes intent → executes via MCP tools
- Results delivered back as voice/audio

### 2. MCP Server Integration
```typescript
// Example: MCP WhatsApp Server Integration
import { McpServer } from "@speakmcp/mcp-whatsapp";

const server = new McpServer({
  name: "whatsapp",
  version: "1.0.0",
  tools: [
    {
      name: "send_message",
      description: "Send WhatsApp message to contact",
      inputSchema: {
        type: "object",
        properties: {
          phone: { type: "string", description: "Phone number with country code" },
          message: { type: "string", description: "Message content" }
        },
        required: ["phone", "message"]
      }
    }
  ]
});
```

### 3. Cross-Platform Design
- **macOS**: Full MCP + dictation (Agent mode)
- **Windows/Linux**: Dictation-only (MCP tools pending)

## MCP Tools Available

### WhatsApp MCP Server (`@speakmcp/mcp-whatsapp`)
| Tool | Description |
|------|-------------|
| `send_message` | Send WhatsApp message |
| `send_media` | Send image/video/audio |
| `get_contacts` | List contacts |
| `get_chats` | List recent conversations |

### Core System Tools
| Tool | Description |
|------|-------------|
| `voice_transcribe` | Convert audio to text |
| `voice_synthesize` | Convert text to audio |
| `agent_execute` | Run agentic workflow |

## Quick Demo Workflow

### 1. Agent Mode Activation
1. Open SpeakMCP app
2. Hold `Ctrl` → Speak: "Send message to John saying I'll be late"
3. App transcribes → LLM interprets → WhatsApp MCP executes
4. Confirmation audio played

### 2. MCP Server Extension
```bash
# Adding a new MCP server
cd speakmcp/packages
npx create-mcp-server my-server --template=whatsapp
# Implement your tool handlers
# Register in SpeakMCP settings
```

## Technical Stack

| Layer | Technology |
|-------|------------|
| Desktop | Electron 31 |
| UI | React 18 + TypeScript |
| Voice | OpenAI Whisper |
| AI | OpenAI GPT-4o |
| Protocol | MCP (Model Context Protocol) |
| Build | Turborepo + pnpm |

## For Developers

### Running the Demo
```bash
git clone https://github.com/aj47/SpeakMCP.git
cd speakmcp
npm install
npm run dev     # Development mode
npm run build   # Production build
```

### Creating Custom MCP Tools
See `DEVELOPMENT.md` for:
- MCP server template structure
- Tool schema definitions
- Testing strategies
- Publishing workflows

## Why MCP Matters

MCP (Model Context Protocol) standardizes how AI agents interact with tools. SpeakMCP demonstrates:

1. **Voice as Interface**: Hands-free agentic workflows
2. **Protocol Standardization**: MCP servers work across any MCP-compatible client
3. **Extensibility**: Add new capabilities without modifying core app

---

**Links:**
- [Download Latest Release](https://github.com/aj47/SpeakMCP/releases/latest)
- [YouTube Demo Video](https://www.youtube.com/watch?v=A4oKYCaeaaw)
- [Claude.md](CLAUDE.md) - AI-assisted development guide
