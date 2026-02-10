import { configStore } from "./config"
import { diagnosticsService } from "./diagnostics"
import { fetchModelsDevData, getModelFromModelsDevByProviderId } from "./models-dev-service"
import type { ModelsDevModel } from "./models-dev-service"
import type { ModelInfo, EnhancedModelInfo } from "../shared/types"

// Re-export ModelInfo for backward compatibility
export type { ModelInfo, EnhancedModelInfo } from "../shared/types"

interface ModelsResponse {
  data: ModelInfo[]
  object: string
}

// Cache for models to avoid frequent API calls
const modelsCache = new Map<
  string,
  { models: ModelInfo[]; timestamp: number }
>()
const CACHE_DURATION = 5 * 60 * 1000

/**
 * Map our provider IDs to models.dev provider IDs
 * @param providerId - Our provider ID (openai, groq, gemini)
 * @param baseUrl - Optional base URL to detect OpenRouter
 * @returns The models.dev provider ID
 */
function mapToModelsDevProviderId(providerId: string, baseUrl?: string): string {
  // Check if using OpenRouter
  if (providerId === "openai" && baseUrl?.includes("openrouter.ai")) {
    return "openrouter"
  }

  // Map our provider IDs to models.dev provider IDs
  const providerMap: Record<string, string> = {
    openai: "openai",
    groq: "groq",
    gemini: "google",
  }

  return providerMap[providerId] || providerId
}

/**
 * Enhance a ModelInfo object with data from models.dev
 * @param model - The basic ModelInfo to enhance
 * @param providerId - Our provider ID (openai, groq, gemini)
 * @param baseUrl - Optional base URL to detect OpenRouter
 * @returns Enhanced model info with pricing and capabilities
 */
function enhanceModelWithModelsDevData(
  model: ModelInfo,
  providerId: string,
  baseUrl?: string
): EnhancedModelInfo {
  const modelsDevProviderId = mapToModelsDevProviderId(providerId, baseUrl)
  const modelsDevModel = getModelFromModelsDevByProviderId(model.id, modelsDevProviderId)

  if (!modelsDevModel) {
    // Return as-is if no models.dev data found
    return model
  }

  const enhanced: EnhancedModelInfo = {
    ...model,
    // Use models.dev name if available, otherwise keep original
    name: model.name,
    family: modelsDevModel.family,

    // Capability flags
    supportsAttachment: modelsDevModel.attachment,
    supportsReasoning: modelsDevModel.reasoning,
    supportsToolCalls: modelsDevModel.tool_call,
    supportsStructuredOutput: modelsDevModel.structured_output,
    supportsTemperature: modelsDevModel.temperature,

    // Metadata
    knowledge: modelsDevModel.knowledge,
    releaseDate: modelsDevModel.release_date,
    lastUpdated: modelsDevModel.last_updated,
    openWeights: modelsDevModel.open_weights,

    // Pricing (USD per million tokens)
    inputCost: modelsDevModel.cost?.input,
    outputCost: modelsDevModel.cost?.output,
    reasoningCost: modelsDevModel.cost?.reasoning,
    cacheReadCost: modelsDevModel.cost?.cache_read,
    cacheWriteCost: modelsDevModel.cost?.cache_write,

    // Limits
    contextLimit: modelsDevModel.limit?.context,
    outputLimit: modelsDevModel.limit?.output,

    // Modalities
    inputModalities: modelsDevModel.modalities?.input,
    outputModalities: modelsDevModel.modalities?.output,
  }

  // Also update context_length if we have it from models.dev and it wasn't set
  if (!enhanced.context_length && modelsDevModel.limit?.context) {
    enhanced.context_length = modelsDevModel.limit.context
  }

  return enhanced
}

