/**
 * Default configuration values for SpeakMCP
 * Extracted from desktop app for consistency
 */

/**
 * Platform-specific defaults
 */
function getPlatformDefaults() {
  const isWindows = process.platform === 'win32'
  return {
    shortcut: isWindows ? 'ctrl-slash' : 'hold-ctrl',
    textInputShortcut: isWindows ? 'ctrl-shift-t' : 'ctrl-t',
  }
}

/**
 * Get default configuration values
 * These match the desktop app defaults for consistency
 */
export function getDefaultConfig(): Record<string, unknown> {
  const platformDefaults = getPlatformDefaults()

  return {
    // Onboarding
    onboardingCompleted: false,

    // Recording shortcuts (platform-specific)
    shortcut: platformDefaults.shortcut,
    textInputShortcut: platformDefaults.textInputShortcut,
    mcpToolsShortcut: 'hold-ctrl-alt',

    // LLM Provider & Model
    mcpToolsProviderId: 'openai',
    mcpToolsOpenaiModel: 'gpt-4o-mini',
    mcpToolsGroqModel: 'llama-3.3-70b-versatile',
    mcpToolsGeminiModel: 'gemini-2.0-flash-exp',
    mcpToolsDelay: 0,
    currentModelPresetId: 'builtin-openai',

    // MCP Settings
    mcpRequireApprovalBeforeToolCall: false,
    mcpAutoPasteEnabled: false,
    mcpAutoPasteDelay: 1000,
    mcpMaxIterations: 10,
    mcpRuntimeDisabledServers: [],
    mcpDisabledTools: [],
    mcpFinalSummaryEnabled: true,

    // Text input
    textInputEnabled: true,
    conversationsEnabled: true,
    maxConversationsToKeep: 100,
    autoSaveConversations: true,

    // Settings hotkey
    settingsHotkeyEnabled: true,
    settingsHotkey: 'ctrl-shift-s',
    customSettingsHotkey: '',

    // Agent kill switch
    agentKillSwitchEnabled: true,
    agentKillSwitchHotkey: 'ctrl-shift-escape',

    // Panel settings
    panelPosition: 'top-right',
    panelDragEnabled: true,
    panelCustomSize: { width: 300, height: 200 },
    floatingPanelAutoShow: true,
    hidePanelWhenMainFocused: true,

    // Theme
    themePreference: 'system',

    // App behavior
    launchAtLogin: false,
    hideDockIcon: false,

    // TTS defaults
    ttsEnabled: true,
    ttsAutoPlay: true,
    ttsProviderId: 'openai',
    ttsPreprocessingEnabled: true,
    ttsRemoveCodeBlocks: true,
    ttsRemoveUrls: true,
    ttsConvertMarkdown: true,
    ttsUseLLMPreprocessing: false,

    // OpenAI TTS
    openaiTtsModel: 'tts-1',
    openaiTtsVoice: 'alloy',
    openaiTtsSpeed: 1.0,
    openaiTtsResponseFormat: 'mp3',

    // OpenAI Compatible preset
    openaiCompatiblePreset: 'openai',

    // Groq TTS
    groqTtsModel: 'canopylabs/orpheus-v1-english',
    groqTtsVoice: 'troy',

    // Gemini TTS
    geminiTtsModel: 'gemini-2.5-flash-preview-tts',
    geminiTtsVoice: 'Kore',

    // Provider section collapse states
    providerSectionCollapsedOpenai: true,
    providerSectionCollapsedGroq: true,
    providerSectionCollapsedGemini: true,

    // API Retry
    apiRetryCount: 3,
    apiRetryBaseDelay: 1000,
    apiRetryMaxDelay: 30000,

    // Context reduction
    mcpContextReductionEnabled: true,
    mcpContextTargetRatio: 0.7,
    mcpContextLastNMessages: 3,
    mcpContextSummarizeCharThreshold: 2000,

    // Tool response processing
    mcpToolResponseProcessingEnabled: true,
    mcpToolResponseLargeThreshold: 20000,
    mcpToolResponseCriticalThreshold: 50000,
    mcpToolResponseChunkSize: 15000,
    mcpToolResponseProgressUpdates: true,

    // Completion verification
    mcpVerifyCompletionEnabled: true,
    mcpVerifyContextMaxItems: 10,
    mcpVerifyRetryCount: 1,

    // Parallel tool execution
    mcpParallelToolExecution: true,

    // Message queue
    mcpMessageQueueEnabled: true,

    // Remote Server (standalone mode always enables this)
    remoteServerEnabled: true,  // Always enabled for standalone server
    remoteServerPort: 3210,
    remoteServerBindAddress: '127.0.0.1',
    remoteServerLogLevel: 'info',
    remoteServerCorsOrigins: ['*'],
    remoteServerAutoShowPanel: false,

    // WhatsApp (disabled by default)
    whatsappEnabled: false,
    whatsappAllowFrom: [],
    whatsappAutoReply: false,
    whatsappLogMessages: false,

    // Streamer Mode
    streamerModeEnabled: false,

    // Langfuse
    langfuseEnabled: false,
    langfusePublicKey: undefined,
    langfuseSecretKey: undefined,
    langfuseBaseUrl: undefined,

    // Dual-Model
    dualModelEnabled: false,
    dualModelSummarizationFrequency: 'every_response',
    dualModelSummaryDetailLevel: 'compact',
    dualModelAutoSaveImportant: false,
    dualModelInjectMemories: false,

    // Memory System
    memoriesEnabled: true,

    // STT Settings
    sttProviderId: 'openai',
    sttLanguage: '',
    transcriptPostProcessingEnabled: true,
    transcriptPostProcessingProviderId: 'openai',

    // Agent settings
    mainAgentMode: 'api',
    mainAgentName: '',

    // ACP
    acpInjectBuiltinTools: true,
  }
}

