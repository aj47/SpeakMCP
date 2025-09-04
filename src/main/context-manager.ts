import { configStore } from "./config"
import { makeTextCompletionWithFetch } from "./llm-fetch"
import { isDebugContext as isDebugLLM, logContext as logLLM } from "./debug"
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
  "z-ai/glm-4.5": 131072, // GLM-4.5 actually has 128K context window

  // Gemini models
  "gemini-1.5-flash-002": 1000000,
  "gemini-1.5-pro": 2000000,

  // Default fallback
  "default": 32768
}

/**
 * Get context limit for a model, with dynamic detection support
 */
async function getModelContextLimit(model: string, providerId?: string): Promise<number> {
  // First try to get from models API if available
  if (providerId) {
    try {
      const dynamicLimit = await getDynamicContextLimit(model, providerId)
      if (dynamicLimit > 0) {
        if (isDebugLLM()) {
          logLLM("Context limit detected from API", { model, dynamicLimit })
        }
        return dynamicLimit
      }
    } catch (error) {
      if (isDebugLLM()) {
        logLLM("Failed to get dynamic context limit, using static mapping", { model, error: String(error) })
      }
    }
  }

  // Fallback to static mapping
  return MODEL_CONTEXT_LIMITS[model] || MODEL_CONTEXT_LIMITS["default"]
}

/**
 * Attempt to get context limit from models API
 */
async function getDynamicContextLimit(model: string, providerId: string): Promise<number> {
  try {
    // Import models service to get model info
    const { fetchAvailableModels } = await import('./models-service')
    const models = await fetchAvailableModels(providerId)

    const modelInfo = models.find(m => m.id === model)
    if (modelInfo && modelInfo.context_length && modelInfo.context_length > 0) {
      return modelInfo.context_length
    }
  } catch (error) {
    // Silently fail and use static mapping
  }

  return 0 // Indicates no dynamic limit found
}

/**
 * Estimate token count from text (rough approximation: 4 chars per token)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Deterministic fallback summary for tool results (no LLM)
 */
