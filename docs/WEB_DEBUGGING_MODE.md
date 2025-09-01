# SpeakMCP Web Debugging Mode

The Web Debugging Mode is a browser-based development environment for SpeakMCP that allows you to debug agent tool calls and conversations without requiring the Rust binary. This mode is perfect for rapid prototyping, testing agent interactions, and understanding agent workflows.

## 🚀 Quick Start

### Starting the Web Debugger

```bash
# Start with default settings (recommended)
npm run dev:web

# Start with verbose logging
npm run debug:web

# Start on a custom port
npm run dev:web -- --port 3002

# Start without opening browser automatically
npm run dev:web -- --no-browser
```

The web debugger will:
1. Build the web debugging interface
2. Start the debugging server on `http://localhost:3001`
3. Open your browser automatically (unless `--no-browser` is specified)

### First Steps

1. **Create a Session**: Click "New Session" to create your first debugging session
2. **Send Messages**: Use the conversation interface to send messages and simulate user interactions
3. **Simulate Agent Mode**: Click the "Agent" button to simulate agent mode processing with tool calls
4. **Explore Tool Calls**: Switch to the "Tools" tab to see detailed tool call visualizations
5. **Monitor Progress**: Use the "Agent" tab to watch real-time agent processing steps

## 🎯 Features

### 🔍 Agent Tool Call Visualization
- **Real-time monitoring** of tool call execution
- **Detailed argument inspection** with JSON formatting
- **Status tracking** (pending, executing, completed, error)
- **Performance metrics** including execution duration
- **Interactive tool testing** with custom arguments

### 💬 Conversation History Inspection
- **Complete conversation logs** with timestamps
- **Role-based message filtering** (user, assistant, tool)
- **Message content formatting** with JSON pretty-printing
- **Tool call and result correlation** within messages
- **Export capabilities** for conversation data

### ⚡ Real-time Progress Tracking
- **Live agent processing** visualization
- **Step-by-step breakdown** of agent thinking and actions
- **Progress indicators** with iteration tracking
- **Error handling** and failure analysis
- **Final result presentation**

### 🛠️ Mock MCP Service
- **No Rust binary required** - pure web implementation
- **Configurable tool responses** with realistic delays
- **Error simulation** for testing failure scenarios
- **Multiple tool types** (filesystem, web search, calculator, etc.)
- **Customizable success rates** and response times

### 🔄 WebSocket Real-time Updates
- **Live session synchronization** across browser tabs
- **Instant tool call notifications**
- **Real-time progress updates**
- **Session management** with automatic cleanup

## 🏗️ Architecture

### Components Overview

```
src/web-debug/
├── server.ts                 # Main web debugging server
├── mock-mcp-service.ts      # Mock MCP service implementation
├── start-server.ts          # Server startup script
├── vite.config.ts           # Vite build configuration
├── index.html               # Main HTML template
├── index.tsx                # React app entry point
├── styles.css               # Global styles
└── components/
    ├── WebDebugApp.tsx      # Main application component
    ├── SessionList.tsx      # Session management
    ├── ConversationHistory.tsx # Conversation viewer
    ├── ToolCallVisualizer.tsx  # Tool call inspector
    ├── AgentProgressViewer.tsx # Agent progress tracker
    └── SessionView.tsx      # Session overview
```

### Server Architecture

The web debugging server consists of:

1. **Express HTTP Server**: Serves the web interface and provides REST API endpoints
2. **Socket.IO WebSocket Server**: Enables real-time communication between server and clients
3. **Mock MCP Service**: Simulates MCP tool calls without requiring external dependencies
4. **Session Management**: Handles debugging session lifecycle and data persistence

### API Endpoints

- `GET /api/sessions` - List all debugging sessions
- `GET /api/sessions/:id` - Get specific session details
- `POST /api/sessions` - Create new debugging session
- `POST /api/sessions/:id/messages` - Add message to session
- `POST /api/sessions/:id/tool-calls` - Execute tool call in session
- `DELETE /api/sessions/:id` - Delete debugging session

## 🔧 Configuration

### Server Configuration

The web debugging server can be configured through command-line options:

```bash
npm run dev:web -- [options]

Options:
  --port, -p <port>     Port to run the server on (default: 3001)
  --host, -h <host>     Host to bind the server to (default: localhost)
  --no-browser          Don't open browser automatically
  --no-build            Skip building the web interface
  --verbose, -v         Enable verbose logging
  --help                Show help message
```

