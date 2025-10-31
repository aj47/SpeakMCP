import { app } from "electron"
import path from "path"
import fs from "fs"
import { Config } from "@shared/types"

export const dataFolder = path.join(app.getPath("appData"), process.env.APP_ID)

export const recordingsFolder = path.join(dataFolder, "recordings")

export const conversationsFolder = path.join(dataFolder, "conversations")

export const configPath = path.join(dataFolder, "config.json")

const getConfig = () => {
  // Platform-specific defaults
  const isWindows = process.platform === 'win32'

  const defaultConfig: Partial<Config> = {
    // Recording shortcut: On Windows, use Ctrl+/ to avoid conflicts with common shortcuts
    // On macOS, Hold Ctrl is fine since Cmd is used for most shortcuts
    shortcut: isWindows ? "ctrl-slash" : "hold-ctrl",

    mcpToolsShortcut: "hold-ctrl-alt",
    mcpToolsEnabled: true,
    mcpAgentModeEnabled: true,
    // Safety: optional approval prompt before each tool call (off by default)
    mcpRequireApprovalBeforeToolCall: false,
    mcpAutoPasteEnabled: false,
    mcpAutoPasteDelay: 1000, // 1 second delay by default
    mcpMaxIterations: 10, // Default max iterations for agent mode
    textInputEnabled: true,
    // Text input: On Windows, use Ctrl+Shift+T to avoid browser new tab conflict
    textInputShortcut: isWindows ? "ctrl-shift-t" : "ctrl-t",
    conversationsEnabled: true,
    maxConversationsToKeep: 100,
    autoSaveConversations: true,
    // Agent kill switch defaults
    agentKillSwitchEnabled: true,
    agentKillSwitchHotkey: "ctrl-shift-escape",
    // Toggle voice dictation defaults
    toggleVoiceDictationEnabled: false,
    toggleVoiceDictationHotkey: "fn",
    // Custom shortcut defaults
    customShortcut: "",
    customShortcutMode: "hold", // Default to hold mode for custom recording shortcut
    customTextInputShortcut: "",
    customAgentKillSwitchHotkey: "",
    customMcpToolsShortcut: "",
    customMcpToolsShortcutMode: "hold", // Default to hold mode for custom MCP tools shortcut
    customToggleVoiceDictationHotkey: "",
    // Persisted MCP runtime state
    mcpRuntimeDisabledServers: [],
    mcpDisabledTools: [],
    // Panel position defaults
    panelPosition: "top-right",
    panelDragEnabled: true,
    panelCustomSize: { width: 300, height: 200 },
    // Mode-specific panel sizes (will be set on first resize in each mode)
    panelNormalModeSize: undefined,
    panelAgentModeSize: undefined,
    panelTextInputModeSize: undefined,
    // Theme preference defaults
    themePreference: "system",

	    // App behavior
	    launchAtLogin: false,

    // TTS defaults
    ttsEnabled: true,
    ttsAutoPlay: true,
    ttsProviderId: "openai",
    ttsPreprocessingEnabled: true,
    ttsRemoveCodeBlocks: true,
    ttsRemoveUrls: true,
    ttsConvertMarkdown: true,
    // OpenAI TTS defaults
    openaiTtsModel: "tts-1",
    openaiTtsVoice: "alloy",
    openaiTtsSpeed: 1.0,
    openaiTtsResponseFormat: "mp3",
    // OpenAI Compatible Provider defaults
    openaiCompatiblePreset: "openai",
    // Groq TTS defaults
    groqTtsModel: "playai-tts",
    groqTtsVoice: "Fritz-PlayAI",
    // Gemini TTS defaults
    geminiTtsModel: "gemini-2.5-flash-preview-tts",
    geminiTtsVoice: "Kore",
    // API Retry defaults
    apiRetryCount: 3,
    apiRetryBaseDelay: 1000, // 1 second
    apiRetryMaxDelay: 30000, // 30 seconds
    // Context reduction defaults
    mcpContextReductionEnabled: true,
    mcpContextTargetRatio: 0.7,
    mcpContextLastNMessages: 3,
    mcpContextSummarizeCharThreshold: 2000,

    // Completion verification defaults
    mcpVerifyCompletionEnabled: true,
    mcpVerifyContextMaxItems: 10,
    mcpVerifyRetryCount: 1,

	    // Remote Server defaults
	    remoteServerEnabled: false,
	    remoteServerPort: 3210,
	    remoteServerBindAddress: "127.0.0.1",
	    remoteServerLogLevel: "info",
	    remoteServerCorsOrigins: ["*"],


  }

  try {
    const savedConfig = JSON.parse(
      fs.readFileSync(configPath, "utf8"),
    ) as Config
    return { ...defaultConfig, ...savedConfig }
  } catch {
    return defaultConfig
  }
}

class ConfigStore {
  config: Config | undefined

  constructor() {
    this.config = getConfig()
  }

  get(): Config {
    return (this.config as Config) || ({} as Config)
  }

  save(config: Config) {
    this.config = config
    fs.mkdirSync(dataFolder, { recursive: true })
    fs.writeFileSync(configPath, JSON.stringify(config))
  }
}

export const configStore = new ConfigStore()
