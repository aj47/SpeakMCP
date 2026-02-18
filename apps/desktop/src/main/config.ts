import { app } from "electron"
import path from "path"
import fs from "fs"
import { Config, ModelPreset } from "@shared/types"
import { getBuiltInModelPresets, DEFAULT_MODEL_PRESET_ID } from "@shared/index"

export const dataFolder = path.join(app.getPath("appData"), process.env.APP_ID)

export const recordingsFolder = path.join(dataFolder, "recordings")

export const conversationsFolder = path.join(dataFolder, "conversations")

export const configPath = path.join(dataFolder, "config.json")

// Valid Orpheus voices - used for migration validation
const ORPHEUS_ENGLISH_VOICES = ["autumn", "diana", "hannah", "austin", "daniel", "troy"]
const ORPHEUS_ARABIC_VOICES = ["fahad", "sultan", "lulwa", "noura"]

// Valid Groq TTS model IDs
const VALID_GROQ_TTS_MODELS = ["canopylabs/orpheus-v1-english", "canopylabs/orpheus-arabic-saudi"]

/**
 * Migrate deprecated Groq TTS PlayAI models/voices to new Orpheus equivalents.
 * This ensures existing installs with saved PlayAI settings continue to work.
 */
function migrateGroqTtsConfig(config: Partial<Config>): Partial<Config> {
  // Migrate deprecated PlayAI models to Orpheus equivalents
  // Use string comparison since saved config may contain deprecated values not in current type
  const savedModel = config.groqTtsModel as string | undefined
  if (savedModel === "playai-tts") {
    config.groqTtsModel = "canopylabs/orpheus-v1-english"
  } else if (savedModel === "playai-tts-arabic") {
    config.groqTtsModel = "canopylabs/orpheus-arabic-saudi"
  } else if (savedModel && !VALID_GROQ_TTS_MODELS.includes(savedModel)) {
    // Unknown model value (user-edited config.json) - reset to default English model
    config.groqTtsModel = "canopylabs/orpheus-v1-english"
  }

  // Migrate voices: check if voice is valid for the current model
  // Guard with typeof check since config.json is user-editable and groqTtsVoice could be non-string
  const voice = config.groqTtsVoice
  const isValidVoice = voice && typeof voice === "string"
  
  if (config.groqTtsModel === "canopylabs/orpheus-arabic-saudi") {
    // For Arabic model, ensure voice is a valid Arabic voice
    if (!isValidVoice || !ORPHEUS_ARABIC_VOICES.includes(voice)) {
      config.groqTtsVoice = "fahad" // Default Arabic voice
    }
  } else if (config.groqTtsModel === "canopylabs/orpheus-v1-english") {
    // For English model, ensure voice is a valid English voice
    if (!isValidVoice || !ORPHEUS_ENGLISH_VOICES.includes(voice)) {
      config.groqTtsVoice = "troy" // Default English voice
    }
  }

  return config
}

