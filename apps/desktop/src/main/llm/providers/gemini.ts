/**
 * Google Gemini LLM Provider
 * Handles Google's Gemini API with its native format
 */

import type {
  LLMMessage,
  LLMCallOptions,
  LLMToolCallResponse,
  CompletionVerification,
  ModelCapabilities,
} from "../types"
import type {
  LLMProvider,
  LLMProviderConstructorConfig,
} from "./base"
import { extractJsonObject } from "./base"
import { withRetry, HttpError } from "../retry"
import { diagnosticsService } from "../../diagnostics"
import { isDebugLLM, logLLM } from "../../debug"
import { llmRequestAbortManager, agentSessionStateManager } from "../../state"

/**
 * Gemini provider implementation
 */
export class GeminiProvider implements LLMProvider {
  readonly id = "gemini"
  readonly displayName = "Google Gemini"

  private apiKey: string
  private baseUrl: string
  private mcpModel: string
  private transcriptModel: string
  private retryCount: number
  private retryBaseDelay: number
  private retryMaxDelay: number

  constructor(config: LLMProviderConstructorConfig) {
    if (!config.apiKey) {
      throw new Error("API key is required for Gemini provider")
    }
    this.apiKey = config.apiKey
    this.baseUrl = config.baseUrl || "https://generativelanguage.googleapis.com"
    this.mcpModel = config.mcpModel || "gemini-1.5-flash-002"
    this.transcriptModel = config.transcriptModel || "gemini-1.5-flash-002"
    this.retryCount = config.retryCount ?? 3
    this.retryBaseDelay = config.retryBaseDelay ?? 1000
    this.retryMaxDelay = config.retryMaxDelay ?? 30000
  }

  getModel(type: "mcp" | "transcript"): string {
    return type === "mcp" ? this.mcpModel : this.transcriptModel
  }

  getModelCapabilities(_model?: string): ModelCapabilities | undefined {
    // Gemini doesn't support JSON schema mode like OpenAI
    return {
      supportsJsonSchema: false,
      supportsJsonObject: false,
      lastTested: Date.now(),
    }
  }

  supportsStructuredOutput(_model?: string): boolean {
    return false
  }

  supportsJsonMode(_model?: string): boolean {
    return false
  }

  async makeCall(
    messages: LLMMessage[],
    options: LLMCallOptions = {}
  ): Promise<LLMToolCallResponse> {
    const { sessionId, onRetryProgress } = options

    return withRetry(
      () => this.makeGeminiCall(messages, sessionId),
      {
        retryCount: this.retryCount,
        baseDelay: this.retryBaseDelay,
        maxDelay: this.retryMaxDelay,
        onRetryProgress,
        logCategory: "llm-gemini",
      }
    )
  }

  async makeStreamingCall(
    messages: LLMMessage[],
    onChunk: (chunk: string, accumulated: string) => void,
    options: LLMCallOptions = {}
  ): Promise<LLMToolCallResponse> {
    // Gemini doesn't support streaming in the same way as OpenAI
    // Fall back to non-streaming and emit the full result
    const result = await this.makeCall(messages, options)
    if (result.content) {
      onChunk(result.content, result.content)
    }
    return result
  }

  async makeTextCompletion(
    prompt: string,
    options: LLMCallOptions = {}
  ): Promise<string> {
    const messages: LLMMessage[] = [{ role: "user", content: prompt }]
    const result = await this.makeCall(messages, options)
    return result.content || ""
  }

