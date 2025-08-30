/**
 * Unified Configuration Store
 * 
 * This replaces the existing config store with support for the new
 * unified provider system and automatic migration from legacy configs.
 */

import { app } from "electron"
import path from "path"
import fs from "fs"
import { UnifiedConfig, LegacyConfig, configMigrator, UnifiedConfigUtils } from "../shared/unified-config"
import { ProviderId } from "../shared/provider-system"
import { diagnosticsService } from "./diagnostics"

export const dataFolder = path.join(app.getPath("appData"), process.env.APP_ID)
export const recordingsFolder = path.join(dataFolder, "recordings")
export const conversationsFolder = path.join(dataFolder, "conversations")
export const configPath = path.join(dataFolder, "config.json")
export const legacyConfigBackupPath = path.join(dataFolder, "config-legacy-backup.json")

/**
 * Get default unified configuration
 */
const getDefaultUnifiedConfig = (): UnifiedConfig => {
  return {
    // Core app settings
    shortcut: "hold-ctrl",
    hideDockIcon: false,
    themePreference: "system",
    
    // Voice dictation
    toggleVoiceDictationEnabled: false,
    toggleVoiceDictationHotkey: "fn",
    
    // Text input
    textInputEnabled: true,
    textInputShortcut: "ctrl-t",
    
    // MCP settings
    mcpToolsEnabled: true,
    mcpToolsShortcut: "hold-ctrl-alt",
    mcpAgentModeEnabled: true,
    mcpRequireApprovalBeforeToolCall: false,
    mcpAutoPasteEnabled: false,
    mcpAutoPasteDelay: 1000,
    mcpMaxIterations: 10,
    mcpRuntimeDisabledServers: [],
    
    // Agent settings
    agentKillSwitchEnabled: true,
    agentKillSwitchHotkey: "ctrl-shift-escape",
    
    // Conversation settings
    conversationsEnabled: true,
    maxConversationsToKeep: 100,
    autoSaveConversations: true,
    
    // Panel settings
    panelPosition: "top-right",
    panelDragEnabled: true,
    panelCustomSize: { width: 300, height: 200 },
    
    // Service settings
    services: {
      stt: {
        enabled: true,
        language: "auto",
      },
      tts: {
        enabled: true,
        autoPlay: true,
        preprocessing: {
          enabled: true,
          removeCodeBlocks: true,
          removeUrls: true,
          convertMarkdown: true,
        },
      },
      transcriptProcessing: {
        enabled: false,
      },
    },
    
    // Unified provider configuration
    providers: {
      activeProviders: {
        chat: "openai",
        stt: "openai",
        tts: "openai",
      },
      providers: {
        openai: {
          baseUrl: "https://api.openai.com/v1",
          baseUrlHistory: [],
          chat: {
            defaultModel: "gpt-4o-mini",
            mcpModel: "gpt-4o-mini",
            transcriptModel: "gpt-4o-mini",
            temperature: 0,
          },
          stt: {
            model: "whisper-1",
            language: "auto",
          },
          tts: {
            model: "tts-1",
            voice: "alloy",
            speed: 1.0,
            responseFormat: "mp3",
          },
          timeout: 30000,
          retryCount: 3,
          retryDelay: 1000,
        },
        groq: {
          baseUrl: "https://api.groq.com/openai/v1",
          baseUrlHistory: [],
          chat: {
            defaultModel: "llama-3.1-70b-versatile",
            mcpModel: "llama-3.1-70b-versatile",
            transcriptModel: "llama-3.1-70b-versatile",
            temperature: 0,
          },
          stt: {
            model: "whisper-large-v3",
            language: "auto",
          },
          tts: {
            model: "playai-tts",
            voice: "Fritz-PlayAI",
          },
          timeout: 30000,
          retryCount: 3,
          retryDelay: 1000,
        },
        gemini: {
          baseUrl: "https://generativelanguage.googleapis.com",
          baseUrlHistory: [],
          chat: {
            defaultModel: "gemini-1.5-flash-002",
            mcpModel: "gemini-1.5-flash-002",
            transcriptModel: "gemini-1.5-flash-002",
            temperature: 0,
          },
          tts: {
            model: "gemini-2.5-flash-preview-tts",
            voice: "Kore",
          },
          timeout: 30000,
          retryCount: 3,
          retryDelay: 1000,
        },
      },
      global: {
        apiRetryCount: 3,
        apiRetryBaseDelay: 1000,
        apiRetryMaxDelay: 30000,
        cacheModels: true,
        cacheDuration: 5 * 60 * 1000, // 5 minutes
      },
    },
  }
}

