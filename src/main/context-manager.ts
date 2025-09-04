import { configStore } from "./config"
import { makeTextCompletionWithFetch } from "./llm-fetch"
import { isDebugLLM, logLLM } from "./debug"
import { diagnosticsService } from "./diagnostics"

export interface Message {
  role: "user" | "assistant" | "system" | "tool"
  content: string
  timestamp?: number
  toolCalls?: any[]
  toolResults?: any[]
}

export interface ContextManagerConfig {
  maxTokens: number
  targetTokens: number // Safety buffer (70% of max)
  compressionRatio: number // Target compression ratio for summaries
}

/**
 * Model context limits mapping
 */
const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  // OpenAI models
  "gpt-4o": 128000,
  "gpt-4o-mini": 128000,
  "gpt-4-turbo": 128000,
  "gpt-3.5-turbo": 16385,

  // Groq/OpenRouter models
  "llama-3.3-70b-versatile": 32768,
  "llama-3.1-70b-versatile": 32768,
  "mixtral-8x7b-32768": 32768,
  "gemma2-9b-it": 8192,
  "moonshotai/kimi-k2:free": 32768,
  "z-ai/glm-4.5": 32768,

  // Gemini models
  "gemini-1.5-flash-002": 1000000,
  "gemini-1.5-pro": 2000000,

  // Default fallback
  "default": 32768
}

/**
 * Get context limit for a model
 */
function getModelContextLimit(model: string): number {
  return MODEL_CONTEXT_LIMITS[model] || MODEL_CONTEXT_LIMITS["default"]
}

/**
 * Estimate token count from text (rough approximation: 4 chars per token)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Estimate tokens for messages array
 */
function estimateMessagesTokens(messages: Message[]): number {
  const totalText = messages.map(m => m.content).join(' ')
  return estimateTokens(totalText)
}

/**
 * Simple LLM-powered context manager
 */
export class SimpleContextManager {
  private config: ContextManagerConfig

  constructor(modelContextLimit: number) {
    this.config = {
      maxTokens: modelContextLimit,
      targetTokens: Math.floor(modelContextLimit * 0.7), // 70% safety buffer
      compressionRatio: 0.3 // Compress to 30% of original
    }

    if (isDebugLLM()) {
      logLLM("Context Manager initialized", {
        maxTokens: this.config.maxTokens,
        targetTokens: this.config.targetTokens,
        compressionRatio: this.config.compressionRatio
      })
    }
  }

  /**
   * Main context management entry point
   */
  async manageContext(messages: Message[]): Promise<Message[]> {
    const currentTokens = estimateMessagesTokens(messages)

    if (currentTokens <= this.config.targetTokens) {
      if (isDebugLLM()) {
        logLLM("Context management: No action needed", {
          currentTokens,
          targetTokens: this.config.targetTokens
        })
      }
      return messages
    }

    if (isDebugLLM()) {
      logLLM("Context management: Compression needed", {
        currentTokens,
        targetTokens: this.config.targetTokens,
        overageTokens: currentTokens - this.config.targetTokens
      })
    }

    try {
      return await this.compressWithLLM(messages)
    } catch (error) {
      if (isDebugLLM()) {
        logLLM("Context management: LLM compression failed, falling back to truncation", error)
      }
      diagnosticsService.logError("context-manager", "LLM compression failed", error)

      // Fallback to simple truncation
      return this.simpleTruncation(messages)
    }
  }

  /**
   * LLM-powered compression strategy
   */
  private async compressWithLLM(messages: Message[]): Promise<Message[]> {
    // 1. Always preserve system prompt and recent messages
    const systemMessage = messages.find(m => m.role === 'system')
    const recentMessages = messages.slice(-3) // Last 3 exchanges

    // 2. Identify middle section to compress
    const startIndex = systemMessage ? 1 : 0
    const endIndex = messages.length - 3
    const middleSection = messages.slice(startIndex, Math.max(startIndex, endIndex))

    if (middleSection.length === 0) {
      if (isDebugLLM()) {
        logLLM("Context management: No middle section to compress")
      }
      return messages // Nothing to compress
    }

    // 3. Compress middle section with LLM
    const compressedMessage = await this.summarizeMessages(middleSection)

    // 4. Reconstruct context
    const result = [
      ...(systemMessage ? [systemMessage] : []),
      compressedMessage,
      ...recentMessages
    ].filter(Boolean)

    if (isDebugLLM()) {
      logLLM("Context management: LLM compression completed", {
        originalMessages: messages.length,
        compressedMessages: result.length,
        originalTokens: estimateMessagesTokens(messages),
        compressedTokens: estimateMessagesTokens(result)
      })
    }

    return result
  }

