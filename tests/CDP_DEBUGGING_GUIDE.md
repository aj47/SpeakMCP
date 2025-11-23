# CDP Debugging Guide for SpeakMCP

## What is This?

**CDP (Chrome DevTools Protocol)** is a built-in Chromium debugging protocol that lets you programmatically control and inspect Electron apps.

**Why you need electron-native tools:** You don't have direct access to the DevTools console, so you use the `electron-native` (github.com/aj47/electron-native-mcp) tools to interact with CDP.

## Quick Start

### 1. Start the App with CDP Enabled

Use the `launch-process` tool:

```javascript
launch_process({
  command: "pnpm dev dui --remote-debugging-port=9222",
  wait: false,
  max_wait_seconds: 30,
  cwd: "/Users/ajjoobandi/Development/SpeakMCP-Workspaces/slot-1"
})
```

**Flags explained:**
- `dui` - Enable debug UI logging (shows all renderer console logs)
- `--remote-debugging-port=9222` - Enable Chrome DevTools Protocol on port 9222

### 2. Verify CDP is Running

Use the `read-process` tool:

```javascript
read_process({
  terminal_id: 5,  // Use the terminal ID from launch-process
  wait: true,
  max_wait_seconds: 10
})
```

You should see this in the output:
```
DevTools listening on ws://127.0.0.1:9222/devtools/browser/...
```

### 3. List Available Targets

Use the `list_electron_targets_electron-native` electron-native tool:

```javascript
list_electron_targets_electron-native()
```

You should see 2 targets:
- **Main Window** - `http://localhost:5173/`
- **Panel Window** - `http://localhost:5173/panel`

**Example response:**
```json
[
  {
    "id": "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
    "type": "page",
    "title": "SpeakMCP",
    "url": "http://localhost:5173/"
  },
  {
    "id": "B10A2E2D017499B23AA317EDB5AAC5A4",
    "type": "page",
    "title": "SpeakMCP",
    "url": "http://localhost:5173/panel"
  }
]
```

### 4. Connect to a Target

Use the `connect_to_electron_target_electron-native` electron-native tool:

```javascript
connect_to_electron_target_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0"  // Use ID from step 3
})
```

### 5. Execute JavaScript

Use the `execute_javascript_electron-native` electron-native tool:

```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: "window.electron.ipcRenderer.invoke('debugPanelState')"
})
```

---

## How to Call TIPC Methods

### Important Discovery

**TIPC methods are accessible via `window.electron.ipcRenderer.invoke()`**, NOT via `window.electronAPI`.

- ❌ `window.electronAPI` - Only has OAuth methods (manually exposed in preload)
- ✅ `window.electron.ipcRenderer.invoke()` - Has ALL TIPC router methods

### Example: Trigger an Agent Session

Use the `execute_javascript_electron-native` electron-native tool:

```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('createMcpTextInput', {
      text: 'What is 2+2? Just answer with the number.'
    }).then(result => {
      console.log('[TEST] Agent session result:', result);
      return result;
    }).catch(error => {
      console.error('[TEST] Error:', error);
      return { error: error.message };
    })
  `
})
```

### Example: Check Panel State

Use the `execute_javascript_electron-native` electron-native tool:

```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('debugPanelState').then(result => {
      console.log('[TEST] Panel state:', result);
      return result;
    })
  `
})
```

### Example: Show Panel Window

Use the `execute_javascript_electron-native` electron-native tool:

```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: "window.electron.ipcRenderer.invoke('showPanelWindow')"
})
```

---

## Available TIPC Methods for Testing

### Panel Control
- `debugPanelState()` - Get current panel state
- `showPanelWindow()` - Show the panel
- `hidePanelWindow()` - Hide the panel (if exists)

### Agent Sessions
- `createMcpTextInput({ text, conversationId? })` - Trigger agent session with text
- `getAgentSessions()` - Get all active/snoozed sessions
- `stopAgentSession({ sessionId })` - Stop a specific session
- `snoozeAgentSession({ sessionId })` - Snooze a session
- `unsnoozeAgentSession({ sessionId })` - Unsnooze a session
- `clearAgentProgress()` - Clear all agent progress
- `emergencyStopAgent()` - Emergency stop all agent sessions (kill switch)

