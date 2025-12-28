/**
 * AI SDK Provider Adapter
 * Provides a unified interface for creating language models using Vercel AI SDK
 * with support for OpenAI, OpenAI-compatible endpoints, Groq, and Google.
 */

import { createOpenAI } from "@ai-sdk/openai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import type { LanguageModel } from "ai"
import { configStore } from "./config"
import { isDebugLLM, logLLM } from "./debug"

export type ProviderType = "openai" | "groq" | "gemini"

interface ProviderConfig {
  apiKey: string
  baseURL?: string
  model: string
}

/**
 * Get provider configuration from app config
 */
function getProviderConfig(
  providerId: ProviderType,
  modelContext: "mcp" | "transcript" = "mcp"
): ProviderConfig {
  const config = configStore.get()

  switch (providerId) {
    case "openai":
      return {
        apiKey: config.openaiApiKey || "",
        baseURL: config.openaiBaseUrl || undefined,
        model:
          modelContext === "mcp"
            ? config.mcpToolsOpenaiModel || "gpt-4o-mini"
            : config.transcriptPostProcessingOpenaiModel || "gpt-4o-mini",
      }

    case "groq":
      return {
        apiKey: config.groqApiKey || "",
        baseURL: config.groqBaseUrl || "https://api.groq.com/openai/v1",
        model:
          modelContext === "mcp"
            ? config.mcpToolsGroqModel || "llama-3.3-70b-versatile"
            : config.transcriptPostProcessingGroqModel ||
              "llama-3.1-70b-versatile",
      }

    case "gemini":
      return {
        apiKey: config.geminiApiKey || "",
        baseURL: config.geminiBaseUrl || undefined,
        model: config.mcpToolsGeminiModel || "gemini-1.5-flash-002",
      }

    default:
      throw new Error(`Unknown provider: ${providerId}`)
  }
}

/**
 * Create a language model instance for the specified provider
 */
export function createLanguageModel(
  providerId?: ProviderType,
  modelContext: "mcp" | "transcript" = "mcp"
): LanguageModel {
  const config = configStore.get()
  const effectiveProviderId =
    providerId || (config.mcpToolsProviderId as ProviderType) || "openai"

  const providerConfig = getProviderConfig(effectiveProviderId, modelContext)

  if (!providerConfig.apiKey) {
    throw new Error(`API key is required for ${effectiveProviderId}`)
  }

  if (isDebugLLM()) {
    logLLM(`Creating ${effectiveProviderId} model:`, {
      model: providerConfig.model,
      baseURL: providerConfig.baseURL,
    })
  }

  switch (effectiveProviderId) {
    case "openai":
    case "groq": {
      // Both OpenAI and Groq use OpenAI-compatible API
      const openai = createOpenAI({
        apiKey: providerConfig.apiKey,
        baseURL: providerConfig.baseURL,
      })
      return openai(providerConfig.model)
    }

    case "gemini": {
      const google = createGoogleGenerativeAI({
        apiKey: providerConfig.apiKey,
        baseURL: providerConfig.baseURL,
      })
      return google(providerConfig.model)
    }

    default:
      throw new Error(`Unknown provider: ${effectiveProviderId}`)
  }
}

/**
 * Get the current provider ID from config
 */
export function getCurrentProviderId(): ProviderType {
  const config = configStore.get()
  return (config.mcpToolsProviderId as ProviderType) || "openai"
}

/**
 * Get the current model name for the provider
 */
export function getCurrentModelName(
  providerId?: ProviderType,
  modelContext: "mcp" | "transcript" = "mcp"
): string {
  const config = configStore.get()
  const effectiveProviderId =
    providerId || (config.mcpToolsProviderId as ProviderType) || "openai"

  return getProviderConfig(effectiveProviderId, modelContext).model
}
