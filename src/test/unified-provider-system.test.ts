/**
 * Unified Provider System Tests
 * 
 * Comprehensive test suite for the new unified provider system,
 * including migration, configuration, and API functionality.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ProviderRegistryImpl } from '../main/provider-registry'
import { ProviderFactory } from '../main/provider-registry'
import { UnifiedModelsService } from '../main/unified-models-service'
import { UnifiedLLMService } from '../main/unified-llm-service'
import { ConfigMigrationService } from '../shared/unified-config'
import { UnifiedConfigStore } from '../main/unified-config-store'
import { MigrationService, CompatibilityLayer } from '../main/migration-service'
import { PROVIDER_DEFINITIONS } from '../shared/provider-definitions'
import { ProviderId, ServiceType, ProviderError, ConfigurationError } from '../shared/provider-system'

// Mock external dependencies
vi.mock('../main/diagnostics', () => ({
  diagnosticsService: {
    logInfo: vi.fn(),
    logError: vi.fn(),
    logWarning: vi.fn(),
  }
}))

vi.mock('../main/config', () => ({
  configStore: {
    get: vi.fn(() => ({})),
    save: vi.fn(),
  }
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/path'),
  }
}))

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => '{}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}))

describe('Provider Registry', () => {
  let registry: ProviderRegistryImpl

  beforeEach(() => {
    registry = new ProviderRegistryImpl()
  })

  it('should initialize with built-in providers', () => {
    const providers = registry.getAllProviders()
    expect(providers).toHaveLength(3)
    expect(providers.map(p => p.id)).toEqual(['openai', 'groq', 'gemini'])
  })

  it('should get provider by id', () => {
    const openai = registry.getProvider('openai')
    expect(openai).toBeDefined()
    expect(openai?.name).toBe('OpenAI')
  })

  it('should return undefined for non-existent provider', () => {
    const provider = registry.getProvider('nonexistent' as ProviderId)
    expect(provider).toBeUndefined()
  })

  it('should filter providers by service', () => {
    const chatProviders = registry.getProvidersForService('chat')
    expect(chatProviders).toHaveLength(3)
    
    const sttProviders = registry.getProvidersForService('stt')
    expect(sttProviders).toHaveLength(2) // OpenAI and Groq
    
    const ttsProviders = registry.getProvidersForService('tts')
    expect(ttsProviders).toHaveLength(3)
  })

  it('should check provider availability for service', () => {
    expect(registry.isProviderAvailable('openai', 'chat')).toBe(true)
    expect(registry.isProviderAvailable('openai', 'stt')).toBe(true)
    expect(registry.isProviderAvailable('openai', 'tts')).toBe(true)
    
    expect(registry.isProviderAvailable('gemini', 'stt')).toBe(false)
  })

  it('should validate provider configuration', () => {
    expect(() => {
      registry.validateConfig('openai', { apiKey: 'sk-test123' })
    }).not.toThrow()

    expect(() => {
      registry.validateConfig('openai', {})
    }).toThrow(ConfigurationError)
  })
})

describe('Provider Factory', () => {
  let factory: ProviderFactory
  let registry: ProviderRegistryImpl

  beforeEach(() => {
    registry = new ProviderRegistryImpl()
    factory = new ProviderFactory(registry)
  })

  it('should create valid provider configuration', () => {
    const config = factory.createConfig('openai', {
      apiKey: 'sk-test123',
    })

    expect(config.apiKey).toBe('sk-test123')
    expect(config.baseUrl).toBe('https://api.openai.com/v1')
    expect(config.chat?.defaultModel).toBe('gpt-4o-mini')
  })

  it('should get provider capabilities', () => {
    const capabilities = factory.getCapabilities('openai')
    expect(capabilities.chat).toBe(true)
    expect(capabilities.stt).toBe(true)
    expect(capabilities.tts).toBe(true)
    expect(capabilities.supportsToolCalling).toBe(true)
  })

  it('should get available models', () => {
    const models = factory.getAvailableModels('openai', 'chat')
    expect(Array.isArray(models)).toBe(true)
    expect(models.length).toBeGreaterThan(0)
  })

  it('should get available voices for TTS providers', () => {
    const voices = factory.getAvailableVoices('openai')
    expect(Array.isArray(voices)).toBe(true)
    expect(voices.length).toBeGreaterThan(0)
    expect(voices[0]).toHaveProperty('id')
    expect(voices[0]).toHaveProperty('name')
  })

  it('should throw error for non-TTS provider voices', () => {
    // Mock a provider without TTS capability
    const mockProvider = {
      ...PROVIDER_DEFINITIONS.openai,
      capabilities: { ...PROVIDER_DEFINITIONS.openai.capabilities, tts: false }
    }
    registry.registerProvider(mockProvider)

    expect(() => {
      factory.getAvailableVoices('openai')
    }).toThrow(ProviderError)
  })

  it('should get API endpoint', () => {
    const endpoint = factory.getEndpoint('openai', 'chat')
    expect(endpoint).toBe('https://api.openai.com/v1/chat/completions')
  })

  it('should test connection', async () => {
    const result = await factory.testConnection('openai', {
      apiKey: 'sk-test123',
    })
    expect(typeof result).toBe('boolean')
  })
})

describe('Unified Models Service', () => {
  let modelsService: UnifiedModelsService

  beforeEach(() => {
    modelsService = new UnifiedModelsService()
    // Mock fetch for API calls
    global.fetch = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should fetch models from provider', async () => {
    // Mock successful API response
    const mockResponse = {
      ok: true,
      json: () => Promise.resolve({
        data: [
          { id: 'gpt-4o', name: 'GPT-4o', description: 'Latest GPT-4 model' },
          { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Smaller GPT-4 model' }
        ]
      })
    }
    vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

    const models = await modelsService.fetchModels('openai', 'chat')
    expect(models).toHaveLength(2)
    expect(models[0].id).toBe('gpt-4o')
  })

  it('should return fallback models on API error', async () => {
    // Mock API error
    vi.mocked(global.fetch).mockRejectedValue(new Error('API Error'))

    const models = await modelsService.fetchModels('openai', 'chat')
    expect(models.length).toBeGreaterThan(0) // Should return fallback models
  })

  it('should cache models', async () => {
    const mockResponse = {
      ok: true,
      json: () => Promise.resolve({ data: [{ id: 'test-model', name: 'Test Model' }] })
    }
    vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

    // First call should fetch from API
    await modelsService.fetchModels('openai', 'chat')
    expect(global.fetch).toHaveBeenCalledTimes(1)

    // Second call should use cache
    await modelsService.fetchModels('openai', 'chat')
    expect(global.fetch).toHaveBeenCalledTimes(1) // Still 1, not 2
  })

  it('should clear cache', async () => {
    const mockResponse = {
      ok: true,
      json: () => Promise.resolve({ data: [{ id: 'test-model', name: 'Test Model' }] })
    }
    vi.mocked(global.fetch).mockResolvedValue(mockResponse as any)

    // Fetch and cache
    await modelsService.fetchModels('openai', 'chat')
    
    // Clear cache
    modelsService.clearCache('openai')
    
    // Next fetch should call API again
    await modelsService.fetchModels('openai', 'chat')
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('should get default model', () => {
    const model = modelsService.getDefaultModel('openai', 'chat', 'mcp')
    expect(typeof model).toBe('string')
    expect(model.length).toBeGreaterThan(0)
  })
})

describe('Configuration Migration', () => {
  let migrator: ConfigMigrationService

  beforeEach(() => {
    migrator = new ConfigMigrationService()
  })

  it('should detect legacy configuration', () => {
    const legacyConfig = {
      openaiApiKey: 'sk-test123',
      groqApiKey: 'gsk-test456',
      sttProviderId: 'openai',
      ttsProviderId: 'groq',
    }

    expect(migrator.needsMigration(legacyConfig)).toBe(true)
  })

  it('should not detect migration need for unified config', () => {
    const unifiedConfig = {
      providers: {
        activeProviders: { chat: 'openai', stt: 'openai', tts: 'openai' },
        providers: { openai: {}, groq: {}, gemini: {} },
        global: { apiRetryCount: 3, apiRetryBaseDelay: 1000, apiRetryMaxDelay: 30000, cacheModels: true, cacheDuration: 300000 }
      }
    }

    expect(migrator.needsMigration(unifiedConfig)).toBe(false)
  })

  it('should migrate legacy configuration', () => {
    const legacyConfig = {
      openaiApiKey: 'sk-test123',
      groqApiKey: 'gsk-test456',
      sttProviderId: 'openai',
      ttsProviderId: 'groq',
      mcpToolsProviderId: 'openai',
      mcpToolsOpenaiModel: 'gpt-4o',
      ttsEnabled: true,
      ttsAutoPlay: false,
    }

    const migratedConfig = migrator.migrate(legacyConfig)

    expect(migratedConfig.providers?.providers.openai.apiKey).toBe('sk-test123')
    expect(migratedConfig.providers?.providers.groq.apiKey).toBe('gsk-test456')
    expect(migratedConfig.providers?.activeProviders.stt).toBe('openai')
    expect(migratedConfig.providers?.activeProviders.tts).toBe('groq')
    expect(migratedConfig.providers?.activeProviders.chat).toBe('openai')
    expect(migratedConfig.providers?.providers.openai.chat?.mcpModel).toBe('gpt-4o')
    expect(migratedConfig.services?.tts?.enabled).toBe(true)
    expect(migratedConfig.services?.tts?.autoPlay).toBe(false)
  })
})

describe('Compatibility Layer', () => {
  beforeEach(() => {
    // Mock unified config store
    vi.mock('../main/unified-config-store', () => ({
      unifiedConfigStore: {
        get: () => ({
          providers: {
            activeProviders: { chat: 'openai', stt: 'openai', tts: 'openai' },
            providers: {
              openai: { apiKey: 'sk-test123', chat: { mcpModel: 'gpt-4o' } },
              groq: { apiKey: 'gsk-test456' },
              gemini: { apiKey: 'ai-test789' }
            }
          },
          services: { tts: { enabled: true, autoPlay: false } }
        }),
        getLegacyConfig: () => ({
          openaiApiKey: 'sk-test123',
          groqApiKey: 'gsk-test456',
          geminiApiKey: 'ai-test789',
          mcpToolsProviderId: 'openai',
          mcpToolsOpenaiModel: 'gpt-4o',
          ttsEnabled: true,
          ttsAutoPlay: false,
        }),
        update: vi.fn(),
      }
    }))
  })

  it('should provide legacy configuration format', () => {
    const legacyConfig = CompatibilityLayer.getLegacyConfig()
    
    expect(legacyConfig.openaiApiKey).toBe('sk-test123')
    expect(legacyConfig.groqApiKey).toBe('gsk-test456')
    expect(legacyConfig.mcpToolsProviderId).toBe('openai')
    expect(legacyConfig.ttsEnabled).toBe(true)
  })

  it('should get provider configuration in legacy format', () => {
    const openaiConfig = CompatibilityLayer.getProviderConfig('openai')
    
    expect(openaiConfig.apiKey).toBe('sk-test123')
    expect(openaiConfig.mcpModel).toBe('gpt-4o')
  })

  it('should detect unified configuration usage', () => {
    expect(CompatibilityLayer.isUsingUnifiedConfig()).toBe(true)
  })
})

describe('Integration Tests', () => {
  it('should work end-to-end with provider registry and models service', async () => {
    const registry = new ProviderRegistryImpl()
    const factory = new ProviderFactory(registry)
    const modelsService = new UnifiedModelsService()

    // Get provider
    const provider = registry.getProvider('openai')
    expect(provider).toBeDefined()

    // Create configuration
    const config = factory.createConfig('openai', { apiKey: 'sk-test123' })
    expect(config.apiKey).toBe('sk-test123')

    // Mock API response for models
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [{ id: 'gpt-4o', name: 'GPT-4o' }]
      })
    })

    // Fetch models
    const models = await modelsService.fetchModels('openai', 'chat')
    expect(models.length).toBeGreaterThan(0)
  })

  it('should handle provider switching correctly', () => {
    const registry = new ProviderRegistryImpl()
    
    // Verify all providers support chat
    const chatProviders = registry.getProvidersForService('chat')
    expect(chatProviders.length).toBe(3)

    // Verify provider capabilities
    chatProviders.forEach(provider => {
      expect(provider.capabilities.chat).toBe(true)
    })
  })
})
