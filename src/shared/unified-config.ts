/**
 * Unified Configuration System
 * 
 * This file defines the new unified configuration structure that replaces
 * the scattered provider-specific configuration fields.
 */

import { UnifiedProviderConfig, ProviderId } from "./provider-system"

// Legacy configuration interface for backward compatibility
export interface LegacyConfig {
  // Provider-specific API keys
  openaiApiKey?: string
  groqApiKey?: string
  geminiApiKey?: string
  
  // Provider-specific base URLs
  openaiBaseUrl?: string
  groqBaseUrl?: string
  geminiBaseUrl?: string
  
  // Base URL history
  openaiBaseUrlHistory?: string[]
  groqBaseUrlHistory?: string[]
  geminiBaseUrlHistory?: string[]
  
  // Provider selections
  sttProviderId?: string
  ttsProviderId?: string
  transcriptPostProcessingProviderId?: string
  mcpToolsProviderId?: string
  
  // Model selections
  mcpToolsOpenaiModel?: string
  mcpToolsGroqModel?: string
  mcpToolsGeminiModel?: string
  transcriptPostProcessingOpenaiModel?: string
  transcriptPostProcessingGroqModel?: string
  transcriptPostProcessingGeminiModel?: string
  
  // STT settings
  sttLanguage?: string
  openaiSttLanguage?: string
  groqSttLanguage?: string
  groqSttPrompt?: string
  
  // TTS settings
  ttsEnabled?: boolean
  ttsAutoPlay?: boolean
  openaiTtsModel?: string
  openaiTtsVoice?: string
  openaiTtsSpeed?: number
  openaiTtsResponseFormat?: string
  groqTtsModel?: string
  groqTtsVoice?: string
  geminiTtsModel?: string
  geminiTtsVoice?: string
  geminiTtsLanguage?: string
  
  // TTS preprocessing
  ttsPreprocessingEnabled?: boolean
  ttsRemoveCodeBlocks?: boolean
  ttsRemoveUrls?: boolean
  ttsConvertMarkdown?: boolean
  
  // Transcript processing
  transcriptPostProcessingEnabled?: boolean
  transcriptPostProcessingPrompt?: string
  
  // API retry settings
  apiRetryCount?: number
  apiRetryBaseDelay?: number
  apiRetryMaxDelay?: number
}

// New unified configuration structure
export interface UnifiedConfig {
  // Core app settings (unchanged)
  shortcut?: "hold-ctrl" | "ctrl-slash" | "custom"
  customShortcut?: string
  hideDockIcon?: boolean
  themePreference?: "system" | "light" | "dark"
  
  // Voice dictation settings
  toggleVoiceDictationEnabled?: boolean
  toggleVoiceDictationHotkey?: "fn" | "f1" | "f2" | "f3" | "f4" | "f5" | "f6" | "f7" | "f8" | "f9" | "f10" | "f11" | "f12" | "custom"
  customToggleVoiceDictationHotkey?: string
  
  // Text input settings
  textInputEnabled?: boolean
  textInputShortcut?: string
  customTextInputShortcut?: string
  
  // MCP settings
  mcpToolsEnabled?: boolean
  mcpToolsShortcut?: string
  customMcpToolsShortcut?: string
  mcpToolsSystemPrompt?: string
  mcpAgentModeEnabled?: boolean
  mcpRequireApprovalBeforeToolCall?: boolean
  mcpMaxIterations?: number
  mcpAutoPasteEnabled?: boolean
  mcpAutoPasteDelay?: number
  mcpRuntimeDisabledServers?: string[]
  
  // Agent settings
  agentKillSwitchEnabled?: boolean
  agentKillSwitchHotkey?: string
  customAgentKillSwitchHotkey?: string
  
  // Conversation settings
  conversationsEnabled?: boolean
  maxConversationsToKeep?: number
  autoSaveConversations?: boolean
  
  // Panel settings
  panelPosition?: string
  panelDragEnabled?: boolean
  panelCustomSize?: { width: number; height: number }
  
