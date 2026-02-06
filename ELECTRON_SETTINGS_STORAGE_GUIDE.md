# Electron Desktop App Settings & Configuration Storage Guide

## Overview
The SpeakMCP Electron desktop app uses **plain JSON files** stored on disk for all persistence. No external database or specialized libraries like `electron-store` are used.

---

## 1. Settings/Configuration Storage

### File Location
- **Path**: `{appData}/{APP_ID}/config.json`
- **Platform-specific appData**:
  - macOS: `~/Library/Application Support/{APP_ID}/`
  - Windows: `%APPDATA%/{APP_ID}/`
  - Linux: `~/.config/{APP_ID}/`

### Storage Mechanism
- **File**: `apps/desktop/src/main/config.ts`
- **Class**: `ConfigStore` (singleton pattern)
- **Format**: JSON (plain text, human-readable)
- **Persistence**: Direct file I/O using Node.js `fs` module
  - Load: `fs.readFileSync(configPath, "utf8")`
  - Save: `fs.writeFileSync(configPath, JSON.stringify(config))`

### Key Methods
```typescript
configStore.get()      // Returns current Config object
configStore.save(config)  // Persists Config to disk
```

---

## 2. Configuration Fields & Defaults

### Core Settings (150+ fields)
**Shortcuts & Hotkeys**:
- `shortcut`: "hold-ctrl" | "ctrl-slash" | "custom" (default: platform-specific)
- `mcpToolsShortcut`: "hold-ctrl-alt" | "toggle-ctrl-alt" | "ctrl-alt-slash" | "custom"
- `textInputShortcut`: "ctrl-t" | "ctrl-shift-t" | "alt-t" | "custom"
- `settingsHotkey`: "ctrl-shift-s" | "ctrl-comma" | "ctrl-shift-comma" | "custom"
- `agentKillSwitchHotkey`: "ctrl-shift-escape" | "ctrl-alt-q" | "ctrl-shift-q" | "custom"
- `toggleVoiceDictationHotkey`: "fn" | "f1"-"f12" | "custom"

**UI/Panel Settings**:
- `panelPosition`: "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-center" | "bottom-right" | "custom"
- `panelCustomSize`: `{ width: 300, height: 200 }`
- `panelDragEnabled`: boolean (default: true)
- `floatingPanelAutoShow`: boolean (default: true)
- `hidePanelWhenMainFocused`: boolean (default: true)
- `themePreference`: "system" | "light" | "dark"

**TTS Configuration**:
- `ttsEnabled`: boolean (default: true)
- `ttsProviderId`: "openai" | "groq" | "gemini"
- `openaiTtsModel`: "tts-1" | "tts-1-hd"
- `openaiTtsVoice`: "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer"
- `groqTtsModel`: "canopylabs/orpheus-v1-english" | "canopylabs/orpheus-arabic-saudi"
- `geminiTtsModel`: "gemini-2.5-flash-preview-tts" | "gemini-2.5-pro-preview-tts"

**API Keys & Credentials**:
- `openaiApiKey`: string
- `groqApiKey`: string
- `geminiApiKey`: string
- `modelPresets`: `ModelPreset[]` (custom model configurations)
- `currentModelPresetId`: string

**MCP Configuration**:
- `mcpConfig`: `MCPConfig` (server definitions)
- `mcpRuntimeDisabledServers`: string[] (disabled at runtime)
- `mcpDisabledTools`: string[]
- `mcpMaxIterations`: number (default: 10)
- `mcpRequireApprovalBeforeToolCall`: boolean (default: false)
- `mcpAutoPasteEnabled`: boolean (default: false)

**Conversation Settings**:
- `conversationsEnabled`: boolean (default: true)
- `maxConversationsToKeep`: number (default: 100)
- `autoSaveConversations`: boolean (default: true)

**Remote Server**:
- `remoteServerEnabled`: boolean (default: false)
- `remoteServerPort`: number (default: 3210)
- `remoteServerBindAddress`: "127.0.0.1" | "0.0.0.0"

---

## 3. Conversation History Storage

### File Structure
- **Index**: `{dataFolder}/conversations/index.json`
- **Individual conversations**: `{dataFolder}/conversations/{conversationId}.json`

### Conversation Index (index.json)
Array of `ConversationHistoryItem`:
```typescript
{
  id: string
  title: string
  createdAt: number (timestamp)
  updatedAt: number (timestamp)
  messageCount: number
  lastMessage: string
  preview: string
}
```

### Full Conversation File
```typescript
{
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ConversationMessage[]
  metadata?: {
    totalTokens?: number
    model?: string
    provider?: string
    agentMode?: boolean
  }
}
```

