/**
 * OpenAI-compatible LLM Provider
 * Handles OpenAI, OpenRouter, and other OpenAI-compatible APIs
 */

import type {
  LLMMessage,
  LLMCallOptions,
  LLMToolCallResponse,
  CompletionVerification,
  ModelCapabilities,
  RawLLMResponse,
} from "../types"
import type {
  LLMProvider,
  LLMProviderConstructorConfig,
} from "./base"
import {
  TOOL_CALL_RESPONSE_SCHEMA,
  VERIFICATION_RESPONSE_SCHEMA,
  modelCapabilityCache,
  CAPABILITY_CACHE_TTL,
  recordStructuredOutputFailure,
  recordStructuredOutputSuccess,
  extractJsonObject,
  isEmptyContentResponse,
} from "./base"
import { withRetry, HttpError } from "../retry"
import { diagnosticsService } from "../../diagnostics"
import { isDebugLLM, logLLM } from "../../debug"
import { llmRequestAbortManager, agentSessionStateManager } from "../../state"

/**
 * OpenAI-compatible provider implementation
 */
export class OpenAIProvider implements LLMProvider {
  readonly id = "openai"
  readonly displayName = "OpenAI"

  private apiKey: string
  private baseUrl: string
  private mcpModel: string
  private transcriptModel: string
  private retryCount: number
  private retryBaseDelay: number
  private retryMaxDelay: number

  constructor(config: LLMProviderConstructorConfig) {
    if (!config.apiKey) {
      throw new Error("API key is required for OpenAI provider")
    }
    this.apiKey = config.apiKey
    this.baseUrl = config.baseUrl || "https://api.openai.com/v1"
    this.mcpModel = config.mcpModel || "gpt-4o-mini"
    this.transcriptModel = config.transcriptModel || "gpt-4o-mini"
    this.retryCount = config.retryCount ?? 3
    this.retryBaseDelay = config.retryBaseDelay ?? 1000
    this.retryMaxDelay = config.retryMaxDelay ?? 30000
  }

  getModel(type: "mcp" | "transcript"): string {
    return type === "mcp" ? this.mcpModel : this.transcriptModel
  }

  getModelCapabilities(model?: string): ModelCapabilities | undefined {
    const modelName = model || this.mcpModel
    const cached = modelCapabilityCache.get(modelName)
    if (cached && Date.now() - cached.lastTested < CAPABILITY_CACHE_TTL) {
      return cached
    }
    return undefined
  }

  supportsStructuredOutput(model?: string): boolean {
    const modelName = model || this.mcpModel
    const cached = this.getModelCapabilities(modelName)
    if (cached) {
      return cached.supportsJsonSchema
    }

    // Hardcoded list of models known to be incompatible
    const incompatibleModels = ["google/gemini"]
    return !incompatibleModels.some(
      (incompatible) => modelName.toLowerCase().includes(incompatible.toLowerCase())
    )
  }

  supportsJsonMode(model?: string): boolean {
    const modelName = model || this.mcpModel
    const cached = this.getModelCapabilities(modelName)
    if (cached) {
      return cached.supportsJsonObject
    }

    // Most OpenAI models support JSON mode
    return (
      modelName.includes("gpt-4") ||
      modelName.includes("gpt-3.5-turbo")
    )
  }

  async makeCall(
    messages: LLMMessage[],
    options: LLMCallOptions = {}
  ): Promise<LLMToolCallResponse> {
    const { useStructuredOutput = true, sessionId, onRetryProgress } = options

    return withRetry(
      () => this.makeLLMCallAttempt(messages, useStructuredOutput, sessionId, onRetryProgress),
      {
        retryCount: this.retryCount,
        baseDelay: this.retryBaseDelay,
        maxDelay: this.retryMaxDelay,
        onRetryProgress,
        logCategory: "llm-openai",
      }
    )
  }