async function fetchOpenAIModels(
  baseUrl?: string,
  apiKey?: string,
): Promise<ModelInfo[]> {
  if (!apiKey) {
    throw new Error("OpenAI API key is required")
  }

  const url = `${baseUrl || "https://api.openai.com/v1"}/models`
  const isOpenRouter = baseUrl?.includes("openrouter.ai")
  const isCerebras = baseUrl?.includes("cerebras.ai")
  const isNativeOpenAI =
    !isOpenRouter && !isCerebras && (!baseUrl || baseUrl.includes("api.openai.com"))
  const isGenericOpenAICompatible =
    !isOpenRouter && !isCerebras && !!baseUrl && !baseUrl.includes("api.openai.com")

  diagnosticsService.logInfo(
    "models-service",
    `Fetching models from: ${url}`,
    {
      baseUrl,
      isOpenRouter,
      isCerebras,
      hasApiKey: !!apiKey,
      apiKeyPrefix: apiKey ? `${apiKey.substring(0, 8)}...` : "none",
    },
  )

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  })

  diagnosticsService.logInfo(
    "models-service",
    `Models API response: ${response.status} ${response.statusText}`,
    {
      url,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
    },
  )

  if (!response.ok) {
    const errorText = await response.text()
    diagnosticsService.logError(
      "models-service",
      `Models API request failed`,
      {
        url,
        status: response.status,
        statusText: response.statusText,
        errorText,
      },
    )
    throw new Error(`HTTP ${response.status}: ${errorText}`)
  }

  const data: ModelsResponse = await response.json()

  diagnosticsService.logInfo(
    "models-service",
    `Models API response data`,
    {
      url,
      dataKeys: Object.keys(data),
      modelsCount: data.data?.length || 0,
      firstFewModels: data.data?.slice(0, 3).map(m => ({ id: m.id, name: m.name || formatModelName(m.id) })) || [],
    },
  )

  let filteredModels = data.data

  if (isOpenRouter) {
    filteredModels = data.data.filter(
      (model) =>
        !model.id.includes(":ft-") &&
        !model.id.includes("instruct-beta") &&
        !model.id.includes("preview") &&
        model.id.length > 0,
    )
  } else if (isCerebras) {
    filteredModels = data.data.filter(
      (model) =>
        model.id && model.id.length > 0,
    )

    diagnosticsService.logInfo(
      "models-service",
      `Cerebras models after filtering`,
      {
        totalModels: data.data.length,
        filteredCount: filteredModels.length,
        modelIds: filteredModels.map(m => m.id),
      },
    )
  } else if (isNativeOpenAI) {
    filteredModels = data.data.filter(
      (model) =>
        !model.id.includes(":") &&
        !model.id.includes("instruct") &&
        (model.id.includes("gpt") || model.id.includes("o1")),
    )
  } else if (isGenericOpenAICompatible) {
    filteredModels = data.data.filter(
      (model) => model.id && model.id.length > 0,
    )
  } else {
    // Fallback: basic validation
    filteredModels = data.data.filter(
      (model) => model.id && model.id.length > 0,
    )
  }

  // Models that support speech-to-text transcription (OpenAI)
  const openaiTranscriptionModels = ["whisper-1"]

  const finalModels = filteredModels
    .map((model) => ({
      id: model.id,
      name: formatModelName(model.id),
      description: model.description,
      context_length: model.context_length,
      created: model.created,
      supportsTranscription: openaiTranscriptionModels.some(tm => model.id.includes(tm)),
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
      } else if (isCerebras) {
        // For Cerebras, sort alphabetically
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

  const providerLabel = isOpenRouter
    ? "OpenRouter"
    : isCerebras
      ? "Cerebras"
      : isNativeOpenAI
        ? "OpenAI"
        : "OpenAI-compatible"

  // Log final results
  diagnosticsService.logInfo(
    "models-service",
    `Final models list for ${providerLabel}`,
    {
      url,
      totalCount: finalModels.length,
      modelIds: finalModels.map(m => m.id),
      modelNames: finalModels.map(m => m.name),
    },
  )

  return finalModels
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

  // Models that support speech-to-text transcription
  const transcriptionModels = ["whisper-large-v3", "whisper-large-v3-turbo", "distil-whisper-large-v3-en"]

  return data.data
    .map((model) => ({
      id: model.id,
      name: formatModelName(model.id),
      description: model.description,
      context_length: model.context_length,
      created: model.created,
      supportsTranscription: transcriptionModels.some(tm => model.id.includes(tm)),
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
    "moonshotai/kimi-k2-instruct": "Kimi K2 Instruct (Moonshot AI)",
    "openai/gpt-oss-20b": "GPT-OSS 20B (OpenAI)",
    "openai/gpt-oss-120b": "GPT-OSS 120B (OpenAI)",
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
  const config = configStore.get()

  // Include base URL and API key hash in cache key so changing credentials invalidates cache
  // This ensures switching between presets with the same URL but different keys fetches fresh models
  const cacheKeyParts = [providerId]
  if (providerId === "openai") {
    const baseUrl = config.openaiBaseUrl || "https://api.openai.com/v1"
    const apiKey = config.openaiApiKey || ""
    cacheKeyParts.push(baseUrl)
    // Include a simple hash of API key (first 8 chars) to invalidate cache on key change
    // without exposing the full key in logs/debug output
    if (apiKey) {
      cacheKeyParts.push(apiKey.slice(0, 8))
    }
  } else if (providerId === "groq") {
    const baseUrl = config.groqBaseUrl || "https://api.groq.com/openai/v1"
    const apiKey = config.groqApiKey || ""
    cacheKeyParts.push(baseUrl)
    if (apiKey) {
      cacheKeyParts.push(apiKey.slice(0, 8))
    }
  } else if (providerId === "gemini") {
    const baseUrl = config.geminiBaseUrl || "https://generativelanguage.googleapis.com"
    const apiKey = config.geminiApiKey || ""
    cacheKeyParts.push(baseUrl)
    if (apiKey) {
      cacheKeyParts.push(apiKey.slice(0, 8))
    }
  }

  const cacheKey = cacheKeyParts.join("|")
  const cached = modelsCache.get(cacheKey)
  const now = Date.now()
  const cacheValid =
    !!cached &&
    now - cached.timestamp < CACHE_DURATION &&
    cached.models.length > 0

  // Log the request
  diagnosticsService.logInfo(
    "models-service",
    `Fetching models for provider: ${providerId}`,
    {
      providerId,
      cacheKey,
      hasCached: !!cached,
      cacheAge: cached ? now - cached.timestamp : null,
      cacheValid,
    },
  )

  // Return cached result if still valid
  if (cacheValid) {
    diagnosticsService.logInfo(
      "models-service",
      `Returning cached models for ${providerId}`,
      { count: cached?.models.length || 0 },
    )
    return cached!.models
  }

  try {
    let models: ModelInfo[] = []

    // Log config details for debugging
    diagnosticsService.logInfo(
      "models-service",
      `Config for ${providerId}`,
      {
        providerId,
        openaiBaseUrl: config.openaiBaseUrl,
        hasOpenaiApiKey: !!config.openaiApiKey,
        hasGroqApiKey: !!config.groqApiKey,
        hasGeminiApiKey: !!config.geminiApiKey,
      },
    )

    // Get base URL for provider to detect OpenRouter
    let baseUrl: string | undefined
    switch (providerId) {
      case "openai":
        baseUrl = config.openaiBaseUrl
        models = await fetchOpenAIModels(baseUrl, config.openaiApiKey)
        break
      case "groq":
        baseUrl = config.groqBaseUrl
        models = await fetchGroqModels(baseUrl, config.groqApiKey)
        break
      case "gemini":
        baseUrl = config.geminiBaseUrl
        models = await fetchGeminiModels(baseUrl, config.geminiApiKey)
        break
      default:
        throw new Error(`Unsupported provider: ${providerId}`)
    }

    // Trigger models.dev cache population in background (don't await)
    fetchModelsDevData().catch((err) => {
      diagnosticsService.logInfo(
        "models-service",
        `Background models.dev fetch failed (non-blocking)`,
        { error: err instanceof Error ? err.message : String(err) }
      )
    })

    // Enhance models with models.dev data
    const enhancedModels = models.map((model) =>
      enhanceModelWithModelsDevData(model, providerId, baseUrl)
    )

    // Log successful fetch
    diagnosticsService.logInfo(
      "models-service",
      `Successfully fetched ${enhancedModels.length} models for ${providerId}`,
      {
        providerId,
        count: enhancedModels.length,
        modelIds: enhancedModels.map(m => m.id),
      },
    )

    // Cache the result only if we have at least one model
    if (enhancedModels.length > 0) {
      modelsCache.set(cacheKey, {
        models: enhancedModels,
        timestamp: now,
      })
    } else {
      diagnosticsService.logInfo(
        "models-service",
        `Not caching empty models list for ${providerId}`,
        {
          providerId,
          cacheKey,
        },
      )
    }

    return enhancedModels
  } catch (error) {
    diagnosticsService.logError(
      "models-service",
      `Failed to fetch models for ${providerId}`,
      {
        providerId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    )

    // Return fallback models if API call fails
    // Try async fallback first, then sync fallback
    try {
      const fallbackModels = await getFallbackModelsAsync(providerId)
      diagnosticsService.logInfo(
        "models-service",
        `Returning ${fallbackModels.length} fallback models (from models.dev) for ${providerId}`,
        {
          providerId,
          fallbackCount: fallbackModels.length,
          fallbackIds: fallbackModels.map(m => m.id),
        },
      )
      return fallbackModels
    } catch {
      const fallbackModels = getFallbackModels(providerId)
      diagnosticsService.logInfo(
        "models-service",
        `Returning ${fallbackModels.length} fallback models (hardcoded) for ${providerId}`,
        {
          providerId,
          fallbackCount: fallbackModels.length,
          fallbackIds: fallbackModels.map(m => m.id),
        },
      )
      return fallbackModels
    }
  }
}

/**
 * Minimal hardcoded fallback models - only used when BOTH provider API
 * AND models.dev cache are unavailable. Keep this list minimal since
 * models.dev is the primary source for fallback model data.
 */
const HARDCODED_FALLBACK_MODELS: Record<string, ModelInfo[]> = {
  openai: [
    { id: "gpt-4o-mini", name: "GPT-4o Mini" },
  ],
  openrouter: [
    { id: "openai/gpt-4o-mini", name: "GPT-4o Mini (OpenAI)" },
    { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet (Anthropic)" },
  ],
  groq: [
    { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B Versatile" },
  ],
  google: [
    { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash" },
  ],
}

/**
 * Get fallback models when API calls fail.
 * First tries to get models from models.dev cache, then falls back to hardcoded models.
 */
async function getFallbackModelsAsync(providerId: string): Promise<ModelInfo[]> {
  const config = configStore.get()
  const isOpenRouter =
    providerId === "openai" && config.openaiBaseUrl?.includes("openrouter.ai")

  const modelsDevProviderId = isOpenRouter ? "openrouter" : mapToModelsDevProviderId(providerId)

  try {
    // Try to get models from models.dev cache
    const modelsDevData = await fetchModelsDevData()
    const provider = modelsDevData[modelsDevProviderId]

    if (provider && provider.models && Object.keys(provider.models).length > 0) {
      const models = Object.entries(provider.models).map(([modelId, modelData]) => {
        const model: ModelInfo = {
          id: modelId,
          name: modelData.name || formatModelName(modelId),
          context_length: modelData.limit?.context,
        }
        return enhanceModelWithModelsDevData(model, providerId, isOpenRouter ? config.openaiBaseUrl : undefined)
      })

      diagnosticsService.logInfo(
        "models-service",
        `Using ${models.length} fallback models from models.dev for ${modelsDevProviderId}`,
        { providerId, modelsDevProviderId, count: models.length }
      )

      return models
    }
  } catch (error) {
    diagnosticsService.logInfo(
      "models-service",
      `Failed to get fallback models from models.dev, using hardcoded fallbacks`,
      { providerId, error: error instanceof Error ? error.message : String(error) }
    )
  }

  // Fall back to hardcoded models
  const hardcodedKey = isOpenRouter ? "openrouter" : modelsDevProviderId
  return HARDCODED_FALLBACK_MODELS[hardcodedKey] || HARDCODED_FALLBACK_MODELS[providerId] || []
}

/**
 * Get fallback models synchronously (for backwards compatibility)
 * This uses the synchronous getModelFromModelsDevByProviderId which requires cache to be loaded
 */
function getFallbackModels(providerId: string): ModelInfo[] {
  const config = configStore.get()
  const isOpenRouter =
    providerId === "openai" && config.openaiBaseUrl?.includes("openrouter.ai")

  // Use hardcoded fallbacks for synchronous access
  const hardcodedKey = isOpenRouter ? "openrouter" : mapToModelsDevProviderId(providerId)
  return HARDCODED_FALLBACK_MODELS[hardcodedKey] || HARDCODED_FALLBACK_MODELS[providerId] || []
}

/**
 * Clear the models cache (useful for testing or when credentials change)
 */
export function clearModelsCache(): void {
  modelsCache.clear()
}

/**
 * Fetch models for a specific preset (base URL + API key combination)
 * This is used by the preset manager to show available models when configuring a preset
 */
export async function fetchModelsForPreset(
  baseUrl: string,
  apiKey: string,
): Promise<ModelInfo[]> {
  if (!baseUrl || !apiKey) {
    throw new Error("Base URL and API key are required")
  }

  // Use the same fetchOpenAIModels function but with the preset's credentials
  try {
    const models = await fetchOpenAIModels(baseUrl, apiKey)
    return models
  } catch (error) {
    diagnosticsService.logError(
      "models-service",
      `Failed to fetch models for preset`,
      {
        baseUrl,
        error: error instanceof Error ? error.message : String(error),
      },
    )
    throw error
  }
}