const getConfig = () => {
  // Platform-specific defaults
  const isWindows = process.platform === 'win32'

  const defaultConfig: Partial<Config> = {
    // Onboarding - not completed by default for new users
    onboardingCompleted: false,

    // Recording shortcut: On Windows, use Ctrl+/ to avoid conflicts with common shortcuts
    // On macOS, Hold Ctrl is fine since Cmd is used for most shortcuts
    shortcut: isWindows ? "ctrl-slash" : "hold-ctrl",

    mcpToolsShortcut: "hold-ctrl-alt",
    // Note: mcpToolsEnabled and mcpAgentModeEnabled are deprecated and always treated as true
    // Safety: optional approval prompt before each tool call (off by default)
    mcpRequireApprovalBeforeToolCall: false,
    mcpAutoPasteEnabled: false,
    mcpAutoPasteDelay: 1000, // 1 second delay by default
    mcpMaxIterations: 10, // Default max iterations for agent mode
    mcpUnlimitedIterations: false, // Default to limited iterations
    textInputEnabled: true,

    // Text input: On Windows, use Ctrl+Shift+T to avoid browser new tab conflict
    textInputShortcut: isWindows ? "ctrl-shift-t" : "ctrl-t",
    conversationsEnabled: true,
    maxConversationsToKeep: 100,
    autoSaveConversations: true,
    recordingsCleanupEnabled: true,
    recordingHistoryMaxItems: 2000,
    recordingHistoryRetentionDays: 90,
    recordingFileRetentionDays: 90,
    recordingOrphanGracePeriodMinutes: 5,
    // Settings hotkey defaults
    settingsHotkeyEnabled: true,
    settingsHotkey: "ctrl-shift-s",
    customSettingsHotkey: "",
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
    panelProgressSize: undefined,
    // Floating panel auto-show - when true, panel auto-shows during agent sessions
    floatingPanelAutoShow: true,
    // Hide floating panel when main app is focused (default: enabled)
    hidePanelWhenMainFocused: true,
    // Theme preference defaults
    themePreference: "system",

    // Parakeet STT defaults
    parakeetNumThreads: 2,
    parakeetModelDownloaded: false,

    // App behavior
	    launchAtLogin: false,
	    hideDockIcon: false,

    // TTS defaults
    ttsEnabled: true,
    ttsAutoPlay: true,
    ttsProviderId: "openai",
    ttsPreprocessingEnabled: true,
    ttsRemoveCodeBlocks: true,
    ttsRemoveUrls: true,
    ttsConvertMarkdown: true,
    // LLM-based TTS preprocessing (off by default - uses regex for fast/free processing)
    ttsUseLLMPreprocessing: false,
    // OpenAI TTS defaults
    openaiTtsModel: "tts-1",
    openaiTtsVoice: "alloy",
    openaiTtsSpeed: 1.0,
    openaiTtsResponseFormat: "mp3",
    // OpenAI Compatible Provider defaults
    openaiCompatiblePreset: "openai",
    // Groq TTS defaults
    groqTtsModel: "canopylabs/orpheus-v1-english",
    groqTtsVoice: "troy",
    // Gemini TTS defaults
    geminiTtsModel: "gemini-2.5-flash-preview-tts",
    geminiTtsVoice: "Kore",
    // Supertonic TTS defaults
    supertonicVoice: "M1",
    supertonicLanguage: "en",
    supertonicSpeed: 1.05,
    supertonicSteps: 5,

    // Provider Section Collapse defaults - collapsed by default
    providerSectionCollapsedOpenai: true,
    providerSectionCollapsedGroq: true,
    providerSectionCollapsedGemini: true,

    // API Retry defaults
    apiRetryCount: 3,
    apiRetryBaseDelay: 1000, // 1 second
    apiRetryMaxDelay: 30000, // 30 seconds
    // Context reduction defaults
    mcpContextReductionEnabled: true,
    mcpContextTargetRatio: 0.7,
    mcpContextLastNMessages: 3,
    mcpContextSummarizeCharThreshold: 2000,

    // Tool response processing defaults
    mcpToolResponseProcessingEnabled: true,
    mcpToolResponseLargeThreshold: 20000, // 20KB threshold for processing
    mcpToolResponseCriticalThreshold: 50000, // 50KB threshold for aggressive summarization
    mcpToolResponseChunkSize: 15000, // Size of chunks for processing
    mcpToolResponseProgressUpdates: true, // Show progress updates during processing

    // Completion verification defaults
    mcpVerifyCompletionEnabled: true,
    mcpVerifyContextMaxItems: 10,
    mcpVerifyRetryCount: 1,

    // Parallel tool execution - when enabled, multiple tool calls from a single LLM response are executed concurrently
    mcpParallelToolExecution: true,

    // Message queue - when enabled, users can queue messages while agent is processing (enabled by default)
    mcpMessageQueueEnabled: true,

	    // Remote Server defaults
	    remoteServerEnabled: false,
	    remoteServerPort: 3210,
	    remoteServerBindAddress: "127.0.0.1",
	    remoteServerLogLevel: "info",
	    remoteServerCorsOrigins: ["*"],
	    remoteServerAutoShowPanel: false, // Don't auto-show panel by default for remote sessions

    // WhatsApp Integration defaults
    whatsappEnabled: false,
    whatsappAllowFrom: [],
    whatsappAutoReply: false,
    whatsappLogMessages: false,

    // Streamer Mode - hides sensitive info for screen sharing
    streamerModeEnabled: false,

    // Langfuse Observability - disabled by default
    langfuseEnabled: false,
    langfusePublicKey: undefined,
    langfuseSecretKey: undefined,
    langfuseBaseUrl: undefined, // Uses cloud.langfuse.com by default

    // Dual-Model Agent Mode defaults
    dualModelEnabled: false,
    dualModelSummarizationFrequency: "every_response",
    dualModelSummaryDetailLevel: "compact",
    dualModelAutoSaveImportant: false,
    dualModelInjectMemories: false,

    // Memory System defaults - enabled by default for backwards compatibility
    memoriesEnabled: true,

    // ACP Tool Injection - when true, injects SpeakMCP builtin tools into ACP agent sessions
    // This allows ACP agents to use delegation, settings management, etc.
    acpInjectBuiltinTools: true,

  }

  try {
    const savedConfig = JSON.parse(
      fs.readFileSync(configPath, "utf8"),
    ) as Config
    // Apply migration for deprecated Groq TTS settings
    const mergedConfig = { ...defaultConfig, ...savedConfig }

    // Migration: Remove deprecated mode-specific panel sizes (these were never used)
    delete (mergedConfig as any).panelNormalModeSize
    delete (mergedConfig as any).panelAgentModeSize
    delete (mergedConfig as any).panelTextInputModeSize

    return migrateGroqTtsConfig(mergedConfig)
  } catch {
    return defaultConfig
  }
}

