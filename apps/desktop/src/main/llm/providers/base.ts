/**
 * Abstract LLM Provider interface
 * All provider implementations must implement this interface
 */

import type {
  LLMMessage,
  LLMCallOptions,
  LLMToolCallResponse,
  CompletionVerification,
  ModelCapabilities,
  ResponseFormat,
  RawLLMResponse,
} from "../types"

/**
 * Base interface for all LLM providers
 */
export interface LLMProvider {
  /** Unique identifier for this provider (e.g., "openai", "groq", "gemini") */
  readonly id: string

  /** Display name for UI (e.g., "OpenAI", "Groq", "Google Gemini") */
  readonly displayName: string

  /**
   * Make a completion call to the LLM
   * @param messages - Array of messages in the conversation
   * @param options - Optional call configuration
   * @returns Parsed LLM response with tool calls and content
   */
  makeCall(
    messages: LLMMessage[],
    options?: LLMCallOptions
  ): Promise<LLMToolCallResponse>

  /**
   * Make a streaming completion call
   * @param messages - Array of messages in the conversation
   * @param onChunk - Callback for each streamed chunk
   * @param options - Optional call configuration
   * @returns Final parsed response
   */
  makeStreamingCall(
    messages: LLMMessage[],
    onChunk: (chunk: string, accumulated: string) => void,
    options?: LLMCallOptions
  ): Promise<LLMToolCallResponse>

  /**
   * Make a simple text completion (no structured output)
   * @param prompt - The prompt to complete
   * @param options - Optional call configuration
   * @returns Plain text response
   */
  makeTextCompletion(
    prompt: string,
    options?: LLMCallOptions
  ): Promise<string>

  /**
   * Verify if a task is complete using the LLM
   * @param messages - Conversation history for verification
   * @param options - Optional call configuration
   * @returns Verification result
   */
  verifyCompletion(
    messages: LLMMessage[],
    options?: LLMCallOptions
  ): Promise<CompletionVerification>

  /**
   * Check if the provider supports structured output (JSON schema)
   * @param model - Optional model name (uses default if not specified)
   * @returns Whether JSON schema mode is supported
   */
  supportsStructuredOutput(model?: string): boolean

  /**
   * Check if the provider supports JSON object mode
   * @param model - Optional model name (uses default if not specified)
   * @returns Whether JSON object mode is supported
   */
  supportsJsonMode(model?: string): boolean

  /**
   * Get runtime-learned capabilities for a model
   * @param model - Model name
   * @returns Cached capabilities or undefined if not tested
   */
  getModelCapabilities(model?: string): ModelCapabilities | undefined

  /**
   * Get the current model being used
   * @param type - The type of model to get (e.g., "mcp" or "transcript")
   * @returns Model identifier string
   */
  getModel(type: "mcp" | "transcript"): string
}

/**
 * Configuration for creating an LLM provider
 */
export interface LLMProviderConstructorConfig {
  /** API key for authentication */
  apiKey: string
  /** Base URL for the API (provider-specific default if not provided) */
  baseUrl?: string
  /** Model name for MCP tool calls */
  mcpModel?: string
  /** Model name for transcript post-processing */
  transcriptModel?: string
  /** Retry count for failed requests */
  retryCount?: number
  /** Base delay for retry backoff in ms */
  retryBaseDelay?: number
  /** Maximum delay for retry backoff in ms */
  retryMaxDelay?: number
}

/**
 * JSON schema for tool call response format (structured output)
 */
export const TOOL_CALL_RESPONSE_SCHEMA = {
  name: "LLMToolCallResponse",
  description:
    "Response format for LLM tool calls with optional tool execution and content",
  schema: {
    type: "object",
    properties: {
      toolCalls: {
        type: "array",
        description: "Array of tool calls to execute",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Name of the tool to call",
            },
            arguments: {
              type: "object",
              description: "Arguments to pass to the tool",
              properties: {},
              additionalProperties: true,
            },
          },
          required: ["name", "arguments"],
          additionalProperties: false,
        },
      },
      content: {
        type: "string",
        description: "Text content of the response",
      },
      needsMoreWork: {
        type: "boolean",
        description: "Whether more work is needed after this response",
      },
    },
    additionalProperties: false,
  },
  strict: true,
}

