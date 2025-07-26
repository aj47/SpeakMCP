# SpeakMCP IPC Architecture

This document provides a comprehensive overview of the Inter-Process Communication (IPC) architecture in SpeakMCP, detailing how different components communicate and coordinate to deliver the application's functionality.

## Overview

SpeakMCP uses a sophisticated multi-process architecture with several communication layers:

1. **TIPC (Type-safe IPC)** - Primary communication between Electron main and renderer processes
2. **Rust Binary Communication** - Low-level keyboard monitoring and text injection
3. **MCP Protocol** - Communication with external Model Context Protocol servers
4. **Event-driven Updates** - Real-time progress and state synchronization

## Architecture Components

### 1. Electron Main Process (`src/main/`)

The main process serves as the central coordinator and handles:

- **System Integration**: Keyboard events, window management, system permissions
- **API Communication**: LLM providers (OpenAI, Groq), audio transcription
- **MCP Orchestration**: Managing connections to external tool servers
- **Agent Engine**: Iterative tool calling and decision making
- **Data Persistence**: Conversation history and configuration storage

Key files:
- `main/index.ts` - Application entry point and initialization
- `main/tipc.ts` - TIPC router with all API endpoints
- `main/keyboard.ts` - Keyboard event handling and Rust binary communication
- `main/window.ts` - Window management and positioning
- `main/mcp-service.ts` - MCP client and tool execution
- `main/llm.ts` - Agent engine and LLM processing

### 2. Renderer Process (`src/renderer/`)

The renderer process provides the user interface and handles:

- **React Application**: Modern UI with real-time updates
- **Progress Tracking**: Live agent progress visualization
- **User Interactions**: Settings, conversation management, tool configuration
- **Recording Interface**: Audio recording and visualization

Key files:
- `renderer/lib/tipc-client.ts` - TIPC client for main process communication
- `renderer/components/agent-progress.tsx` - Real-time progress display
- `renderer/pages/panel.tsx` - Recording and agent interface
- `renderer/contexts/conversation-context.tsx` - Conversation state management

### 3. Preload Script (`src/preload/`)

The preload script acts as a secure bridge:

- **Context Bridge**: Safely exposes Electron APIs to renderer
- **Security Layer**: Prevents direct Node.js access from renderer
- **API Exposure**: Makes `ipcRenderer` available for TIPC communication

### 4. Rust Binary (`speakmcp-rs/`)

The Rust binary provides low-level system integration:

- **Keyboard Monitoring**: Global hotkey detection (Ctrl+Alt+\)
- **Text Injection**: Cross-platform text insertion
- **Focus Management**: Application focus tracking

## Communication Patterns

### TIPC (Type-safe IPC)

TIPC provides the primary communication layer between main and renderer processes with full TypeScript type safety.

#### Request-Response Pattern
```typescript
// Renderer side (tipc-client.ts)
const result = await tipcClient.processRecording({
  recording: audioData,
  duration: recordingDuration
})

// Main side (tipc.ts)
processRecording: t.procedure
  .input<{ recording: ArrayBuffer; duration: number }>()
  .action(async ({ input }) => {
    // Process audio and return result
    return processedResult
  })
```

#### Event Emission Pattern
```typescript
// Main side - emit events to renderer
const handlers = getRendererHandlers<RendererHandlers>(webContents)
handlers.agentProgressUpdate.send(progressUpdate)

// Renderer side - listen for events
useEffect(() => {
  const unlisten = rendererHandlers.agentProgressUpdate.listen((update) => {
    setAgentProgress(update)
  })
  return unlisten
}, [])
```

### Keyboard Event Flow

1. **User Input**: User presses Ctrl+Alt+\ (or other configured hotkey)
2. **Rust Detection**: Rust binary detects keypress and outputs JSON event
3. **Main Process**: `keyboard.ts` reads JSON from Rust binary's stdout
4. **Event Processing**: Determines action based on current state
5. **Window Management**: Shows/hides panel window as needed
6. **Renderer Notification**: Sends events to renderer for UI updates

```typescript
// Keyboard event processing
function handleKeyboardEvent(event: RdevEvent) {
  if (isRecordingHotkey(event)) {
    if (state.isRecording) {
      stopRecordingAndHidePanelWindow()
    } else {
      showPanelWindowAndStartRecording()
    }
  }
}
```

