import OpenAI from "openai"
import { z } from "zod"
import { configStore } from "./config"

// Define the schema for LLM tool call responses
const LLMToolCallSchema = z.object({
  toolCalls: z.array(z.object({
    name: z.string(),
    arguments: z.record(z.any())
  })).optional(),
  content: z.string().optional(),
  needsMoreWork: z.boolean().optional()
})

export type LLMToolCallResponse = z.infer<typeof LLMToolCallSchema>

// Define the JSON schema for OpenAI structured output
const toolCallResponseSchema: OpenAI.ResponseFormatJSONSchema["json_schema"] = {
  name: "LLMToolCallResponse",
  description: "Response format for LLM tool calls with optional tool execution and content",
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
              description: "Name of the tool to call"
            },
            arguments: {
              type: "object",
              description: "Arguments to pass to the tool",
              additionalProperties: true
            }
          },
          required: ["name", "arguments"],
          additionalProperties: false
        }
      },
      content: {
        type: "string",
        description: "Text content of the response"
      },
      needsMoreWork: {
        type: "boolean",
        description: "Whether more work is needed after this response"
      }
    },
    additionalProperties: false
  },
  strict: true
}

// Context extraction schema
const ContextExtractionSchema = z.object({
  contextSummary: z.string(),
  resources: z.array(z.object({
    type: z.string(),
    id: z.string(),
    parameter: z.string()
  }))
})

export type ContextExtractionResponse = z.infer<typeof ContextExtractionSchema>

const contextExtractionSchema: OpenAI.ResponseFormatJSONSchema["json_schema"] = {
  name: "ContextExtraction",
  description: "Extract context summary and resource identifiers from conversation",
  schema: {
    type: "object",
    properties: {
      contextSummary: {
        type: "string",
        description: "Brief summary of the current state and what has been accomplished"
      },
      resources: {
        type: "array",
        description: "Array of resource objects with type, id, and parameter information",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              description: "Type of resource (session, connection, handle, workspace, channel, other)"
            },
            id: {
              type: "string",
              description: "The actual ID value"
            },
            parameter: {
              type: "string",
              description: "The parameter name this ID should be used for (e.g., sessionId, connectionId)"
            }
          },
          required: ["type", "id", "parameter"],
          additionalProperties: false
        }
      }
    },
    required: ["contextSummary", "resources"],
    additionalProperties: false
  },
  strict: true
}

/**
 * Create an OpenAI client instance based on the current configuration
 */
function createOpenAIClient(providerId?: string): OpenAI {
  const config = configStore.get()
  const chatProviderId = providerId || config.mcpToolsProviderId || 'openai'

  const baseURL = chatProviderId === "groq"
    ? config.groqBaseUrl || "https://api.groq.com/openai/v1"
    : config.openaiBaseUrl || "https://api.openai.com/v1"

  const apiKey = chatProviderId === "groq"
    ? config.groqApiKey
    : config.openaiApiKey

  if (!apiKey) {
    throw new Error(`API key is required for ${chatProviderId}`)
  }

  return new OpenAI({
    baseURL,
    apiKey
  })
}

/**
 * Get the appropriate model for the provider
 */
function getModel(providerId?: string, context: 'mcp' | 'transcript' = 'mcp'): string {
  const config = configStore.get()
  const chatProviderId = providerId || config.mcpToolsProviderId || 'openai'

  if (context === 'transcript') {
    return chatProviderId === "groq"
      ? config.transcriptPostProcessingGroqModel || "gemma2-9b-it"
      : config.transcriptPostProcessingOpenaiModel || "gpt-4o-mini"
  }

  return chatProviderId === "groq"
    ? config.mcpToolsGroqModel || "gemma2-9b-it"
    : config.mcpToolsOpenaiModel || "gpt-4o-mini"
}

/**
 * Check if the model supports structured output
 */
function supportsStructuredOutput(model: string): boolean {
  // Models that support structured output
  const supportedModels = [
    'gpt-4o-mini-2024-07-18',
    'gpt-4o-2024-08-06',
    'gpt-4o-mini',
    'gpt-4o',
    'o1-2024-12-17',
    'o3-mini-2025-1-31'
  ]

  return supportedModels.some(supported => model.includes(supported.split('-')[0]))
}

/**
 * Make a structured LLM call for tool responses
 */
export async function makeStructuredToolCall(
  messages: Array<{ role: string; content: string }>,
  providerId?: string
): Promise<LLMToolCallResponse> {
  const config = configStore.get()
  const chatProviderId = providerId || config.mcpToolsProviderId || 'openai'

  // For Gemini, fall back to the existing implementation
  if (chatProviderId === "gemini") {
    throw new Error("Gemini provider should use existing implementation")
  }

  const model = getModel(providerId, 'mcp')
  const client = createOpenAIClient(providerId)


  try {
    if (supportsStructuredOutput(model)) {

      const response = await client.chat.completions.create({
        model,
        messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        temperature: 0,
        response_format: {
          type: "json_schema",
          json_schema: toolCallResponseSchema
        }
      })

      const content = response.choices[0]?.message.content
      if (content) {
        try {
          const parsed = JSON.parse(content)
          return LLMToolCallSchema.parse(parsed)
        } catch (parseError) {
        }
      }
    }

    // Fallback to regular completion for unsupported models

    const response = await client.chat.completions.create({
      model,
      messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      temperature: 0
    })

    const content = response.choices[0]?.message.content?.trim()
    if (content) {
      try {
        const parsed = JSON.parse(content)
        return LLMToolCallSchema.parse(parsed)
      } catch (parseError) {
        return { content }
      }
    }

    throw new Error("No response content received")

  } catch (error) {
    throw error
  }
}

/**
 * Make a structured LLM call for context extraction
 */
export async function makeStructuredContextExtraction(
  prompt: string,
  providerId?: string
): Promise<ContextExtractionResponse> {
  const config = configStore.get()
  const chatProviderId = providerId || config.mcpToolsProviderId || 'openai'

  const model = getModel(providerId, 'mcp')
  const client = createOpenAIClient(providerId)


  try {
    if (supportsStructuredOutput(model)) {

      const response = await client.chat.completions.create({
        model,
        messages: [
          {
            role: "system",
            content: "You are a context extraction assistant. Analyze conversation history and extract useful resource identifiers and context information."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0,
        response_format: {
          type: "json_schema",
          json_schema: contextExtractionSchema
        }
      })

      const content = response.choices[0]?.message.content
      if (content) {
        try {
          const parsed = JSON.parse(content)
          return ContextExtractionSchema.parse(parsed)
        } catch (parseError) {
        }
      }
    }

    // Fallback for unsupported models

    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: "You are a context extraction assistant. Always respond with valid JSON only."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0
    })

    const content = response.choices[0]?.message.content?.trim()
    if (content) {
      try {
        const parsed = JSON.parse(content)
        return ContextExtractionSchema.parse(parsed)
      } catch (parseError) {
        return { contextSummary: "", resources: [] }
      }
    }

    return { contextSummary: "", resources: [] }

  } catch (error) {
    return { contextSummary: "", resources: [] }
  }
}

/**
 * Make a regular text completion call (for transcript processing)
 */
export async function makeTextCompletion(
  prompt: string,
  providerId?: string
): Promise<string> {
  const config = configStore.get()
  const chatProviderId = providerId || config.transcriptPostProcessingProviderId || 'openai'

  const model = getModel(providerId, 'transcript')
  const client = createOpenAIClient(providerId)


  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: prompt
      }
    ],
    temperature: 0
  })

  return response.choices[0]?.message.content?.trim() || ""
}
