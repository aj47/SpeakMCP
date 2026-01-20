/**
 * ConfigStore - Central configuration management for SpeakMCP server
 * Combines file-based config with environment variable overrides
 */

import fs from 'fs'
import { getConfigPath, getDataDir, ensureDir } from './paths'
import { getEnvConfig, mergeWithEnvConfig } from './env'
import { getDefaultConfig, migrateGroqTtsConfig } from './defaults'

/**
 * Generic Config type - will be refined as we port more types
 */
export type Config = Record<string, unknown>

/**
 * Load config from file with defaults
 */
function loadConfig(): Config {
  const defaultConfig = getDefaultConfig()
  const configPath = getConfigPath()

  try {
    if (fs.existsSync(configPath)) {
      const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      const merged = { ...defaultConfig, ...savedConfig }

      // Apply migrations
      const migrated = migrateGroqTtsConfig(merged)

      // Remove deprecated panel size fields if present
      delete (migrated as any).panelNormalModeSize
      delete (migrated as any).panelAgentModeSize
      delete (migrated as any).panelTextInputModeSize

      return migrated
    }
  } catch (error) {
    // If config file is invalid, use defaults
    console.warn('Failed to load config file, using defaults:', error)
  }

  return defaultConfig
}

/**
 * ConfigStore class - manages configuration with file persistence
 */
class ConfigStore {
  private config: Config

  constructor() {
    // Load config from file
    const fileConfig = loadConfig()
    // Apply environment variable overrides
    this.config = mergeWithEnvConfig(fileConfig) as Config
  }

  /**
   * Get the current configuration
   */
  get(): Config {
    return this.config || {}
  }

  /**
   * Save configuration to file and update in-memory state
   */
  save(config: Config): void {
    this.config = config

    // Ensure data directory exists
    ensureDir(getDataDir())

    // Write to file
    const configPath = getConfigPath()
    fs.writeFileSync(configPath, JSON.stringify(this.config, null, 2))
  }

  /**
   * Update specific config values without replacing the entire config
   */
  update(updates: Partial<Config>): void {
    this.save({ ...this.config, ...updates })
  }

  /**
   * Reload configuration from file
   */
  reload(): void {
    const fileConfig = loadConfig()
    this.config = mergeWithEnvConfig(fileConfig) as Config
  }
}

// Singleton instance
let configStoreInstance: ConfigStore | null = null

/**
 * Get the ConfigStore singleton
 */
export function getConfigStore(): ConfigStore {
  if (!configStoreInstance) {
    configStoreInstance = new ConfigStore()
  }
  return configStoreInstance
}

/**
 * Export singleton instance for backward compatibility
 * This matches the desktop app's export pattern
 */
export const configStore = {
  get config(): Config {
    return getConfigStore().get()
  },
  get(): Config {
    return getConfigStore().get()
  },
  save(config: Config): void {
    getConfigStore().save(config)
  },
  update(updates: Partial<Config>): void {
    getConfigStore().update(updates)
  },
  reload(): void {
    getConfigStore().reload()
  },
}

// Re-export path utilities for convenience
export { getDataDir, getConfigPath, getConversationsFolder, getRecordingsFolder, getProfilesFolder, getMemoriesFolder, getOAuthStoragePath, ensureDir, ensureDataDirs } from './paths'

// Re-export env utilities
export { getEnvConfig, isStandaloneServer, isDevelopment } from './env'

