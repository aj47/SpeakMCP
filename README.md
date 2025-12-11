# SpeakMCP

Voice-powered AI assistant with MCP tool integration.

https://github.com/user-attachments/assets/0c181c70-d1f1-4c5d-a6f5-a73147e75182

## Download

**[📥 Latest Release](https://github.com/aj47/SpeakMCP/releases/latest)** (macOS)

## Usage

| Action | Shortcut |
|--------|----------|
| Voice recording | Hold `Ctrl` |
| MCP agent mode | Hold `Ctrl+Alt` |
| Text input | `Ctrl+T` |
| Kill switch | `Ctrl+Shift+Escape` |

## Development

```bash
git clone https://github.com/aj47/SpeakMCP.git
cd SpeakMCP
pnpm install
pnpm build-rs
pnpm dev
```

## MCP Configuration

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

## License

[AGPL-3.0](./LICENSE) • Fork of [Whispo](https://github.com/egoist/whispo)
