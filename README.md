# SpeakMCP

🎤 **AI-powered voice assistant with MCP integration** - A fork of [Whispo](https://github.com/egoist/whispo) that transforms your voice into intelligent actions with advanced speech recognition, LLM processing, and Model Context Protocol (MCP) tool execution.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%203.0-blue.svg)](./LICENSE)
[![Electron](https://img.shields.io/badge/Electron-31.0.2-47848f.svg)](https://electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6.3-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.3.1-61dafb.svg)](https://reactjs.org/)

## 🎬 Preview

https://github.com/user-attachments/assets/0c181c70-d1f1-4c5d-a6f5-a73147e75182

## 🚀 Quick Start

### Download

**[📥 Download Latest Release](https://github.com/aj47/SpeakMCP/releases/latest)**

> **Platform Support**: macOS (Apple Silicon & Intel) with full MCP agent functionality.
> ⚠️ **Windows/Linux**: MCP tools not currently supported — see [v0.2.2](https://github.com/aj47/SpeakMCP/releases/tag/v0.2.2) for dictation-only builds.

### Basic Usage

**Voice Recording:**

1. **Hold `Ctrl`** (macOS/Linux) or **`Ctrl+/`** (Windows) to start recording
2. **Release** to stop recording and transcribe
3. Text is automatically inserted into your active application

**MCP Agent Mode** (macOS only):

1. **Hold `Ctrl+Alt`** to start recording for agent mode
2. **Release `Ctrl+Alt`** to process with MCP tools
3. Watch real-time progress as the agent executes tools
4. Results are automatically inserted or displayed

**Text Input:**

- **`Ctrl+T`** (macOS/Linux) or **`Ctrl+Shift+T`** (Windows) for direct typing



## ✨ Features

### 🎤 Voice & Speech
- **Voice-to-Text**: Hold `Ctrl` (macOS/Linux) or `Ctrl+/` (Windows) to record
- **Toggle Voice Dictation**: Press `Fn` key to start/stop recording (configurable)
- **Multi-Language Support**: 30+ languages including Spanish, French, German, Chinese, Japanese, Arabic, Hindi
- **Text-to-Speech (TTS)**: AI-generated speech with 50+ voices across OpenAI, Groq, and Gemini
- **Auto-Play TTS**: Automatic speech playback for seamless conversations

### 🤖 AI Agent & MCP
- **MCP Agent Mode**: Hold `Ctrl+Alt` for intelligent tool execution with real-time progress
- **MCP Integration**: Connect to any MCP-compatible tools and services
- **OAuth 2.1 Support**: Secure authentication for MCP servers with deep link integration
- **Tool Management**: Per-server tool toggles and approval prompts
- **Conversation Continuity**: Context preservation across agent interactions

### 🛠️ Platform & Performance
- **Cross-Platform**: macOS, Windows, and Linux support with native builds
- **Rate Limit Handling**: Exponential backoff retry for API rate limits (429 errors)
- **Model Selection**: Choose specific models for OpenAI, Groq, and Gemini providers
- **Debug Modes**: Comprehensive logging for LLM calls and tool execution
- **Universal Integration**: Works with any text-input application

### 🎨 User Experience
- **Text Input**: `Ctrl+T` (macOS/Linux) or `Ctrl+Shift+T` (Windows) for direct input
- **Dark/Light Themes**: Toggle between dark and light modes
- **Resizable Panels**: Drag-to-resize interface components
- **Kill Switch**: Emergency stop for agent operations (`Ctrl+Shift+Escape`)
- **Conversation Management**: Full conversation history with tool call visualization

## 🏗️ Architecture

Built with modern technologies for cross-platform performance:
- **Electron**: Main process for system integration, MCP orchestration, and TTS processing
- **React + TypeScript**: Modern UI with real-time progress tracking and conversation management
- **Rust**: High-performance keyboard monitoring and text injection across platforms
- **MCP Client**: Full Model Context Protocol implementation with OAuth 2.1 support
- **Multi-Provider AI**: OpenAI, Groq, and Gemini integration for speech, text, and TTS

## 🛠️ Development

**Prerequisites**: Node.js 18+, pnpm, Rust toolchain

> ⚠️ **Important**: This project uses **pnpm** as its package manager. Using npm or yarn may cause installation issues, especially with Electron binaries. If you don't have pnpm installed:
> ```bash
> npm install -g pnpm
> ```

```bash
# Setup
git clone https://github.com/aj47/SpeakMCP.git
cd SpeakMCP
pnpm install
pnpm build-rs  # Build Rust binary for your platform
pnpm dev       # Start development server

# Platform-specific builds
pnpm build        # Production build for current platform
pnpm build:mac    # macOS build (Apple Silicon + Intel)
pnpm build:win    # Windows build (x64)
pnpm build:linux  # Linux build (x64)

# Testing
pnpm test         # Run test suite
pnpm test:run     # Run tests once (CI mode)
pnpm test:coverage # Run tests with coverage
```

### 🔧 Troubleshooting Development Setup

**"Electron uninstall" error when running `pnpm dev`:**

This usually means Electron binaries weren't installed correctly. Fix it by:

```bash
# Clean install with pnpm
rm -rf node_modules
pnpm install
```

**Multiple lock files (package-lock.json, pnpm-lock.yaml, bun.lock):**

If you have multiple lock files, you've mixed package managers. Clean up:

```bash
# Remove all lock files except pnpm's
rm -f package-lock.json bun.lock
rm -rf node_modules
pnpm install
```

**Windows: "not a valid Win32 application" during postinstall:**

If you see this error when running `pnpm install`:
```
%1 is not a valid Win32 application
```

This is caused by electron-builder attempting to execute `pnpm.cjs` directly. Try the manual workaround:

```powershell
pnpm install --ignore-scripts
pnpm.cmd -C apps/desktop exec electron-builder install-app-deps
```

**Node version mismatch:**

This project works best with Node.js 18-20. Check your version:

```bash
node --version  # Should be v18.x, v19.x, or v20.x
```

If using nvm, switch to the recommended version:

```bash
nvm use 20
```

## ⚙️ Configuration

**AI Providers**: OpenAI, Groq, Google Gemini
- Configure API keys and custom base URLs in settings
- Select specific models for each provider
- Multi-language speech recognition support
- TTS with 50+ voices across providers

**MCP Servers**: Configure tools in `mcpServers` JSON format:
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
    },
    "web-search": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-web-search"],
      "env": {"BRAVE_API_KEY": "your-key"}
    }
  }
}
```

**Keyboard Shortcuts**:
- **Hold Ctrl** (macOS/Linux) / **Ctrl+/** (Windows): Voice recording
- **Fn Key**: Toggle voice dictation (press once to start/stop)
- **Hold Ctrl+Alt**: MCP agent mode (macOS only)
- **Ctrl+T** (macOS/Linux) / **Ctrl+Shift+T** (Windows): Text input mode
- **Ctrl+Shift+Escape**: Kill switch for agent operations

## 🤖 MCP Agent Mode

**MCP (Model Context Protocol)** enables AI assistants to connect to external tools. SpeakMCP implements a full MCP client with advanced capabilities.

**Enhanced Features**:
- **Intelligent Tool Selection**: Automatically determines which tools to use
- **Real-time Progress**: Visual feedback with TTS narration during execution
- **Conversation Continuity**: Context preservation across multi-turn interactions
- **OAuth 2.1 Integration**: Secure authentication for MCP servers
- **Rate Limit Handling**: Automatic retry with exponential backoff
- **Kill Switch**: Emergency stop functionality with `Ctrl+Shift+Escape`
- **Tool Management**: Per-server tool toggles and approval prompts

**Example commands**:
- "Create a new project folder and add a README"
- "Search for latest AI news and summarize the top 3 articles"
- "Send a message to the team about today's progress"
- "Analyze this codebase and suggest improvements"

## 🐛 Debug Mode

For development and troubleshooting, SpeakMCP includes comprehensive debug logging:

```bash
# Enable all debug modes
pnpm dev d               # Shortest option
pnpm dev debug-all       # Readable format

# Enable specific modes
pnpm dev debug-llm       # LLM calls and responses
pnpm dev debug-tools     # MCP tool execution
pnpm dev debug-ui        # UI focus, renders, and state changes
```

See [DEBUGGING.md](DEBUGGING.md) for detailed debugging instructions.

## 🤝 Contributing

We welcome contributions! Fork the repo, create a feature branch, and open a Pull Request.

**💬 Get help on [Discord](https://discord.gg/cK9WeQ7jPq)** | **🌐 More info at [techfren.net](https://techfren.net)**

## 📄 License

This project is licensed under the [AGPL-3.0 License](./LICENSE).

## 🙏 Acknowledgments

- **[Whispo](https://github.com/egoist/whispo)** - This project is a fork of Whispo, the original AI voice assistant
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
