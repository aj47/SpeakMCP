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

interface ModelPresetLike {
  id?: unknown
  name?: unknown
  baseUrl?: unknown
  apiKey?: unknown
  isBuiltIn?: unknown
  mcpToolsModel?: unknown
  transcriptProcessingModel?: unknown
  [key: string]: unknown
}

const BUILTIN_MODEL_PRESETS: ModelPresetLike[] = [
  {
    id: 'builtin-openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    isBuiltIn: true,
  },
  {
    id: 'builtin-openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiKey: '',
    isBuiltIn: true,
  },
  {
    id: 'builtin-together',
    name: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    apiKey: '',
    isBuiltIn: true,
  },
  {
    id: 'builtin-cerebras',
    name: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    apiKey: '',
    isBuiltIn: true,
  },
  {
    id: 'builtin-zhipu',
    name: 'Zhipu GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: '',
    isBuiltIn: true,
  },
  {
    id: 'builtin-perplexity',
    name: 'Perplexity',
    baseUrl: 'https://api.perplexity.ai',
    apiKey: '',
    isBuiltIn: true,
  },
]

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getActivePreset(config: Config): ModelPresetLike | undefined {
  const savedPresetsRaw = config.modelPresets
  const savedPresets = Array.isArray(savedPresetsRaw)
    ? savedPresetsRaw.filter(isObject) as ModelPresetLike[]
    : []

  const currentPresetId =
    typeof config.currentModelPresetId === 'string' && config.currentModelPresetId.length > 0
      ? config.currentModelPresetId
      : 'builtin-openai'

  // Merge built-in presets with saved overrides, filtering undefined values
  const mergedBuiltIns = BUILTIN_MODEL_PRESETS.map((preset) => {
    const saved = savedPresets.find((candidate) => candidate.id === preset.id)
    if (!saved) return preset

    const filteredSaved = Object.fromEntries(
      Object.entries(saved).filter(([, value]) => value !== undefined)
    )
    return { ...preset, ...filteredSaved }
  })

  // Include custom presets (non-built-in IDs)
  const builtinIds = new Set(
    BUILTIN_MODEL_PRESETS
      .map((preset) => preset.id)
      .filter((id): id is string => typeof id === 'string')
  )
  const customPresets = savedPresets.filter(
    (preset) => typeof preset.id === 'string' && !builtinIds.has(preset.id)
  )

  const allPresets = [...mergedBuiltIns, ...customPresets]
  return allPresets.find((preset) => preset.id === currentPresetId)
}

/**
 * Sync the active preset's credentials and model preferences to legacy fields.
 * This mirrors desktop behavior so standalone server and Electron resolve the
 * same effective OpenAI-compatible provider settings.
 */
function syncPresetToLegacyFields(config: Config): Config {
  const synced = { ...config }
  const activePreset = getActivePreset(synced)
  if (!activePreset) return synced

  synced.openaiApiKey = typeof activePreset.apiKey === 'string' ? activePreset.apiKey : ''
  synced.openaiBaseUrl = typeof activePreset.baseUrl === 'string' ? activePreset.baseUrl : ''
  synced.mcpToolsOpenaiModel =
    typeof activePreset.mcpToolsModel === 'string' ? activePreset.mcpToolsModel : ''
  synced.transcriptPostProcessingOpenaiModel =
    typeof activePreset.transcriptProcessingModel === 'string'
      ? activePreset.transcriptProcessingModel
      : ''

  return synced
}

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

      return syncPresetToLegacyFields(migrated as Config)
    }
  } catch (error) {
    // If config file is invalid, use defaults
    console.warn('Failed to load config file, using defaults:', error)
  }

  return syncPresetToLegacyFields(defaultConfig as Config)
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
    this.config = syncPresetToLegacyFields(config)

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