  // Service-specific settings
  services?: {
    stt?: {
      enabled?: boolean
      language?: string
    }
    tts?: {
      enabled?: boolean
      autoPlay?: boolean
      preprocessing?: {
        enabled?: boolean
        removeCodeBlocks?: boolean
        removeUrls?: boolean
        convertMarkdown?: boolean
      }
    }
    transcriptProcessing?: {
      enabled?: boolean
      prompt?: string
    }
  }
  
  // NEW: Unified provider configuration
  providers?: UnifiedProviderConfig
  
  // Legacy fields for backward compatibility (will be migrated)
  _legacy?: LegacyConfig
}

// Configuration migration utilities
export interface ConfigMigrator {
  /**
   * Migrate legacy configuration to unified format
   */
  migrate(legacyConfig: LegacyConfig): UnifiedConfig
  
  /**
   * Check if configuration needs migration
   */
  needsMigration(config: any): boolean
  
  /**
   * Get migration version
   */
  getVersion(): number
}

export class ConfigMigrationService implements ConfigMigrator {
  private readonly CURRENT_VERSION = 1

  migrate(legacyConfig: LegacyConfig): UnifiedConfig {
    const unifiedConfig: UnifiedConfig = {
      // Preserve non-provider settings as-is
      shortcut: legacyConfig.shortcut as any,
      customShortcut: legacyConfig.customShortcut,
      hideDockIcon: legacyConfig.hideDockIcon,
      themePreference: legacyConfig.themePreference as any,
      
      // Migrate service settings
      services: {
        stt: {
          enabled: true,
          language: legacyConfig.sttLanguage || "auto",
        },
        tts: {
          enabled: legacyConfig.ttsEnabled ?? true,
          autoPlay: legacyConfig.ttsAutoPlay ?? true,
          preprocessing: {
            enabled: legacyConfig.ttsPreprocessingEnabled ?? true,
            removeCodeBlocks: legacyConfig.ttsRemoveCodeBlocks ?? true,
            removeUrls: legacyConfig.ttsRemoveUrls ?? true,
            convertMarkdown: legacyConfig.ttsConvertMarkdown ?? true,
          },
        },
        transcriptProcessing: {
          enabled: legacyConfig.transcriptPostProcessingEnabled ?? false,
          prompt: legacyConfig.transcriptPostProcessingPrompt,
        },
      },
      
      // Create unified provider configuration
      providers: {
        activeProviders: {
          chat: (legacyConfig.mcpToolsProviderId as ProviderId) || "openai",
          stt: (legacyConfig.sttProviderId as ProviderId) || "openai",
          tts: (legacyConfig.ttsProviderId as ProviderId) || "openai",
        },
        providers: {
          openai: {
            apiKey: legacyConfig.openaiApiKey,
            baseUrl: legacyConfig.openaiBaseUrl,
            baseUrlHistory: legacyConfig.openaiBaseUrlHistory || [],
            chat: {
              mcpModel: legacyConfig.mcpToolsOpenaiModel,
              transcriptModel: legacyConfig.transcriptPostProcessingOpenaiModel,
            },
            stt: {
              language: legacyConfig.openaiSttLanguage || legacyConfig.sttLanguage,
            },
            tts: {
              model: legacyConfig.openaiTtsModel,
              voice: legacyConfig.openaiTtsVoice,
              speed: legacyConfig.openaiTtsSpeed,
              responseFormat: legacyConfig.openaiTtsResponseFormat,
            },
          },
          groq: {
            apiKey: legacyConfig.groqApiKey,
            baseUrl: legacyConfig.groqBaseUrl,
            baseUrlHistory: legacyConfig.groqBaseUrlHistory || [],
            chat: {
              mcpModel: legacyConfig.mcpToolsGroqModel,
              transcriptModel: legacyConfig.transcriptPostProcessingGroqModel,
            },
            stt: {
              language: legacyConfig.groqSttLanguage || legacyConfig.sttLanguage,
              prompt: legacyConfig.groqSttPrompt,
            },
            tts: {
              model: legacyConfig.groqTtsModel,
              voice: legacyConfig.groqTtsVoice,
            },
          },
          gemini: {
            apiKey: legacyConfig.geminiApiKey,
            baseUrl: legacyConfig.geminiBaseUrl,
            baseUrlHistory: legacyConfig.geminiBaseUrlHistory || [],
            chat: {
              mcpModel: legacyConfig.mcpToolsGeminiModel,
              transcriptModel: legacyConfig.transcriptPostProcessingGeminiModel,
            },
            tts: {
              model: legacyConfig.geminiTtsModel,
              voice: legacyConfig.geminiTtsVoice,
              language: legacyConfig.geminiTtsLanguage,
            },
          },
        },
        global: {
          apiRetryCount: legacyConfig.apiRetryCount || 3,
          apiRetryBaseDelay: legacyConfig.apiRetryBaseDelay || 1000,
          apiRetryMaxDelay: legacyConfig.apiRetryMaxDelay || 30000,
          cacheModels: true,
          cacheDuration: 5 * 60 * 1000, // 5 minutes
        },
      },
      
      // Store legacy config for reference during transition
      _legacy: legacyConfig,
    }

    return unifiedConfig
  }

