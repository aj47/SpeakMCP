# Claude Code Compatibility

This file provides Claude-specific context for the SpeakMCP project.

## Project Context

SpeakMCP is a voice-enabled interface for Model Context Protocol (MCP) servers, built as a cross-platform Electron application.

## Architecture Overview

### Frontend (Electron Renderer)
- **Framework**: React with TypeScript
- **Styling**: Tailwind CSS
- **State Management**: React hooks and context
- **Voice Integration**: Web Speech API, LiveKit

### Backend (Electron Main + Rust)
- **Main Process**: Node.js/Electron for system integration
- **Core Logic**: Rust (speakmcp-rs) for performance-critical operations
- **IPC**: Electron's inter-process communication

### Key Components

1. **Voice Processing**: Real-time speech-to-text and text-to-speech
2. **MCP Integration**: Communication with MCP servers
3. **UI Components**: React components for voice interface
4. **System Integration**: Desktop notifications, tray icons

## Development Workflow

### Setup
```bash
npm install
cd speakmcp-rs && cargo build
npm run dev
```

### Testing
```bash
npm test
cargo test --manifest-path speakmcp-rs/Cargo.toml
```

### Building
```bash
npm run build
npm run dist
```

## Code Patterns

- Use TypeScript for type safety
- Follow React functional component patterns
- Implement proper error handling for voice operations
- Use Rust for CPU-intensive operations
- Maintain security boundaries between processes

## Important Files

- `src/main/index.ts` - Electron main process entry
- `src/renderer/App.tsx` - Main React application
- `speakmcp-rs/src/lib.rs` - Rust core functionality
- `electron.vite.config.ts` - Build configuration

## Security Considerations

- Validate all IPC messages
- Sanitize voice input before processing
- Follow Electron security best practices
- Implement proper error boundaries
