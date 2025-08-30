/**
 * Provider Registry and Factory
 * 
 * This file implements the provider registry system that manages
 * provider definitions, configurations, and instantiation.
 */

import {
  ProviderDefinition,
  ProviderRegistry,
  ProviderId,
  ServiceType,
  ProviderConfig,
  ProviderError,
  ConfigurationError,
} from "../shared/provider-system"
import { PROVIDER_DEFINITIONS } from "../shared/provider-definitions"
import { diagnosticsService } from "./diagnostics"

/**
 * Concrete implementation of the ProviderRegistry interface
 */
class ProviderRegistryImpl implements ProviderRegistry {
  private providers: Map<ProviderId, ProviderDefinition> = new Map()
  private initialized = false

  constructor() {
    this.initialize()
  }

  private initialize(): void {
    if (this.initialized) return

    // Register all built-in providers
    Object.values(PROVIDER_DEFINITIONS).forEach(provider => {
      this.registerProvider(provider)
    })

    this.initialized = true
    diagnosticsService.logInfo("provider-registry", "Provider registry initialized", {
      providerCount: this.providers.size,
      providers: Array.from(this.providers.keys())
    })
  }

  getProvider(id: ProviderId): ProviderDefinition | undefined {
    return this.providers.get(id)
  }

  getAllProviders(): ProviderDefinition[] {
    return Array.from(this.providers.values())
  }

  getProvidersForService(service: ServiceType): ProviderDefinition[] {
    return this.getAllProviders().filter(provider => {
      switch (service) {
        case "chat":
          return provider.capabilities.chat
        case "stt":
          return provider.capabilities.stt
        case "tts":
          return provider.capabilities.tts
        default:
          return false
      }
    })
  }

  registerProvider(provider: ProviderDefinition): void {
    if (!provider.id || !provider.name) {
      throw new Error("Provider must have id and name")
    }

    this.providers.set(provider.id, provider)
    diagnosticsService.logInfo("provider-registry", `Registered provider: ${provider.name}`, {
      id: provider.id,
      capabilities: provider.capabilities
    })
  }

  isProviderAvailable(id: ProviderId, service: ServiceType): boolean {
    const provider = this.getProvider(id)
    if (!provider) return false

    switch (service) {
      case "chat":
        return provider.capabilities.chat
      case "stt":
        return provider.capabilities.stt
      case "tts":
        return provider.capabilities.tts
      default:
        return false
    }
  }

  /**
   * Validate a provider configuration
   */
  validateConfig(providerId: ProviderId, config: ProviderConfig): boolean {
    const provider = this.getProvider(providerId)
    if (!provider) {
      throw new ProviderError(`Provider ${providerId} not found`, providerId)
    }

    // Check required API key
    if (provider.auth.apiKeyRequired && !config.apiKey) {
      throw new ConfigurationError("API key is required", providerId, "apiKey")
    }

    // Validate API key format if validator exists
    if (config.apiKey && provider.validators?.apiKey) {
      if (!provider.validators.apiKey(config.apiKey)) {
        throw new ConfigurationError("Invalid API key format", providerId, "apiKey")
      }
    }

    // Validate base URL if validator exists
    if (config.baseUrl && provider.validators?.baseUrl) {
      if (!provider.validators.baseUrl(config.baseUrl)) {
        throw new ConfigurationError("Invalid base URL format", providerId, "baseUrl")
      }
    }

    return true
  }

  /**
   * Get default configuration for a provider
   */
  getDefaultConfig(providerId: ProviderId): ProviderConfig {
    const provider = this.getProvider(providerId)
    if (!provider) {
      throw new ProviderError(`Provider ${providerId} not found`, providerId)
    }

    return { ...provider.defaultConfig }
  }

  /**
   * Merge user config with default config
   */
  mergeConfig(providerId: ProviderId, userConfig: Partial<ProviderConfig>): ProviderConfig {
    const defaultConfig = this.getDefaultConfig(providerId)
    
    return {
      ...defaultConfig,
      ...userConfig,
      // Deep merge service-specific configs
      chat: {
        ...defaultConfig.chat,
        ...userConfig.chat,
      },
      stt: {
        ...defaultConfig.stt,
        ...userConfig.stt,
      },
      tts: {
        ...defaultConfig.tts,
        ...userConfig.tts,
      },
    }
  }
}

/**
 * Provider Factory for creating provider instances and configurations
 */
export class ProviderFactory {
  private registry: ProviderRegistry

  constructor(registry?: ProviderRegistry) {
    this.registry = registry || new ProviderRegistryImpl()
  }

  /**
   * Create a provider configuration with validation
   */
  createConfig(providerId: ProviderId, userConfig: Partial<ProviderConfig> = {}): ProviderConfig {
    const mergedConfig = this.registry.mergeConfig(providerId, userConfig)
    
    // Validate the merged configuration
    this.registry.validateConfig(providerId, mergedConfig)
    
    return mergedConfig
  }

  /**
   * Get provider capabilities
   */
  getCapabilities(providerId: ProviderId) {
    const provider = this.registry.getProvider(providerId)
    if (!provider) {
      throw new ProviderError(`Provider ${providerId} not found`, providerId)
    }
    return provider.capabilities
  }

  /**
   * Get available models for a provider and service
   */
  getAvailableModels(providerId: ProviderId, service: ServiceType) {
    const provider = this.registry.getProvider(providerId)
    if (!provider) {
      throw new ProviderError(`Provider ${providerId} not found`, providerId)
    }

    switch (service) {
      case "chat":
        return provider.models?.chat || []
      case "stt":
        return provider.models?.stt || []
      case "tts":
        return provider.models?.tts || []
      default:
        return []
    }
  }

  /**
   * Get available voices for TTS providers
   */
  getAvailableVoices(providerId: ProviderId) {
    const provider = this.registry.getProvider(providerId)
    if (!provider) {
      throw new ProviderError(`Provider ${providerId} not found`, providerId)
    }

    if (!provider.capabilities.tts) {
      throw new ProviderError(`Provider ${providerId} does not support TTS`, providerId, "tts")
    }

    return provider.voices || []
  }

  /**
   * Get API endpoint for a provider and service
   */
  getEndpoint(providerId: ProviderId, service: ServiceType, baseUrl?: string): string {
    const provider = this.registry.getProvider(providerId)
    if (!provider) {
      throw new ProviderError(`Provider ${providerId} not found`, providerId)
    }

    const endpoint = provider.endpoints[service]
    if (!endpoint) {
      throw new ProviderError(`Provider ${providerId} does not support ${service}`, providerId, service)
    }

    const base = baseUrl || provider.defaultConfig.baseUrl || ""
    return `${base}${endpoint}`
  }

  /**
   * Test provider connection
   */
  async testConnection(providerId: ProviderId, config: ProviderConfig): Promise<boolean> {
    try {
      // Validate config first
      this.registry.validateConfig(providerId, config)

      // For now, just validate the configuration
      // In a full implementation, this would make an actual API call
      return true
    } catch (error) {
      diagnosticsService.logError("provider-factory", `Connection test failed for ${providerId}`, error)
      return false
    }
  }

  /**
   * Get registry instance
   */
  getRegistry(): ProviderRegistry {
    return this.registry
  }
}

// Singleton instances
export const providerRegistry = new ProviderRegistryImpl()
export const providerFactory = new ProviderFactory(providerRegistry)

// Export for external use
export { ProviderRegistryImpl }