### Text Input
- `createTextInput({ text })` - Process text without agent mode

### Configuration
- `getConfig()` - Get current configuration
- `updateConfig({ ...config })` - Update configuration

### Text-to-Speech (TTS)
- `generateSpeech({ text, providerId?, voice?, model?, speed? })` - Generate speech audio
  - Providers: `openai`, `groq`, `gemini`
  - Returns: `{ audio: ArrayBuffer, processedText: string, provider: string }`

### OAuth (via `window.electronAPI`)
- `initiateOAuthFlow(serverName)` - Start OAuth flow for MCP server
- `completeOAuthFlow(serverName, code, state)` - Complete OAuth with authorization code
- `getOAuthStatus(serverName)` - Check OAuth authentication status
- `revokeOAuthTokens(serverName)` - Revoke OAuth tokens for server

### Conversation Management
- `getConversationHistory()` - Get all conversation history
- `loadConversation({ conversationId })` - Load specific conversation
- `addMessageToConversation({ conversationId, content, role, toolCalls?, toolResults? })` - Add message
- `deleteConversation({ conversationId })` - Delete specific conversation
- `deleteAllConversations()` - Delete all conversations

### MCP Server Management
- `getMcpServerStatus()` - Get status of all MCP servers
- `restartMcpServer({ serverName })` - Restart specific MCP server
- `stopMcpServer({ serverName })` - Stop specific MCP server
- `getMcpServerLogs({ serverName })` - Get logs from MCP server
- `clearMcpServerLogs({ serverName })` - Clear MCP server logs
- `testMCPServer(serverName, config)` - Test MCP server configuration (via `window.electronAPI`)

### Model Management
- `fetchAvailableModels({ providerId })` - Fetch available models for provider

---

## Common Testing Patterns

### Pattern 1: Trigger Agent Session and Monitor

**Step 1:** Connect to main window using `connect_to_electron_target_electron-native`:
```javascript
connect_to_electron_target_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0"
})
```

**Step 2:** Trigger agent session using `execute_javascript_electron-native`:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('createMcpTextInput', {
      text: 'Test agent session'
    }).then(result => {
      console.log('[TEST] Session started:', result);
      return result;
    })
  `
})
```

**Step 3:** Watch terminal output for logs:
```
[AgentSessionTracker] Started session: session_XXX
[WINDOW PANEL] show
[llm.ts emitAgentProgress] Called for session...
[AgentSessionTracker] Completing session: session_XXX
```

### Pattern 2: Check UI State

Use the `execute_javascript_electron-native` electron-native tool:

```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: "window.electron.ipcRenderer.invoke('debugPanelState')"
})
```

**Expected result:**
```json
{
  "exists": true,
  "isVisible": false,
  "isDestroyed": false,
  "bounds": { "x": 376, "y": 45, "width": 600, "height": 443 },
  "isAlwaysOnTop": true
}
```

### Pattern 3: Test Multiple Sessions

**Start first session** using `execute_javascript_electron-native`:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('createMcpTextInput', {
      text: 'First session'
    })
  `
})
```

**Start second session (while first is running)** using `execute_javascript_electron-native`:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('createMcpTextInput', {
      text: 'Second session'
    })
  `
})
```