  async verifyCompletion(
    messages: LLMMessage[],
    options: LLMCallOptions = {}
  ): Promise<CompletionVerification> {
    const parseVerification = (content: string): CompletionVerification => {
      const json = extractJsonObject(content) || (() => {
        try {
          return JSON.parse(content)
        } catch {
          return null
        }
      })()

      if (json && typeof (json as { isComplete?: unknown }).isComplete === "boolean") {
        return json as CompletionVerification
      }

      diagnosticsService.logError(
        "llm-gemini",
        "Failed to parse verifier output",
        {
          contentLength: content?.length || 0,
          contentPreview: content?.substring(0, 200) || "(empty)",
        }
      )

      return { isComplete: false, reason: "Unparseable verifier output" }
    }

    try {
      const result = await this.makeCall(messages, options)
      const content = result.content || ""
      return parseVerification(content)
    } catch (error) {
      diagnosticsService.logError("llm-gemini", "Verification call failed", error)
      return { isComplete: false, reason: (error as { message?: string })?.message || "Verification failed" }
    }
  }

  /**
   * Make a call to the Gemini API
   */
  private async makeGeminiCall(
    messages: LLMMessage[],
    sessionId?: string
  ): Promise<LLMToolCallResponse> {
    // Convert messages to Gemini format
    const prompt = messages.map((m) => `${m.role}: ${m.content}`).join("\n\n")

    if (isDebugLLM()) {
      logLLM("Gemini HTTP Request", {
        url: `${this.baseUrl}/v1beta/models/${this.mcpModel}:generateContent`,
        model: this.mcpModel,
      })
      logLLM("Gemini Request Body", { prompt })
    }

    const controller = new AbortController()
    if (sessionId) {
      agentSessionStateManager.registerAbortController(sessionId, controller)
    } else {
      llmRequestAbortManager.register(controller)
    }

    try {
      // Check stop flags
      if (sessionId && agentSessionStateManager.shouldStopSession(sessionId)) {
        controller.abort()
      }

      const response = await fetch(
        `${this.baseUrl}/v1beta/models/${this.mcpModel}:generateContent?key=${this.apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: prompt }],
              },
            ],
            generationConfig: {
              temperature: 0,
            },
          }),
          signal: controller.signal,
        }
      )

      if (!response.ok) {
        const errorText = await response.text()

        // Extract Retry-After header for rate limiting
        let retryAfter: number | undefined
        const retryAfterHeader = response.headers.get("retry-after")
        if (retryAfterHeader) {
          const parsed = parseInt(retryAfterHeader, 10)
          if (!isNaN(parsed)) {
            retryAfter = parsed
          }
        }

        if (isDebugLLM()) {
          logLLM("Gemini HTTP Error", {
            status: response.status,
            statusText: response.statusText,
            errorText,
            retryAfter,
          })
        }

        throw new HttpError(response.status, response.statusText, errorText, retryAfter)
      }

      const data = await response.json()

      if (data.error) {
        if (isDebugLLM()) {
          logLLM("Gemini API Error", data.error)
        }
        throw new Error(data.error.message)
      }

      // Extract text from Gemini response format
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text
      if (!text) {
        throw new Error("No text content in Gemini response")
      }

      if (isDebugLLM()) {
        logLLM("Gemini HTTP Response", data)
      }

      // Parse the response content
      return this.parseResponse(text.trim())
    } finally {
      if (sessionId) {
        agentSessionStateManager.unregisterAbortController(sessionId, controller)
      } else {
        llmRequestAbortManager.unregister(controller)
      }
    }
  }

  /**
   * Parse Gemini response into LLMToolCallResponse
   */
  private parseResponse(content: string): LLMToolCallResponse {
    // Try to extract JSON object from response
    const jsonObject = extractJsonObject(content) as LLMToolCallResponse | null
    if (jsonObject && (jsonObject.toolCalls || jsonObject.content)) {
      if (jsonObject.needsMoreWork === undefined && !jsonObject.toolCalls) {
        jsonObject.needsMoreWork = true
      }
      return jsonObject
    }

    // Check for tool markers
    const hasToolMarkers = /<\|tool_calls_section_begin\|>|<\|tool_call_begin\|>/i.test(content)
    const cleaned = content.replace(/<\|[^|]*\|>/g, "").trim()

    if (hasToolMarkers) {
      return { content: cleaned, needsMoreWork: true }
    }

    return { content: cleaned || content, needsMoreWork: undefined }
  }
}
