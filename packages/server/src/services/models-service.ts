/**
 * Models Service - Fetch available models from LLM providers
 * Simplified version for the standalone server package
 */

import { configStore } from '../config'

export interface ModelInfo {
  id: string
  name: string
  description?: string
  context_length?: number
}

// Cache to avoid frequent API calls
const modelsCache = new Map<string, { models: ModelInfo[]; timestamp: number }>()
const CACHE_DURATION = 5 * 60 * 1000

function formatModelName(modelId: string): string {
  const nameMap: Record<string, string> = {
    "gpt-4o": "GPT-4o",
    "gpt-4o-mini": "GPT-4o Mini",
    "gpt-4-turbo": "GPT-4 Turbo",
    "gpt-4": "GPT-4",
    "gpt-3.5-turbo": "GPT-3.5 Turbo",
    "o1-preview": "o1 Preview",
    "o1-mini": "o1 Mini",
    "gemma2-9b-it": "Gemma2 9B IT",
    "llama-3.3-70b-versatile": "Llama 3.3 70B Versatile",
    "llama-3.1-70b-versatile": "Llama 3.1 70B Versatile",
    "mixtral-8x7b-32768": "Mixtral 8x7B",
  }

  if (nameMap[modelId]) return nameMap[modelId]

  // Fallback: capitalize
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

async function fetchOpenAIModels(baseUrl?: string, apiKey?: string): Promise<ModelInfo[]> {
  if (!apiKey) throw new Error("OpenAI API key is required")

  const url = `${baseUrl || "https://api.openai.com/v1"}/models`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  })

  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`)

  const data = await response.json() as { data: Array<{ id: string; description?: string; context_length?: number }> }

  const isNativeOpenAI = !baseUrl || baseUrl.includes("api.openai.com")

  const filtered = isNativeOpenAI
    ? data.data.filter(m => !m.id.includes(":") && !m.id.includes("instruct") && (m.id.includes("gpt") || m.id.includes("o1")))
    : data.data.filter(m => m.id && m.id.length > 0)

  return filtered
    .map(m => ({ id: m.id, name: formatModelName(m.id), description: m.description, context_length: m.context_length }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

async function fetchGroqModels(baseUrl?: string, apiKey?: string): Promise<ModelInfo[]> {
  if (!apiKey) throw new Error("Groq API key is required")

  const url = `${baseUrl || "https://api.groq.com/openai/v1"}/models`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
  })

  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`)

  const data = await response.json() as { data: Array<{ id: string; description?: string; context_length?: number }> }

  return data.data
    .map(m => ({ id: m.id, name: formatModelName(m.id), description: m.description, context_length: m.context_length }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

async function fetchGeminiModels(baseUrl?: string, apiKey?: string): Promise<ModelInfo[]> {
  if (!apiKey) throw new Error("Gemini API key is required")

  const url = `${baseUrl || "https://generativelanguage.googleapis.com"}/v1beta/models?key=${apiKey}`
  const response = await fetch(url, { headers: { "Content-Type": "application/json" } })

  if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`)

  const data = await response.json() as { models?: Array<{ name: string; description?: string; inputTokenLimit?: number; supportedGenerationMethods?: string[] }> }

  if (!data.models || !Array.isArray(data.models)) return []

  return data.models
    .filter(m => m.name && m.name.includes("gemini") && m.supportedGenerationMethods?.includes("generateContent"))
    .map(m => {
      const modelId = m.name.split("/").pop() || m.name
      return { id: modelId, name: formatModelName(modelId), description: m.description, context_length: m.inputTokenLimit }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function fetchAvailableModels(providerId: string): Promise<ModelInfo[]> {
  const config = configStore.get() as Record<string, string | undefined>

  const cacheKey = `${providerId}|${config[`${providerId}ApiKey`]?.slice(0, 8) || ""}`
  const cached = modelsCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION && cached.models.length > 0) {
    return cached.models
  }

  let models: ModelInfo[]
  switch (providerId) {
    case "openai":
      models = await fetchOpenAIModels(config.openaiBaseUrl, config.openaiApiKey)
      break
    case "groq":
      models = await fetchGroqModels(config.groqBaseUrl, config.groqApiKey)
      break
    case "gemini":
      models = await fetchGeminiModels(config.geminiBaseUrl, config.geminiApiKey)
      break
    default:
      throw new Error(`Unsupported provider: ${providerId}`)
  }

  if (models.length > 0) {
    modelsCache.set(cacheKey, { models, timestamp: Date.now() })
  }

  return models
}