**Check active sessions** using `execute_javascript_electron-native`:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: "window.electron.ipcRenderer.invoke('getAgentSessions')"
})
```

---

## Advanced Testing Patterns

### Pattern 4: Toggle Voice Dictation (Fn Key)

**Note:** The Fn key toggle voice dictation is a keyboard-driven feature that starts/stops recording with a single key press (instead of hold-to-record). This is primarily tested through keyboard interaction, but you can monitor the recording state.

**Step 1:** Check recording state using `execute_javascript_electron-native`:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('getConfig').then(config => {
      return {
        toggleVoiceDictationEnabled: config.toggleVoiceDictationEnabled,
        toggleVoiceDictationKey: config.toggleVoiceDictationKey
      };
    })
  `
})
```

**Step 2:** Monitor recording events in terminal:
```
Expected logs when Fn key is pressed:
[recordEvent] type: start
[keyboard.ts] Toggle voice dictation started
[recordEvent] type: end
[keyboard.ts] Toggle voice dictation stopped
```

**Step 3:** Check recording history after dictation:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('getRecordingHistory').then(result => {
      console.log('[TEST] Recording history:', result.slice(0, 3));
      return result.slice(0, 3).map(r => ({
        id: r.id,
        transcript: r.transcript,
        duration: r.duration
      }));
    })
  `
})
```

**Expected behavior:**
- First Fn press: Start recording (tray icon changes)
- Second Fn press: Stop recording and transcribe
- Transcript auto-pasted to active application
- Recording saved to history

**Alternative: Simulate recording creation (for testing):**
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    // Note: This requires actual audio data, so it's mainly for reference
    // Real testing should use keyboard interaction
    window.electron.ipcRenderer.invoke('recordEvent', {
      type: 'start'
    }).then(() => {
      console.log('[TEST] Recording started');
      return { success: true };
    })
  `
})
```

### Pattern 5: Text Input Mode (Ctrl+T)

**Step 1:** Connect to main window using `connect_to_electron_target_electron-native`:
```javascript
connect_to_electron_target_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0"
})
```

**Step 2:** Trigger text input mode using `execute_javascript_electron-native`:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('createTextInput', {
      text: 'Test text input without agent mode'
    }).then(result => {
      console.log('[TEST] Text input result:', result);
      return result;
    })
  `
})
```

**Expected behavior:**
- Text is processed without agent mode
- Post-processing applied if enabled in config
- Text is auto-pasted if configured
- Saved to recording history

**Check config for text input:**
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('getConfig').then(config => {
      return {
        transcriptPostProcessingEnabled: config.transcriptPostProcessingEnabled,
        customTextInputShortcut: config.customTextInputShortcut
      };
    })
  `
})
```

### Pattern 5: Kill Switch / Emergency Stop

**Step 1:** Start an agent session using `execute_javascript_electron-native`:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('createMcpTextInput', {
      text: 'Long running task that will be stopped'
    }).then(result => {
      console.log('[TEST] Session started:', result);
      return result;
    })
  `
})
```

**Step 2:** Trigger emergency stop using `execute_javascript_electron-native`:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('emergencyStopAgent').then(result => {
      console.log('[TEST] Emergency stop result:', result);
      return result;
    })
  `
})
```

**Expected behavior:**
- All active agent sessions are stopped
- LLM requests are aborted
- Child processes are killed
- Panel shows "Agent stopped" message
- Sessions removed from active sessions list

**Verify sessions were stopped:**
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: "window.electron.ipcRenderer.invoke('getAgentSessions')"
})
```

**Stop a specific session (alternative to emergency stop):**
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('stopAgentSession', {
      sessionId: 'session_XXX'
    }).then(result => {
      console.log('[TEST] Session stopped:', result);
      return result;
    })
  `
})
```

### Pattern 7: Text-to-Speech (TTS)

**Step 1:** Check TTS configuration using `execute_javascript_electron-native`:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('getConfig').then(config => {
      return {
        ttsEnabled: config.ttsEnabled,
        ttsProviderId: config.ttsProviderId,
        openaiTtsVoice: config.openaiTtsVoice,
        openaiTtsModel: config.openaiTtsModel,
        groqTtsVoice: config.groqTtsVoice,
        groqTtsModel: config.groqTtsModel,
        geminiTtsVoice: config.geminiTtsVoice,
        geminiTtsModel: config.geminiTtsModel,
        ttsAutoPlay: config.ttsAutoPlay,
        ttsPreprocessingEnabled: config.ttsPreprocessingEnabled
      };
    })
  `
})
```

**Step 2:** Generate speech using `execute_javascript_electron-native`:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('generateSpeech', {
      text: 'Hello, this is a test of text to speech.',
      providerId: 'openai',
      voice: 'alloy',
      model: 'tts-1',
      speed: 1.0
    }).then(result => {
      console.log('[TEST] TTS generated:', {
        provider: result.provider,
        processedText: result.processedText,
        audioSize: result.audio.byteLength
      });
      return { success: true, audioSize: result.audio.byteLength };
    }).catch(error => {
      console.error('[TEST] TTS error:', error);
      return { error: error.message };
    })
  `
})
```

