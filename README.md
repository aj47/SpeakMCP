# SpeakMCP

🎤 **AI-powered voice assistant with MCP integration** - Transform your voice into intelligent actions with advanced speech recognition, LLM processing, and Model Context Protocol (MCP) tool execution.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%203.0-blue.svg)](./LICENSE)
[![Electron](https://img.shields.io/badge/Electron-31.0.2-47848f.svg)](https://electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6.3-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.3.1-61dafb.svg)](https://reactjs.org/)

## 🚀 Quick Start

### Download

Currently building for **macOS (Apple Silicon)** and **Windows x64**.

**[📥 Download Latest Release](https://github.com/aj47/SpeakMCP/releases/latest)**

### Basic Usage

**Voice Recording:**
1. **Hold `Ctrl`** key to start recording your voice
2. **Release `Ctrl`** to stop recording and transcribe
3. Text is automatically inserted into your active application

**MCP Agent Mode:**
1. **Hold `Ctrl+Alt`** to start recording for agent mode
2. **Release `Ctrl+Alt`** to process with MCP tools
3. Watch real-time progress as the agent executes tools
4. Results are automatically inserted or displayed

**Text Input:**
- **Press `Ctrl+T`** to open text input mode for direct typing

## 🎬 Preview

https://github.com/user-attachments/assets/2344a817-f36c-42b0-9ebc-cdd6e926b7a0

## ✨ Features

### 🎯 Core Functionality
- **Voice-to-Text**: Hold `Ctrl` key to record, release to transcribe
- **MCP Agent Mode**: Hold `Ctrl+Alt` for intelligent tool execution
- **Text Input Mode**: Press `Ctrl+T` for direct text input
- **Universal Integration**: Works with any application that supports text input
- **Conversation Management**: Persistent conversations across multiple interactions
- **Real-time Feedback**: Visual audio waveform and agent progress tracking

### 🤖 AI-Powered Processing
- **Speech Recognition**: OpenAI Whisper and Groq for high-accuracy transcription
- **LLM Integration**: OpenAI GPT, Groq, and Google Gemini for intelligent processing
- **Structured Output**: Reliable JSON responses using OpenAI SDK and Zod validation
- **Custom Endpoints**: Support for self-hosted APIs and custom base URLs

### 🛠️ MCP Tool Integration
- **Model Context Protocol**: Connect to any MCP-compatible tools and services
- **Agent Mode**: Iterative tool calling with intelligent decision making
- **Real-time Progress**: Visual feedback showing agent thinking and tool execution
- **Multi-Server Support**: Connect to multiple MCP servers simultaneously
- **Tool Discovery**: Automatic detection and configuration of available tools

### 🧠 Intelligent Conversations
- **Context Persistence**: Maintain conversation history across voice interactions
- **Multi-turn Dialogues**: Continue conversations with follow-up questions
- **Tool Memory**: Agents remember previous tool results and context
- **Conversation Management**: Create, continue, and manage multiple conversation threads

### 🔧 Advanced Configuration
- **Multiple Shortcuts**: Configurable keyboard shortcuts for different modes
- **Provider Selection**: Choose between multiple STT and LLM providers
- **Model Customization**: Select specific models for each provider and use case
- **Auto-paste Settings**: Configurable delays and focus restoration
- **API Management**: Secure storage of API keys and environment variables

## 🏗️ Architecture

SpeakMCP is built with a modern, multi-process architecture designed for performance, reliability, and extensibility:

### System Overview
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Electron      │    │   Rust Binary    │    │   MCP Servers   │
│   Main Process  │◄──►│   speakmcp-rs    │    │   (Tools &      │
│                 │    │   (Keyboard &    │    │   Services)     │
│                 │    │   Text Input)    │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                                               ▲
         ▼                                               │
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   React UI      │    │   External APIs  │    │   Agent Engine  │
│   (Renderer)    │    │   OpenAI, Groq   │    │   Conversation  │
│   Progress &    │    │   Gemini         │    │   Management    │
│   Conversations │    │                  │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Key Components

- **Main Process**: Handles system integration, keyboard events, API communication, and MCP orchestration
- **Renderer Process**: React-based UI with real-time progress tracking and conversation management
- **Rust Binary**: Low-level keyboard monitoring, text injection, and focus management
- **MCP Service**: Model Context Protocol client for connecting to external tools and services
- **Agent Engine**: Iterative tool calling with intelligent decision making and progress tracking
- **Conversation Service**: Persistent conversation management with message history
- **Structured Output**: Type-safe LLM responses using OpenAI SDK and Zod validation
- **TIPC Communication**: Type-safe IPC between Electron processes

## 🛠️ Development

### Prerequisites

- **Node.js** 18+ with **pnpm** package manager
- **Rust** toolchain for building the native binary
- **Xcode Command Line Tools** (macOS) or **Visual Studio Build Tools** (Windows)

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/aj47/SpeakMCP.git
   cd SpeakMCP
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Build Rust binary**
   ```bash
   pnpm build-rs
   ```

4. **Start development server**
   ```bash
   pnpm dev
   ```

### Build Commands

```bash
# Development
pnpm dev                    # Start development server
pnpm build                  # Build for production

# Platform-specific builds
pnpm build:mac             # Build for macOS
pnpm build:win             # Build for Windows
pnpm build:linux           # Build for Linux

# Testing
pnpm typecheck             # Type checking
pnpm lint                  # ESLint
```

### Project Structure

```
SpeakMCP/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── tipc.ts             # IPC router and API handlers
│   │   ├── keyboard.ts         # Keyboard event handling
│   │   ├── llm.ts              # LLM processing and agent mode
│   │   ├── mcp-service.ts      # MCP client and tool management
│   │   ├── conversation-service.ts # Conversation persistence
│   │   ├── structured-output.ts # Type-safe LLM responses
│   │   └── diagnostics.ts      # Error tracking and logging
│   ├── renderer/src/           # React UI
│   │   ├── pages/              # Application pages
│   │   ├── components/         # Reusable components
│   │   │   ├── agent-progress.tsx # Real-time agent feedback
│   │   │   └── conversation-display.tsx # Conversation UI
│   │   ├── contexts/           # React contexts
│   │   │   └── conversation-context.tsx # Conversation state
│   │   └── lib/                # Utilities and services
│   ├── preload/                # Electron preload scripts
│   └── shared/                 # Shared types and constants
├── speakmcp-rs/                # Rust binary for system integration
├── resources/                  # Static resources and assets
├── docs/                       # Documentation
│   ├── MCP_TESTING.md         # MCP testing infrastructure
│   └── issues/                # Issue tracking and analysis
└── scripts/                    # Build and utility scripts
    ├── mock-mcp-server.mjs    # Mock MCP server for testing
    └── test-mcp-path-fix.mjs  # PATH resolution testing
```

## ⚙️ Configuration

### Speech-to-Text Providers

| Provider | Platform | Speed | Quality | Privacy | Cost |
|----------|----------|-------|---------|---------|------|
| **OpenAI Whisper** | All | 🐌 Moderate | 🎯 High | ☁️ Cloud | 💰 Paid |
| **Groq** | All | ⚡ Fast | 🎯 High | ☁️ Cloud | 💰 Paid |

### LLM Providers

**Supported Providers and Models:**
- **OpenAI**: GPT-4o, GPT-4o-mini, GPT-3.5-turbo
- **Groq**: Gemma2-9b-it, Llama-3.1-70b, Mixtral-8x7b
- **Google Gemini**: Gemini-1.5-flash, Gemini-1.5-pro

### MCP Server Configuration

Configure external tools and services through MCP servers:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-filesystem", "/path/to/workspace"],
      "env": {},
      "disabled": false
    },
    "brave-search": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-brave-search"],
      "env": {
        "BRAVE_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Keyboard Shortcuts

**Voice Recording:**
- **Hold Ctrl**: Press and hold to record, release to transcribe
- **Ctrl + /**: Press once to start, press again to stop

**MCP Agent Mode:**
- **Hold Ctrl+Alt**: Press and hold to record for agent mode
- **Ctrl+Alt + /**: Press once to start agent mode, press again to stop

**Text Input:**
- **Ctrl + T**: Open text input mode
- **Ctrl + Shift + T**: Alternative text input shortcut
- **Alt + T**: Alternative text input shortcut

**General:**
- **Escape**: Cancel current recording or close agent mode



## 🔧 API Configuration

### OpenAI Setup

1. Get API key from [OpenAI Platform](https://platform.openai.com/api-keys)
2. Add to SpeakMCP settings under "Providers" → "OpenAI"
3. Optional: Configure custom base URL for self-hosted endpoints
4. Select models for STT, LLM processing, and MCP tool calling

### Groq Setup

1. Get API key from [Groq Console](https://console.groq.com/keys)
2. Add to SpeakMCP settings under "Providers" → "Groq"
3. Configure STT prompt for better accuracy (optional)
4. Select models for fast processing and tool calling

### Google Gemini Setup

1. Get API key from [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Add to SpeakMCP settings under "Providers" → "Gemini"
3. Select appropriate model for post-processing and tool calling

### MCP Server Setup

1. **Install MCP Servers**: Use npm to install MCP-compatible servers
   ```bash
   npm install -g @modelcontextprotocol/server-filesystem
   npm install -g @modelcontextprotocol/server-brave-search
   ```

2. **Configure in Settings**: Add server configurations in SpeakMCP settings
   - Set command path (e.g., `npx` or full path)
   - Configure arguments and environment variables
   - Test connection to ensure proper setup

3. **Available MCP Servers**:
   - **Filesystem**: File operations and workspace management
   - **Brave Search**: Web search capabilities
   - **GitHub**: Repository management and code operations
   - **Slack**: Team communication and notifications
   - **Custom Servers**: Build your own MCP-compatible tools

## 🤖 MCP Integration & Agent Mode

### What is MCP?

The Model Context Protocol (MCP) is an open standard that enables AI assistants to securely connect to external tools and data sources. SpeakMCP implements a full MCP client that can connect to any MCP-compatible server.

### Agent Mode Features

**Intelligent Tool Execution:**
- Automatically determines which tools to use based on your voice input
- Executes multiple tools in sequence when needed
- Provides real-time progress feedback with step-by-step updates
- Handles errors gracefully with fallback strategies

**Real-time Progress Tracking:**
- Visual progress indicators showing current agent status
- Step-by-step breakdown of agent thinking and tool execution
- Tool call details with arguments and results
- Error handling and retry mechanisms

**Conversation Continuity:**
- Maintains context across multiple voice interactions
- Remembers previous tool results and conversation history
- Allows follow-up questions and iterative refinement
- Supports multi-turn dialogues with persistent state

### Example Use Cases

**File Management:**
- "Create a new project folder and add a README file"
- "Find all Python files in my workspace and show their sizes"
- "Backup my important documents to a new folder"

**Web Research:**
- "Search for the latest news about AI developments"
- "Find documentation for the React useEffect hook"
- "Look up the weather forecast for tomorrow"

**Development Tasks:**
- "Create a new Git branch and switch to it"
- "Run the test suite and show me any failures"
- "Deploy the latest changes to staging"

**Communication:**
- "Send a message to the team about the meeting delay"
- "Create a calendar event for next week's review"
- "Update the project status in our tracking system"

## 🚨 Troubleshooting

### Common Issues

**🎤 Microphone not working**
- Grant microphone permissions in system settings
- Check microphone access in SpeakMCP settings
- Restart application after granting permissions

**⌨️ Text not inserting**
- Enable accessibility permissions (macOS)
- Run as administrator (Windows)
- Check target application supports text input
- Verify focus restoration is working correctly

**🔧 MCP tools not working**
- Check MCP server configuration and paths
- Verify environment variables are set correctly
- Test server connection in settings
- Check logs for `spawn npx ENOENT` errors (PATH issues)

**🤖 Agent mode issues**
- Ensure MCP tools are enabled in settings
- Check that at least one MCP server is configured and connected
- Verify LLM provider supports structured output (OpenAI/Groq recommended)
- Check conversation history if context seems lost

**🌐 API errors**
- Verify API keys are correct
- Check internet connection for cloud providers
- Validate custom base URLs if configured
- Monitor rate limits and usage quotas

### Performance Optimization

**For Cloud APIs:**
- Use Groq for fastest cloud transcription and tool calling
- Configure custom prompts for better accuracy
- Enable post-processing for grammar correction

**For MCP Integration:**
- Use local MCP servers when possible for faster response times
- Configure appropriate timeouts for external services
- Enable agent mode for complex multi-step tasks

**For Conversations:**
- Set reasonable conversation history limits
- Use conversation management to organize different topics
- Clear old conversations periodically to maintain performance

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Workflow

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Make your changes and test thoroughly
4. Commit with conventional commits: `git commit -m "feat: add amazing feature"`
5. Push to your fork: `git push origin feature/amazing-feature`
6. Open a Pull Request

### Areas for Contribution

- 🐛 Bug fixes and stability improvements
- ✨ New features and enhancements
- 🔧 New MCP server integrations
- 🤖 Agent mode improvements and optimizations
- 📚 Documentation improvements
- 🧪 Test coverage expansion (see `docs/MCP_TESTING.md`)
- 🌍 Internationalization support
- 🎨 UI/UX improvements
- 🔒 Security enhancements
- ⚡ Performance optimizations

## 📄 License

This project is licensed under the [AGPL-3.0 License](./LICENSE).

## 🙏 Acknowledgments

- [OpenAI](https://openai.com/) for Whisper speech recognition and GPT models
- [Anthropic](https://anthropic.com/) for Claude and MCP protocol development
- [Model Context Protocol](https://modelcontextprotocol.io/) for the extensible tool integration standard
- [Electron](https://electronjs.org/) for cross-platform desktop framework
- [React](https://reactjs.org/) for the user interface
- [Rust](https://rust-lang.org/) for system-level integration
- [Groq](https://groq.com/) for fast inference capabilities
- [Google](https://ai.google.dev/) for Gemini models

---

**Made with ❤️ by the SpeakMCP team**
