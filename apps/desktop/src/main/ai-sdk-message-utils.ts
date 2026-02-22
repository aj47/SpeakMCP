/**
 * AI SDK message conversion utilities (dependency-light).
 *
 * Goal: ensure the message history we send to Vercel AI SDK v6 always satisfies
 * the tool-call ↔ tool-result invariants, even when legacy history is missing
 * IDs/names or when a previous run crashed mid-turn.
 */

import type {
  CoreAssistantMessage,
  CoreMessage,
  CoreToolMessage,
  ToolCallPart,
  ToolResultPart,
} from "ai"
import { randomUUID } from "crypto"

export type ToolCallLike = {
  name: string
  arguments: any
  toolCallId?: string
}

export type ToolResultLike = {
  // Supports both @speakmcp/shared ToolResult (string) and MCPToolResult (array)
  content: any
  success?: boolean
  isError?: boolean
  error?: string
  toolCallId?: string
  toolName?: string
}

export type LLMMessageLike = {
  role: "system" | "user" | "assistant" | "tool"
  content: string
  toolCalls?: ToolCallLike[]
  toolResults?: ToolResultLike[]
}

export type ConvertMessagesOptions = {
  /**
   * Map original MCP tool name -> provider-safe tool name (sanitized).
   * When provided, we use this mapping to keep history tool names consistent
   * with the `tools` passed to `generateText()`.
   */
  originalToolNameToProviderToolName?: Map<string, string>

  /** Override tool-name sanitizer used as a fallback when mapping is missing. */
  sanitizeToolName?: (name: string) => string

  /** Placeholder text inserted as an error tool-result when history is incomplete. */
  missingToolResultText?: string

  /**
   * If true (default), tool-role messages WITHOUT structured `toolResults` are
   * converted to `user` messages (unless we have pending tool calls to attach
   * them to). This avoids generating orphan tool-result parts.
   */
  treatLegacyToolMessagesAsUser?: boolean

  /**
   * If true (default), ensure the conversation doesn't end with an assistant
   * message (some OpenAI-compatible providers reject assistant-prefill).
   */
  ensureEndsWithUserMessage?: boolean
}

/**
 * Sanitize tool name for provider compatibility.
 * Providers require: ^[a-zA-Z0-9_-]{1,128}$
 */
export function sanitizeToolName(name: string, suffix?: string): string {
  // First replace colons with __COLON__ to preserve server prefix distinction
  let sanitized = name.replace(/:/g, "__COLON__")
  // Replace any remaining characters that don't match [a-zA-Z0-9_-] with underscore
  sanitized = sanitized.replace(/[^a-zA-Z0-9_-]/g, "_")

  // If we have a suffix, ensure it survives truncation by reserving space for it
  if (suffix) {
    const suffixStr = `_${suffix}`
    const maxBaseLength = 128 - suffixStr.length
    if (sanitized.length > maxBaseLength) {
      sanitized = sanitized.substring(0, maxBaseLength)
    }
    sanitized = `${sanitized}${suffixStr}`
  } else if (sanitized.length > 128) {
    sanitized = sanitized.substring(0, 128)
  }

  return sanitized
}

/**
 * Restore original tool name from sanitized version using the provided map.
 * Falls back to colon restoration when no map is available.
 */
export function restoreToolName(
  sanitizedName: string,
  toolNameMap?: Map<string, string>,
): string {
  if (toolNameMap && toolNameMap.has(sanitizedName)) {
    return toolNameMap.get(sanitizedName)!
  }

  // Some gateways prepend "proxy_". Only strip it when we can verify via the map.
  if (toolNameMap && sanitizedName.startsWith("proxy_")) {
    const cleanedName = sanitizedName.slice(6)
    if (toolNameMap.has(cleanedName)) {
      return toolNameMap.get(cleanedName)!
    }
  }

  return sanitizedName.replace(/__COLON__/g, ":")
}

type PendingToolCall = {
  toolCallId: string
  toolName: string
  resolved: boolean
}

function normalizeToolName(name: string, opts: ConvertMessagesOptions): string {
  const mapped = opts.originalToolNameToProviderToolName?.get(name)
  if (mapped) return mapped
  const sanitizer = opts.sanitizeToolName ?? sanitizeToolName
  return sanitizer(name)
}

