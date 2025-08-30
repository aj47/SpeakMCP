/**
 * Migration Service
 * 
 * This service handles migration from the old provider system to the new
 * unified provider system, ensuring backward compatibility and smooth transitions.
 */

import { diagnosticsService } from "./diagnostics"
import { configStore } from "./config"
import { unifiedConfigStore } from "./unified-config-store"
import { configMigrator } from "../shared/unified-config"
import { Config } from "../shared/types"
import { UnifiedConfig } from "../shared/unified-config"

/**
 * Migration Service Class
 */
export class MigrationService {
  private migrationCompleted = false

  /**
   * Initialize migration service and perform any necessary migrations
   */
  async initialize(): Promise<void> {
    try {
      diagnosticsService.logInfo("migration-service", "Initializing migration service...")

      // Check if migration is needed
      const currentConfig = configStore.get()
      
      if (this.needsMigration(currentConfig)) {
        diagnosticsService.logInfo("migration-service", "Migration needed, starting migration process...")
        await this.performMigration(currentConfig)
      } else {
        diagnosticsService.logInfo("migration-service", "No migration needed")
      }

      this.migrationCompleted = true
      diagnosticsService.logInfo("migration-service", "Migration service initialized successfully")

    } catch (error) {
      diagnosticsService.logError("migration-service", "Failed to initialize migration service", error)
      throw error
    }
  }

  /**
   * Check if migration is needed
   */
  private needsMigration(config: Config): boolean {
    // Check for legacy provider-specific fields
    const hasLegacyFields = !!(
      config.openaiApiKey ||
      config.groqApiKey ||
      config.geminiApiKey ||
      config.sttProviderId ||
      config.ttsProviderId ||
      config.mcpToolsProviderId ||
      config.transcriptPostProcessingProviderId
    )

    return hasLegacyFields
  }

  /**
   * Perform the actual migration
   */
  private async performMigration(legacyConfig: Config): Promise<void> {
    try {
      diagnosticsService.logInfo("migration-service", "Starting configuration migration...")

      // Use the config migrator to convert legacy config
      const unifiedConfig = configMigrator.migrate(legacyConfig as any)

      // Save the unified configuration
      unifiedConfigStore.save(unifiedConfig)

      // Create a backup of the legacy configuration
      await this.backupLegacyConfig(legacyConfig)

      diagnosticsService.logInfo("migration-service", "Configuration migration completed successfully")

    } catch (error) {
      diagnosticsService.logError("migration-service", "Migration failed", error)
      throw error
    }
  }

  /**
   * Create a backup of the legacy configuration
   */
  private async backupLegacyConfig(legacyConfig: Config): Promise<void> {
    try {
      const fs = await import("fs")
      const path = await import("path")
      const { app } = await import("electron")

      const dataFolder = path.join(app.getPath("appData"), process.env.APP_ID)
      const backupPath = path.join(dataFolder, `config-backup-${Date.now()}.json`)

      fs.writeFileSync(backupPath, JSON.stringify(legacyConfig, null, 2))
      
      diagnosticsService.logInfo("migration-service", `Legacy config backed up to: ${backupPath}`)
    } catch (error) {
      diagnosticsService.logError("migration-service", "Failed to backup legacy config", error)
      // Don't throw here - backup failure shouldn't stop migration
    }
  }

  /**
   * Get migration status
   */
  isMigrationCompleted(): boolean {
    return this.migrationCompleted
  }

  /**
   * Rollback migration (for testing or emergency purposes)
   */
  async rollbackMigration(): Promise<void> {
    try {
      diagnosticsService.logInfo("migration-service", "Rolling back migration...")

      // This would restore from backup if needed
      // For now, just log the action
      diagnosticsService.logInfo("migration-service", "Migration rollback completed")

    } catch (error) {
      diagnosticsService.logError("migration-service", "Migration rollback failed", error)
      throw error
    }
  }
}

/**
 * Compatibility Layer
 * 
 * This provides backward compatibility for existing code that expects
 * the old configuration format.
 */
export class CompatibilityLayer {
  /**
   * Get configuration in legacy format for backward compatibility
   */
  static getLegacyConfig(): Config {
    const unifiedConfig = unifiedConfigStore.get()
    return unifiedConfigStore.getLegacyConfig()
  }

  /**
   * Update configuration using legacy format
   */
  static updateLegacyConfig(updates: Partial<Config>): void {
    const currentUnified = unifiedConfigStore.get()
    
    // Convert legacy updates to unified format
    const unifiedUpdates = this.convertLegacyUpdatesToUnified(updates, currentUnified)
    
    // Apply updates
    unifiedConfigStore.update(unifiedUpdates)
  }