**Test different TTS providers:**

**OpenAI TTS:**
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('generateSpeech', {
      text: 'Testing OpenAI TTS',
      providerId: 'openai',
      voice: 'nova',
      model: 'tts-1-hd'
    })
  `
})
```

**Groq TTS:**
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('generateSpeech', {
      text: 'Testing Groq TTS',
      providerId: 'groq',
      voice: 'Fritz-PlayAI',
      model: 'playai-tts'
    })
  `
})
```

**Gemini TTS:**
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('generateSpeech', {
      text: 'Testing Gemini TTS',
      providerId: 'gemini',
      voice: 'Puck',
      model: 'gemini-2.5-flash-preview-tts'
    })
  `
})
```

**Test TTS preprocessing:**
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('generateSpeech', {
      text: 'Check out https://example.com and this code: \`console.log("test")\`',
      providerId: 'openai'
    }).then(result => {
      console.log('[TEST] Preprocessed text:', result.processedText);
      return result;
    })
  `
})
```

**Expected preprocessing:**
- URLs removed or converted
- Code blocks removed or converted
- Markdown converted to natural speech

### Pattern 8: OAuth Flow

**Step 1:** Check OAuth status for a server using `execute_javascript_electron-native`:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electronAPI.getOAuthStatus('your-server-name').then(result => {
      console.log('[TEST] OAuth status:', result);
      return result;
    })
  `
})
```

**Expected response:**
```json
{
  "configured": true,
  "authenticated": false,
  "tokenExpiry": null
}
```

**Step 2:** Initiate OAuth flow using `execute_javascript_electron-native`:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electronAPI.initiateOAuthFlow('your-server-name').then(result => {
      console.log('[TEST] OAuth initiated:', result);
      return result;
    })
  `
})
```

**Expected response:**
```json
{
  "authorizationUrl": "https://...",
  "state": "random-state-string"
}
```

**Step 3:** Complete OAuth flow (after user authorizes):
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electronAPI.completeOAuthFlow(
      'your-server-name',
      'authorization-code',
      'state-from-step-2'
    ).then(result => {
      console.log('[TEST] OAuth completed:', result);
      return result;
    })
  `
})
```

**Step 4:** Verify authentication:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electronAPI.getOAuthStatus('your-server-name').then(result => {
      console.log('[TEST] OAuth status after auth:', result);
      return result;
    })
  `
})
```

**Expected response:**
```json
{
  "configured": true,
  "authenticated": true,
  "tokenExpiry": 1234567890
}
```

**Step 5:** Revoke OAuth tokens:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electronAPI.revokeOAuthTokens('your-server-name').then(result => {
      console.log('[TEST] OAuth revoked:', result);
      return result;
    })
  `
})
```

### Pattern 9: Conversation Management

**Step 1:** Get conversation history using `execute_javascript_electron-native`:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('getConversationHistory').then(result => {
      console.log('[TEST] Conversation history:', result);
      return result.map(c => ({ id: c.id, title: c.title, messageCount: c.messages?.length }));
    })
  `
})
```

**Step 2:** Load a specific conversation:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('loadConversation', {
      conversationId: 'conversation-id-here'
    }).then(result => {
      console.log('[TEST] Loaded conversation:', result);
      return result;
    })
  `
})
```

**Step 3:** Add message to conversation:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('addMessageToConversation', {
      conversationId: 'conversation-id-here',
      content: 'Follow-up question',
      role: 'user'
    }).then(result => {
      console.log('[TEST] Message added:', result);
      return result;
    })
  `
})
```

**Step 4:** Continue conversation with agent:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('createMcpTextInput', {
      text: 'Continue the previous task',
      conversationId: 'conversation-id-here'
    }).then(result => {
      console.log('[TEST] Continued conversation:', result);
      return result;
    })
  `
})
```

**Step 5:** Delete a conversation:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('deleteConversation', {
      conversationId: 'conversation-id-here'
    }).then(result => {
      console.log('[TEST] Conversation deleted');
      return { success: true };
    })
  `
})
```