/**
 * JSON schema for completion verification
 */
export const VERIFICATION_RESPONSE_SCHEMA = {
  name: "CompletionVerification",
  description: "Strict verifier to determine if the user's request has been fully satisfied.",
  schema: {
    type: "object",
    properties: {
      isComplete: {
        type: "boolean",
        description: "True only if the user's original request has been fully satisfied.",
      },
      confidence: {
        type: "number",
        description: "Confidence in the judgment, must be between 0 and 1 inclusive.",
      },
      missingItems: {
        type: "array",
        items: { type: "string" },
        description: "List of missing steps, outputs, or requirements, if any.",
      },
      reason: {
        type: "string",
        description: "Brief explanation of the judgment.",
      },
    },
    required: ["isComplete"],
    additionalProperties: false,
  },
  strict: true,
}

/**
 * Cache of model capabilities learned at runtime
 * Shared across all providers for models that may be accessed through different endpoints
 */
export const modelCapabilityCache = new Map<string, ModelCapabilities>()

/**
 * How long to cache model capability information (24 hours)
 */
export const CAPABILITY_CACHE_TTL = 24 * 60 * 60 * 1000

/**
 * Record that a model failed with a specific structured output mode
 */
export function recordStructuredOutputFailure(
  model: string,
  mode: "json_schema" | "json_object"
): void {
  const cached = modelCapabilityCache.get(model) || {
    supportsJsonSchema: true,
    supportsJsonObject: true,
    lastTested: Date.now(),
  }

  if (mode === "json_schema") {
    cached.supportsJsonSchema = false
  } else if (mode === "json_object") {
    cached.supportsJsonObject = false
  }

  cached.lastTested = Date.now()
  modelCapabilityCache.set(model, cached)
}

/**
 * Record that a model succeeded with a specific structured output mode
 */
export function recordStructuredOutputSuccess(
  model: string,
  mode: "json_schema" | "json_object"
): void {
  const cached = modelCapabilityCache.get(model) || {
    supportsJsonSchema: true,
    supportsJsonObject: true,
    lastTested: Date.now(),
  }

  if (mode === "json_schema") {
    cached.supportsJsonSchema = true
  } else if (mode === "json_object") {
    cached.supportsJsonObject = true
  }

  cached.lastTested = Date.now()
  modelCapabilityCache.set(model, cached)
}

/**
 * Check if cached model capabilities are still valid
 */
export function isCacheValid(model: string): boolean {
  const cached = modelCapabilityCache.get(model)
  if (!cached) return false
  return Date.now() - cached.lastTested < CAPABILITY_CACHE_TTL
}

/**
 * Extracts the first JSON object from a given string.
 * @param str - The string to search for a JSON object.
 * @returns The parsed JSON object, or null if no valid JSON object is found.
 */
export function extractJsonObject(str: string): unknown | null {
  let braceCount = 0
  let startIndex = -1

  for (let i = 0; i < str.length; i++) {
    const char = str[i]

    if (char === "{") {
      if (braceCount === 0) {
        startIndex = i
      }
      braceCount++
    } else if (char === "}") {
      braceCount--

      if (braceCount === 0 && startIndex !== -1) {
        const jsonStr = str.substring(startIndex, i + 1)
        try {
          return JSON.parse(jsonStr)
        } catch {
          startIndex = -1
        }
      }
    }
  }

  return null
}

/**
 * Helper: detect empty assistant content in an OpenAI-compatible response
 */
export function isEmptyContentResponse(resp: RawLLMResponse): boolean {
  try {
    const content = resp?.choices?.[0]?.message?.content
    return typeof content !== "string" || content.trim() === ""
  } catch {
    return true
  }
}