  /**
   * Fallback simple truncation strategy
   */
  private simpleTruncation(messages: Message[]): Promise<Message[]> {
    const systemMessage = messages.find(m => m.role === 'system')
    const criticalMessages = this.identifyCriticalMessages(messages)
    const recentMessages = messages.slice(-4) // Last 4 exchanges

    // Combine and deduplicate
    const result = [
      ...(systemMessage ? [systemMessage] : []),
      ...criticalMessages,
      ...recentMessages
    ].filter((msg, index, arr) =>
      arr.findIndex(m => m.content === msg.content && m.role === msg.role) === index
    )

    if (isDebugLLM()) {
      logLLM("Context management: Simple truncation completed", {
        originalMessages: messages.length,
        truncatedMessages: result.length,
        originalTokens: estimateMessagesTokens(messages),
        truncatedTokens: estimateMessagesTokens(result)
      })
    }

    return Promise.resolve(result)
  }

  /**
   * Summarize messages using LLM
   */
  private async summarizeMessages(messages: Message[]): Promise<Message> {
    const conversationText = this.messagesToText(messages)

    const summaryPrompt = `Summarize this conversation history, preserving:
1. Key decisions made
2. Important tool results and data
3. Current task progress
4. Any errors or issues encountered
5. Resource IDs and connections established

Keep the summary concise but complete. Focus on actionable information that would be needed to continue the conversation effectively.

Conversation to summarize:
${conversationText}

Summary:`

    const targetTokens = Math.floor(estimateTokens(conversationText) * this.config.compressionRatio)

    try {
      const config = configStore.get()
      const summary = await makeTextCompletionWithFetch(summaryPrompt, config.mcpToolsProviderId)

      return {
        role: 'assistant',
        content: `[CONTEXT SUMMARY] ${summary}`,
        timestamp: Date.now()
      }
    } catch (error) {
      if (isDebugLLM()) {
        logLLM("Context management: Failed to generate LLM summary", error)
      }

      // Fallback to simple text truncation
      const truncatedText = conversationText.length > 1000
        ? conversationText.substring(0, 1000) + "... [truncated]"
        : conversationText

      return {
        role: 'assistant',
        content: `[CONTEXT SUMMARY] ${truncatedText}`,
        timestamp: Date.now()
      }
    }
  }

  /**
   * Convert messages to readable text format
   */
  private messagesToText(messages: Message[]): string {
    return messages.map(message => {
      let text = `${message.role.toUpperCase()}: ${message.content}`

      if (message.toolCalls && message.toolCalls.length > 0) {
        text += `\nTOOL_CALLS: ${message.toolCalls.map(tc => `${tc.name}(${JSON.stringify(tc.arguments)})`).join(", ")}`
      }

      if (message.toolResults && message.toolResults.length > 0) {
        text += `\nTOOL_RESULTS: ${message.toolResults.map(tr => (tr.isError ? "ERROR" : "SUCCESS")).join(", ")}`
      }

      return text
    }).join('\n\n')
  }

  /**
   * Identify critical messages that should never be removed
   */
  private identifyCriticalMessages(messages: Message[]): Message[] {
    return messages.filter(message => this.isCritical(message))
  }

  /**
   * Determine if a message is critical and should be preserved
   */
  private isCritical(message: Message): boolean {
    const content = message.content.toLowerCase()

    // Critical indicators
    const criticalKeywords = [
      'error', 'failed', 'important', 'warning',
      'created', 'deleted', 'updated', 'configured',
      'authentication', 'connection', 'api key',
      'session', 'id:', 'token:', 'key:',
      '[context summary]'
    ]

    return message.role === 'system' ||
           content.includes('[context summary]') ||
           criticalKeywords.some(keyword => content.includes(keyword)) ||
           (message.toolCalls !== undefined && message.toolCalls.length > 0) ||
           (message.toolResults !== undefined && message.toolResults.length > 0)
  }
}

/**
 * Factory function to create context manager with automatic model detection
 */
export function createContextManager(providerId?: string, model?: string): SimpleContextManager {
  const config = configStore.get()
  const chatProviderId = providerId || config.mcpToolsProviderId || "openai"

  // Get model name
  let modelName = model
  if (!modelName) {
    switch (chatProviderId) {
      case "openai":
        modelName = config.mcpToolsOpenaiModel || "gpt-4o-mini"
        break
      case "groq":
        modelName = config.mcpToolsGroqModel || "llama-3.3-70b-versatile"
        break
      case "gemini":
        modelName = config.mcpToolsGeminiModel || "gemini-1.5-flash-002"
        break
      default:
        modelName = "gpt-4o-mini"
    }
  }

  const contextLimit = getModelContextLimit(modelName)

  if (isDebugLLM()) {
    logLLM("Creating context manager", {
      providerId: chatProviderId,
      model: modelName,
      contextLimit
    })
  }

  return new SimpleContextManager(contextLimit)
}
