/**
 * Context Extraction Module
 * Extracts useful context from conversation history for agent mode
 */

import { makeStructuredContextExtraction } from "../structured-output"
import type { MCPToolCall, MCPToolResult } from "../../mcp-service"

/**
 * Conversation entry for context extraction
 */
export interface ConversationEntry {
  role: "user" | "assistant" | "tool"
  content: string
  toolCalls?: MCPToolCall[]
  toolResults?: MCPToolResult[]
}

/**
 * Extracted context information
 */
export interface ExtractedContext {
  resources: Array<{ type: string; id: string }>
}

/**
 * Use LLM to extract useful context from conversation history
 */
export async function extractContextFromHistory(
  conversationHistory: ConversationEntry[],
  providerId?: string,
): Promise<ExtractedContext> {
  if (conversationHistory.length === 0) {
    return { resources: [] }
  }

  // Create a condensed version of the conversation for analysis
  const conversationText = conversationHistory
    .map((entry) => {
      let text = `${entry.role.toUpperCase()}: ${entry.content}`

      if (entry.toolCalls) {
        text += `\nTOOL_CALLS: ${entry.toolCalls.map((tc) => `${tc.name}(${JSON.stringify(tc.arguments)})`).join(", ")}`
      }

      if (entry.toolResults) {
        text += `\nTOOL_RESULTS: ${entry.toolResults.map((tr) => (tr.isError ? "ERROR" : "SUCCESS")).join(", ")}`
      }

      return text
    })
    .join("\n\n")

  const contextExtractionPrompt = `Extract active resource IDs from this conversation:

${conversationText}

Return JSON: {"resources": [{"type": "session|connection|handle|other", "id": "actual_id_value"}]}
Only include currently active/usable resources.`

  try {
    const result = await makeStructuredContextExtraction(
      contextExtractionPrompt,
      providerId,
    )
    return result as ExtractedContext
  } catch (error) {
    return { resources: [] }
  }
}

/**
 * Extract recent context from history (simple approach without LLM)
 * Returns the last N messages for context
 */
export function extractRecentContext(
  history: ConversationEntry[],
  maxMessages: number = 8,
): ConversationEntry[] {
  return history.slice(-maxMessages)
}

/**
 * Analyze tool errors and provide recovery strategies
 */
export function analyzeToolErrors(toolResults: MCPToolResult[]): {
  recoveryStrategy: string
  errorTypes: string[]
} {
  const errorTypes: string[] = []
  const errorMessages = toolResults
    .filter((r) => r.isError)
    .map((r) => r.content.map((c) => c.text).join(" "))
    .join(" ")

  // Categorize error types generically
  if (
    errorMessages.includes("timeout") ||
    errorMessages.includes("connection")
  ) {
    errorTypes.push("connectivity")
  }
  if (
    errorMessages.includes("permission") ||
    errorMessages.includes("access") ||
    errorMessages.includes("denied")
  ) {
    errorTypes.push("permissions")
  }
  if (
    errorMessages.includes("not found") ||
    errorMessages.includes("does not exist") ||
    errorMessages.includes("missing")
  ) {
    errorTypes.push("resource_missing")
  }

  // Generate generic recovery strategy
  let recoveryStrategy = "RECOVERY STRATEGIES:\n"

  if (errorTypes.includes("connectivity")) {
    recoveryStrategy +=
      "- For connectivity issues: Wait a moment and retry, or check if the service is available\n"
  }
  if (errorTypes.includes("permissions")) {
    recoveryStrategy +=
      "- For permission errors: Try alternative approaches or check access rights\n"
  }
  if (errorTypes.includes("resource_missing")) {
    recoveryStrategy +=
      "- For missing resources: Verify the resource exists or try creating it first\n"
  }

  // Always provide generic fallback advice
  recoveryStrategy +=
    "- General: Try breaking down the task into smaller steps, use alternative tools, or try a different approach\n"

  return { recoveryStrategy, errorTypes }
}

/**
 * Format conversation history for progress updates
 */
export function formatConversationForProgress(
  history: ConversationEntry[],
): Array<{
  role: string
  content: string
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>
  toolResults?: Array<{ success: boolean; content: string; error?: string }>
  timestamp?: number
}> {
  const isNudge = (content: string) =>
    content.includes("Please either take action using available tools") ||
    content.includes("You have relevant tools available for this request")

  return history
    .filter((entry) => !(entry.role === "user" && isNudge(entry.content)))
    .map((entry) => ({
      role: entry.role,
      content: entry.content,
      toolCalls: entry.toolCalls?.map((tc) => ({
        name: tc.name,
        arguments: tc.arguments,
      })),
      toolResults: entry.toolResults?.map((tr) => {
        const contentText = Array.isArray(tr.content)
          ? tr.content.map((c) => c.text).join("\n")
          : String(tr.content || "")

        return {
          success: !tr.isError,
          content: contentText,
          error: tr.isError ? contentText : undefined,
        }
      }),
      timestamp: (entry as { timestamp?: number }).timestamp || Date.now(),
    }))
}

/**
 * Check if content is just a tool call placeholder
 */
export function isToolCallPlaceholder(content: string): boolean {
  const trimmed = content.trim()
  return /^\[(?:Calling tools?|Tool|Tools?):[^\]]+\]$/i.test(trimmed)
}

/**
 * Detect if agent is repeating the same response (infinite loop)
 */
export function detectRepeatedResponse(
  currentResponse: string,
  conversationHistory: ConversationEntry[],
): boolean {
  const assistantResponses = conversationHistory
    .filter((entry) => entry.role === "assistant")
    .map((entry) => entry.content.trim().toLowerCase())
    .slice(-3)

  if (assistantResponses.length < 2) return false

  const currentTrimmed = currentResponse.trim().toLowerCase()

  for (const prevResponse of assistantResponses.slice(-2)) {
    if (prevResponse.length === 0 || currentTrimmed.length === 0) continue

    const similarity = calculateSimilarity(currentTrimmed, prevResponse)
    if (similarity > 0.8) {
      return true
    }
  }

  return false
}

/**
 * Simple similarity calculation (Jaccard similarity on words)
 */
function calculateSimilarity(str1: string, str2: string): number {
  const words1 = new Set(str1.split(/\s+/))
  const words2 = new Set(str2.split(/\s+/))

  const intersection = new Set([...words1].filter((x) => words2.has(x)))
  const union = new Set([...words1, ...words2])

  return union.size === 0 ? 0 : intersection.size / union.size
}