function toolResultContentToString(tr: ToolResultLike): string {
  if (Array.isArray(tr.content)) {
    // MCPToolResult format: Array<{ type: "text", text: string }>
    return (tr.content as Array<{ type?: string; text?: string }>)
      .map(c => String(c?.text ?? ""))
      .join("\n")
  }
  if (typeof tr.content === "string") return tr.content
  if (tr.content == null) return ""
  try {
    return JSON.stringify(tr.content)
  } catch {
    return String(tr.content)
  }
}

function toolResultIsError(tr: ToolResultLike): boolean {
  if (typeof tr.success === "boolean") return !tr.success
  if (typeof tr.isError === "boolean") return tr.isError
  return typeof tr.error === "string" && tr.error.length > 0
}

function formatToolResultForUser(tr: ToolResultLike): string {
  const toolName = tr.toolName ? String(tr.toolName) : "unknown"
  const content = toolResultContentToString(tr)
  const prefix = toolResultIsError(tr) ? `[${toolName}] ERROR: ` : `[${toolName}] `
  return `${prefix}${content}`
}

function makeMissingToolResultPart(pending: PendingToolCall, text: string): ToolResultPart {
  return {
    type: "tool-result" as const,
    toolCallId: pending.toolCallId,
    toolName: pending.toolName,
    output: { type: "error-text" as const, value: text },
  }
}

function makeToolResultPart(
  pending: PendingToolCall,
  tr: ToolResultLike,
): ToolResultPart {
  const content = toolResultContentToString(tr)
  const isError = toolResultIsError(tr)
  return {
    type: "tool-result" as const,
    toolCallId: pending.toolCallId,
    toolName: pending.toolName,
    output: isError
      ? { type: "error-text" as const, value: content }
      : { type: "text" as const, value: content },
  }
}

/**
 * Convert app messages into AI SDK v6 CoreMessage[] + separate system prompt.
 */