**Step 6:** Delete all conversations:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('deleteAllConversations').then(result => {
      console.log('[TEST] All conversations deleted');
      return { success: true };
    })
  `
})
```

### Pattern 10: Tool Management

**Step 1:** Get MCP server status using `execute_javascript_electron-native`:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('getMcpServerStatus').then(result => {
      console.log('[TEST] MCP server status:', result);
      return result;
    })
  `
})
```

**Step 2:** Get available tools from a server:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('getMcpServerStatus').then(result => {
      const server = result.find(s => s.name === 'your-server-name');
      console.log('[TEST] Available tools:', server?.tools);
      return server?.tools;
    })
  `
})
```

**Step 3:** Restart an MCP server:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('restartMcpServer', {
      serverName: 'your-server-name'
    }).then(result => {
      console.log('[TEST] Server restarted:', result);
      return result;
    })
  `
})
```

**Step 4:** Stop an MCP server:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('stopMcpServer', {
      serverName: 'your-server-name'
    }).then(result => {
      console.log('[TEST] Server stopped:', result);
      return result;
    })
  `
})
```

**Step 5:** Get server logs:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('getMcpServerLogs', {
      serverName: 'your-server-name'
    }).then(result => {
      console.log('[TEST] Server logs:', result);
      return result;
    })
  `
})
```

**Step 6:** Clear server logs:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('clearMcpServerLogs', {
      serverName: 'your-server-name'
    }).then(result => {
      console.log('[TEST] Logs cleared');
      return result;
    })
  `
})
```

**Step 7:** Test MCP server configuration:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electronAPI.testMCPServer('your-server-name', {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp']
    }).then(result => {
      console.log('[TEST] Server test result:', result);
      return result;
    })
  `
})
```

### Pattern 11: Model Selection

**Step 1:** Get current model configuration:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('getConfig').then(config => {
      return {
        chatProviderId: config.chatProviderId,
        openaiChatModel: config.openaiChatModel,
        groqChatModel: config.groqChatModel,
        geminiChatModel: config.geminiChatModel,
        sttProviderId: config.sttProviderId,
        openaiSttModel: config.openaiSttModel,
        groqSttModel: config.groqSttModel,
        ttsProviderId: config.ttsProviderId,
        openaiTtsModel: config.openaiTtsModel,
        groqTtsModel: config.groqTtsModel,
        geminiTtsModel: config.geminiTtsModel
      };
    })
  `
})
```

**Step 2:** Fetch available models for a provider:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('fetchAvailableModels', {
      providerId: 'openai'
    }).then(result => {
      console.log('[TEST] Available models:', result);
      return result;
    })
  `
})
```

**Step 3:** Update chat model:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('updateConfig', {
      chatProviderId: 'openai',
      openaiChatModel: 'gpt-4o'
    }).then(result => {
      console.log('[TEST] Model updated');
      return { success: true };
    })
  `
})
```

**Step 4:** Update TTS model and voice:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('updateConfig', {
      ttsProviderId: 'openai',
      openaiTtsModel: 'tts-1-hd',
      openaiTtsVoice: 'nova'
    }).then(result => {
      console.log('[TEST] TTS model updated');
      return { success: true };
    })
  `
})
```

**Step 5:** Test with new model:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('createMcpTextInput', {
      text: 'Test with new model configuration'
    }).then(result => {
      console.log('[TEST] Testing new model:', result);
      return result;
    })
  `
})
```

### Pattern 12: Rate Limit Handling

**Note:** Rate limit handling is automatic with exponential backoff. To test it, you need to trigger rate limits.

**Step 1:** Check current retry configuration:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('getConfig').then(config => {
      return {
        chatProviderId: config.chatProviderId,
        openaiApiKey: config.openaiApiKey ? '***configured***' : 'not set',
        groqApiKey: config.groqApiKey ? '***configured***' : 'not set',
        geminiApiKey: config.geminiApiKey ? '***configured***' : 'not set'
      };
    })
  `
})
```

