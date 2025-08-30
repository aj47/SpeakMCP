/**
 * Unified Models Service
 * 
 * This service replaces the existing provider-specific model fetching
 * with a unified system that works with any provider.
 */

import {
  ModelService,
  ProviderId,
  ServiceType,
  ModelType,
  ModelInfo,
  ProviderError,
  APIError,
} from "../shared/provider-system"
import { providerFactory, providerRegistry } from "./provider-registry"
import { configStore } from "./config"
import { diagnosticsService } from "./diagnostics"

interface ModelCache {
  models: ModelInfo[]
  timestamp: number
  providerId: ProviderId
  service: ServiceType
}

/**
 * Unified Models Service Implementation
 */
class UnifiedModelsService implements ModelService {
  private cache = new Map<string, ModelCache>()
  private readonly CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

  /**
   * Fetch models from a provider's API
   */
  async fetchModels(providerId: ProviderId, service: ServiceType): Promise<ModelInfo[]> {
    const cacheKey = `${providerId}-${service}`
    
    // Check cache first
    const cached = this.getCachedModels(providerId, service)
    if (cached) {
      return cached
    }

    try {
      const config = configStore.get()
      const provider = providerRegistry.getProvider(providerId)
      
      if (!provider) {
        throw new ProviderError(`Provider ${providerId} not found`, providerId)
      }

      if (!providerRegistry.isProviderAvailable(providerId, service)) {
        throw new ProviderError(`Provider ${providerId} does not support ${service}`, providerId, service)
      }

      let models: ModelInfo[] = []

      // Get provider configuration
      const providerConfig = this.getProviderConfig(providerId, config)
      
      if (!providerConfig.apiKey) {
        // Return fallback models if no API key
        models = this.getFallbackModels(providerId, service)
      } else {
        // Fetch from API
        models = await this.fetchFromAPI(providerId, service, providerConfig)
      }

      // Cache the results
      this.cache.set(cacheKey, {
        models,
        timestamp: Date.now(),
        providerId,
        service,
      })

      diagnosticsService.logInfo("unified-models-service", `Fetched ${models.length} models for ${providerId}/${service}`)
      return models

    } catch (error) {
      diagnosticsService.logError("unified-models-service", `Failed to fetch models for ${providerId}/${service}`, error)
      
      // Return fallback models on error
      return this.getFallbackModels(providerId, service)
    }
  }

  /**
   * Get cached models if available and not expired
   */
  getCachedModels(providerId: ProviderId, service: ServiceType): ModelInfo[] | null {
    const cacheKey = `${providerId}-${service}`
    const cached = this.cache.get(cacheKey)

    if (!cached) return null

    const isExpired = Date.now() - cached.timestamp > this.CACHE_DURATION
    if (isExpired) {
      this.cache.delete(cacheKey)
      return null
    }

    return cached.models
  }

  /**
   * Clear cache for specific provider or all providers
   */
  clearCache(providerId?: ProviderId): void {
    if (providerId) {
      // Clear cache for specific provider
      const keysToDelete = Array.from(this.cache.keys()).filter(key => 
        key.startsWith(`${providerId}-`)
      )
      keysToDelete.forEach(key => this.cache.delete(key))
    } else {
      // Clear all cache
      this.cache.clear()
    }
    
    diagnosticsService.logInfo("unified-models-service", `Cleared cache${providerId ? ` for ${providerId}` : ""}`)
  }

  /**
   * Get default model for a provider and service
   */
  getDefaultModel(providerId: ProviderId, service: ServiceType, type?: ModelType): string {
    const provider = providerRegistry.getProvider(providerId)
    if (!provider) {
      throw new ProviderError(`Provider ${providerId} not found`, providerId)
    }

    const config = configStore.get()
    const providerConfig = this.getProviderConfig(providerId, config)

    // Get model based on service and type
    switch (service) {
      case "chat":
        if (type === "mcp") {
          return providerConfig.chat?.mcpModel || provider.defaultConfig.chat?.mcpModel || provider.defaultConfig.chat?.defaultModel || ""
        } else if (type === "transcript") {
          return providerConfig.chat?.transcriptModel || provider.defaultConfig.chat?.transcriptModel || provider.defaultConfig.chat?.defaultModel || ""
        }
        return providerConfig.chat?.defaultModel || provider.defaultConfig.chat?.defaultModel || ""
      
      case "stt":
        return providerConfig.stt?.model || provider.defaultConfig.stt?.model || ""
      
      case "tts":
        return providerConfig.tts?.model || provider.defaultConfig.tts?.model || ""
      
      default:
        return ""
    }
  }

  /**
   * Fetch models from provider API
   */
  private async fetchFromAPI(providerId: ProviderId, service: ServiceType, providerConfig: any): Promise<ModelInfo[]> {
    const provider = providerRegistry.getProvider(providerId)!
    
    switch (providerId) {
      case "openai":
        return this.fetchOpenAIModels(providerConfig)
      case "groq":
        return this.fetchGroqModels(providerConfig)
      case "gemini":
        return this.fetchGeminiModels(providerConfig)
      default:
        throw new ProviderError(`Unsupported provider: ${providerId}`, providerId)
    }
  }

  /**
   * Fetch OpenAI models
   */
  private async fetchOpenAIModels(config: any): Promise<ModelInfo[]> {
    const baseUrl = config.baseUrl || "https://api.openai.com/v1"
    const url = `${baseUrl}/models`
    
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new APIError(`HTTP ${response.status}: ${errorText}`, "openai", "chat", response.status)
    }