/**
 * Load configuration from disk with automatic migration
 */
const loadConfig = (): UnifiedConfig => {
  try {
    if (!fs.existsSync(configPath)) {
      diagnosticsService.logInfo("unified-config-store", "No config file found, using defaults")
      return getDefaultUnifiedConfig()
    }

    const configData = fs.readFileSync(configPath, "utf8")
    const rawConfig = JSON.parse(configData)

    // Check if migration is needed
    if (configMigrator.needsMigration(rawConfig)) {
      diagnosticsService.logInfo("unified-config-store", "Legacy configuration detected, migrating...")
      
      // Backup legacy config
      try {
        fs.writeFileSync(legacyConfigBackupPath, configData)
        diagnosticsService.logInfo("unified-config-store", "Legacy config backed up")
      } catch (backupError) {
        diagnosticsService.logError("unified-config-store", "Failed to backup legacy config", backupError)
      }

      // Migrate configuration
      const migratedConfig = configMigrator.migrate(rawConfig as LegacyConfig)
      
      // Save migrated config
      try {
        saveConfigToDisk(migratedConfig)
        diagnosticsService.logInfo("unified-config-store", "Configuration migrated successfully")
      } catch (saveError) {
        diagnosticsService.logError("unified-config-store", "Failed to save migrated config", saveError)
        // Fall back to default config
        return getDefaultUnifiedConfig()
      }

      return migratedConfig
    }

    // Merge with defaults to ensure all fields are present
    const defaultConfig = getDefaultUnifiedConfig()
    const mergedConfig = deepMerge(defaultConfig, rawConfig)
    
    diagnosticsService.logInfo("unified-config-store", "Configuration loaded successfully")
    return mergedConfig

  } catch (error) {
    diagnosticsService.logError("unified-config-store", "Failed to load configuration", error)
    return getDefaultUnifiedConfig()
  }
}

/**
 * Save configuration to disk
 */
const saveConfigToDisk = (config: UnifiedConfig): void => {
  try {
    fs.mkdirSync(dataFolder, { recursive: true })
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
  } catch (error) {
    diagnosticsService.logError("unified-config-store", "Failed to save configuration", error)
    throw error
  }
}

/**
 * Deep merge two objects
 */
const deepMerge = (target: any, source: any): any => {
  const result = { ...target }
  
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key])
    } else {
      result[key] = source[key]
    }
  }
  
  return result
}

/**
 * Unified Configuration Store Class
 */
class UnifiedConfigStore {
  private config: UnifiedConfig

  constructor() {
    this.config = loadConfig()
  }

  /**
   * Get the current configuration
   */
  get(): UnifiedConfig {
    return this.config
  }

  /**
   * Save the entire configuration
   */
  save(config: UnifiedConfig): void {
    this.config = config
    saveConfigToDisk(config)
    diagnosticsService.logInfo("unified-config-store", "Configuration saved")
  }

  /**
   * Update specific configuration fields
   */
  update(updates: Partial<UnifiedConfig>): void {
    this.config = deepMerge(this.config, updates)
    saveConfigToDisk(this.config)
    diagnosticsService.logInfo("unified-config-store", "Configuration updated")
  }

  /**
   * Get provider configuration
   */
  getProviderConfig(providerId: ProviderId) {
    return UnifiedConfigUtils.getProviderConfig(this.config, providerId)
  }

  /**
   * Update provider configuration
   */
  updateProviderConfig(providerId: ProviderId, updates: Partial<any>): void {
    this.config = UnifiedConfigUtils.updateProviderConfig(this.config, providerId, updates)
    saveConfigToDisk(this.config)
    diagnosticsService.logInfo("unified-config-store", `Provider ${providerId} configuration updated`)
  }

  /**
   * Get active provider for a service
   */
  getActiveProvider(service: "chat" | "stt" | "tts"): ProviderId {
    return UnifiedConfigUtils.getActiveProvider(this.config, service)
  }

