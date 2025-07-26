import { configStore } from '../config'
import { withRetry, withTimeout, ErrorContext } from './error-handler'
import { TIMEOUTS, RETRY_CONFIG, API_ENDPOINTS, ERROR_MESSAGES } from '../../shared/constants'

/**
 * Common API utilities to reduce code duplication
 */

export type ProviderType = 'openai' | 'groq' | 'gemini'

export interface ApiConfig {
  baseUrl: string
  apiKey: string
  model?: string
}

/**
 * Get API configuration for a provider
 */
export function getProviderConfig(providerId: ProviderType): ApiConfig {
  const config = configStore.get()
  
  switch (providerId) {
    case 'openai':
      return {
        baseUrl: config.openaiBaseUrl || 'https://api.openai.com/v1',
        apiKey: config.openaiApiKey || '',
        model: config.transcriptPostProcessingOpenaiModel
      }
    case 'groq':
      return {
        baseUrl: config.groqBaseUrl || 'https://api.groq.com/openai/v1',
        apiKey: config.groqApiKey || '',
        model: config.transcriptPostProcessingGroqModel
      }
    case 'gemini':
      return {
        baseUrl: config.geminiBaseUrl || 'https://generativelanguage.googleapis.com',
        apiKey: config.geminiApiKey || '',
        model: config.transcriptPostProcessingGeminiModel
      }
    default:
      throw new Error(`Unsupported provider: ${providerId}`)
  }
}

/**
 * Standard HTTP headers for API calls
 */
export function getStandardHeaders(apiKey: string, isGemini: boolean = false): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  
  if (!isGemini) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }
  
  return headers
}

/**
 * Make a standardized HTTP request with retry and timeout
 */
export async function makeApiRequest<T = any>(
  url: string,
  options: RequestInit,
  context: ErrorContext,
  timeoutMs: number = TIMEOUTS.DEFAULT_CONNECTION
): Promise<T> {
  return withRetry(
    async () => {
      const fetchPromise = fetch(url, options)
      const response = await withTimeout(fetchPromise, timeoutMs)
      
      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`HTTP ${response.status}: ${errorText}`)
      }
      
      const data = await response.json()
      
      if (data.error) {
        throw new Error(data.error.message || 'API returned an error')
      }
      
      return data
    },
    context,
    RETRY_CONFIG.API_CALL_ATTEMPTS
  )
}

/**
 * Build OpenAI-compatible API URL
 */
export function buildOpenAIUrl(baseUrl: string, endpoint: string = API_ENDPOINTS.OPENAI_CHAT): string {
  return `${baseUrl.replace(/\/$/, '')}${endpoint}`
}

/**
 * Build Gemini API URL
 */
export function buildGeminiUrl(baseUrl: string, model: string): string {
  const config = configStore.get()
  return `${baseUrl}${API_ENDPOINTS.GEMINI_GENERATE}/${model}:generateContent?key=${config.geminiApiKey}`
}

/**
 * Extract response content from different provider formats
 */
export function extractResponseContent(response: any, providerId: ProviderType): string {
  switch (providerId) {
    case 'gemini':
      return response.candidates?.[0]?.content?.parts?.[0]?.text || ''
    case 'openai':
    case 'groq':
    default:
      return response.choices?.[0]?.message?.content?.trim() || ''
  }
}

/**
 * Validate response has content
 */
export function validateResponseContent(content: string): void {
  if (!content) {
    throw new Error(ERROR_MESSAGES.NO_RESPONSE_CONTENT)
  }
}

/**
 * Check if a model supports JSON mode
 */
export function supportsJsonMode(model: string, providerId: ProviderType): boolean {
  if (providerId === 'gemini') {
    return false // Gemini doesn't support JSON mode in the same way
  }
  
  // OpenAI and Groq models that support JSON mode
  const jsonModeModels = [
    'gpt-4',
    'gpt-4-turbo',
    'gpt-4o',
    'gpt-3.5-turbo',
    'llama3-8b-8192',
    'llama3-70b-8192',
    'mixtral-8x7b-32768'
  ]
  
  return jsonModeModels.some(supportedModel => model.includes(supportedModel))
}

/**
 * Create standard message format
 */
export function createMessage(role: 'system' | 'user' | 'assistant', content: string) {
  return { role, content }
}

/**
 * Create system message with prompt
 */
export function createSystemMessage(prompt: string) {
  return createMessage('system', prompt)
}

/**
 * Create user message
 */
export function createUserMessage(content: string) {
  return createMessage('user', content)
}

/**
 * Format messages for Gemini API
 */
export function formatMessagesForGemini(messages: Array<{role: string, content: string}>) {
  // Gemini expects a different format
  return {
    contents: messages.map(msg => ({
      parts: [{ text: msg.content }]
    }))
  }
}

/**
 * Create request body for OpenAI-compatible APIs
 */
export function createOpenAIRequestBody(
  messages: Array<{role: string, content: string}>,
  model: string,
  useStructuredOutput: boolean = false,
  providerId: ProviderType = 'openai'
) {
  const requestBody: any = {
    model,
    messages,
    temperature: 0,
  }
  
  // Add structured output for supported models
  if (useStructuredOutput && supportsJsonMode(model, providerId)) {
    requestBody.response_format = { type: 'json_object' }
  }
  
  return requestBody
}

/**
 * Create request body for Gemini API
 */
export function createGeminiRequestBody(messages: Array<{role: string, content: string}>) {
  return {
    contents: [{
      parts: [{ text: messages[messages.length - 1]?.content || '' }]
    }],
    generationConfig: {
      temperature: 0,
    }
  }
}