  needsMigration(config: any): boolean {
    // Check if config has legacy provider-specific fields
    const hasLegacyFields = !!(
      config.openaiApiKey ||
      config.groqApiKey ||
      config.geminiApiKey ||
      config.sttProviderId ||
      config.ttsProviderId ||
      config.mcpToolsProviderId
    )

    // Check if config lacks unified provider structure
    const lacksUnifiedStructure = !config.providers

    return hasLegacyFields || lacksUnifiedStructure
  }

  getVersion(): number {
    return this.CURRENT_VERSION
  }
}

// Utility functions for working with unified config
export class UnifiedConfigUtils {
  /**
   * Get provider configuration for a specific provider
   */
  static getProviderConfig(config: UnifiedConfig, providerId: ProviderId) {
    return config.providers?.providers[providerId]
  }

  /**
   * Get active provider for a service
   */
  static getActiveProvider(config: UnifiedConfig, service: "chat" | "stt" | "tts"): ProviderId {
    return config.providers?.activeProviders[service] || "openai"
  }

  /**
   * Update provider configuration
   */
  static updateProviderConfig(
    config: UnifiedConfig,
    providerId: ProviderId,
    updates: Partial<any>
  ): UnifiedConfig {
    if (!config.providers) {
      config.providers = {
        activeProviders: { chat: "openai", stt: "openai", tts: "openai" },
        providers: { openai: {}, groq: {}, gemini: {} },
        global: {
          apiRetryCount: 3,
          apiRetryBaseDelay: 1000,
          apiRetryMaxDelay: 30000,
          cacheModels: true,
          cacheDuration: 5 * 60 * 1000,
        },
      }
    }

    return {
      ...config,
      providers: {
        ...config.providers,
        providers: {
          ...config.providers.providers,
          [providerId]: {
            ...config.providers.providers[providerId],
            ...updates,
          },
        },
      },
    }
  }

  /**
   * Set active provider for a service
   */
  static setActiveProvider(
    config: UnifiedConfig,
    service: "chat" | "stt" | "tts",
    providerId: ProviderId
  ): UnifiedConfig {
    if (!config.providers) {
      config.providers = {
        activeProviders: { chat: "openai", stt: "openai", tts: "openai" },
        providers: { openai: {}, groq: {}, gemini: {} },
        global: {
          apiRetryCount: 3,
          apiRetryBaseDelay: 1000,
          apiRetryMaxDelay: 30000,
          cacheModels: true,
          cacheDuration: 5 * 60 * 1000,
        },
      }
    }

    return {
      ...config,
      providers: {
        ...config.providers,
        activeProviders: {
          ...config.providers.activeProviders,
          [service]: providerId,
        },
      },
    }
  }
}

// Export singleton migrator
export const configMigrator = new ConfigMigrationService()
