# SpeakMCP v1.2.0 - Mobile Settings, MCP Registry & Code Quality

**Released**: December 2025

## 🎯 Major Features

### 📱 Mobile Settings Management (#744)
- **Profile Switching** - Switch between profiles directly from mobile app
- **MCP Server Management** - View connection status and enable/disable servers remotely
- **Feature Toggles** - Control post-processing, TTS, and tool approval from mobile
- **Pull-to-Refresh** - Sync settings with desktop in real-time
- New API endpoints: `/v1/profiles`, `/v1/mcp/servers`, `/v1/settings`

### 🔍 MCP Registry Integration (#785)
- **Official Registry Browser** - Discover 100+ MCP servers from the official registry
- **One-Click Installation** - Add servers with a single click
- **Smart Search** - Find servers by name and description
- **Server Type Badges** - npm, PyPI, Docker, Remote server indicators
- **5-Minute Caching** - Reduced API calls for better performance

### 📤 Enhanced Profile Export/Import (#772)
- **MCP Server Definitions** - Export now includes all enabled MCP server configurations
- **Model Settings** - Export includes model configuration settings
- **Smart Import** - Merges MCP definitions without overwriting existing config
- **Easy Sharing** - Share complete profiles with team members

## 🚀 Performance & UX Improvements

### Recording Latency Reduction (#734)
- **250ms faster** - Reduced hold-to-record delay from 800ms → 250ms
- **Overlapped initialization** - Start recording before showing panel UI
- **Snappier response** - Faster feedback when holding Ctrl

### Mobile Text Interaction (#735)
- **Expandable/Collapsible Text** - Tap anywhere on collapsed text to expand
- **Selectable Content** - Copy LLM responses and tool parameters
- **Better Tool Cards** - Larger tap targets for expanding tool results
- **Visual Feedback** - Pressed states for better UX

### Session Management (#739, #740)
- **Always-Visible Start Buttons** - Start new sessions anytime, even with active sessions
- **Queueable Voice Input** - Record voice messages during agent processing
- **Message Queuing** - Transcripts queue automatically when agent is busy

### UI Polish (#733, #738)
- **Stop Sign Icon** - Changed kill switch from X to OctagonX for clarity
- **Collapsed Servers** - MCP servers collapsed by default for cleaner UI
- **Kill Switch in Follow-ups** - Stop button now in follow-up input panels

## 🔧 Code Quality & Maintenance

### LLM Code Consolidation (#781)
- **Removed structured-output.ts** - Consolidated unused code (~285 LOC reduction)
- **Moved makeStructuredContextExtraction** - Relocated to llm-fetch.ts

### Testing Infrastructure (#770)
- **E2E Tests** - Playwright tests for Electron with custom fixtures
- **Smoke Tests** - App launch and basic navigation tests
- **Settings Tests** - Configuration and provider testing
- **MCP Tests** - Server management and session tests
- **CI Integration** - GitHub Actions workflow for automated testing

### Refactoring Issue Templates (#745)
- Created 9 detailed issue templates for future refactoring work
- Includes proposals for tipc.ts, mcp-service.ts, keyboard.ts modularization

## 🐛 Bug Fixes

### LLM & Provider
- **Empty Response Handling** (#793) - Fixed false "Network error" for valid empty completions
- **Provider Name Display** (#737) - Show actual preset name (OpenRouter, Together AI) instead of generic "OpenAI"
- **Groq TTS Update** (#784) - Updated to Orpheus models (PlayAI deprecated)

### Mobile & Desktop
- **Disabled Server Tools** (#743) - Hide tools from disabled MCP servers
- **JSX Nesting** (#728) - Fixed parse errors in MCP config manager
- **Tunnel Persistence** (#722) - Auto-reconnect mobile app on restart with stable device ID

### UI/UX
- **Tool Collapse** (#713) - Collapsible server groups in Tools section with state persistence
- **Mic Button** (#732) - Mic clickable during agent processing with message queuing

## 📊 Stats

- **25+ PRs merged** since v1.1.0
- **E2E testing infrastructure** - New Playwright test suite
- **Improved mobile experience** - Settings management, text selection, tunnel persistence

## 🔄 Migration Notes

- **No breaking changes** - All existing functionality preserved
- **Automatic migration** - Settings and data migrate seamlessly
- **New features opt-in** - All new features work with existing configurations
- **Backward compatible** - Existing API endpoints and data structures unchanged

## 📥 Downloads

**Cross-Platform Support:** macOS (Apple Silicon & Intel), Windows, Linux, Android, iOS

### macOS Builds
- **DMG**: `SpeakMCP-1.2.0-arm64.dmg` | `SpeakMCP-1.2.0-x64.dmg`
- **PKG**: `SpeakMCP-1.2.0-arm64.pkg` | `SpeakMCP-1.2.0-x64.pkg`
- **ZIP**: `SpeakMCP-1.2.0-arm64.zip` | `SpeakMCP-1.2.0-x64.zip`

[📥 Download Latest Release](https://github.com/aj47/SpeakMCP/releases/latest)

## 🙏 Acknowledgments

Thanks to all contributors and users who provided feedback!

**Full Changelog**: https://github.com/aj47/SpeakMCP/compare/v1.1.0...v1.2.0

---

**License**: AGPL-3.0

