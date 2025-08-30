/**
 * Unified LLM Service
 * 
 * This service replaces the existing LLM integration with a unified
 * system that works with any provider through the provider registry.
 */

import {
  ProviderId,
  ServiceType,
  ModelType,
  ProviderError,
  APIError,
} from "../shared/provider-system"
import { providerRegistry, providerFactory } from "./provider-registry"
import { unifiedConfigStore } from "./unified-config-store"
import { unifiedModelsService } from "./unified-models-service"
import { diagnosticsService } from "./diagnostics"
import { isDebugLLM, logLLM } from "./debug"

// LLM request/response interfaces
export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string
  toolCalls?: any[]
  toolResults?: any[]
}

export interface LLMRequest {
  messages: LLMMessage[]
  model?: string
  temperature?: number
  maxTokens?: number
  stream?: boolean
  tools?: any[]
  toolChoice?: any
}

export interface LLMResponse {
  content?: string
  toolCalls?: any[]
  usage?: {
    promptTokens?: number
    completionTokens?: number
    totalTokens?: number
  }
  model?: string
  finishReason?: string
}

export interface LLMToolCallResponse extends LLMResponse {
  content: string
}

/**
 * Unified LLM Service Implementation
 */
class UnifiedLLMService {
  /**
   * Make a chat completion request
   */
  async makeChatCompletion(
    messages: LLMMessage[],
    options: {
      providerId?: ProviderId
      modelType?: ModelType
      temperature?: number
      maxTokens?: number
      tools?: any[]
      stream?: boolean
    } = {}
  ): Promise<LLMResponse> {
    const config = unifiedConfigStore.get()
    const providerId = options.providerId || config.providers?.activeProviders.chat || "openai"
    
    try {
      // Get provider and validate
      const provider = providerRegistry.getProvider(providerId)
      if (!provider) {
        throw new ProviderError(`Provider ${providerId} not found`, providerId)
      }

      if (!provider.capabilities.chat) {
        throw new ProviderError(`Provider ${providerId} does not support chat`, providerId, "chat")
      }

      // Get provider configuration
      const providerConfig = unifiedConfigStore.getProviderConfig(providerId)
      if (!providerConfig?.apiKey) {
        throw new ProviderError(`No API key configured for ${providerId}`, providerId)
      }

      // Get model
      const model = options.modelType 
        ? unifiedModelsService.getDefaultModel(providerId, "chat", options.modelType)
        : unifiedModelsService.getDefaultModel(providerId, "chat")

      if (!model) {
        throw new ProviderError(`No model configured for ${providerId}`, providerId, "chat")
      }

      // Build request
      const request: LLMRequest = {
        messages,
        model,
        temperature: options.temperature ?? providerConfig.chat?.temperature ?? 0,
        maxTokens: options.maxTokens ?? providerConfig.chat?.maxTokens,
        stream: options.stream ?? false,
        tools: options.tools,
      }

      if (isDebugLLM()) {
        logLLM("=== UNIFIED LLM REQUEST ===")
        logLLM("Provider:", providerId)
        logLLM("Model:", model)
        logLLM("Messages:", messages.length)
        logLLM("Request:", request)
      }

      // Make API call based on provider
      const response = await this.makeProviderRequest(providerId, request, providerConfig)

      if (isDebugLLM()) {
        logLLM("=== UNIFIED LLM RESPONSE ===")
        logLLM("Response:", response)
      }

      return response

    } catch (error) {
      diagnosticsService.logError("unified-llm-service", `Chat completion failed for ${providerId}`, error)
      throw error
    }
  }

  /**
   * Make a simple text completion request
   */
  async makeTextCompletion(
    prompt: string,
    options: {
      providerId?: ProviderId
      modelType?: ModelType
      temperature?: number
    } = {}
  ): Promise<string> {
    const messages: LLMMessage[] = [
      {
        role: "system",
        content: prompt,
      },
    ]

    const response = await this.makeChatCompletion(messages, options)
    return response.content || ""
  }

  /**
   * Make a tool-calling request (for MCP integration)
   */
  async makeToolCallRequest(
    messages: LLMMessage[],
    tools: any[],
    options: {
      providerId?: ProviderId
      temperature?: number
    } = {}
  ): Promise<LLMToolCallResponse> {
    const response = await this.makeChatCompletion(messages, {
      ...options,
      modelType: "mcp",
      tools,
    })

    return {
      content: response.content || "",
      toolCalls: response.toolCalls,
      usage: response.usage,
      model: response.model,
      finishReason: response.finishReason,
    }
  }