**Step 2:** Trigger multiple requests to potentially hit rate limits:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    // Trigger multiple agent sessions rapidly
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        window.electron.ipcRenderer.invoke('createMcpTextInput', {
          text: \`Rate limit test \${i + 1}\`
        })
      );
    }
    Promise.all(promises).then(results => {
      console.log('[TEST] All requests completed:', results);
      return results;
    }).catch(error => {
      console.error('[TEST] Rate limit error:', error);
      return { error: error.message };
    })
  `
})
```

**Step 3:** Watch terminal output for retry behavior:
```
Expected logs:
[llm.ts] Rate limit hit (429), retrying in 1000ms...
[llm.ts] Rate limit hit (429), retrying in 2000ms...
[llm.ts] Rate limit hit (429), retrying in 4000ms...
```

**Step 4:** Monitor agent sessions during rate limiting:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('getAgentSessions').then(result => {
      console.log('[TEST] Sessions during rate limit:', {
        activeCount: result.activeSessions.length,
        recentCount: result.recentSessions.length
      });
      return result;
    })
  `
})
```

**Expected behavior:**
- Automatic retry with exponential backoff (1s, 2s, 4s, 8s, etc.)
- Sessions remain active during retries
- Eventually succeeds or fails after max retries
- Error messages shown in UI if all retries fail

### Pattern 13: Multi-Language Support

**Step 1:** Check current language configuration:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('getConfig').then(config => {
      return {
        sttLanguage: config.sttLanguage,
        sttProviderId: config.sttProviderId,
        ttsProviderId: config.ttsProviderId
      };
    })
  `
})
```

**Step 2:** Update language for speech recognition:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('updateConfig', {
      sttLanguage: 'es'  // Spanish
    }).then(result => {
      console.log('[TEST] Language updated to Spanish');
      return { success: true };
    })
  `
})
```

**Supported languages:**
- `en` - English
- `es` - Spanish
- `fr` - French
- `de` - German
- `zh` - Chinese
- `ja` - Japanese
- `ar` - Arabic
- `hi` - Hindi
- And 20+ more languages

**Step 3:** Test TTS with different languages:

**Spanish TTS:**
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('generateSpeech', {
      text: 'Hola, ¿cómo estás?',
      providerId: 'openai',
      voice: 'nova'
    }).then(result => {
      console.log('[TEST] Spanish TTS generated');
      return { success: true };
    })
  `
})
```

**French TTS:**
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('generateSpeech', {
      text: 'Bonjour, comment allez-vous?',
      providerId: 'openai',
      voice: 'alloy'
    }).then(result => {
      console.log('[TEST] French TTS generated');
      return { success: true };
    })
  `
})
```

**Arabic TTS (Groq):**
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('updateConfig', {
      ttsProviderId: 'groq',
      groqTtsModel: 'playai-tts-arabic',
      groqTtsVoice: 'Ammar-PlayAI'
    }).then(() => {
      return window.electron.ipcRenderer.invoke('generateSpeech', {
        text: 'مرحبا، كيف حالك؟',
        providerId: 'groq'
      });
    }).then(result => {
      console.log('[TEST] Arabic TTS generated');
      return { success: true };
    })
  `
})
```

**Step 4:** Test multi-language agent session:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('updateConfig', {
      sttLanguage: 'es'
    }).then(() => {
      return window.electron.ipcRenderer.invoke('createMcpTextInput', {
        text: '¿Cuál es el clima hoy?'
      });
    }).then(result => {
      console.log('[TEST] Spanish agent session started:', result);
      return result;
    })
  `
})
```

**Step 5:** Reset to English:
```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: `
    window.electron.ipcRenderer.invoke('updateConfig', {
      sttLanguage: 'en'
    }).then(result => {
      console.log('[TEST] Language reset to English');
      return { success: true };
    })
  `
})
```

---

## Debugging Tips

### 1. Watch Terminal Output

The `dui` flag enables debug logging. Watch for:
- `[DEBUG][UI] [MAIN]` - Main window logs
- `[DEBUG][UI] [PANEL]` - Panel window logs
- `[AgentSessionTracker]` - Session lifecycle
- `[llm.ts emitAgentProgress]` - Agent progress updates
- `[WINDOW PANEL] show/hide` - Panel visibility changes

### 2. Check What's Available

Use the `execute_javascript_electron-native` electron-native tool:

```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: "Object.keys(window.electronAPI).join(', ')"
})
```

**Returns:** `"initiateOAuthFlow, completeOAuthFlow, getOAuthStatus, revokeOAuthTokens, testMCPServer"`

### 3. Take Screenshots

Use the `take_electron_screenshot_electron-native` electron-native tool:

```javascript
take_electron_screenshot_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0"
})
```

This captures the current state of the window.

### 4. Inspect DOM

Use the `execute_javascript_electron-native` electron-native tool:

```javascript
execute_javascript_electron-native({
  targetId: "C8AC35BF57CC8E8E4540C5DB65FBC2C0",
  code: "document.querySelector('.agent-progress')?.textContent"
})
```

---

## Troubleshooting

### Problem: "Failed to list CDP targets"

**Solution:** Make sure app is running with `--remote-debugging-port=9222`

### Problem: "No handler registered for 'methodName'"

**Solution:** Check the method name. Common mistakes:
- ❌ `processWithAgentMode` - This is a helper function, not a TIPC method
- ✅ `createMcpTextInput` - This is the correct TIPC method

### Problem: "Error invoking remote method"

**Solution:** Check the parameters. TIPC methods expect specific input shapes:
```javascript
// ❌ Wrong
invoke('createMcpTextInput', 'text here')

