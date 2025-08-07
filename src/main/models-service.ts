import { configStore } from "./config"
import { diagnosticsService } from "./diagnostics"

export interface ModelInfo {
  id: string
  name: string
  description?: string
  context_length?: number
  created?: number
}

interface ModelsResponse {
  data: ModelInfo[]
  object: string
}

// Cache for models to avoid frequent API calls
const modelsCache = new Map<
  string,
  { models: ModelInfo[]; timestamp: number }
>()
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

/**
 * Fetch available models from OpenAI API or OpenRouter
 */
async function fetchOpenAIModels(
  baseUrl?: string,
  apiKey?: string,
): Promise<ModelInfo[]> {
  if (!apiKey) {
    throw new Error("OpenAI API key is required")
  }

  const url = `${baseUrl || "https://api.openai.com/v1"}/models`
  const isOpenRouter = baseUrl?.includes("openrouter.ai")

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`HTTP ${response.status}: ${errorText}`)
  }

  const data: ModelsResponse = await response.json()

  // Different filtering logic for OpenRouter vs native OpenAI
  let filteredModels = data.data

  if (isOpenRouter) {
    // For OpenRouter, show all models but filter out some problematic ones
    filteredModels = data.data.filter(
      (model) =>
        // Filter out fine-tuned models and some problematic model types
        !model.id.includes(":ft-") &&
        !model.id.includes("instruct-beta") &&
        !model.id.includes("preview") &&
        // Keep most models but filter out some edge cases
        model.id.length > 0,
    )
  } else {
    // For native OpenAI, use the original restrictive filtering
    filteredModels = data.data.filter(
      (model) =>
        // Filter out fine-tuned models and deprecated models
        !model.id.includes(":") &&
        !model.id.includes("instruct") &&
        (model.id.includes("gpt") || model.id.includes("o1")),
    )
  }

  return filteredModels
    .map((model) => ({
      id: model.id,
      name: formatModelName(model.id),
      description: model.description,
      context_length: model.context_length,
      created: model.created,
    }))
    .sort((a, b) => {
      if (isOpenRouter) {
        // For OpenRouter, sort by model family and capability
        const getOpenRouterPriority = (id: string) => {
          // Prioritize popular/capable models
          if (id.includes("gpt-4o")) return 0
          if (id.includes("claude-3.5-sonnet")) return 1
          if (id.includes("claude-3-opus")) return 2
          if (id.includes("gpt-4")) return 3
          if (id.includes("claude")) return 4
          if (id.includes("llama-3.1") && id.includes("405b")) return 5
          if (id.includes("llama-3.1") && id.includes("70b")) return 6
          if (id.includes("gemini-1.5-pro")) return 7
          if (id.includes("o1")) return 8
          if (id.includes("gpt-3.5")) return 9
          return 10
        }
        const priorityDiff =
          getOpenRouterPriority(a.id) - getOpenRouterPriority(b.id)
        if (priorityDiff !== 0) return priorityDiff
        return a.name.localeCompare(b.name)
      } else {
        // For native OpenAI, use original sorting
        const getModelPriority = (id: string) => {
          if (id.includes("o1")) return 0
          if (id.includes("gpt-4")) return 1
          if (id.includes("gpt-3.5")) return 2
          return 3
        }
        return getModelPriority(a.id) - getModelPriority(b.id)
      }
    })
}

/**
 * Fetch available models from Groq API
 */