### Mock MCP Service Configuration

The mock MCP service can be configured programmatically:

```typescript
const mockService = new MockMCPService({
  enabledTools: ['filesystem', 'web-search', 'calculator'],
  simulateDelay: true,
  delayRange: [500, 2000], // 500ms to 2s delay
  errorRate: 0.1, // 10% error rate
  enableProgressUpdates: true
})
```

### Environment Variables

- `WEB_DEBUG_PORT` - Default port for the web debugging server
- `WEB_DEBUG_HOST` - Default host for the web debugging server
- `WEB_DEBUG_LOG_LEVEL` - Logging level (debug, info, warn, error)

## 🎮 Usage Examples

### Basic Conversation Testing

1. Start the web debugger: `npm run dev:web`
2. Create a new session: "Test Conversation"
3. Send a user message: "Hello, can you help me with file operations?"
4. Click "Agent" to simulate agent mode processing
5. Watch the agent break down the request and execute tool calls

### Tool Call Development

1. Navigate to the "Tools" tab
2. Click "Execute Tool Call"
3. Select a tool (e.g., `filesystem_read`)
4. Modify the arguments JSON:
   ```json
   {
     "path": "/path/to/your/file.txt"
   }
   ```
5. Execute and observe the mock response

### Agent Flow Debugging

1. Use the "Agent" tab for agent mode simulation
2. Enter a complex request: "Search for information about TypeScript and save it to a file"
3. Watch the step-by-step breakdown:
   - Thinking: Agent analyzes the request
   - Tool Call: web_search with query "TypeScript"
   - Tool Result: Mock search results
   - Tool Call: filesystem_write with search results
   - Completion: Final summary

## 🔍 Debugging Tips

### Common Issues

1. **Port Already in Use**
   ```bash
   # Use a different port
   npm run dev:web -- --port 3002
   ```

2. **Build Failures**
   ```bash
   # Skip build and use existing files
   npm run serve:web-debug
   ```

3. **WebSocket Connection Issues**
   - Check browser console for connection errors
   - Ensure no firewall blocking WebSocket connections
   - Try refreshing the page

### Performance Optimization

- Use `--no-build` flag when iterating on server-side changes
- Enable verbose logging only when needed (`--verbose`)
- Clear old sessions regularly to free memory

### Development Workflow

1. **Frontend Changes**: Modify components in `src/web-debug/components/`
2. **Server Changes**: Edit `src/web-debug/server.ts` or related files
3. **Mock Service**: Update `src/web-debug/mock-mcp-service.ts` for tool behavior
4. **Restart**: Use `npm run dev:web` to rebuild and restart

## 🚀 Advanced Features

### Custom Tool Implementation

Add custom tools to the mock MCP service:

```typescript
// In mock-mcp-service.ts
const customTool: MCPTool = {
  name: 'custom_tool',
  description: 'My custom tool',
  inputSchema: {
    type: 'object',
    properties: {
      input: { type: 'string' }
    }
  }
}
```

### Session Export/Import

Sessions can be exported as JSON for sharing or backup:

```javascript
// In browser console
const session = await fetch('/api/sessions/session_id').then(r => r.json())
console.log(JSON.stringify(session, null, 2))
```

### Real-time Collaboration

Multiple browser tabs can connect to the same session for collaborative debugging:

1. Open multiple tabs to the same web debugger URL
2. Select the same session in each tab
3. Changes in one tab appear instantly in others

## 🔗 Integration with Main App

The web debugging mode is completely independent of the main Electron app and doesn't require:

- Rust binary compilation
- Electron runtime
- System permissions
- MCP server setup

This makes it perfect for:
- **Quick prototyping** of agent interactions
- **Educational purposes** to understand agent workflows
- **Development environments** where Rust compilation is difficult
- **CI/CD testing** of agent logic

## 📚 Next Steps

After getting familiar with the web debugging mode:

1. **Explore Real MCP Integration**: Set up actual MCP servers for production testing
2. **Custom Tool Development**: Create your own MCP tools and test them
3. **Agent Prompt Engineering**: Use the debugger to refine agent prompts
4. **Performance Analysis**: Monitor tool call patterns and optimize workflows

For more information, see:
- [Main SpeakMCP Documentation](../README.md)
- [MCP Integration Guide](./MCP_INTEGRATION.md)
- [Development Setup](./DEVELOPMENT.md)