  async makeStreamingCall(
    messages: LLMMessage[],
    onChunk: (chunk: string, accumulated: string) => void,
    options: LLMCallOptions = {}
  ): Promise<LLMToolCallResponse> {
    const { sessionId } = options

    const controller = new AbortController()
    if (sessionId) {
      agentSessionStateManager.registerAbortController(sessionId, controller)
    } else {
      llmRequestAbortManager.register(controller)
    }

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(this.enrichRequestBody({
          model: this.mcpModel,
          messages,
          temperature: 0,
          stream: true,
        })),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`API request failed: ${response.status} ${errorText}`)
      }

      if (!response.body) {
        throw new Error("Response body is null")
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let accumulated = ""
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed === "data: [DONE]") continue
          if (!trimmed.startsWith("data: ")) continue

          try {
            const json = JSON.parse(trimmed.slice(6))
            const delta = json.choices?.[0]?.delta?.content
            if (delta) {
              accumulated += delta
              onChunk(delta, accumulated)
            }
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }

      // Flush the decoder
      buffer += decoder.decode(new Uint8Array(), { stream: false })
      if (buffer.trim() && buffer.trim() !== "data: [DONE]" && buffer.trim().startsWith("data: ")) {
        try {
          const json = JSON.parse(buffer.trim().slice(6))
          const delta = json.choices?.[0]?.delta?.content
          if (delta) {
            accumulated += delta
            onChunk(delta, accumulated)
          }
        } catch {
          // Skip malformed JSON chunks
        }
      }

      return {
        content: accumulated,
        needsMoreWork: undefined,
        toolCalls: undefined,
      }
    } catch (error: unknown) {
      if ((error as { name?: string })?.name === "AbortError") {
        throw error
      }
      diagnosticsService.logError("llm-openai", "Streaming call failed", error)
      throw error
    } finally {
      if (sessionId) {
        agentSessionStateManager.unregisterAbortController(sessionId, controller)
      } else {
        llmRequestAbortManager.unregister(controller)
      }
    }
  }

  async makeTextCompletion(
    prompt: string,
    options: LLMCallOptions = {}
  ): Promise<string> {
    const { sessionId } = options

    const messages: LLMMessage[] = [{ role: "user", content: prompt }]

    const response = await this.makeAPICallAttempt(
      { model: this.transcriptModel, messages, temperature: 0, seed: 1 },
      0,
      sessionId
    )

    return response.choices[0]?.message.content?.trim() || ""
  }

  async verifyCompletion(
    messages: LLMMessage[],
    options: LLMCallOptions = {}
  ): Promise<CompletionVerification> {
    const { sessionId, onRetryProgress } = options

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
        "llm-openai",
        "Failed to parse verifier output",
        {
          contentLength: content?.length || 0,
          contentPreview: content?.substring(0, 200) || "(empty)",
          extractedJson: json,
        }
      )

      return { isComplete: false, reason: "Unparseable verifier output" }
    }

    const estimatedTokens = Math.ceil(
      messages.reduce((sum, msg) => sum + msg.content.length, 0) / 4
    )
    const baseRequestBody = { model: this.mcpModel, messages, temperature: 0, seed: 1 }

    try {
      const response = await withRetry(
        async () => {
          // Try JSON Schema first
          if (this.supportsStructuredOutput()) {
            try {
              const body = {
                ...baseRequestBody,
                response_format: { type: "json_schema", json_schema: VERIFICATION_RESPONSE_SCHEMA },
              }
              return await this.makeAPICallAttempt(body, estimatedTokens, options.sessionId)
            } catch (error: unknown) {
              if (!(error as { isStructuredOutputError?: boolean })?.isStructuredOutputError) throw error
            }
          }

          // Try JSON Object
          if (this.supportsJsonMode()) {
            try {
              const body = { ...baseRequestBody, response_format: { type: "json_object" } }
              return await this.makeAPICallAttempt(body, estimatedTokens, options.sessionId)
            } catch (error: unknown) {
              if (!(error as { isStructuredOutputError?: boolean })?.isStructuredOutputError) throw error
            }
          }

          // Fallback plain text
          return await this.makeAPICallAttempt(baseRequestBody, estimatedTokens, options.sessionId)
        },
        {
          retryCount: this.retryCount,
          baseDelay: this.retryBaseDelay,
          maxDelay: this.retryMaxDelay,
          onRetryProgress,
          logCategory: "llm-openai",
        }
      )

      const content = response.choices?.[0]?.message?.content?.trim() || ""
      return parseVerification(content)
    } catch (error) {
      diagnosticsService.logError("llm-openai", "Verification call failed", error)
      return { isComplete: false, reason: (error as { message?: string })?.message || "Verification failed" }
    }
  }

  /**
   * Make a single API call attempt with structured output fallback
   */
  private async makeLLMCallAttempt(
    messages: LLMMessage[],
    useStructuredOutput: boolean,
    sessionId?: string,
    onRetryProgress?: (info: { isRetrying: boolean; attempt: number; delaySeconds: number; reason: string; startedAt: number }) => void,
  ): Promise<LLMToolCallResponse> {
    if (isDebugLLM()) {
      logLLM("Starting OpenAI LLM call", {
        messagesCount: messages.length,
        useStructuredOutput,
      })
    }

    const estimatedTokens = Math.ceil(
      messages.reduce((sum, msg) => sum + msg.content.length, 0) / 4
    )

    const baseRequestBody = {
      model: this.mcpModel,
      messages,
      temperature: 0,
      seed: 1,
    }

    let response: RawLLMResponse

    if (!useStructuredOutput) {
      response = await this.makeAPICallAttempt(baseRequestBody, estimatedTokens, sessionId)
    } else {
      response = await this.makeStructuredCall(baseRequestBody, estimatedTokens, sessionId)
    }

    return this.parseResponse(response)
  }

  /**
   * Make a structured call with fallback through response formats
   */
  private async makeStructuredCall(
    baseRequestBody: { model: string; messages: LLMMessage[]; temperature: number; seed: number },
    estimatedTokens: number,
    sessionId?: string
  ): Promise<RawLLMResponse> {
    // First attempt: JSON Schema mode
    if (this.supportsStructuredOutput(baseRequestBody.model)) {
      try {
        const requestBodyWithSchema = {
          ...baseRequestBody,
          response_format: {
            type: "json_schema",
            json_schema: TOOL_CALL_RESPONSE_SCHEMA,
          },
        }

        if (isDebugLLM()) {
          logLLM("Attempting JSON Schema mode for model:", baseRequestBody.model)
        }

        const data = await this.makeAPICallAttempt(requestBodyWithSchema, estimatedTokens, sessionId)
        if (isEmptyContentResponse(data)) {
          if (isDebugLLM()) {
            logLLM("Empty content from JSON Schema response; falling back")
          }
          const err = new Error("Empty content in structured (json_schema) response") as { isStructuredOutputError?: boolean }
          err.isStructuredOutputError = true
          recordStructuredOutputFailure(baseRequestBody.model, "json_schema")
          throw err
        }
        recordStructuredOutputSuccess(baseRequestBody.model, "json_schema")
        return data
      } catch (error: unknown) {
        if ((error as { isStructuredOutputError?: boolean })?.isStructuredOutputError) {
          // Try recovery with failed_generation
          const failedGeneration = (error as { failedGeneration?: string })?.failedGeneration
          if (failedGeneration) {
            try {
              const retryMessages: LLMMessage[] = [
                ...baseRequestBody.messages,
                { role: "assistant", content: failedGeneration },
                { role: "user", content: `Return your previous response as valid JSON: {"content": "...", "needsMoreWork": false}. Escape quotes properly.` },
              ]

              const retryData = await this.makeAPICallAttempt(
                {
                  ...baseRequestBody,
                  messages: retryMessages,
                  response_format: { type: "json_schema", json_schema: TOOL_CALL_RESPONSE_SCHEMA },
                },
                estimatedTokens,
                sessionId
              )

              if (!isEmptyContentResponse(retryData)) {
                recordStructuredOutputSuccess(baseRequestBody.model, "json_schema")
                return retryData
              }
            } catch {
              // Continue to fallback modes
            }
          }

          if (isDebugLLM()) {
            logLLM("JSON Schema failed for", baseRequestBody.model, "- falling back")
          }
          recordStructuredOutputFailure(baseRequestBody.model, "json_schema")
        } else {
          throw error
        }
      }
    }

    // Second attempt: JSON Object mode
    if (this.supportsJsonMode(baseRequestBody.model)) {
      try {
        const requestBodyWithJson = {
          ...baseRequestBody,
          response_format: { type: "json_object" },
        }

        if (isDebugLLM()) {
          logLLM("Attempting JSON Object mode for model:", baseRequestBody.model)
        }

        const data = await this.makeAPICallAttempt(requestBodyWithJson, estimatedTokens, sessionId)
        if (isEmptyContentResponse(data)) {
          if (isDebugLLM()) {
            logLLM("Empty content from JSON Object response; falling back")
          }
          const err = new Error("Empty content in structured (json_object) response") as { isStructuredOutputError?: boolean }
          err.isStructuredOutputError = true
          recordStructuredOutputFailure(baseRequestBody.model, "json_object")
          throw err
        }
        recordStructuredOutputSuccess(baseRequestBody.model, "json_object")
        return data
      } catch (error: unknown) {
        if ((error as { isStructuredOutputError?: boolean })?.isStructuredOutputError) {
          if (isDebugLLM()) {
            logLLM("JSON Object mode FAILED for model", baseRequestBody.model, "- falling back")
          }
          recordStructuredOutputFailure(baseRequestBody.model, "json_object")
        } else {
          throw error
        }
      }
    }

    // Final attempt: Plain text mode
    if (isDebugLLM()) {
      logLLM("Using plain text mode for model:", baseRequestBody.model)
    }

    return await this.makeAPICallAttempt(baseRequestBody, estimatedTokens, sessionId)
  }

  /**
   * Make a single raw API call attempt
   */
  private async makeAPICallAttempt(
    requestBody: Record<string, unknown>,
    estimatedTokens: number,
    sessionId?: string
  ): Promise<RawLLMResponse> {
    if (isDebugLLM()) {
      logLLM("=== OPENAI API REQUEST ===")
      logLLM("HTTP Request", {
        url: `${this.baseUrl}/chat/completions`,
        model: requestBody.model,
        messagesCount: (requestBody.messages as LLMMessage[]).length,
        responseFormat: requestBody.response_format,
        estimatedTokens,
      })
    }

    const controller = new AbortController()
    if (sessionId) {
      agentSessionStateManager.registerAbortController(sessionId, controller)
    } else {
      llmRequestAbortManager.register(controller)
    }

    try {
      // Check stop flags
      if (agentSessionStateManager.shouldStopSession(sessionId || "")) {
        controller.abort()
      }

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(this.enrichRequestBody(requestBody)),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errorText = await response.text()

        if (isDebugLLM()) {
          logLLM("HTTP Error Response", {
            status: response.status,
            statusText: response.statusText,
            errorText: errorText.substring(0, 1000),
          })
        }

        // Check if this is a structured output related error
        const errorTextLower = errorText.toLowerCase()
        const isStructuredOutputError =
          response.status >= 400 &&
          response.status < 500 &&
          (errorTextLower.includes("json_schema") ||
            errorTextLower.includes("response_format") ||
            errorTextLower.includes("json_validate_failed") ||
            errorTextLower.includes("failed to generate json") ||
            (errorTextLower.includes("schema") && errorTextLower.includes("not supported")) ||
            (errorTextLower.includes("model inference") && errorTextLower.includes("error")) ||
            errorTextLower.includes("unknown error in the model") ||
            (errorTextLower.includes("object fields require") && errorTextLower.includes("properties")))

        if (isStructuredOutputError) {
          if (isDebugLLM()) {
            logLLM("Detected as structured output error")
          }
          const error = new Error(errorText) as { isStructuredOutputError?: boolean; failedGeneration?: string }
          error.isStructuredOutputError = true

          // Extract failed_generation if available
          try {
            const errorJson = JSON.parse(errorText)
            if (errorJson?.error?.failed_generation) {
              error.failedGeneration = errorJson.error.failed_generation
            }
          } catch {
            // Not JSON
          }

          throw error
        }

        throw new HttpError(response.status, response.statusText, errorText)
      }

      const data = await response.json() as RawLLMResponse

      // Log empty content cases
      const messageContent = data.choices?.[0]?.message?.content
      const hasToolCalls = !!data.choices?.[0]?.message?.tool_calls?.length
      const isEmptyContent =
        !hasToolCalls &&
        (!messageContent ||
          (typeof messageContent === "string" && messageContent.trim() === "") ||
          (Array.isArray(messageContent) && messageContent.length === 0))

      if (isEmptyContent) {
        diagnosticsService.logError("llm-openai", "Empty content from LLM API", {
          model: requestBody.model,
          provider: this.baseUrl,
          finishReason: data.choices?.[0]?.finish_reason,
          usage: data.usage,
        })
      }

      if (data.error) {
        if (isDebugLLM()) {
          logLLM("API Error", data.error)
        }
        const errorMessage = data.error.message || String(data.error)
        const errorMessageLower = errorMessage.toLowerCase()
        const error = new Error(errorMessage) as { isStructuredOutputError?: boolean; failedGeneration?: string }
        error.isStructuredOutputError =
          errorMessageLower.includes("json_schema") ||
          errorMessageLower.includes("response_format") ||
          errorMessageLower.includes("json_validate_failed") ||
          errorMessageLower.includes("model inference") ||
          errorMessageLower.includes("unknown error in the model")

        if (data.error.failed_generation) {
          error.failedGeneration = data.error.failed_generation
        }

        throw error
      }

      if (isDebugLLM()) {
        logLLM("Response received", {
          hasContent: !!data.choices?.[0]?.message?.content,
          contentLength: data.choices?.[0]?.message?.content?.length || 0,
          hasToolCalls: !!data.choices?.[0]?.message?.tool_calls?.length,
          finishReason: data.choices?.[0]?.finish_reason,
        })
      }

      return data
    } finally {
      if (sessionId) {
        agentSessionStateManager.unregisterAbortController(sessionId, controller)
      } else {
        llmRequestAbortManager.unregister(controller)
      }
    }
  }

  /**
   * Parse raw API response into LLMToolCallResponse
   */
  private parseResponse(response: RawLLMResponse): LLMToolCallResponse {
    const messageObj = response.choices?.[0]?.message || {}
    let content: string | undefined = (messageObj.content ?? "").trim()

    if (isDebugLLM()) {
      logLLM("Message content extracted:", {
        contentLength: content?.length || 0,
        contentPreview: content?.substring(0, 200) || "(empty)",
      })
    }

    if (!content) {
      // Check reasoning fallback
      const rawReasoning = (messageObj as { reasoning?: string | { text: string } })?.reasoning
      const reasoningText =
        typeof rawReasoning === "string"
          ? rawReasoning
          : rawReasoning && typeof rawReasoning === "object" && typeof rawReasoning.text === "string"
            ? rawReasoning.text
            : ""

      if (reasoningText) {
        const jsonFromReasoning = extractJsonObject(reasoningText) as LLMToolCallResponse | null
        if (jsonFromReasoning && (jsonFromReasoning.toolCalls || jsonFromReasoning.content)) {
          if (isDebugLLM()) {
            logLLM("Parsed structured output from reasoning fallback")
          }
          if (jsonFromReasoning.needsMoreWork === undefined && !jsonFromReasoning.toolCalls) {
            jsonFromReasoning.needsMoreWork = true
          }
          return jsonFromReasoning
        }

        if (reasoningText.trim()) {
          if (isDebugLLM()) logLLM("Using reasoning text as content fallback")
          content = reasoningText.trim()
        }
      }

      if (!content) {
        diagnosticsService.logError("llm-openai", "LLM returned empty response", {
          hasResponse: !!response,
          hasChoices: !!response?.choices,
          choicesLength: response?.choices?.length,
        })
        throw new Error("LLM returned empty response - this indicates a model or API issue that should be retried")
      }
    }

    // Try to extract JSON object from response
    const jsonObject = extractJsonObject(content) as LLMToolCallResponse | null
    if (jsonObject && (jsonObject.toolCalls || jsonObject.content)) {
      if (jsonObject.needsMoreWork === undefined && !jsonObject.toolCalls) {
        jsonObject.needsMoreWork = true
      }

      // Safety check for tool markers in content
      const toolMarkers = /<\|tool_calls_section_begin\|>|<\|tool_call_begin\|>/i
      const text = (jsonObject.content || "").replace(/<\|[^|]*\|>/g, "").trim()
      if (
        jsonObject.needsMoreWork === false &&
        (!jsonObject.toolCalls || jsonObject.toolCalls.length === 0) &&
        toolMarkers.test(text)
      ) {
        jsonObject.needsMoreWork = true
      }

      if (isDebugLLM()) {
        logLLM("Returning structured JSON response", {
          hasContent: !!jsonObject.content,
          hasToolCalls: !!jsonObject.toolCalls,
          toolCallsCount: jsonObject.toolCalls?.length || 0,
          needsMoreWork: jsonObject.needsMoreWork,
        })
      }

      return jsonObject
    }

    // No valid JSON found
    const hasToolMarkers = /<\|tool_calls_section_begin\|>|<\|tool_call_begin\|>/i.test(content || "")
    const cleaned = (content || "").replace(/<\|[^|]*\|>/g, "").trim()

    if (hasToolMarkers) {
      if (isDebugLLM()) {
        logLLM("Returning plain text with tool markers (needsMoreWork=true)")
      }
      return { content: cleaned, needsMoreWork: true }
    }

    if (isDebugLLM()) {
      logLLM("Returning plain text response (needsMoreWork=undefined)")
    }
    return { content: cleaned || content, needsMoreWork: undefined }
  }

  /**
   * Enrich request body with OpenRouter-specific fields when using OpenRouter API
   */
  private enrichRequestBody(requestBody: Record<string, unknown>): Record<string, unknown> {
    if (!this.baseUrl.toLowerCase().includes("openrouter.ai")) {
      return requestBody
    }

    const existingPlugins = Array.isArray(requestBody.plugins) ? requestBody.plugins : []
    if (existingPlugins.some((p: { id?: string } | null | undefined) => p?.id === "response-healing")) {
      return requestBody
    }

    return {
      ...requestBody,
      plugins: [...existingPlugins, { id: "response-healing" }],
    }
  }
}