### Agent Progress Updates

Real-time progress updates during agent execution:

1. **Agent Engine**: `llm.ts` processes user request with iterative tool calling
2. **Progress Emission**: Each step emits progress updates via `emitAgentProgress()`
3. **Renderer Updates**: Progress component receives updates and re-renders
4. **UI Synchronization**: Panel window resizes and displays current status

```typescript
// Progress update flow
function emitAgentProgress(update: AgentProgressUpdate) {
  const panel = WINDOWS.get("panel")
  const handlers = getRendererHandlers<RendererHandlers>(panel.webContents)
  handlers.agentProgressUpdate.send(update)
}
```

### MCP Communication

Model Context Protocol integration for external tools:

1. **Server Management**: `mcp-service.ts` manages connections to MCP servers
2. **Tool Discovery**: Lists available tools from connected servers
3. **Tool Execution**: Executes tools with proper error handling and timeouts
4. **Result Processing**: Returns structured results to agent engine

```typescript
// MCP tool execution
async executeToolCall(toolCall: MCPToolCall): Promise<MCPToolResult> {
  const [serverName, toolName] = toolCall.name.split(':', 2)
  const client = this.clients.get(serverName)
  const result = await client.callTool({ name: toolName, arguments: toolCall.arguments })
  return { content: result.content, isError: result.isError }
}
```

## Window Management

SpeakMCP uses multiple windows with dynamic positioning:

### Window Types
- **Main Window**: Settings, history, and configuration
- **Panel Window**: Recording interface and agent progress
- **Setup Window**: Initial permissions and setup

### Dynamic Positioning
The panel window repositions based on mode:
- **Normal Mode**: Small recording interface
- **Agent Mode**: Expanded view for progress tracking
- **Text Input Mode**: Text input interface

```typescript
function getPanelWindowPosition(mode: 'normal' | 'agent' | 'textInput') {
  const display = screen.getPrimaryDisplay()
  const { width, height } = display.workAreaSize
  
  switch (mode) {
    case 'agent':
      return { x: Math.round(width * 0.3), y: Math.round(height * 0.2) }
    case 'textInput':
      return { x: Math.round(width * 0.25), y: Math.round(height * 0.4) }
    default:
      return { x: Math.round(width * 0.45), y: Math.round(height * 0.45) }
  }
}
```

## Error Handling and Diagnostics

### Error Propagation
- **TIPC Errors**: Automatically propagated to renderer with full stack traces
- **MCP Errors**: Wrapped with context and server information
- **Agent Errors**: Displayed in progress UI with retry options

### Diagnostics Service
Centralized error tracking and logging:
- **Error Collection**: Captures errors from all components
- **Context Preservation**: Maintains error context and stack traces
- **User Feedback**: Provides actionable error messages

## Security Considerations

### Context Isolation
- **Preload Script**: Only exposes necessary APIs via context bridge
- **No Direct Access**: Renderer cannot directly access Node.js APIs
- **Type Safety**: TIPC ensures type-safe communication

### MCP Security
- **Sandboxed Execution**: MCP servers run in separate processes
- **Timeout Protection**: All MCP calls have configurable timeouts
- **Error Isolation**: MCP errors don't crash the main application

## Performance Optimizations

### Efficient Updates
- **Debounced Progress**: Progress updates are debounced to prevent UI flooding
- **Selective Re-renders**: React components use memoization for performance
- **Background Processing**: Heavy operations run in main process

### Memory Management
- **Stream Processing**: Audio data processed in streams
- **Resource Cleanup**: Proper cleanup of MCP connections and event listeners
- **Window Lifecycle**: Windows are properly managed and cleaned up

## Development and Testing

### Type Safety
- **Full TypeScript**: All IPC communication is fully typed
- **Shared Types**: Common types shared between main and renderer
- **Compile-time Validation**: TypeScript catches IPC interface mismatches

### Testing Strategy
- **Unit Tests**: Individual components tested in isolation
- **Integration Tests**: IPC communication patterns tested
- **E2E Tests**: Full user workflows validated

This architecture provides a robust, type-safe, and performant foundation for SpeakMCP's complex multi-process communication needs.