async function fetchGroqModels(
  baseUrl?: string,
  apiKey?: string,
): Promise<ModelInfo[]> {
  if (!apiKey) {
    throw new Error("Groq API key is required")
  }

  const url = `${baseUrl || "https://api.groq.com/openai/v1"}/models`

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`HTTP ${response.status}: ${errorText}`)
  }

  const data: ModelsResponse = await response.json()

  return data.data
    .map((model) => ({
      id: model.id,
      name: formatModelName(model.id),
      description: model.description,
      context_length: model.context_length,
      created: model.created,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Fetch available models from Gemini API
 */
async function fetchGeminiModels(
  baseUrl?: string,
  apiKey?: string,
): Promise<ModelInfo[]> {
  if (!apiKey) {
    throw new Error("Gemini API key is required")
  }

  const url = `${baseUrl || "https://generativelanguage.googleapis.com"}/v1beta/models?key=${apiKey}`

  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`HTTP ${response.status}: ${errorText}`)
  }

  const data = await response.json()

  // Gemini API returns models in a different format
  if (!data.models || !Array.isArray(data.models)) {
    return []
  }

  return data.models
    .filter(
      (model: any) =>
        model.name &&
        model.name.includes("gemini") &&
        model.supportedGenerationMethods?.includes("generateContent"),
    )
    .map((model: any) => {
      const modelId = model.name.split("/").pop()
      return {
        id: modelId,
        name: formatModelName(modelId),
        description: model.description,
        context_length: model.inputTokenLimit,
      }
    })
    .sort((a: ModelInfo, b: ModelInfo) => a.name.localeCompare(b.name))
}

/**
 * Format model ID into a human-readable name
 */
function formatModelName(modelId: string): string {
  // Handle common model naming patterns
  const nameMap: Record<string, string> = {
    // OpenAI models
    "gpt-4o": "GPT-4o",
    "gpt-4o-mini": "GPT-4o Mini",
    "gpt-4-turbo": "GPT-4 Turbo",
    "gpt-4": "GPT-4",
    "gpt-3.5-turbo": "GPT-3.5 Turbo",
    "o1-preview": "o1 Preview",
    "o1-mini": "o1 Mini",

    // Anthropic Claude models (OpenRouter format)
    "anthropic/claude-3.5-sonnet": "Claude 3.5 Sonnet",
    "anthropic/claude-3-opus": "Claude 3 Opus",
    "anthropic/claude-3-sonnet": "Claude 3 Sonnet",
    "anthropic/claude-3-haiku": "Claude 3 Haiku",

    // Google models
    "google/gemini-1.5-pro": "Gemini 1.5 Pro",
    "google/gemini-1.5-flash": "Gemini 1.5 Flash",
    "google/gemini-1.0-pro": "Gemini 1.0 Pro",
    "gemini-1.5-pro": "Gemini 1.5 Pro",
    "gemini-1.5-flash": "Gemini 1.5 Flash",
    "gemini-1.0-pro": "Gemini 1.0 Pro",

    // Meta Llama models
    "meta-llama/llama-3.1-405b-instruct": "Llama 3.1 405B Instruct",
    "meta-llama/llama-3.1-70b-instruct": "Llama 3.1 70B Instruct",
    "meta-llama/llama-3.1-8b-instruct": "Llama 3.1 8B Instruct",
    "meta-llama/llama-3-70b-instruct": "Llama 3 70B Instruct",
    "meta-llama/llama-3-8b-instruct": "Llama 3 8B Instruct",

    // Groq models
    "gemma2-9b-it": "Gemma2 9B IT",
    "llama-3.3-70b-versatile": "Llama 3.3 70B Versatile",
    "llama-3.1-70b-versatile": "Llama 3.1 70B Versatile",
    "mixtral-8x7b-32768": "Mixtral 8x7B",

    // Mistral models
    "mistralai/mistral-7b-instruct": "Mistral 7B Instruct",
    "mistralai/mixtral-8x7b-instruct": "Mixtral 8x7B Instruct",
    "mistralai/mixtral-8x22b-instruct": "Mixtral 8x22B Instruct",
  }

  // Check for exact match first
  if (nameMap[modelId]) {
    return nameMap[modelId]
  }

  // Handle OpenRouter format (provider/model-name)
  if (modelId.includes("/")) {
    const [provider, model] = modelId.split("/")
    const providerNames: Record<string, string> = {
      anthropic: "Anthropic",
      openai: "OpenAI",
      google: "Google",
      "meta-llama": "Meta",
      mistralai: "Mistral",
      cohere: "Cohere",
      perplexity: "Perplexity",
    }

    const formattedProvider =
      providerNames[provider] ||
      provider.charAt(0).toUpperCase() + provider.slice(1)
    const formattedModel = model
      .split("-")
      .map((part) => {
        // Handle special cases
        if (part === "instruct") return "Instruct"
        if (part === "turbo") return "Turbo"
        if (part.match(/^\d+b$/)) return part.toUpperCase() // 70b -> 70B
        if (part.match(/^\d+\.\d+$/)) return part // version numbers like 3.1
        return part.charAt(0).toUpperCase() + part.slice(1)
      })
      .join(" ")

    return `${formattedModel} (${formattedProvider})`
  }

  // Fallback: capitalize each part
  return modelId
    .split("-")
    .map((part) => {
      // Handle special cases
      if (part === "instruct") return "Instruct"
      if (part === "turbo") return "Turbo"
      if (part.match(/^\d+b$/)) return part.toUpperCase() // 70b -> 70B
      if (part.match(/^\d+\.\d+$/)) return part // version numbers like 3.1
      return part.charAt(0).toUpperCase() + part.slice(1)
    })
    .join(" ")
}

/**
 * Main function to fetch available models for a provider
 */
export async function fetchAvailableModels(
  providerId: string,
): Promise<ModelInfo[]> {
  const cacheKey = providerId
  const cached = modelsCache.get(cacheKey)

  // Return cached result if still valid
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.models
  }

  try {
    const config = configStore.get()
    let models: ModelInfo[] = []

    switch (providerId) {
      case "openai":
        models = await fetchOpenAIModels(
          config.openaiBaseUrl,
          config.openaiApiKey,
        )
        break
      case "groq":
        models = await fetchGroqModels(config.groqBaseUrl, config.groqApiKey)
        break
      case "gemini":
        models = await fetchGeminiModels(
          config.geminiBaseUrl,
          config.geminiApiKey,
        )
        break
      default:
        throw new Error(`Unsupported provider: ${providerId}`)
    }

    // Cache the result
    modelsCache.set(cacheKey, {
      models,
      timestamp: Date.now(),
    })

    return models
  } catch (error) {
    diagnosticsService.logError(
      "models-service",
      `Failed to fetch models for ${providerId}`,
      error,
    )

    // Return fallback models if API call fails
    return getFallbackModels(providerId)
  }
}

