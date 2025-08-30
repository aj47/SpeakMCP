/**
 * Unified Provider Configuration System
 * 
 * This file defines the new unified system for managing AI providers,
 * their configurations, capabilities, and models.
 */

// Core provider types
export type ProviderId = "openai" | "groq" | "gemini"
export type ServiceType = "chat" | "stt" | "tts"
export type ModelType = "mcp" | "transcript"

// Provider capability definitions
export interface ProviderCapabilities {
  chat: boolean
  stt: boolean
  tts: boolean
  supportsStreaming?: boolean
  supportsToolCalling?: boolean
  supportsJsonMode?: boolean
  maxContextLength?: number
}

// Model information structure
export interface ModelInfo {
  id: string
  name: string
  description?: string
  contextLength?: number
  created?: number
  capabilities?: {
    toolCalling?: boolean
    jsonMode?: boolean
    streaming?: boolean
  }
  pricing?: {
    inputTokens?: number
    outputTokens?: number
  }
}

// Voice configuration for TTS providers
export interface VoiceOption {
  id: string
  name: string
  language?: string
  gender?: "male" | "female" | "neutral"
  description?: string
}

// TTS model configuration
export interface TTSModelOption {
  id: string
  name: string
  quality?: "standard" | "hd" | "premium"
  languages?: string[]
}

// Provider-specific configuration
export interface ProviderConfig {
  // Authentication
  apiKey?: string
  baseUrl?: string
  baseUrlHistory?: string[]
  
  // Service-specific settings
  chat?: {
    defaultModel?: string
    mcpModel?: string
    transcriptModel?: string
    temperature?: number
    maxTokens?: number
  }
  
  stt?: {
    language?: string
    prompt?: string
    model?: string
  }
  
  tts?: {
    model?: string
    voice?: string
    speed?: number
    responseFormat?: string
    language?: string
  }
  
  // API configuration
  timeout?: number
  retryCount?: number
  retryDelay?: number
  
  // Provider-specific extras
  extras?: Record<string, any>
}

// Complete provider definition
export interface ProviderDefinition {
  id: ProviderId
  name: string
  description?: string
  website?: string
  capabilities: ProviderCapabilities
  
  // Default configuration
  defaultConfig: ProviderConfig
  
  // Available options
  models?: {
    chat?: ModelInfo[]
    stt?: ModelInfo[]
    tts?: TTSModelOption[]
  }
  
  voices?: VoiceOption[]
  
  // API endpoints and configuration
  endpoints: {
    chat?: string
    stt?: string
    tts?: string
    models?: string
  }
  
  // Authentication requirements
  auth: {
    apiKeyRequired: boolean
    apiKeyName?: string
    customHeaders?: Record<string, string>
  }
  
  // Validation and formatting functions
  validators?: {
    apiKey?: (key: string) => boolean
    baseUrl?: (url: string) => boolean
  }
  
  formatters?: {
    modelName?: (modelId: string) => string
    errorMessage?: (error: any) => string
  }
}

// Unified provider configuration for the entire app
export interface UnifiedProviderConfig {
  // Active provider selections
  activeProviders: {
    chat: ProviderId
    stt: ProviderId
    tts: ProviderId
  }
  
  // Provider-specific configurations
  providers: Record<ProviderId, ProviderConfig>
  
  // Global settings
  global: {
    apiRetryCount: number
    apiRetryBaseDelay: number
    apiRetryMaxDelay: number
    cacheModels: boolean
    cacheDuration: number
  }
}

// Provider registry interface
export interface ProviderRegistry {
  getProvider(id: ProviderId): ProviderDefinition | undefined
  getAllProviders(): ProviderDefinition[]
  getProvidersForService(service: ServiceType): ProviderDefinition[]
  registerProvider(provider: ProviderDefinition): void
  isProviderAvailable(id: ProviderId, service: ServiceType): boolean
}

// Model service interface
export interface ModelService {
  fetchModels(providerId: ProviderId, service: ServiceType): Promise<ModelInfo[]>
  getCachedModels(providerId: ProviderId, service: ServiceType): ModelInfo[] | null
  clearCache(providerId?: ProviderId): void
  getDefaultModel(providerId: ProviderId, service: ServiceType, type?: ModelType): string
}

// Provider API interface
export interface ProviderAPI {
  makeRequest(
    providerId: ProviderId,
    service: ServiceType,
    payload: any,
    options?: {
      timeout?: number
      retries?: number
      streaming?: boolean
    }
  ): Promise<any>
  
  validateConfig(providerId: ProviderId, config: ProviderConfig): boolean
  testConnection(providerId: ProviderId, config: ProviderConfig): Promise<boolean>
}

// Migration interface for backward compatibility
export interface ConfigMigration {
  version: number
  migrate(oldConfig: any): UnifiedProviderConfig
  canMigrate(config: any): boolean
}

// Event system for provider changes
export interface ProviderEvents {
  onProviderConfigChanged: (providerId: ProviderId, config: ProviderConfig) => void
  onProviderSwitched: (service: ServiceType, oldProvider: ProviderId, newProvider: ProviderId) => void
  onModelsUpdated: (providerId: ProviderId, service: ServiceType, models: ModelInfo[]) => void
}

// Error types for the provider system
export class ProviderError extends Error {
  constructor(
    message: string,
    public providerId: ProviderId,
    public service?: ServiceType,
    public originalError?: Error
  ) {
    super(message)
    this.name = "ProviderError"
  }
}

export class ConfigurationError extends ProviderError {
  constructor(message: string, providerId: ProviderId, public field?: string) {
    super(message, providerId)
    this.name = "ConfigurationError"
  }
}

export class APIError extends ProviderError {
  constructor(
    message: string,
    providerId: ProviderId,
    service: ServiceType,
    public statusCode?: number,
    public response?: any
  ) {
    super(message, providerId, service)
    this.name = "APIError"
  }
}
