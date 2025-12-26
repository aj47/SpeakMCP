/**
 * Structured Output Module
 * Handles JSON schema parsing and context extraction
 */

import { z } from "zod"
import { createProviderFromConfig } from "./providers"
import { extractJsonObject } from "./providers/base"
import { logLLM } from "../debug"
import type { LLMMessage } from "./types"

/**
 * Schema for LLM tool call responses
 */
export const LLMToolCallSchema = z.object({
  toolCalls: z
    .array(
      z.object({
        name: z.string(),
        arguments: z.record(z.any()),
      }),
    )
    .optional(),
  content: z.string().optional(),
  needsMoreWork: z.boolean().optional(),
})

export type LLMToolCallResponse = z.infer<typeof LLMToolCallSchema>

/**
 * Schema for context extraction responses
 */
export const ContextExtractionSchema = z.object({
  resources: z.array(
    z.object({
      type: z.string(),
      id: z.string(),
    }),
  ),
})

export type ContextExtractionResponse = z.infer<typeof ContextExtractionSchema>

/**
 * JSON schema for context extraction (OpenAI format)
 */
export const CONTEXT_EXTRACTION_SCHEMA = {
  name: "ContextExtraction",
  description: "Extract resource identifiers from conversation",
  schema: {
    type: "object",
    properties: {
      resources: {
        type: "array",
        description: "Array of active resource identifiers",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              description: "Resource type (session, connection, handle, etc)",
            },
            id: {
              type: "string",
              description: "The resource identifier value",
            },
          },
          required: ["type", "id"],
          additionalProperties: false,
        },
      },
    },
    required: ["resources"],
    additionalProperties: false,
  },
  strict: true,
}

/**
 * Clean LLM response content for JSON parsing
 */
function cleanResponseContent(content: string): string {
  let cleanContent = content.trim()

  // Remove common LLM formatting artifacts
  cleanContent = cleanContent
    .replace(/<\|[^|]*\|>/g, "") // Remove special tokens
    .replace(/```json\s*/g, "") // Remove code block markers
    .replace(/```\s*/g, "")
    .replace(/^\s*[\w\s]*:\s*/, "") // Remove leading text
    .trim()

  return cleanContent
}

/**
 * Parse LLM response content into LLMToolCallResponse
 */
export function parseToolCallResponse(content: string): LLMToolCallResponse {
  const cleanContent = cleanResponseContent(content)

  // Try to extract JSON object if embedded in text
  const jsonObject = extractJsonObject(cleanContent)
  if (jsonObject) {
    try {
      return LLMToolCallSchema.parse(jsonObject)
    } catch {
      // Continue to fallback
    }
  }

  // Try direct JSON parse
  try {
    const parsed = JSON.parse(cleanContent)
    return LLMToolCallSchema.parse(parsed)
  } catch {
    // If parsing fails, return text content
    const textContent = content.replace(/<\|[^|]*\|>/g, "").trim()
    if (textContent) {
      return { content: textContent, needsMoreWork: true }
    }
    return { content: "", needsMoreWork: true }
  }
}

/**
 * Parse LLM response content into ContextExtractionResponse
 */
export function parseContextExtractionResponse(content: string): ContextExtractionResponse {
  const cleanContent = cleanResponseContent(content)

  // Try to extract JSON object
  const jsonObject = extractJsonObject(cleanContent)
  if (jsonObject) {
    try {
      return ContextExtractionSchema.parse(jsonObject)
    } catch {
      // Continue to fallback
    }
  }

  // Try direct JSON parse
  try {
    const parsed = JSON.parse(cleanContent)
    return ContextExtractionSchema.parse(parsed)
  } catch {
    return { resources: [] }
  }
}

/**
 * Make a structured LLM call for tool responses
 * Uses the provider abstraction for flexible backend support
 */
export async function makeStructuredToolCall(
  messages: Array<{ role: string; content: string }>,
  _providerId?: string,
): Promise<LLMToolCallResponse> {
  const provider = createProviderFromConfig("mcp")

  // Convert messages to LLMMessage format
  const llmMessages: LLMMessage[] = messages.map((m) => ({
    role: m.role as "system" | "user" | "assistant",
    content: m.content,
  }))

  const response = await provider.makeCall(llmMessages, {
    useStructuredOutput: true,
  })

  return response
}

/**
 * Make a structured LLM call for context extraction
 */
export async function makeStructuredContextExtraction(
  prompt: string,
  _providerId?: string,
): Promise<ContextExtractionResponse> {
  const provider = createProviderFromConfig("mcp")

  const messages: LLMMessage[] = [
    {
      role: "system",
      content:
        "You are a context extraction assistant. Analyze conversation history and extract useful resource identifiers and context information. Always respond with valid JSON.",
    },
    {
      role: "user",
      content: prompt,
    },
  ]

  try {
    const response = await provider.makeCall(messages, {
      useStructuredOutput: true,
    })

    if (response.content) {
      return parseContextExtractionResponse(response.content)
    }

    return { resources: [] }
  } catch (error) {
    logLLM("Context extraction failed:", error)
    return { resources: [] }
  }
}

/**
 * Make a regular text completion call (for transcript processing)
 */
export async function makeTextCompletion(
  prompt: string,
  _providerId?: string,
): Promise<string> {
  const provider = createProviderFromConfig("transcript")
  return provider.makeTextCompletion(prompt)
}
