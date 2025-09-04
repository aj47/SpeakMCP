# SpeakMCP Debugging Guide

This guide covers comprehensive debugging techniques for SpeakMCP development and troubleshooting.

## 🚀 Quick Start Debug Commands

### Super Convenient (No dashes needed!)

**Debug everything with just one letter:**
```bash
pnpm dev d
```

**Individual debug modes:**
```bash
pnpm dev debug-llm       # Enable LLM debug
pnpm dev debug-context   # Enable context manager/compression debug
pnpm dev debug-tools     # Enable tools debug
pnpm dev debug-app       # Enable app debug
pnpm dev debug-all       # Enable all debug modes
pnpm dev dl              # Enable LLM debug (short)
pnpm dev dctx            # Enable context debug (short)
pnpm dev dt              # Enable tools debug (short)
pnpm dev dk              # Enable keybinds debug (short)
pnpm dev dapp            # Enable app debug (short)
```

### Traditional Formats

**With dashes:**
```bash
pnpm dev -- -d                # Debug all (short)
pnpm dev -- -da               # Debug all (short)
pnpm dev -- --debug-llm       # LLM debug (long)
pnpm dev -- --debug-context   # Context debug (long)
pnpm dev -- --debug-tools     # Tools debug (long)
pnpm dev -- --debug-app       # App debug (long)
pnpm dev -- --debug-all       # All debug modes (long)
pnpm dev -- -dctx             # Context debug (short)
pnpm dev -- -dapp             # App debug (short)
```

**Environment variables:**
```bash
DEBUG=* pnpm dev                 # Enable all debug modes
DEBUG_LLM=true pnpm dev          # LLM debug only
DEBUG_CONTEXT=true pnpm dev      # Context manager/compression debug only
DEBUG_TOOLS=true pnpm dev        # Tools debug only
DEBUG_APP=true pnpm dev          # App debug only
DEBUG=llm,context pnpm dev       # Multiple specific modes
DEBUG=llm,context,tools,app pnpm dev # Multiple specific modes including context
```

## 🔍 Debug Output Details

### LLM Debug (`debug-llm` or `dl`)

When LLM debug is enabled, you'll see:

```
[DEBUG][LLM] === LLM CALL START ===
[DEBUG][LLM] Messages → {
  count: 3,
  totalChars: 1247,
  messages: [
    { role: "system", content: "You are an AI assistant..." },
    { role: "user", content: "Create a new file called test.txt" }
  ]
}
[DEBUG][LLM] Response ← {
  needsMoreWork: false,
  toolCalls: [
    { name: "write_file", arguments: { path: "test.txt", content: "..." } }
  ]
}
[DEBUG][LLM] === LLM CALL END ===
```

**What it shows:**
- Complete request/response cycle
- Message content and token counts
- Structured output parsing
- Tool calls planned by the LLM
- Error details and stack traces

### Context Debug (`debug-context` or `dctx`)

When context debug is enabled, you'll see detailed context management and compression decisions:

```
[DEBUG][CONTEXT] Context Manager initialized { maxTokens: 32768, targetTokens: 19660, compressionRatio: 0.3 }
[DEBUG][CONTEXT] Context management: No action needed { currentTokens: 1200, targetTokens: 19660 }
[DEBUG][CONTEXT] Context management: Compression needed { currentTokens: 23000, targetTokens: 19660, overageTokens: 3340 }
[DEBUG][CONTEXT] Context management: LLM compression completed { originalTokens: 23000, compressedTokens: 14000 }
```

**What it shows:**
- Model context detection and limits
- Static prompt trimming and tool docs reductions
- Large tool-result compression vs truncation
- Middle-section summarization strategy
- Fallback truncation decisions and token accounting

### Tools Debug (`debug-tools` or `dt`)

When tools debug is enabled, you'll see:

```
[DEBUG][TOOLS] MCP Service initialization starting
[DEBUG][TOOLS] Server filesystem connected successfully
[DEBUG][TOOLS] Available tools: ["list_files", "read_file", "write_file"]
[DEBUG][TOOLS] Executing planned tool call: {
  name: "write_file",
  arguments: { path: "test.txt", content: "Hello World" }
}
[DEBUG][TOOLS] Tool result: {
  serverName: "filesystem",
  toolName: "write_file",
  result: { success: true, path: "test.txt" }
}
```

**What it shows:**
- MCP server connection status
- Tool discovery and registration
- Tool execution requests and responses
- Error handling and retry logic
- Performance timing information

### Keybinds Debug (`debug-keybinds` or `dk`)

When keybinds debug is enabled, you'll see:

```
[DEBUG][KEYBINDS] Keyboard event: { key: "Control", type: "keydown" }
[DEBUG][KEYBINDS] Hotkey activated: voice_recording
[DEBUG][KEYBINDS] Recording started
[DEBUG][KEYBINDS] Keyboard event: { key: "Control", type: "keyup" }
[DEBUG][KEYBINDS] Recording stopped, processing...
[DEBUG][KEYBINDS] Text insertion: "Hello, this is a test"
```