export function convertMessagesToAISDK(
  messages: Array<LLMMessageLike | { role: string; content: string }>,
  opts: ConvertMessagesOptions = {},
): { system: string | undefined; messages: CoreMessage[] } {
  const options: Required<Pick<ConvertMessagesOptions,
    "treatLegacyToolMessagesAsUser" | "ensureEndsWithUserMessage" | "missingToolResultText"
  >> & ConvertMessagesOptions = {
    treatLegacyToolMessagesAsUser: opts.treatLegacyToolMessagesAsUser ?? true,
    ensureEndsWithUserMessage: opts.ensureEndsWithUserMessage ?? true,
    missingToolResultText:
      opts.missingToolResultText ??
      "Tool result missing from conversation history (likely an interrupted previous run).",
    ...opts,
  }

  const systemMessages: string[] = []
  const coreMessages: CoreMessage[] = []

  let pendingToolCalls: PendingToolCall[] = []

  const hasUnresolvedPending = () => pendingToolCalls.some(p => !p.resolved)

  const flushMissingResultsIfNeeded = () => {
    if (!hasUnresolvedPending()) return
    const toolResultParts: ToolResultPart[] = pendingToolCalls
      .filter(p => !p.resolved)
      .map(p => makeMissingToolResultPart(p, options.missingToolResultText))
    pendingToolCalls = []
    const toolMsg: CoreToolMessage = { role: "tool", content: toolResultParts }
    coreMessages.push(toolMsg)
  }

  const markPendingResolved = (toolCallId: string) => {
    const pending = pendingToolCalls.find(p => p.toolCallId === toolCallId)
    if (pending) pending.resolved = true
  }

  const getNextUnresolvedPending = (): PendingToolCall | undefined =>
    pendingToolCalls.find(p => !p.resolved)

  for (const msg of messages) {
    const role = (msg.role as any) as string

    if (role === "system") {
      systemMessages.push(msg.content)
      continue
    }

    // Any non-tool message means the previous tool-call batch is over.
    if (role !== "tool") {
      flushMissingResultsIfNeeded()
    }

    if (role === "assistant") {
      const llmMsg = msg as LLMMessageLike
      if (llmMsg.toolCalls && llmMsg.toolCalls.length > 0) {
        const contentParts: ({ type: "text"; text: string } | ToolCallPart)[] = []
        if (llmMsg.content?.trim()) {
          contentParts.push({ type: "text" as const, text: llmMsg.content })
        }

        // Start a new pending batch (tool calls should not overlap).
        pendingToolCalls = []
        for (const tc of llmMsg.toolCalls) {
          const toolCallId = tc.toolCallId || `call_${randomUUID()}`
          const toolName = normalizeToolName(tc.name, options)

          const toolCallPart: ToolCallPart = {
            type: "tool-call",
            toolCallId,
            toolName,
            args: tc.arguments ?? {},
          }
          contentParts.push(toolCallPart)
          pendingToolCalls.push({ toolCallId, toolName, resolved: false })
        }

        const assistantMsg: CoreAssistantMessage = {
          role: "assistant",
          content: contentParts,
        }
        coreMessages.push(assistantMsg)
      } else {
        coreMessages.push({ role: "assistant", content: (msg as any).content || "" })
      }
      continue
    }

    if (role === "user") {
      coreMessages.push({ role: "user", content: msg.content })
      continue
    }

    if (role === "tool") {
      const llmMsg = msg as LLMMessageLike

      // If we have no pending tool calls, treating tool-role messages as tool-result
      // parts risks creating orphan tool results. Prefer user-role text.
      if (pendingToolCalls.length === 0) {
        if (llmMsg.toolResults && llmMsg.toolResults.length > 0) {
          const orphanText = llmMsg.toolResults.map(formatToolResultForUser).join("\n")
          if (orphanText.trim()) {
            coreMessages.push({ role: "user", content: orphanText })
          }
          continue
        }

        if (options.treatLegacyToolMessagesAsUser && llmMsg.content?.trim()) {
          coreMessages.push({ role: "user", content: llmMsg.content })
        }
        continue
      }

      const toolResultParts: ToolResultPart[] = []
      const orphanTexts: string[] = []

      if (llmMsg.toolResults && llmMsg.toolResults.length > 0) {
        // Match by toolCallId when present; otherwise match by next unresolved pending (position).
        const pendingById = new Map(pendingToolCalls.map(p => [p.toolCallId, p]))

        for (const tr of llmMsg.toolResults) {
          let matched: PendingToolCall | undefined
          if (tr.toolCallId && pendingById.has(tr.toolCallId)) {
            matched = pendingById.get(tr.toolCallId)
          } else if (!tr.toolCallId) {
            matched = getNextUnresolvedPending()
          }

          if (!matched) {
            orphanTexts.push(formatToolResultForUser(tr))
            continue
          }

          toolResultParts.push(makeToolResultPart(matched, tr))
          markPendingResolved(matched.toolCallId)
        }
      } else {
        // Legacy tool message with only text content.
        const next = getNextUnresolvedPending()
        if (next) {
          toolResultParts.push({
            type: "tool-result" as const,
            toolCallId: next.toolCallId,
            toolName: next.toolName,
            output: { type: "text" as const, value: llmMsg.content || "" },
          })
          markPendingResolved(next.toolCallId)
        } else if (llmMsg.content?.trim()) {
          coreMessages.push({ role: "user", content: llmMsg.content })
        }
      }

      if (toolResultParts.length > 0) {
        coreMessages.push({ role: "tool", content: toolResultParts })
      }

      // Keep any orphan tool results as user-visible context rather than tool parts.
      if (orphanTexts.length > 0) {
        coreMessages.push({ role: "user", content: orphanTexts.join("\n") })
      }

      // If all pending tool calls are resolved, clear the batch.
      if (!hasUnresolvedPending()) {
        pendingToolCalls = []
      }

      continue
    }

    // Unknown role: treat as user.
    coreMessages.push({ role: "user", content: msg.content })
  }

  // End-of-history: ensure no unresolved tool calls remain.
  flushMissingResultsIfNeeded()

  if (
    options.ensureEndsWithUserMessage &&
    coreMessages.length > 0 &&
    coreMessages[coreMessages.length - 1].role === "assistant"
  ) {
    coreMessages.push({
      role: "user",
      content: "Continue from your most recent step using the existing context. Do not restart.",
    })
  }

  return {
    system: systemMessages.length > 0 ? systemMessages.join("\n\n") : undefined,
    messages: coreMessages,
  }
}