    const data = await response.json()
    
    // Filter and format models based on provider type
    const isOpenRouter = baseUrl?.includes("openrouter.ai")
    const isCerebras = baseUrl?.includes("cerebras.ai")
    
    let filteredModels = data.data || []
    
    if (isOpenRouter) {
      filteredModels = filteredModels.filter((model: any) =>
        !model.id.includes(":ft-") &&
        !model.id.includes("instruct-beta") &&
        !model.id.includes("preview") &&
        model.id.length > 0
      )
    } else if (isCerebras) {
      filteredModels = filteredModels.filter((model: any) =>
        !model.id.includes(":ft-") &&
        model.id.length > 0
      )
    } else {
      filteredModels = filteredModels.filter((model: any) =>
        !model.id.includes(":") &&
        !model.id.includes("instruct") &&
        (model.id.includes("gpt") || model.id.includes("o1"))
      )
    }

    return filteredModels.map((model: any) => ({
      id: model.id,
      name: this.formatModelName(model.id),
      description: model.description,
      contextLength: model.context_length,
      created: model.created,
    }))
  }

  /**
   * Fetch Groq models
   */
  private async fetchGroqModels(config: any): Promise<ModelInfo[]> {
    const baseUrl = config.baseUrl || "https://api.groq.com/openai/v1"
    const url = `${baseUrl}/models`
    
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new APIError(`HTTP ${response.status}: ${errorText}`, "groq", "chat", response.status)
    }

    const data = await response.json()
    
    return (data.data || [])
      .filter((model: any) => model.id && !model.id.includes(":ft-"))
      .map((model: any) => ({
        id: model.id,
        name: this.formatModelName(model.id),
        description: model.description,
        contextLength: model.context_length,
        created: model.created,
      }))
  }

  /**
   * Fetch Gemini models
   */
  private async fetchGeminiModels(config: any): Promise<ModelInfo[]> {
    const baseUrl = config.baseUrl || "https://generativelanguage.googleapis.com"
    const url = `${baseUrl}/v1beta/models?key=${config.apiKey}`
    
    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new APIError(`HTTP ${response.status}: ${errorText}`, "gemini", "chat", response.status)
    }

    const data = await response.json()
    
    return (data.models || [])
      .filter((model: any) =>
        model.name &&
        model.name.includes("gemini") &&
        model.supportedGenerationMethods?.includes("generateContent")
      )
      .map((model: any) => {
        const modelId = model.name.split("/").pop()
        return {
          id: modelId,
          name: this.formatModelName(modelId),
          description: model.description,
          contextLength: model.inputTokenLimit,
        }
      })
  }

  /**
   * Get fallback models for a provider
   */
  private getFallbackModels(providerId: ProviderId, service: ServiceType): ModelInfo[] {
    const provider = providerRegistry.getProvider(providerId)
    if (!provider) return []

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
   * Get provider configuration from app config
   */
  private getProviderConfig(providerId: ProviderId, config: any): any {
    switch (providerId) {
      case "openai":
        return {
          apiKey: config.openaiApiKey,
          baseUrl: config.openaiBaseUrl,
          chat: {
            mcpModel: config.mcpToolsOpenaiModel,
            transcriptModel: config.transcriptPostProcessingOpenaiModel,
          }
        }
      case "groq":
        return {
          apiKey: config.groqApiKey,
          baseUrl: config.groqBaseUrl,
          chat: {
            mcpModel: config.mcpToolsGroqModel,
            transcriptModel: config.transcriptPostProcessingGroqModel,
          }
        }
      case "gemini":
        return {
          apiKey: config.geminiApiKey,
          baseUrl: config.geminiBaseUrl,
          chat: {
            mcpModel: config.mcpToolsGeminiModel,
            transcriptModel: config.transcriptPostProcessingGeminiModel,
          }
        }
      default:
        return {}
    }
  }

  /**
   * Format model name for display
   */
  private formatModelName(modelId: string): string {
    // Use existing formatting logic from the original models service
    const providerNames: Record<string, string> = {
      "openai": "OpenAI",
      "groq": "Groq", 
      "gemini": "Google",
      "anthropic": "Anthropic",
      "meta": "Meta",
      "mistralai": "Mistral",
    }

    // Check if it's a provider/model format
    if (modelId.includes("/")) {
      const [provider, model] = modelId.split("/", 2)
      const formattedProvider = providerNames[provider] || provider.charAt(0).toUpperCase() + provider.slice(1)
      const formattedModel = model
        .split("-")
        .map((part) => {
          if (part === "instruct") return "Instruct"
          if (part === "turbo") return "Turbo"
          if (part.match(/^\d+b$/)) return part.toUpperCase()
          if (part.match(/^\d+\.\d+$/)) return part
          return part.charAt(0).toUpperCase() + part.slice(1)
        })
        .join(" ")
      return `${formattedModel} (${formattedProvider})`
    }

    // Fallback: capitalize each part
    return modelId
      .split("-")
      .map((part) => {
        if (part === "instruct") return "Instruct"
        if (part === "turbo") return "Turbo"
        if (part.match(/^\d+b$/)) return part.toUpperCase()
        if (part.match(/^\d+\.\d+$/)) return part
        return part.charAt(0).toUpperCase() + part.slice(1)
      })
      .join(" ")
  }
}

// Export singleton instance
export const unifiedModelsService = new UnifiedModelsService()

// Export class for testing
export { UnifiedModelsService }