### Message Structure
```typescript
{
  id: string
  role: "user" | "assistant" | "tool"
  content: string
  createdAt: number
  toolCalls?: Array<{ name: string; arguments: any }>
  toolResults?: Array<{ success: boolean; content: string; error?: string }>
  isSummary?: boolean
  summarizedMessageCount?: number
}
```

### Service Class
- **File**: `apps/desktop/src/main/conversation-service.ts`
- **Class**: `ConversationService` (singleton)
- **Key Methods**:
  - `saveConversation(conversation)`: Saves and updates index
  - `loadConversation(conversationId)`: Loads full conversation
  - `getConversationHistory()`: Returns sorted index (most recent first)
  - `addMessageToConversation()`: Appends message to conversation

---

## 4. Profiles Storage

### File Location
- **Path**: `{appData}/{APP_ID}/profiles.json`

### File Structure
```typescript
{
  profiles: Profile[]
  currentProfileId?: string
}
```

### Profile Schema
```typescript
{
  id: string (UUID)
  name: string
  guidelines: string
  createdAt: number
  updatedAt: number
  isDefault?: boolean
  systemPrompt?: string
  mcpServerConfig?: {
    disabledServers?: string[]
    disabledTools?: string[]
    allServersDisabledByDefault?: boolean
    enabledServers?: string[]
    enabledBuiltinTools?: string[]
  }
  modelConfig?: {
    mcpToolsProviderId?: "openai" | "groq" | "gemini"
    mcpToolsOpenaiModel?: string
    sttProviderId?: "openai" | "groq"
    ttsProviderId?: "openai" | "groq" | "gemini"
    currentModelPresetId?: string
  }
  skillsConfig?: {
    enabledSkillIds?: string[]
    allSkillsDisabledByDefault?: boolean
  }
}
```

### Service Class
- **File**: `apps/desktop/src/main/profile-service.ts`
- **Class**: `ProfileService` (singleton)
- **Default Profile**: "Default" profile created on first run
- **Key Methods**:
  - `getProfiles()`: Returns all profiles
  - `getProfile(id)`: Returns specific profile
  - `createProfile()`: Creates new profile with all MCPs disabled by default
  - `updateProfile()`: Updates profile
  - `updateProfileMcpConfig()`: Updates MCP settings for profile

---

## 5. MCP Server Configuration Storage

### Location
Stored within `config.json` under `mcpConfig` field

### Schema
```typescript
{
  mcpConfig: {
    mcpServers: Record<string, MCPServerConfig>
  }
}
```

### MCPServerConfig Structure
```typescript
{
  transport?: "stdio" | "websocket" | "streamableHttp"
  command?: string (for stdio)
  args?: string[]
  env?: Record<string, string>
  url?: string (for remote transports)
  headers?: Record<string, string>
  oauth?: OAuthConfig
  timeout?: number
  disabled?: boolean
}
```

### Runtime State
- **Disabled servers**: `config.mcpRuntimeDisabledServers` (string[])
- **Disabled tools**: `config.mcpDisabledTools` (string[])
- **Service**: `apps/desktop/src/main/mcp-service.ts`

---

## 6. Data Folder Structure

```
{appData}/{APP_ID}/
├── config.json                 # Main settings
├── profiles.json               # User profiles
├── conversations/
│   ├── index.json             # Conversation index
│   ├── {conversationId}.json  # Individual conversations
│   └── ...
└── recordings/                # Audio recordings
```

---

## 7. Configuration Loading & Merging

### Load Process
1. Read `config.json` from disk
2. Merge with hardcoded defaults (defaults override missing fields)
3. Apply migrations (e.g., deprecated Groq TTS settings)
4. Sync active model preset credentials to legacy fields
5. Return merged config

### Save Process
1. Sync active preset credentials to legacy fields
2. Create data folder if needed
3. Write entire config object to `config.json`
4. No partial updates - always full file write

---

## 8. Key Implementation Details

### No External Libraries
- ✅ Plain JSON files
- ✅ Node.js `fs` module only
- ❌ No `electron-store`, `conf`, or similar

### Migrations
- Deprecated Groq TTS models (PlayAI → Orpheus)
- Deprecated panel size fields (removed)
- Backward compatibility maintained

### Thread Safety
- Single-threaded Electron main process
- No concurrent access issues
- Synchronous file I/O

### Type Safety
- Full TypeScript types in `apps/desktop/src/shared/types.ts`
- `Config` type with 150+ optional fields
- Strict validation for MCP server configs