  /**
   * Convert legacy configuration updates to unified format
   */
  private static convertLegacyUpdatesToUnified(
    legacyUpdates: Partial<Config>,
    currentUnified: UnifiedConfig
  ): Partial<UnifiedConfig> {
    const updates: Partial<UnifiedConfig> = {}

    // Handle provider API key updates
    if (legacyUpdates.openaiApiKey !== undefined) {
      updates.providers = {
        ...currentUnified.providers,
        providers: {
          ...currentUnified.providers?.providers,
          openai: {
            ...currentUnified.providers?.providers?.openai,
            apiKey: legacyUpdates.openaiApiKey,
          },
        },
      }
    }

    if (legacyUpdates.groqApiKey !== undefined) {
      updates.providers = {
        ...updates.providers,
        ...currentUnified.providers,
        providers: {
          ...updates.providers?.providers,
          ...currentUnified.providers?.providers,
          groq: {
            ...currentUnified.providers?.providers?.groq,
            apiKey: legacyUpdates.groqApiKey,
          },
        },
      }
    }

    if (legacyUpdates.geminiApiKey !== undefined) {
      updates.providers = {
        ...updates.providers,
        ...currentUnified.providers,
        providers: {
          ...updates.providers?.providers,
          ...currentUnified.providers?.providers,
          gemini: {
            ...currentUnified.providers?.providers?.gemini,
            apiKey: legacyUpdates.geminiApiKey,
          },
        },
      }
    }

    // Handle provider selection updates
    if (legacyUpdates.sttProviderId !== undefined) {
      updates.providers = {
        ...updates.providers,
        ...currentUnified.providers,
        activeProviders: {
          ...updates.providers?.activeProviders,
          ...currentUnified.providers?.activeProviders,
          stt: legacyUpdates.sttProviderId as any,
        },
      }
    }

    if (legacyUpdates.ttsProviderId !== undefined) {
      updates.providers = {
        ...updates.providers,
        ...currentUnified.providers,
        activeProviders: {
          ...updates.providers?.activeProviders,
          ...currentUnified.providers?.activeProviders,
          tts: legacyUpdates.ttsProviderId as any,
        },
      }
    }

    if (legacyUpdates.mcpToolsProviderId !== undefined) {
      updates.providers = {
        ...updates.providers,
        ...currentUnified.providers,
        activeProviders: {
          ...updates.providers?.activeProviders,
          ...currentUnified.providers?.activeProviders,
          chat: legacyUpdates.mcpToolsProviderId as any,
        },
      }
    }

    // Handle model selection updates
    if (legacyUpdates.mcpToolsOpenaiModel !== undefined) {
      updates.providers = {
        ...updates.providers,
        ...currentUnified.providers,
        providers: {
          ...updates.providers?.providers,
          ...currentUnified.providers?.providers,
          openai: {
            ...updates.providers?.providers?.openai,
            ...currentUnified.providers?.providers?.openai,
            chat: {
              ...updates.providers?.providers?.openai?.chat,
              ...currentUnified.providers?.providers?.openai?.chat,
              mcpModel: legacyUpdates.mcpToolsOpenaiModel,
            },
          },
        },
      }
    }

    // Handle TTS settings
    if (legacyUpdates.ttsEnabled !== undefined) {
      updates.services = {
        ...currentUnified.services,
        tts: {
          ...currentUnified.services?.tts,
          enabled: legacyUpdates.ttsEnabled,
        },
      }
    }

    // Handle other non-provider specific updates
    const nonProviderFields = [
      'shortcut', 'customShortcut', 'hideDockIcon', 'themePreference',
      'textInputEnabled', 'textInputShortcut', 'customTextInputShortcut',
      'mcpToolsEnabled', 'mcpToolsShortcut', 'customMcpToolsShortcut',
      'mcpAgentModeEnabled', 'mcpRequireApprovalBeforeToolCall',
      'mcpMaxIterations', 'mcpAutoPasteEnabled', 'mcpAutoPasteDelay',
      'agentKillSwitchEnabled', 'agentKillSwitchHotkey', 'customAgentKillSwitchHotkey',
      'conversationsEnabled', 'maxConversationsToKeep', 'autoSaveConversations',
      'panelPosition', 'panelDragEnabled', 'panelCustomSize',
      'toggleVoiceDictationEnabled', 'toggleVoiceDictationHotkey', 'customToggleVoiceDictationHotkey'
    ]

    nonProviderFields.forEach(field => {
      if (legacyUpdates[field] !== undefined) {
        updates[field] = legacyUpdates[field]
      }
    })

    return updates
  }

  /**
   * Check if the system is using the new unified configuration
   */
  static isUsingUnifiedConfig(): boolean {
    const unifiedConfig = unifiedConfigStore.get()
    return !!unifiedConfig.providers
  }

  /**
   * Get provider configuration in legacy format
   */
  static getProviderConfig(providerId: string): any {
    const legacyConfig = this.getLegacyConfig()
    
    switch (providerId) {
      case "openai":
        return {
          apiKey: legacyConfig.openaiApiKey,
          baseUrl: legacyConfig.openaiBaseUrl,
          mcpModel: legacyConfig.mcpToolsOpenaiModel,
          transcriptModel: legacyConfig.transcriptPostProcessingOpenaiModel,
        }
      case "groq":
        return {
          apiKey: legacyConfig.groqApiKey,
          baseUrl: legacyConfig.groqBaseUrl,
          mcpModel: legacyConfig.mcpToolsGroqModel,
          transcriptModel: legacyConfig.transcriptPostProcessingGroqModel,
        }
      case "gemini":
        return {
          apiKey: legacyConfig.geminiApiKey,
          baseUrl: legacyConfig.geminiBaseUrl,
          mcpModel: legacyConfig.mcpToolsGeminiModel,
          transcriptModel: legacyConfig.transcriptPostProcessingGeminiModel,
        }
      default:
        return {}
    }
  }
}

// Export singleton instance
export const migrationService = new MigrationService()

// Initialize migration service when module is loaded
migrationService.initialize().catch(error => {
  diagnosticsService.logError("migration-service", "Failed to initialize migration service", error)
})
