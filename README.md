# SpeakMCP

🎤 **AI-powered voice assistant with MCP integration** - A fork of [Whispo](https://github.com/whispo/whispo) that transforms your voice into intelligent actions with advanced speech recognition, LLM processing, and Model Context Protocol (MCP) tool execution.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%203.0-blue.svg)](./LICENSE)
[![Electron](https://img.shields.io/badge/Electron-31.0.2-47848f.svg)](https://electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6.3-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.3.1-61dafb.svg)](https://reactjs.org/)

## 🎬 Preview

https://github.com/user-attachments/assets/0c181c70-d1f1-4c5d-a6f5-a73147e75182

## 🚀 Quick Start

### Download

Currently building for **macOS (Apple Silicon)**

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



## ✨ Features

- **Voice-to-Text**: Hold `Ctrl` to record, release to transcribe
- **MCP Agent Mode**: Hold `Ctrl+Alt` for intelligent tool execution
- **Text Input**: Press `Ctrl+T` for direct text input
- **Universal Integration**: Works with any text-input application
- **AI Processing**: OpenAI/Groq for speech recognition, multiple LLM providers
- **MCP Integration**: Connect to any MCP-compatible tools and services
- **Real-time Feedback**: Visual progress tracking during agent execution

## 🏗️ Architecture

Built with Electron + Rust for cross-platform compatibility:
- **Electron**: Main process for system integration and MCP orchestration
- **React**: UI for real-time progress and conversation management
- **Rust**: Low-level keyboard monitoring and text injection
- **MCP Client**: Connects to any MCP-compatible tools and services

## 🛠️ Development

**Prerequisites**: Node.js 18+, pnpm, Rust toolchain

```bash
# Setup
git clone https://github.com/aj47/SpeakMCP.git
cd SpeakMCP
pnpm install
pnpm build-rs  # Build Rust binary
pnpm dev       # Start development server

# Build commands
pnpm build        # Production build
pnpm build:mac    # macOS build
pnpm build:win    # Windows build
pnpm build:linux  # Linux build

# Debug (optional) - Multiple convenient options!
pnpm dev d               # Enable all debug logs (shortest!)
pnpm dev debug-llm       # Enable LLM debug only
pnpm dev dl              # Enable LLM debug (short)
pnpm dev dt              # Enable tools debug (short)
pnpm dev -- --debug-all  # Traditional format
```

## ⚙️ Configuration

**Providers**: OpenAI, Groq, Google Gemini (configure API keys in settings)

**MCP Servers**: Configure tools in `mcpServers` JSON format:
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-filesystem", "/path"]
    }
  }
}
```

**Keyboard Shortcuts**:
- **Hold Ctrl**: Voice recording
- **Hold Ctrl+Alt**: MCP agent mode
- **Ctrl+T**: Text input mode
- **Escape**: Cancel current action

## 🤖 MCP Agent Mode

**MCP (Model Context Protocol)** enables AI assistants to connect to external tools. SpeakMCP implements a full MCP client for intelligent tool execution.

**Features**:
- **Intelligent Tool Selection**: Automatically determines which tools to use
- **Real-time Progress**: Visual feedback during tool execution
- **Conversation Continuity**: Maintains context across interactions

**Example commands**:
- "Create a new project folder and add a README"
- "Search for latest AI news"
- "Send a message to the team"

## 🐛 Debug Mode

SpeakMCP includes comprehensive debug logging to help troubleshoot issues and understand system behavior.

### Quick Debug Commands

**Enable all debug modes (recommended):**
```bash
pnpm dev d               # Shortest - just one letter!
pnpm dev debug-all       # Readable format
```

**Enable specific debug modes:**
```bash
pnpm dev debug-llm       # LLM calls and responses
pnpm dev debug-tools     # MCP tool execution
pnpm dev debug-keybinds  # Keyboard event handling
pnpm dev dl              # LLM debug (short)
pnpm dev dt              # Tools debug (short)
pnpm dev dk              # Keybinds debug (short)
```

**Traditional format (with dashes):**
```bash
pnpm dev -- --debug-all
pnpm dev -- --debug-llm
pnpm dev -- -d           # Short with dashes
```

**Environment variables:**
```bash
DEBUG=* pnpm dev         # Enable all
DEBUG_LLM=true pnpm dev  # LLM only
DEBUG=llm,tools pnpm dev # Multiple modes
```

### Debug Output

When debug modes are enabled, you'll see detailed logs:

**LLM Debug (`debug-llm` or `dl`):**
- Request messages sent to LLM providers
- Response content and structured output
- Token usage and timing information
- Error details for failed calls

**Tools Debug (`debug-tools` or `dt`):**
- MCP server connection status
- Tool discovery and registration
- Tool execution requests and responses
- Error handling and retry logic

**Keybinds Debug (`debug-keybinds` or `dk`):**
- Keyboard event capture and processing
- Hotkey activation and release
- Focus management and text insertion

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

We welcome contributions! Fork the repo, create a feature branch, and open a Pull Request.

**💬 Get help on [Discord](https://discord.gg/naGJHsKc)** | **🌐 More info at [techfren.net](https://techfren.net)**

## 📄 License

This project is licensed under the [AGPL-3.0 License](./LICENSE).

## 🙏 Acknowledgments

- **[Whispo](https://github.com/whispo/whispo)** - This project is a fork of Whispo, the original AI voice assistant
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
