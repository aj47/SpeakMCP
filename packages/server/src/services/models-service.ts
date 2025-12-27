import OpenAI from 'openai'
import { config } from '../config.js'
import { configService } from './config-service.js'

export interface ModelInfo {
  id: string
  name: string
  providerId: string
}

export const modelsService = {
  /**
   * Fetch available models for a provider
   */
  async fetchModels(providerId: string): Promise<ModelInfo[]> {
    const appConfig = configService.get()
    
    try {
      const client = getClientForProvider(providerId, appConfig)
      const response = await client.models.list()
      
      const models = response.data
        .filter(m => isRelevantModel(m.id, providerId))
        .map(m => ({
          id: m.id,
          name: formatModelName(m.id),
          providerId,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))

      return models
    } catch (error) {
      console.error(`Failed to fetch models for ${providerId}:`, error)
      return getDefaultModels(providerId)
    }
  },

  /**
   * Fetch models for a custom preset
   */
  async fetchModelsForPreset(presetId: string): Promise<ModelInfo[]> {
    const appConfig = configService.get()
    const preset = appConfig.modelPresets?.find(p => p.id === presetId)
    
    if (!preset) {
      throw new Error(`Preset ${presetId} not found`)
    }

    // If preset has hardcoded models, return those
    if (preset.models && preset.models.length > 0) {
      return preset.models.map(id => ({
        id,
        name: formatModelName(id),
        providerId: presetId,
      }))
    }

    // Otherwise try to fetch from the endpoint
    try {
      const client = new OpenAI({
        apiKey: preset.apiKey || 'not-needed',
        baseURL: preset.baseUrl,
      })

      const response = await client.models.list()
      return response.data.map(m => ({
        id: m.id,
        name: formatModelName(m.id),
        providerId: presetId,
      }))
    } catch (error) {
      console.error(`Failed to fetch models for preset ${presetId}:`, error)
      return []
    }
  },

  /**
   * Get default models for a provider (fallback when API fails)
   */
  getDefaultModels(providerId: string): ModelInfo[] {
    return getDefaultModels(providerId)
  },
}

function getClientForProvider(providerId: string, appConfig: ReturnType<typeof configService.get>): OpenAI {
  switch (providerId) {
    case 'groq':
      return new OpenAI({
        apiKey: appConfig.groqApiKey ?? config.groq.apiKey ?? '',
        baseURL: appConfig.groqBaseUrl ?? config.groq.baseUrl,
      })
    case 'gemini':
      return new OpenAI({
        apiKey: appConfig.geminiApiKey ?? config.gemini.apiKey ?? '',
        baseURL: appConfig.geminiBaseUrl ?? 'https://generativelanguage.googleapis.com/v1beta/openai',
      })
    case 'openai':
    default:
      return new OpenAI({
        apiKey: appConfig.openaiApiKey ?? config.openai.apiKey ?? '',
        baseURL: appConfig.openaiBaseUrl ?? config.openai.baseUrl,
      })
  }
}

function isRelevantModel(modelId: string, providerId: string): boolean {
  const id = modelId.toLowerCase()
  
  // Filter out embedding, moderation, and other non-chat models
  if (id.includes('embedding') || id.includes('moderation') || id.includes('davinci') || 
      id.includes('babbage') || id.includes('ada') || id.includes('curie')) {
    return false
  }

  switch (providerId) {
    case 'openai':
      return id.includes('gpt') || id.includes('o1') || id.includes('o3')
    case 'groq':
      return id.includes('llama') || id.includes('mixtral') || id.includes('gemma')
    case 'gemini':
      return id.includes('gemini')
    default:
      return true
  }
}

function formatModelName(modelId: string): string {
  // Simple formatting - capitalize and clean up
  return modelId
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

function getDefaultModels(providerId: string): ModelInfo[] {
  switch (providerId) {
    case 'openai':
      return [
        { id: 'gpt-4o', name: 'GPT-4o', providerId },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini', providerId },
        { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', providerId },
        { id: 'gpt-4', name: 'GPT-4', providerId },
        { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', providerId },
        { id: 'o1-preview', name: 'O1 Preview', providerId },
        { id: 'o1-mini', name: 'O1 Mini', providerId },
      ]
    case 'groq':
      return [
        { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', providerId },
        { id: 'llama-3.1-70b-versatile', name: 'Llama 3.1 70B', providerId },
        { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', providerId },
        { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', providerId },
        { id: 'gemma2-9b-it', name: 'Gemma 2 9B', providerId },
      ]
    case 'gemini':
      return [
        { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash', providerId },
        { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', providerId },
        { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', providerId },
      ]
    default:
      return []
  }
}

