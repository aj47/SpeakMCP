[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL%203.0-blue.svg)](./LICENSE)
[![Electron](https://img.shields.io/badge/Electron-31.0.2-47848f.svg)](https://electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6.3-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.3.1-61dafb.svg)](https://reactjs.org/)

## 🎬 Preview
v1.4
<img width="1341" height="1174" alt="image" src="https://github.com/user-attachments/assets/4ea2fa66-9a22-4d56-b388-457dfc99fed6" />

[Click here to see v1 launch video on youtube ](https://www.youtube.com/watch?v=A4oKYCaeaaw)
<img width="2050" height="1564" alt="image" src="https://github.com/user-attachments/assets/a1e55c53-838f-414f-92e7-d752f74e7107" />

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

| Category | Capabilities |
|----------|--------------|
| **🎤 Voice** | Hold-to-record, 30+ languages, Fn toggle mode, auto-insert to any app |
| **🔊 TTS** | 50+ AI voices via OpenAI, Groq, and Gemini with auto-play |
| **🤖 MCP Agent** | Tool execution, OAuth 2.1 auth, real-time progress, conversation context |
| **📊 Observability** | [Langfuse](https://langfuse.com/) integration for LLM tracing, token usage, and debugging |
| **🛠️ Platform** | macOS/Windows/Linux, rate limit handling, multi-provider AI |
| **🎨 UX** | Dark/light themes, resizable panels, kill switch, conversation history |

## 🛠️ Development

```bash
git clone https://github.com/aj47/SpeakMCP.git && cd SpeakMCP
pnpm install && pnpm build-rs && pnpm dev
```

See **[DEVELOPMENT.md](DEVELOPMENT.md)** for full setup, build commands, troubleshooting, and architecture details.

## ⚙️ Configuration

**AI Providers** — Configure in settings:
- OpenAI, Groq, or Google Gemini API keys
- Model selection per provider
- Custom base URLs (optional)

**MCP Servers** — Add tools in `mcpServers` JSON format:
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
    }
  }
}
```

**Keyboard Shortcuts**:

| Shortcut | Action |
|----------|--------|
| Hold `Ctrl` / `Ctrl+/` (Win) | Voice recording |
| `Fn` | Toggle dictation on/off |
| Hold `Ctrl+Alt` | MCP agent mode (macOS) |
| `Ctrl+T` / `Ctrl+Shift+T` (Win) | Text input |
| `Ctrl+Shift+Escape` | Kill switch |

## 🤝 Contributing

We welcome contributions! Fork the repo, create a feature branch, and open a Pull Request.

**💬 Get help on [Discord](https://discord.gg/cK9WeQ7jPq)** | **🌐 More info at [techfren.net](https://techfren.net)**

## 📄 License

This project is licensed under the [AGPL-3.0 License](./LICENSE).

## 🙏 Acknowledgments

Built on [Whispo](https://github.com/egoist/whispo) • Powered by [OpenAI](https://openai.com/), [Anthropic](https://anthropic.com/), [Groq](https://groq.com/), [Google](https://ai.google.dev/) • [MCP](https://modelcontextprotocol.io/) • [Electron](https://electronjs.org/) • [React](https://reactjs.org/) • [Rust](https://rust-lang.org/)

---

**Made with ❤️ by the SpeakMCP team**
