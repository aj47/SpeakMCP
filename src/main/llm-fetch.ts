import { configStore } from "./config"
import { MCPTool, LLMToolCallResponse } from "./mcp-service"
import { diagnosticsService } from "./diagnostics"
import { isDebugLLM, logLLM } from "./debug"
import { MultimodalMessage, MultimodalContent, ImageContent, TextContent } from "../shared/types"

/**
 * Extracts the first JSON object from a given string.
 * @param str - The string to search for a JSON object.
 * @returns The parsed JSON object, or null if no valid JSON object is found.
 */
function extractJsonObject(str: string): any | null {
  // Try to find JSON by looking for balanced braces
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
        // Found a complete JSON object
        const jsonStr = str.substring(startIndex, i + 1)
        try {
          return JSON.parse(jsonStr)
        } catch (e) {
          // Continue looking for the next JSON object
          startIndex = -1
        }
      }
    }
  }

  return null
}

/**
 * Makes an API call with retry logic.
 * @param call - The API call function to execute.
 * @param retryCount - The number of times to retry the API call if it fails.
 * @returns A promise that resolves with the response from the successful API call.
 */
async function apiCallWithRetry<T>(
  call: () => Promise<T>,
  retryCount: number = 3,
): Promise<T> {
  for (let i = 0; i < retryCount; i++) {
    try {
      const response = await call()
      return response
    } catch (error) {
      if (i === retryCount - 1) {
        diagnosticsService.logError(
          "llm-fetch",
          "API call failed after retries",
          error,
        )
        throw error
      }
    }
  }
  throw new Error("Unexpected error in retry logic")
}

/**
 * Get the appropriate model for the provider
 */
function getModel(providerId: string, type: "mcp" | "transcript"): string {
  const config = configStore.get()

  switch (providerId) {
    case "openai":
      return type === "mcp"
        ? config.mcpToolsOpenaiModel || "gpt-4o-mini"
        : config.transcriptPostProcessingOpenaiModel || "gpt-4o-mini"
    case "groq":
      return type === "mcp"
        ? config.mcpToolsGroqModel || "llama-3.1-70b-versatile"
        : config.transcriptPostProcessingGroqModel || "llama-3.1-70b-versatile"
    case "gemini":
      return config.mcpToolsGeminiModel || "gemini-1.5-flash-002"
    default:
      return "gpt-4o-mini"
  }
}

/**
 * Check if a model supports JSON mode
 */
function supportsJsonMode(model: string, providerId: string): boolean {
  // OpenAI models that support JSON mode
  if (providerId === "openai") {
    return model.includes("gpt-4") || model.includes("gpt-3.5-turbo")
  }

  // Groq models that support JSON mode
  if (providerId === "groq") {
    return (
      model.includes("llama") ||
      model.includes("mixtral") ||
      model.includes("gemma")
    )
  }

  // Conservative default - assume no JSON mode support
  return false
}

/**
 * Make a fetch-based LLM call for OpenAI-compatible APIs
 */
async function makeOpenAICompatibleCall(
  messages: Array<{ role: string; content: string }>,
  providerId: string,
  useStructuredOutput: boolean = true,
): Promise<any> {
  const config = configStore.get()

  const baseURL =
    providerId === "groq"
      ? config.groqBaseUrl || "https://api.groq.com/openai/v1"
      : config.openaiBaseUrl || "https://api.openai.com/v1"

  const apiKey = providerId === "groq" ? config.groqApiKey : config.openaiApiKey

  if (!apiKey) {
    throw new Error(`API key is required for ${providerId}`)
  }

  const model = getModel(providerId, "mcp")

  const requestBody: any = {
    model,
    messages,
    temperature: 0,
    frequency_penalty: 0.5,
    seed: 1,
  }

  // Add structured output for supported models
  if (useStructuredOutput && supportsJsonMode(model, providerId)) {
    requestBody.response_format = { type: "json_object" }
  }

  return apiCallWithRetry(async () => {
    if (isDebugLLM()) {
      logLLM("HTTP Request", {
        url: `${baseURL}/chat/completions`,
        model,
        messagesCount: messages.length,
        useStructuredOutput,
      })
      logLLM("Request Body", requestBody)
    }
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      if (isDebugLLM()) {
        logLLM("HTTP Error", response.status, errorText)
      }
      throw new Error(`HTTP ${response.status}: ${errorText}`)
    }

    const data = await response.json()

    if (data.error) {
      if (isDebugLLM()) {
        logLLM("API Error", data.error)
      }
      throw new Error(data.error.message)
    }

    if (isDebugLLM()) {
      logLLM("HTTP Response", data)
    }

    return data
  })
}

/**
 * Make a fetch-based LLM call for Gemini API
 */