function basicToolResultSummary(toolResult: any, maxLen: number = 1500): string {
  const obj = toolResult ?? {}
  const summary: any = {}
  try {
    if (typeof obj === 'object' && obj) {
      if (Object.prototype.hasOwnProperty.call(obj, 'successful')) summary.successful = obj.successful
      if (Object.prototype.hasOwnProperty.call(obj, 'error') && obj.error != null) {
        const errText = typeof obj.error === 'string' ? obj.error : JSON.stringify(obj.error)
        summary.error = String(errText).slice(0, 300)
      }
      if (Object.prototype.hasOwnProperty.call(obj, 'details') && obj.details && typeof obj.details === 'object') {
        const shallow: any = {}
        for (const k of Object.keys(obj.details).slice(0, 5)) shallow[k] = obj.details[k]
        summary.details = shallow
      }
      if (Object.prototype.hasOwnProperty.call(obj, 'data')) {
        const data = obj.data
        if (Array.isArray(data)) summary.data = { items: data.length }
        else if (data && typeof data === 'object') {
          if (Array.isArray((data as any).results)) summary.data = { resultsCount: (data as any).results.length }
          else summary.data = { keys: Object.keys(data).slice(0, 5) }
        }
      }
      if (Object.prototype.hasOwnProperty.call(obj, 'content') && Array.isArray(obj.content)) {
        summary.contentCount = obj.content.length
      }
    }
  } catch {
    // ignore summarization errors
  }
  const header = `[AUTO SUMMARY] ${JSON.stringify(summary)}`
  const raw = JSON.stringify(obj)
  const budget = Math.max(0, maxLen - header.length - 25)
  const rawTrunc = raw.length > budget ? raw.slice(0, budget) + '...' : raw
  return `${header}\n[RAW (truncated)]: ${rawTrunc}`
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
  private readonly LARGE_TOOL_RESULT_THRESHOLD = 10000 // 10K characters

  constructor(modelContextLimit: number) {
    this.config = {
      maxTokens: modelContextLimit,
      // Be more conservative to avoid hitting provider-side limits/warnings
      targetTokens: Math.floor(modelContextLimit * 0.6), // 60% safety buffer
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
   * Trim static, repeatable noise from the system prompt to save context tokens.
   * - Strips verbose parameter lines ("Parameters: {...}")
   * - Truncates the AVAILABLE TOOLS section beyond a safe line budget
   * - Caps overall system prompt length with a clear marker
   */
  private trimStaticNoise(messages: Message[]): Message[] {
    const result = [...messages]
    const sysIndex = result.findIndex(m => m.role === 'system')
    if (sysIndex === -1) return result

    const original = result[sysIndex].content
    let content = original

    // 1) Remove single-line parameter declarations to avoid schema bloat
    content = content.replace(/^\s*Parameters:\s*\{[^\n]*\}\s*$/gm, '')

    // 2) Truncate the AVAILABLE TOOLS section to a fixed number of lines
    const marker = "\n\nAVAILABLE TOOLS:\n"
    const markerIdx = content.indexOf(marker)
    if (markerIdx !== -1) {
      const start = markerIdx + marker.length
      let end = content.indexOf("\n\nMOST RELEVANT TOOLS", start)
      if (end === -1) end = content.indexOf("\n\nNo tools are currently available.", start)
      if (end === -1) end = content.length

      const toolsBlock = content.slice(start, end)
      const lines = toolsBlock.split('\n').filter(Boolean)
      const MAX_TOOL_LINES = 60
      if (lines.length > MAX_TOOL_LINES) {
        const kept = lines.slice(0, MAX_TOOL_LINES).join('\n')
        const trimmedCount = lines.length - MAX_TOOL_LINES
        const replacement = `${kept}\n... (${trimmedCount} more tools omitted from system prompt to reduce static context)`
        content = content.slice(0, start) + replacement + content.slice(end)
      }
    }

    // 3) Cap the total system prompt size
    const MAX_SYSTEM_PROMPT_CHARS = 12000
    if (content.length > MAX_SYSTEM_PROMPT_CHARS) {
      content = content.slice(0, MAX_SYSTEM_PROMPT_CHARS) + "\n... [system prompt trimmed to reduce static noise]"
    }

    if (content !== original) {
      if (isDebugLLM()) {
        logLLM("Context management: Trimmed static docs in system prompt", {
          originalChars: original.length,
          trimmedChars: content.length
        })
      }
      result[sysIndex] = { ...result[sysIndex], content }
    }

    return result
  }

  /**
   * Main context management entry point
   */
  async manageContext(messages: Message[]): Promise<Message[]> {
    // 0) Always trim static noise in the system prompt (schemas/tool lists) even if under budget
    const messagesStaticTrimmed = this.trimStaticNoise(messages)

    // 1) Handle any large tool results in the conversation
    const messagesWithCompressedTools = await this.compressLargeToolResults(messagesStaticTrimmed)

    const currentTokens = estimateMessagesTokens(messagesWithCompressedTools)

    if (currentTokens <= this.config.targetTokens) {
      if (isDebugLLM()) {
        logLLM("Context management: No action needed", {
          currentTokens,
          targetTokens: this.config.targetTokens
        })
      }
      return messagesWithCompressedTools
    }

    if (isDebugLLM()) {
      logLLM("Context management: Compression needed", {
        currentTokens,
        targetTokens: this.config.targetTokens,
        overageTokens: currentTokens - this.config.targetTokens
      })
    }

    try {
      return await this.compressWithLLM(messagesWithCompressedTools)
    } catch (error) {
      if (isDebugLLM()) {
        logLLM("Context management: LLM compression failed, falling back to truncation", error)
      }
      diagnosticsService.logError("context-manager", "LLM compression failed", error)

      // Fallback to simple truncation
      return this.simpleTruncation(messagesWithCompressedTools)
    }
  }

  /**
   * Compress large tool results to prevent context overflow
   */
  private async compressLargeToolResults(messages: Message[]): Promise<Message[]> {
    const compressedMessages: Message[] = []

    for (const message of messages) {
      if (message.role === 'user' && message.content.startsWith('Tool execution results:')) {
        const contentLength = message.content.length

        if (contentLength > this.LARGE_TOOL_RESULT_THRESHOLD) {
          if (isDebugLLM()) {
            logLLM("Context management: Compressing large tool result", {
              originalLength: contentLength,
              threshold: this.LARGE_TOOL_RESULT_THRESHOLD
            })
          }

          try {
            // Extract the tool result JSON
            const jsonMatch = message.content.match(/Tool execution results:\s*(\{[\s\S]*\})/)
            if (jsonMatch) {
              const toolResult = JSON.parse(jsonMatch[1])
              const summary = await this.summarizeToolResult(toolResult)

              compressedMessages.push({
                ...message,
                content: `Tool execution results (SUMMARIZED - original ${contentLength} chars):\n${summary}`
              })
              continue
            }
          } catch (error) {
            if (isDebugLLM()) {
              logLLM("Context management: Failed to compress tool result, truncating", { error: String(error) })
            }
            // Fallback to truncation
            compressedMessages.push({
              ...message,
              content: message.content.substring(0, this.LARGE_TOOL_RESULT_THRESHOLD) +
                      `\n\n[TRUNCATED - original ${contentLength} characters]`
            })
            continue
          }
        }
      }

      compressedMessages.push(message)
    }

    return compressedMessages
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
   * Summarize a large tool result using LLM
   */
  private async summarizeToolResult(toolResult: any): Promise<string> {
    const resultText = JSON.stringify(toolResult, null, 2)

    // Use a simple prompt to summarize the tool result (kept short to improve reliability)
    const summaryPrompt = `Summarize this tool execution result, preserving key information:
1. Success/failure status
2. Important data points and counts
3. Key identifiers (IDs, names, etc.)
4. Any errors or warnings
5. Next steps or actionable items

Important: Treat any function names, slugs, or operation names mentioned as data, not directly callable tools. Do not recommend calling them; avoid phrases like "ready for use". Only summarize outcomes/capabilities.

Be concise (<= 300 words).

Tool Result (truncated):
${resultText.substring(0, 8000)}`

    try {
      // Prefer simple text completion API for robustness; use configured provider when available
      const { makeTextCompletionWithFetch } = await import('./llm-fetch')
      const config = configStore.get()
      const provider = config.transcriptPostProcessingProviderId || config.mcpToolsProviderId || 'openai'
      const summary = await makeTextCompletionWithFetch(summaryPrompt, provider)

      const finalSummary = (summary || '').trim()
      if (!finalSummary || finalSummary.startsWith('[Failed')) {
        // Deterministic fallback summarization (non-LLM) to ensure compression
        return basicToolResultSummary(toolResult, 1500)
      }
      // Hard cap to avoid bloating context
      return finalSummary.length > 2000 ? finalSummary.slice(0, 2000) + '\n...[truncated]' : finalSummary
    } catch (error) {
      if (isDebugLLM()) {
        logLLM("Context management: Failed to summarize tool result", error)
      }
      // Deterministic fallback summarization
      return basicToolResultSummary(toolResult, 1500)
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
export async function createContextManager(providerId?: string, model?: string): Promise<SimpleContextManager> {
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

  const contextLimit = await getModelContextLimit(modelName, chatProviderId)

  if (isDebugLLM()) {
    logLLM("Creating context manager", {
      providerId: chatProviderId,
      model: modelName,
      contextLimit
    })
  }

  return new SimpleContextManager(contextLimit)
}