/**
 * Get fallback models when API calls fail
 */
function getFallbackModels(providerId: string): ModelInfo[] {
  const config = configStore.get()
  const isOpenRouter =
    providerId === "openai" && config.openaiBaseUrl?.includes("openrouter.ai")

  const fallbackModels: Record<string, ModelInfo[]> = {
    openai: isOpenRouter
      ? [
          // OpenRouter popular models
          { id: "gpt-4o", name: "GPT-4o" },
          { id: "gpt-4o-mini", name: "GPT-4o Mini" },
          {
            id: "anthropic/claude-3.5-sonnet",
            name: "Claude 3.5 Sonnet (Anthropic)",
          },
          { id: "anthropic/claude-3-opus", name: "Claude 3 Opus (Anthropic)" },
          {
            id: "meta-llama/llama-3.1-405b-instruct",
            name: "Llama 3.1 405B Instruct (Meta)",
          },
          {
            id: "meta-llama/llama-3.1-70b-instruct",
            name: "Llama 3.1 70B Instruct (Meta)",
          },
          { id: "google/gemini-1.5-pro", name: "Gemini 1.5 Pro (Google)" },
          {
            id: "mistralai/mixtral-8x22b-instruct",
            name: "Mixtral 8x22B Instruct (Mistral)",
          },
        ]
      : [
          // Native OpenAI models
          { id: "gpt-4o", name: "GPT-4o" },
          { id: "gpt-4o-mini", name: "GPT-4o Mini" },
          { id: "gpt-4-turbo", name: "GPT-4 Turbo" },
          { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo" },
        ],
    groq: [
      { id: "gemma2-9b-it", name: "Gemma2 9B IT" },
      { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B Versatile" },
      { id: "llama-3.1-70b-versatile", name: "Llama 3.1 70B Versatile" },
      { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B" },
    ],
    gemini: [
      { id: "gemini-1.5-flash-002", name: "Gemini 1.5 Flash" },
      { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro" },
      { id: "gemini-1.0-pro", name: "Gemini 1.0 Pro" },
    ],
  }

  return fallbackModels[providerId] || []
}

/**
 * Clear the models cache (useful for testing or when credentials change)
 */
export function clearModelsCache(): void {
  modelsCache.clear()
}