async function makeGeminiCall(
  messages: Array<{ role: string; content: string }>,
): Promise<any> {
  const config = configStore.get()

  if (!config.geminiApiKey) {
    throw new Error("Gemini API key is required")
  }

  const model = getModel("gemini", "mcp")
  const baseURL =
    config.geminiBaseUrl || "https://generativelanguage.googleapis.com"

  // Convert messages to Gemini format
  const prompt = messages.map((m) => `${m.role}: ${m.content}`).join("\n\n")

  return apiCallWithRetry(async () => {
    if (isDebugLLM()) {
      logLLM("Gemini HTTP Request", {
        url: `${baseURL}/v1beta/models/${model}:generateContent`,
        model,
      })
      logLLM("Gemini Request Body", { prompt })
    }
    const response = await fetch(
      `${baseURL}/v1beta/models/${model}:generateContent?key=${config.geminiApiKey}`,
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
      },
    )

    if (!response.ok) {
      const errorText = await response.text()
      if (isDebugLLM()) {
        logLLM("Gemini HTTP Error", response.status, errorText)
      }
      throw new Error(`HTTP ${response.status}: ${errorText}`)
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

    // Return in OpenAI-compatible format
    return {
      choices: [
        {
          message: {
            content: text.trim(),
          },
        },
      ],
    }
  })
}

/**
 * Main function to make LLM calls using fetch
 */
export async function makeLLMCallWithFetch(
  messages: Array<{ role: string; content: string }>,
  providerId?: string,
): Promise<LLMToolCallResponse> {
  const config = configStore.get()
  const chatProviderId = providerId || config.mcpToolsProviderId || "openai"

  try {
    let response: any

    if (chatProviderId === "gemini") {
      response = await makeGeminiCall(messages)
    } else {
      response = await makeOpenAICompatibleCall(messages, chatProviderId, true)
    }

    const content = response.choices[0]?.message.content?.trim()
    if (!content) {
      throw new Error("No response content received")
    }

    // Try to extract JSON object from response
    const jsonObject = extractJsonObject(content)
    if (isDebugLLM()) {
      logLLM("Extracted JSON object", jsonObject)
      logLLM("JSON object has toolCalls:", !!jsonObject?.toolCalls)
      logLLM("JSON object has content:", !!jsonObject?.content)
    }
    if (jsonObject && (jsonObject.toolCalls || jsonObject.content)) {
      // If JSON lacks both toolCalls and needsMoreWork, default needsMoreWork to true (continue)
      const response = jsonObject as LLMToolCallResponse
      if (response.needsMoreWork === undefined && !response.toolCalls) {
        response.needsMoreWork = true
      }
      return response
    }

    // If no valid JSON found, return as content with needsMoreWork=true to continue
    return { content, needsMoreWork: true }
  } catch (error) {
    diagnosticsService.logError("llm-fetch", "LLM call failed", error)
    throw error
  }
}

/**
 * Make a simple text completion call
 */
export async function makeTextCompletionWithFetch(
  prompt: string,
  providerId?: string,
): Promise<string> {
  const config = configStore.get()
  const chatProviderId =
    providerId || config.transcriptPostProcessingProviderId || "openai"

  const messages = [
    {
      role: "system",
      content: prompt,
    },
  ]

  try {
    let response: any

    if (chatProviderId === "gemini") {
      response = await makeGeminiCall(messages)
    } else {
      response = await makeOpenAICompatibleCall(messages, chatProviderId, false)
    }

    return response.choices[0]?.message.content?.trim() || ""
  } catch (error) {
    diagnosticsService.logError("llm-fetch", "Text completion failed", error)
    throw error
  }
}

/**
 * Convert multimodal messages to OpenAI format
 */
function convertToOpenAIFormat(messages: MultimodalMessage[]): any[] {
  return messages.map(message => {
    if (typeof message.content === "string") {
      return {
        role: message.role,
        content: message.content
      }
    }

    // Handle multimodal content
    const content = message.content.map((item: MultimodalContent) => {
      if (item.type === "text") {
        return {
          type: "text",
          text: item.text
        }
      } else if (item.type === "image") {
        return {
          type: "image_url",
          image_url: {
            url: `data:${item.mimeType};base64,${item.data}`
          }
        }
      }
      return item
    })

    return {
      role: message.role,
      content
    }
  })
}

/**
 * Convert multimodal messages to Gemini format
 */
function convertToGeminiFormat(messages: MultimodalMessage[]): any {
  // Gemini expects a single contents array with parts
  const parts: any[] = []

  messages.forEach(message => {
    if (typeof message.content === "string") {
      parts.push({ text: `${message.role}: ${message.content}` })
    } else {
      // Handle multimodal content
      message.content.forEach((item: MultimodalContent) => {
        if (item.type === "text") {
          parts.push({ text: `${message.role}: ${item.text}` })
        } else if (item.type === "image") {
          parts.push({
            inline_data: {
              mime_type: item.mimeType,
              data: item.data
            }
          })
        }
      })
    }
  })

  return {
    contents: [{ parts }]
  }
}