  /**
   * Make provider-specific API request
   */
  private async makeProviderRequest(
    providerId: ProviderId,
    request: LLMRequest,
    providerConfig: any
  ): Promise<LLMResponse> {
    switch (providerId) {
      case "openai":
        return this.makeOpenAIRequest(request, providerConfig)
      case "groq":
        return this.makeGroqRequest(request, providerConfig)
      case "gemini":
        return this.makeGeminiRequest(request, providerConfig)
      default:
        throw new ProviderError(`Unsupported provider: ${providerId}`, providerId)
    }
  }

  /**
   * Make OpenAI-compatible API request (works for OpenAI, Groq, etc.)
   */
  private async makeOpenAIRequest(request: LLMRequest, config: any): Promise<LLMResponse> {
    const baseUrl = config.baseUrl || "https://api.openai.com/v1"
    const url = `${baseUrl}/chat/completions`

    const requestBody: any = {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature,
      stream: request.stream,
    }

    if (request.maxTokens) {
      requestBody.max_tokens = request.maxTokens
    }

    if (request.tools && request.tools.length > 0) {
      requestBody.tools = request.tools
      requestBody.tool_choice = request.toolChoice || "auto"
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new APIError(
        `HTTP ${response.status}: ${errorText}`,
        config.providerId || "openai",
        "chat",
        response.status,
        errorText
      )
    }

    const data = await response.json()

    return {
      content: data.choices?.[0]?.message?.content || "",
      toolCalls: data.choices?.[0]?.message?.tool_calls,
      usage: {
        promptTokens: data.usage?.prompt_tokens,
        completionTokens: data.usage?.completion_tokens,
        totalTokens: data.usage?.total_tokens,
      },
      model: data.model,
      finishReason: data.choices?.[0]?.finish_reason,
    }
  }

  /**
   * Make Groq API request (uses OpenAI-compatible format)
   */
  private async makeGroqRequest(request: LLMRequest, config: any): Promise<LLMResponse> {
    // Groq uses OpenAI-compatible API
    return this.makeOpenAIRequest(request, {
      ...config,
      baseUrl: config.baseUrl || "https://api.groq.com/openai/v1",
      providerId: "groq",
    })
  }

  /**
   * Make Gemini API request
   */
  private async makeGeminiRequest(request: LLMRequest, config: any): Promise<LLMResponse> {
    const baseUrl = config.baseUrl || "https://generativelanguage.googleapis.com"
    const model = request.model || "gemini-1.5-flash-002"
    const url = `${baseUrl}/v1beta/models/${model}:generateContent?key=${config.apiKey}`

    // Convert messages to Gemini format
    const prompt = request.messages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n\n")

    const requestBody = {
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: request.temperature || 0,
      },
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new APIError(
        `HTTP ${response.status}: ${errorText}`,
        "gemini",
        "chat",
        response.status,
        errorText
      )
    }

    const data = await response.json()

    // Extract text from Gemini response format
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) {
      throw new APIError("No text content in Gemini response", "gemini", "chat")
    }

    return {
      content: text.trim(),
      usage: {
        promptTokens: data.usageMetadata?.promptTokenCount,
        completionTokens: data.usageMetadata?.candidatesTokenCount,
        totalTokens: data.usageMetadata?.totalTokenCount,
      },
      model: model,
      finishReason: data.candidates?.[0]?.finishReason,
    }
  }

  /**
   * Test provider connection
   */
  async testConnection(providerId: ProviderId): Promise<boolean> {
    try {
      const testMessages: LLMMessage[] = [
        {
          role: "user",
          content: "Hello, this is a connection test. Please respond with 'OK'.",
        },
      ]

      const response = await this.makeChatCompletion(testMessages, {
        providerId,
        temperature: 0,
      })

      return !!response.content
    } catch (error) {
      diagnosticsService.logError("unified-llm-service", `Connection test failed for ${providerId}`, error)
      return false
    }
  }

  /**
   * Get available models for a provider
   */
  async getAvailableModels(providerId: ProviderId): Promise<any[]> {
    return unifiedModelsService.fetchModels(providerId, "chat")
  }

  /**
   * Clear models cache
   */
  clearModelsCache(providerId?: ProviderId): void {
    unifiedModelsService.clearCache(providerId)
  }
}

// Export singleton instance
export const unifiedLLMService = new UnifiedLLMService()

// Export class for testing
export { UnifiedLLMService }

// Backward compatibility exports for existing code
export const makeLLMCallWithFetch = async (
  messages: Array<{ role: string; content: string }>,
  providerId?: string,
): Promise<LLMToolCallResponse> => {
  return unifiedLLMService.makeToolCallRequest(
    messages as LLMMessage[],
    [], // No tools for basic calls
    { providerId: providerId as ProviderId }
  )
}

export const makeTextCompletionWithFetch = async (
  prompt: string,
  providerId?: string,
): Promise<string> => {
  return unifiedLLMService.makeTextCompletion(prompt, {
    providerId: providerId as ProviderId,
    modelType: "transcript"
  })
}