/**
 * Get the active model preset from config, merging built-in presets with saved data
 * This includes API keys, model preferences, and any other saved properties
 */
function getActivePreset(config: Partial<Config>): ModelPreset | undefined {
  const builtIn = getBuiltInModelPresets()
  const savedPresets = config.modelPresets || []
  const currentPresetId = config.currentModelPresetId || DEFAULT_MODEL_PRESET_ID

  // Merge built-in presets with ALL saved properties (apiKey, mcpToolsModel, transcriptProcessingModel, etc.)
  // Filter out undefined values from saved to prevent overwriting built-in defaults with undefined
  const allPresets = builtIn.map(preset => {
    const saved = savedPresets.find(s => s.id === preset.id)
    // Spread saved properties over built-in preset to preserve all customizations
    // Use defensive merge to filter out undefined values that could overwrite defaults
    return saved ? { ...preset, ...Object.fromEntries(Object.entries(saved).filter(([_, v]) => v !== undefined)) } : preset
  })

  // Add custom (non-built-in) presets
  const customPresets = savedPresets.filter(p => !p.isBuiltIn)
  allPresets.push(...customPresets)

  return allPresets.find(p => p.id === currentPresetId)
}

/**
 * Sync the active preset's credentials and model preferences to legacy config fields for backward compatibility.
 * Always syncs all fields together to keep them consistent with the active preset.
 */
function syncPresetToLegacyFields(config: Partial<Config>): Partial<Config> {
  const activePreset = getActivePreset(config)
  if (activePreset) {
    // Always sync both fields to keep them consistent with the active preset
    // If preset has empty values, legacy fields should reflect that
    config.openaiApiKey = activePreset.apiKey || ''
    config.openaiBaseUrl = activePreset.baseUrl || ''

    // Always sync model preferences to keep legacy fields consistent with the active preset
    // If preset has empty/undefined values, legacy fields should reflect that
    config.mcpToolsOpenaiModel = activePreset.mcpToolsModel || ''
    config.transcriptPostProcessingOpenaiModel = activePreset.transcriptProcessingModel || ''
  }
  return config
}

class ConfigStore {
  config: Config | undefined

  constructor() {
    const loadedConfig = getConfig()
    // Sync active preset credentials to legacy fields on startup
    this.config = syncPresetToLegacyFields(loadedConfig) as Config
  }

  get(): Config {
    return (this.config as Config) || ({} as Config)
  }

  save(config: Config) {
    // Sync active preset credentials before saving
    this.config = syncPresetToLegacyFields(config) as Config
    fs.mkdirSync(dataFolder, { recursive: true })
    fs.writeFileSync(configPath, JSON.stringify(this.config))
  }
}

export const configStore = new ConfigStore()