/**
 * Make OpenAI-compatible call with pre-formatted messages
 */
async function makeOpenAICompatibleCallWithFormat(
  messages: any[],
  providerId: string,
  useStructuredOutput: boolean = true,
): Promise<any> {
  const config = configStore.get()

  const baseURL =
    providerId === "groq"
      ? config.groqBaseUrl || "https://api.groq.com/openai/v1"
      : config.openaiBaseUrl || "https://api.openai.com/v1"

  const apiKey = providerId === "groq" ? config.groqApiKey : config.openaiApiKey

  if (!apiKey) {
    throw new Error(`API key is required for ${providerId}`)
  }

  const model = getModel(providerId, "mcp")

  const requestBody: any = {
    model,
    messages,
    temperature: 0,
    frequency_penalty: 0.5,
    seed: 1,
  }

  if (useStructuredOutput && providerId === "openai") {
    requestBody.response_format = {
      type: "json_schema",
      json_schema: {
        name: "llm_response",
        strict: true,
        schema: {
          type: "object",
          properties: {
            content: { type: "string" },
            toolCalls: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  arguments: { type: "object" },
                },
                required: ["name", "arguments"],
                additionalProperties: false,
              },
            },
          },
          required: ["content", "toolCalls"],
          additionalProperties: false,
        },
      },
    }
  }

  return apiCallWithRetry(async () => {
    if (isDebugLLM()) {
      logLLM("HTTP Request", { url: `${baseURL}/chat/completions`, model })
      logLLM("Request Body", requestBody)
    }
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      if (isDebugLLM()) {
        logLLM("HTTP Error", response.status, errorText)
      }
      throw new Error(`HTTP ${response.status}: ${errorText}`)
    }

    const data = await response.json()

    if (isDebugLLM()) {
      logLLM("HTTP Response", data)
    }

    return data
  })
}

/**
 * Make Gemini call with pre-formatted content
 */
async function makeGeminiCallWithFormat(geminiFormat: any): Promise<any> {
  const config = configStore.get()

  if (!config.geminiApiKey) {
    throw new Error("Gemini API key is required")
  }

  const model = getModel("gemini", "mcp")
  const baseURL =
    config.geminiBaseUrl || "https://generativelanguage.googleapis.com"

  return apiCallWithRetry(async () => {
    if (isDebugLLM()) {
      logLLM("Gemini HTTP Request", {
        url: `${baseURL}/v1beta/models/${model}:generateContent`,
        model,
      })
      logLLM("Gemini Request Body", geminiFormat)
    }
    const response = await fetch(
      `${baseURL}/v1beta/models/${model}:generateContent?key=${config.geminiApiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...geminiFormat,
          generationConfig: {
            temperature: 0,
          },
        }),
      },
    )

    if (!response.ok) {
      const errorText = await response.text()
      if (isDebugLLM()) {
        logLLM("Gemini HTTP Error", response.status, errorText)
      }
      throw new Error(`HTTP ${response.status}: ${errorText}`)
    }

    const data = await response.json()

    if (isDebugLLM()) {
      logLLM("Gemini HTTP Response", data)
    }

    // Convert Gemini response to OpenAI format
    return {
      choices: [
        {
          message: {
            content: data.candidates?.[0]?.content?.parts?.[0]?.text || "",
          },
        },
      ],
    }
  })
}

/**
 * Main function to make multimodal LLM calls using fetch
 */
export async function makeMultimodalLLMCallWithFetch(
  messages: MultimodalMessage[],
  providerId?: string,
): Promise<LLMToolCallResponse> {
  const config = configStore.get()
  const chatProviderId = providerId || config.mcpToolsProviderId || "openai"

  try {
    let response: any

    if (chatProviderId === "gemini") {
      const geminiFormat = convertToGeminiFormat(messages)
      response = await makeGeminiCallWithFormat(geminiFormat)
    } else {
      const openaiFormat = convertToOpenAIFormat(messages)
      response = await makeOpenAICompatibleCallWithFormat(openaiFormat, chatProviderId, true)
    }

    const content = response.choices[0]?.message.content?.trim()
    if (!content) {
      throw new Error("No response content received")
    }

    // Try to extract JSON object from response
    const jsonObject = extractJsonObject(content)
    if (isDebugLLM()) {
      logLLM("Extracted JSON object", jsonObject)
      logLLM("JSON object has toolCalls:", !!jsonObject?.toolCalls)
      logLLM("JSON object has content:", !!jsonObject?.content)
    }

    if (jsonObject && (jsonObject.toolCalls || jsonObject.content)) {
      return {
        content: jsonObject.content || "",
        toolCalls: jsonObject.toolCalls || [],
      }
    }

    // Fallback to plain content
    return {
      content,
      toolCalls: [],
    }
  } catch (error) {
    diagnosticsService.logError("llm-fetch", "Multimodal LLM call failed", error)
    throw error
  }
}