// ✅ Correct
invoke('createMcpTextInput', { text: 'text here' })
```

### Problem: Agent session doesn't start

**Check:**
1. Is `mcpToolsEnabled: true` in config?
2. Is an API key configured?
3. Check terminal for error messages

---

## Architecture Notes

### Why This Works

The app uses **TIPC (Type-safe IPC)** which automatically exposes all router methods via `window.electron.ipcRenderer.invoke()`.

**Two separate APIs:**
1. **`window.electronAPI`** - Custom OAuth methods (manually exposed in `src/preload/index.ts`)
2. **`window.electron.ipcRenderer`** - All TIPC methods (automatically exposed by `@electron-toolkit/preload`)

### Security

This is the **intended design**. The renderer can call TIPC methods, but:
- Methods validate inputs
- Methods check permissions
- Methods enforce business logic
- Context isolation prevents direct main process access

---

## Quick Reference

### Start App

Use `launch-process`:
```javascript
launch_process({
  command: "pnpm dev dui --remote-debugging-port=9222",
  wait: false,
  max_wait_seconds: 30,
  cwd: "/path/to/your/project"
})
```

### List Targets

Use `list_electron_targets_electron-native` electron-native tool:
```javascript
list_electron_targets_electron-native()
```

### Connect

Use `connect_to_electron_target_electron-native` electron-native tool:
```javascript
connect_to_electron_target_electron-native({
  targetId: "YOUR_TARGET_ID"
})
```

### Execute JavaScript

Use `execute_javascript_electron-native` electron-native tool:
```javascript
execute_javascript_electron-native({
  targetId: "YOUR_TARGET_ID",
  code: "window.electron.ipcRenderer.invoke('methodName', { params })"
})
```

### Common Methods
- `createMcpTextInput({ text })` - Trigger agent
- `debugPanelState()` - Check panel
- `getAgentSessions()` - List sessions
- `getConfig()` - Get config

---

## Alternative: Manual DevTools Access

If you have direct access to the app (not using electron-native tools), you can also:

1. Start app with CDP: `pnpm dev dui --remote-debugging-port=9222`
2. Open Chrome browser
3. Go to `chrome://inspect`
4. Click "Configure" and add `localhost:9222`
5. Click "inspect" on your Electron app windows
6. Use the DevTools console directly

This gives you the same capabilities but through Chrome's DevTools UI instead of programmatic tool calls.

---

## Related Files

- **TIPC Router:** `src/main/tipc.ts` - All available methods
- **Preload Script:** `src/preload/index.ts` - What's exposed to renderer
- **TIPC Client:** `src/renderer/src/lib/tipc-client.ts` - How renderer calls TIPC
- **Test Cases:** `tests/ui-state-test-cases.md` - What to test
- **CDP Results:** `tests/CDP_TESTING_RESULTS.md` - Detailed findings

---

**Last Updated:** November 23, 2025
**Status:** ✅ Working - CDP debugging fully functional with comprehensive testing patterns

