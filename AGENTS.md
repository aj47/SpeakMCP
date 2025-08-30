# Agent Compatibility

This file is automatically loaded by AI agents to understand the project structure and guidelines.

## Project Overview

SpeakMCP is an Electron-based application that provides a voice interface for Model Context Protocol (MCP) servers.

## Key Technologies

- **Frontend**: Electron, React, TypeScript, Tailwind CSS
- **Backend**: Rust (speakmcp-rs), Node.js
- **Voice Processing**: LiveKit, Web Speech API
- **Build System**: Vite, electron-builder

## Project Structure

```
├── src/                    # Main application source
│   ├── main/              # Electron main process
│   ├── renderer/          # React frontend
│   ├── preload/           # Electron preload scripts
│   └── shared/            # Shared utilities
├── speakmcp-rs/           # Rust backend components
├── resources/             # Application resources
├── build/                 # Build configuration
└── scripts/               # Build and deployment scripts
```

## Development Guidelines

1. **Code Style**: Follow TypeScript/React best practices
2. **Testing**: Write tests for new features
3. **Documentation**: Update relevant docs when making changes
4. **Security**: Follow Electron security best practices

## Common Tasks

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run test` - Run tests
- `npm run lint` - Run linting

## Important Notes

- This is a cross-platform desktop application
- Voice processing happens in real-time
- MCP server integration is core functionality
- Security is critical for desktop applications