  /**
   * Set active provider for a service
   */
  setActiveProvider(service: "chat" | "stt" | "tts", providerId: ProviderId): void {
    this.config = UnifiedConfigUtils.setActiveProvider(this.config, service, providerId)
    saveConfigToDisk(this.config)
    diagnosticsService.logInfo("unified-config-store", `Active ${service} provider set to ${providerId}`)
  }

  /**
   * Get legacy configuration for backward compatibility
   */
  getLegacyConfig(): LegacyConfig {
    // Convert unified config back to legacy format for components that haven't been updated yet
    const providers = this.config.providers
    if (!providers) return {}

    const openaiConfig = providers.providers.openai || {}
    const groqConfig = providers.providers.groq || {}
    const geminiConfig = providers.providers.gemini || {}

    return {
      // API keys
      openaiApiKey: openaiConfig.apiKey,
      groqApiKey: groqConfig.apiKey,
      geminiApiKey: geminiConfig.apiKey,
      
      // Base URLs
      openaiBaseUrl: openaiConfig.baseUrl,
      groqBaseUrl: groqConfig.baseUrl,
      geminiBaseUrl: geminiConfig.baseUrl,
      
      // Base URL history
      openaiBaseUrlHistory: openaiConfig.baseUrlHistory,
      groqBaseUrlHistory: groqConfig.baseUrlHistory,
      geminiBaseUrlHistory: geminiConfig.baseUrlHistory,
      
      // Provider selections
      sttProviderId: providers.activeProviders.stt,
      ttsProviderId: providers.activeProviders.tts,
      mcpToolsProviderId: providers.activeProviders.chat,
      transcriptPostProcessingProviderId: providers.activeProviders.chat,
      
      // Model selections
      mcpToolsOpenaiModel: openaiConfig.chat?.mcpModel,
      mcpToolsGroqModel: groqConfig.chat?.mcpModel,
      mcpToolsGeminiModel: geminiConfig.chat?.mcpModel,
      transcriptPostProcessingOpenaiModel: openaiConfig.chat?.transcriptModel,
      transcriptPostProcessingGroqModel: groqConfig.chat?.transcriptModel,
      transcriptPostProcessingGeminiModel: geminiConfig.chat?.transcriptModel,
      
      // STT settings
      sttLanguage: this.config.services?.stt?.language,
      openaiSttLanguage: openaiConfig.stt?.language,
      groqSttLanguage: groqConfig.stt?.language,
      groqSttPrompt: groqConfig.stt?.prompt,
      
      // TTS settings
      ttsEnabled: this.config.services?.tts?.enabled,
      ttsAutoPlay: this.config.services?.tts?.autoPlay,
      openaiTtsModel: openaiConfig.tts?.model,
      openaiTtsVoice: openaiConfig.tts?.voice,
      openaiTtsSpeed: openaiConfig.tts?.speed,
      openaiTtsResponseFormat: openaiConfig.tts?.responseFormat,
      groqTtsModel: groqConfig.tts?.model,
      groqTtsVoice: groqConfig.tts?.voice,
      geminiTtsModel: geminiConfig.tts?.model,
      geminiTtsVoice: geminiConfig.tts?.voice,
      geminiTtsLanguage: geminiConfig.tts?.language,
      
      // TTS preprocessing
      ttsPreprocessingEnabled: this.config.services?.tts?.preprocessing?.enabled,
      ttsRemoveCodeBlocks: this.config.services?.tts?.preprocessing?.removeCodeBlocks,
      ttsRemoveUrls: this.config.services?.tts?.preprocessing?.removeUrls,
      ttsConvertMarkdown: this.config.services?.tts?.preprocessing?.convertMarkdown,
      
      // Transcript processing
      transcriptPostProcessingEnabled: this.config.services?.transcriptProcessing?.enabled,
      transcriptPostProcessingPrompt: this.config.services?.transcriptProcessing?.prompt,
      
      // API retry settings
      apiRetryCount: providers.global.apiRetryCount,
      apiRetryBaseDelay: providers.global.apiRetryBaseDelay,
      apiRetryMaxDelay: providers.global.apiRetryMaxDelay,
    }
  }
}

// Export singleton instance
export const unifiedConfigStore = new UnifiedConfigStore()

// Export class for testing
export { UnifiedConfigStore }
