/**
 * LLM Provider Factory
 * Unified interface for creating and managing LLM providers
 */

import type { LLMProvider, LLMProviderConstructorConfig } from "./base"
import { OpenAIProvider } from "./openai"
import { GroqProvider } from "./groq"
import { GeminiProvider } from "./gemini"
import { configStore } from "../../config"

// Re-export types and utilities
export type { LLMProvider, LLMProviderConstructorConfig } from "./base"
export {
  TOOL_CALL_RESPONSE_SCHEMA,
  VERIFICATION_RESPONSE_SCHEMA,
  modelCapabilityCache,
  CAPABILITY_CACHE_TTL,
  recordStructuredOutputFailure,
  recordStructuredOutputSuccess,
  isCacheValid,
  extractJsonObject,
  isEmptyContentResponse,
} from "./base"

export { OpenAIProvider } from "./openai"
export { GroqProvider } from "./groq"
export { GeminiProvider } from "./gemini"

/**
 * Supported provider IDs
 */
export type ProviderId = "openai" | "groq" | "gemini"

/**
 * Provider configuration from config store
 */
interface ProviderConfigFromStore {
  providerId: string
  openaiApiKey?: string
  openaiBaseUrl?: string
  mcpToolsOpenaiModel?: string
  transcriptPostProcessingOpenaiModel?: string
  groqApiKey?: string
  groqBaseUrl?: string
  mcpToolsGroqModel?: string
  transcriptPostProcessingGroqModel?: string
  geminiApiKey?: string
  geminiBaseUrl?: string
  mcpToolsGeminiModel?: string
  apiRetryCount?: number
  apiRetryBaseDelay?: number
  apiRetryMaxDelay?: number
}

/**
 * Create an LLM provider from the config store settings
 * @param type - The type of provider to use ("mcp" for tool calls, "transcript" for post-processing)
 * @returns Configured LLM provider instance
 */
export function createProviderFromConfig(
  type: "mcp" | "transcript" = "mcp"
): LLMProvider {
  const config = configStore.get()

  const providerId = type === "mcp"
    ? config.mcpToolsProviderId || "openai"
    : config.transcriptPostProcessingProviderId || "openai"

  return createProvider(providerId as ProviderId, {
    // OpenAI config
    openaiApiKey: config.openaiApiKey,
    openaiBaseUrl: config.openaiBaseUrl,
    mcpToolsOpenaiModel: config.mcpToolsOpenaiModel,
    transcriptPostProcessingOpenaiModel: config.transcriptPostProcessingOpenaiModel,
    // Groq config
    groqApiKey: config.groqApiKey,
    groqBaseUrl: config.groqBaseUrl,
    mcpToolsGroqModel: config.mcpToolsGroqModel,
    transcriptPostProcessingGroqModel: config.transcriptPostProcessingGroqModel,
    // Gemini config
    geminiApiKey: config.geminiApiKey,
    geminiBaseUrl: config.geminiBaseUrl,
    mcpToolsGeminiModel: config.mcpToolsGeminiModel,
    // Retry config
    apiRetryCount: config.apiRetryCount,
    apiRetryBaseDelay: config.apiRetryBaseDelay,
    apiRetryMaxDelay: config.apiRetryMaxDelay,
    // Provider selection
    providerId,
  })
}

/**
 * Create an LLM provider instance
 * @param providerId - The provider ID ("openai", "groq", or "gemini")
 * @param config - Provider configuration
 * @returns Configured LLM provider instance
 */
export function createProvider(
  providerId: ProviderId,
  config: ProviderConfigFromStore
): LLMProvider {
  switch (providerId) {
    case "openai":
      if (!config.openaiApiKey) {
        throw new Error("OpenAI API key is required")
      }
      return new OpenAIProvider({
        apiKey: config.openaiApiKey,
        baseUrl: config.openaiBaseUrl,
        mcpModel: config.mcpToolsOpenaiModel,
        transcriptModel: config.transcriptPostProcessingOpenaiModel,
        retryCount: config.apiRetryCount,
        retryBaseDelay: config.apiRetryBaseDelay,
        retryMaxDelay: config.apiRetryMaxDelay,
      })

    case "groq":
      if (!config.groqApiKey) {
        throw new Error("Groq API key is required")
      }
      return new GroqProvider({
        apiKey: config.groqApiKey,
        baseUrl: config.groqBaseUrl,
        mcpModel: config.mcpToolsGroqModel,
        transcriptModel: config.transcriptPostProcessingGroqModel,
        retryCount: config.apiRetryCount,
        retryBaseDelay: config.apiRetryBaseDelay,
        retryMaxDelay: config.apiRetryMaxDelay,
      })

    case "gemini":
      if (!config.geminiApiKey) {
        throw new Error("Gemini API key is required")
      }
      return new GeminiProvider({
        apiKey: config.geminiApiKey,
        baseUrl: config.geminiBaseUrl,
        mcpModel: config.mcpToolsGeminiModel,
        transcriptModel: config.mcpToolsGeminiModel, // Gemini uses same model for both
        retryCount: config.apiRetryCount,
        retryBaseDelay: config.apiRetryBaseDelay,
        retryMaxDelay: config.apiRetryMaxDelay,
      })

    default:
      throw new Error(`Unknown provider ID: ${providerId}`)
  }
}

/**
 * Get a list of all available provider IDs
 */
export function getAvailableProviders(): ProviderId[] {
  return ["openai", "groq", "gemini"]
}

/**
 * Check if a provider ID is valid
 */
export function isValidProviderId(id: string): id is ProviderId {
  return ["openai", "groq", "gemini"].includes(id)
}
