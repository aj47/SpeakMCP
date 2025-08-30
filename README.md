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

**Cross-Platform Support**: macOS (Apple Silicon & Intel), Windows (x64), Linux (x64)

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

### 🎤 Voice & Speech
- **Voice-to-Text**: Hold `Ctrl` to record, release to transcribe
- **Toggle Voice Dictation**: Press `Fn` key to start/stop recording (configurable)
- **Multi-Language Support**: 39 languages with auto-detection (see [Supported Languages](#-supported-languages) below)
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
- **Debug Modes**: Comprehensive logging for LLM calls, tool execution, and TTS
- **Universal Integration**: Works with any text-input application

### 🎨 User Experience
- **Text Input**: Press `Ctrl+T` for direct text input mode
- **Dark/Light Themes**: Toggle between dark and light modes
- **Resizable Panels**: Drag-to-resize interface components
- **Kill Switch**: Emergency stop for agent operations (`Escape` key)
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
pnpm test:tts     # Test TTS functionality
```

## ⚙️ Configuration

**AI Providers**: OpenAI, Groq, Google Gemini
- Configure API keys and custom base URLs in settings
- Select specific models for each provider
- Multi-language speech recognition support (39 languages)
- TTS with 50+ voices across providers
- Language auto-detection or manual selection per provider

**MCP Servers**: Configure tools in `mcpServers` JSON format:
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-filesystem", "/path"]
    },
    "web-search": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-web-search"],
      "env": {"BRAVE_API_KEY": "your-key"}
    }
  }
}
```

**Keyboard Shortcuts**:
- **Hold Ctrl**: Voice recording (traditional mode)
- **Fn Key**: Toggle voice dictation (press once to start/stop)
- **Hold Ctrl+Alt**: MCP agent mode
- **Ctrl+T**: Text input mode
- **Escape**: Cancel/kill switch for operations

## 🌍 Supported Languages

SpeakMCP supports **39 languages** for speech recognition with automatic language detection. All languages are supported by both OpenAI Whisper and Groq Whisper providers.

### Available Languages

| Language | Native Name | Code |
|----------|-------------|------|
| **Auto-detect** | Auto-detect | `auto` |
| Arabic | العربية | `ar` |
| Bulgarian | Български | `bg` |
| Chinese | 中文 | `zh` |
| Croatian | Hrvatski | `hr` |
| Czech | Čeština | `cs` |
| Danish | Dansk | `da` |
| Dutch | Nederlands | `nl` |
| English | English | `en` |
| Estonian | Eesti | `et` |
| Finnish | Suomi | `fi` |
| French | Français | `fr` |
| German | Deutsch | `de` |
| Greek | Ελληνικά | `el` |
| Hebrew | עברית | `he` |
| Hindi | हिन्दी | `hi` |
| Hungarian | Magyar | `hu` |
| Indonesian | Bahasa Indonesia | `id` |
| Italian | Italiano | `it` |
| Japanese | 日本語 | `ja` |
| Korean | 한국어 | `ko` |
| Latvian | Latviešu | `lv` |
| Lithuanian | Lietuvių | `lt` |
| Malay | Bahasa Melayu | `ms` |
| Maltese | Malti | `mt` |
| Norwegian | Norsk | `no` |
| Polish | Polski | `pl` |
| Portuguese | Português | `pt` |
| Romanian | Română | `ro` |
| Russian | Русский | `ru` |
| Serbian | Српски | `sr` |
| Slovak | Slovenčina | `sk` |
| Slovenian | Slovenščina | `sl` |
| Spanish | Español | `es` |
| Swedish | Svenska | `sv` |
| Thai | ไทย | `th` |
| Turkish | Türkçe | `tr` |
| Ukrainian | Українська | `uk` |
| Vietnamese | Tiếng Việt | `vi` |

### Language Configuration

- **Auto-detection**: Set to "Auto-detect" to let the AI determine the language automatically
- **Provider-specific**: Configure different languages for OpenAI and Groq providers
- **Global setting**: Set a default language that applies to all speech recognition
- **Per-provider override**: Override the global language setting for specific providers

## 🤖 MCP Agent Mode

**MCP (Model Context Protocol)** enables AI assistants to connect to external tools. SpeakMCP implements a full MCP client with advanced capabilities.

**Enhanced Features**:
- **Intelligent Tool Selection**: Automatically determines which tools to use
- **Real-time Progress**: Visual feedback with TTS narration during execution
- **Conversation Continuity**: Context preservation across multi-turn interactions
- **OAuth 2.1 Integration**: Secure authentication for MCP servers
- **Rate Limit Handling**: Automatic retry with exponential backoff
- **Kill Switch**: Emergency stop functionality with `Escape` key
- **Tool Management**: Per-server tool toggles and approval prompts

**Example commands**:
- "Create a new project folder and add a README"
- "Search for latest AI news and summarize the top 3 articles"
- "Send a message to the team about today's progress"
- "Analyze this codebase and suggest improvements"

## 🆕 What's New

**Recent Major Features**:

### 🎵 Text-to-Speech (TTS) Integration
- **50+ AI Voices**: OpenAI (6 voices), Groq (23 voices), Gemini (30+ voices)
- **Auto-Play**: Seamless conversation flow with automatic speech playback
- **Smart Preprocessing**: Converts code blocks, URLs, and markdown to natural speech
- **Multi-Language**: Support for 39 languages with native pronunciation

### 🖥️ Cross-Platform Support
- **Windows Build**: Full Windows compatibility with native builds
- **Enhanced macOS**: Apple Silicon and Intel support
- **Linux Ready**: Complete Linux build pipeline

### 🎛️ Enhanced Voice Controls
- **Toggle Voice Dictation**: Press `Fn` key to start/stop recording
- **Multi-Language Recognition**: 39 languages with automatic detection
- **Configurable Hotkeys**: Customize keyboard shortcuts for all functions

### 🔧 Reliability & Performance
- **Rate Limit Handling**: Automatic retry with exponential backoff for API limits
- **OAuth 2.1**: Secure authentication for MCP servers with deep link integration
- **Kill Switch**: Emergency stop functionality for all operations
- **Model Selection**: Choose specific AI models for each provider

## 🐛 Debug Mode

For development and troubleshooting, SpeakMCP includes comprehensive debug logging:

```bash
# Enable all debug modes
pnpm dev d               # Shortest option
pnpm dev debug-all       # Readable format

# Enable specific modes
pnpm dev debug-llm       # LLM calls and responses
pnpm dev debug-tools     # MCP tool execution
pnpm dev debug-tts       # Text-to-speech debugging
```

## 🤝 Contributing

We welcome contributions! Fork the repo, create a feature branch, and open a Pull Request.

**💬 Get help on [Discord](https://discord.gg/naGJHsKc)** | **🌐 More info at [techfren.net](https://techfren.net)**

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