**What it shows:**
- Raw keyboard events
- Hotkey detection and activation
- Recording state changes
- Text insertion and focus management

### App Debug (`debug-app` or `dapp`)

When app debug is enabled, you'll see:

```
[DEBUG][APP] Application startup sequence initiated
[DEBUG][APP] Window creation: main window
[DEBUG][APP] Configuration loaded: { theme: "dark", shortcuts: {...} }
[DEBUG][APP] Panel window state change: visible -> hidden
[DEBUG][APP] Menu action triggered: show_settings
```

**What it shows:**
- Application lifecycle events
- Window management operations
- Configuration changes and loading
- UI state transitions
- Menu and user interaction events

## 🛠️ Advanced Debugging

### Custom Debug Combinations

You can combine multiple debug modes:

```bash
# LLM + Tools (most common combination)
pnpm dev dl dt

# LLM + App debugging
pnpm dev dl dapp

# All modes explicitly
pnpm dev debug-llm debug-tools debug-keybinds debug-app
```

### Environment Variable Debugging

For persistent debugging across sessions:

```bash
# Add to your shell profile (.bashrc, .zshrc, etc.)
export DEBUG_LLM=true
export DEBUG_CONTEXT=true
export DEBUG_TOOLS=true
export DEBUG_APP=true

# Then just run
pnpm dev
```

### Production Debugging

For debugging built applications:

```bash
# Set environment variables before launching
DEBUG=* ./dist/SpeakMCP.app/Contents/MacOS/SpeakMCP
```

## 🔧 Common Debug Scenarios

### Debugging LLM Issues

```bash
pnpm dev dl  # Enable LLM debug
```

**Look for:**
- Request message formatting
- Response parsing errors
- Token limit issues
- API key problems
- Network connectivity

### Debugging MCP Tool Problems

```bash
pnpm dev dt  # Enable tools debug
```

**Look for:**
- Server connection failures
- Tool discovery issues
- Execution timeouts
- Permission problems
- Path resolution errors

### Debugging Keyboard Issues

```bash
pnpm dev dk  # Enable keybinds debug
```

**Look for:**
- Event capture problems
- Hotkey conflicts
- Focus management issues
- Text insertion failures
- Accessibility permission problems

## 📊 Performance Debugging

### Timing Information

Debug modes include timing information:

```
[DEBUG][LLM] Request took 1.2s
[DEBUG][TOOLS] Tool execution took 0.3s
[DEBUG][KEYBINDS] Text insertion took 0.05s
```

### Memory Usage

Monitor memory usage during debugging:

```bash
# macOS
pnpm dev d & sleep 5 && ps -o pid,rss,vsz,comm -p $(pgrep -f electron)

# Linux
pnpm dev d & sleep 5 && ps -o pid,rss,vsz,comm -p $(pgrep -f electron)
```

## 🚨 Debug Log Management

### Log File Locations

Debug logs are written to:
- **Console**: Real-time output during development
- **Electron DevTools**: Available in production builds
- **System logs**: Platform-specific locations

### Filtering Debug Output

Use grep to filter specific debug information:

```bash
pnpm dev d 2>&1 | grep "LLM"       # LLM logs only
pnpm dev d 2>&1 | grep "CONTEXT"   # Context manager/compression logs only
pnpm dev d 2>&1 | grep "ERROR"     # Errors only
pnpm dev d 2>&1 | grep -v "TOOLS"  # Exclude tools logs
```

## 🔍 Troubleshooting Debug Mode

### Debug Flags Not Working

1. **Check the command format:**
   ```bash
   pnpm dev d           # ✅ Correct
   pnpm dev -- d        # ❌ Wrong (extra dashes)
   ```

2. **Verify the package.json script:**
   ```json
   "dev": "electron-vite dev --watch --"
   ```

3. **Check environment variables:**
   ```bash
   echo $DEBUG_LLM
   echo $DEBUG_CONTEXT
   echo $DEBUG
   ```

### No Debug Output Appearing

1. **Ensure debug initialization:**
   Look for: `[DEBUG INIT] Debug flags initialized:`

2. **Check console output:**
   Debug logs go to the terminal, not the app UI

3. **Verify debug conditions:**
   Some debug output only appears during specific operations

## 📝 Contributing Debug Information

When reporting issues, include:

1. **Debug command used:**
   ```bash
   pnpm dev d
   ```

2. **Debug initialization output:**
   ```
   [DEBUG INIT] Debug flags initialized: { llm: true, tools: true, ... }
   ```

3. **Relevant debug logs:**
   Copy the specific debug output related to your issue

4. **System information:**
   - OS version
   - Node.js version
   - Electron version
   - SpeakMCP version

This comprehensive debugging system helps identify and resolve issues quickly during development and troubleshooting.