/**
 * Groq TTS voice validation
 */
export const ORPHEUS_ENGLISH_VOICES = ['autumn', 'diana', 'hannah', 'austin', 'daniel', 'troy']
export const ORPHEUS_ARABIC_VOICES = ['fahad', 'sultan', 'lulwa', 'noura']
export const VALID_GROQ_TTS_MODELS = ['canopylabs/orpheus-v1-english', 'canopylabs/orpheus-arabic-saudi']

/**
 * Migrate deprecated Groq TTS configurations
 */
export function migrateGroqTtsConfig<T extends Record<string, unknown>>(config: T): T {
  const migrated: Record<string, unknown> = { ...config }

  // Migrate deprecated PlayAI models
  const savedModel = migrated.groqTtsModel as string | undefined
  if (savedModel === 'playai-tts') {
    migrated.groqTtsModel = 'canopylabs/orpheus-v1-english'
  } else if (savedModel === 'playai-tts-arabic') {
    migrated.groqTtsModel = 'canopylabs/orpheus-arabic-saudi'
  } else if (savedModel && !VALID_GROQ_TTS_MODELS.includes(savedModel)) {
    migrated.groqTtsModel = 'canopylabs/orpheus-v1-english'
  }

  // Validate voice for current model
  const voice = migrated.groqTtsVoice as string | undefined
  const isValidVoice = voice && typeof voice === 'string'

  if (migrated.groqTtsModel === 'canopylabs/orpheus-arabic-saudi') {
    if (!isValidVoice || !ORPHEUS_ARABIC_VOICES.includes(voice)) {
      migrated.groqTtsVoice = 'fahad'
    }
  } else if (migrated.groqTtsModel === 'canopylabs/orpheus-v1-english') {
    if (!isValidVoice || !ORPHEUS_ENGLISH_VOICES.includes(voice)) {
      migrated.groqTtsVoice = 'troy'
    }
  }

  return migrated as T
}

