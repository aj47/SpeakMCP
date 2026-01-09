import { configStore } from "./config"
import { isDebugLLM, logLLM } from "./debug"
import { makeTextCompletionWithFetch } from "./llm-fetch"
import { constructMinimalSystemPrompt } from "./system-prompts"
import { agentSessionStateManager } from "./state"

export type LLMMessage = { role: string; content: string }

// Marker to identify already-summarized content, preventing duplicate summarization
// when the same conversation is processed multiple times (e.g., back-to-back messages)
const SUMMARY_MARKER = "<!-- ctx-summary -->"

export function isAlreadySummarized(content: string): boolean {
  return content.includes(SUMMARY_MARKER)
}

// Simple in-memory cache for provider/model context windows
const contextWindowCache = new Map<string, number>()

function key(providerId: string, model: string) {
  return `${providerId}|${model}`
}

// Conservative static defaults by model id substring
function staticDefaultMaxTokens(providerId: string, model: string): number {
  const lower = model.toLowerCase()
  if (providerId === "openai") {
    if (lower.includes("gpt-4o-mini") || lower.includes("gpt-4o")) return 128_000
    if (lower.includes("gpt-4") || lower.includes("gpt4")) return 128_000
    if (lower.includes("gpt-3.5")) return 16_000
    return 64_000
  }
  if (providerId === "groq") {
    // Groq exposes context_length via /models; fallback conservatively
    if (lower.includes("70b")) return 32_768
    if (lower.includes("405b")) return 32_768
    if (lower.includes("8b") || lower.includes("9b")) return 8_192
    return 32_768
  }
  if (providerId === "gemini") {
    // Gemini 1.5 Flash supports very large context; be conservative
    if (lower.includes("1.5")) return 1_000_000
    return 100_000
  }
  return 64_000
}

async function fetchGroqContextWindow(model: string): Promise<number | undefined> {
  try {
    const config = configStore.get()
    const baseURL = config.groqBaseUrl || "https://api.groq.com/openai/v1"
    const apiKey = config.groqApiKey
    if (!apiKey) return undefined
    const resp = await fetch(`${baseURL}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!resp.ok) return undefined
    const data = await resp.json() as any
    const list = Array.isArray(data?.data) ? data.data : []
    const entry = list.find((m: any) => m?.id === model)
    const ctx = entry?.context_length || entry?.max_context_tokens || entry?.context_window
    if (typeof ctx === "number") return ctx
  } catch {}
  return undefined
}

export async function getMaxContextTokens(providerId: string, model: string): Promise<number> {
  const cfg = configStore.get()
  const override = cfg.mcpMaxContextTokensOverride
  if (override && typeof override === "number" && override > 0) return override

  const k = key(providerId, model)
  if (contextWindowCache.has(k)) return contextWindowCache.get(k)!

  let result: number | undefined
  if (providerId === "groq") {
    result = await fetchGroqContextWindow(model)
  }
  // OpenAI and Gemini models endpoints don’t reliably expose context sizes; use static defaults
  if (!result) result = staticDefaultMaxTokens(providerId, model)

  contextWindowCache.set(k, result)
  return result
}

export function estimateTokensFromMessages(messages: LLMMessage[]): number {
  // Rough estimate: 4 chars ≈ 1 token
  const totalChars = messages.reduce((sum, m) => sum + (m.content?.length || 0), 0)
  return Math.ceil(totalChars / 4)
}

export function getProviderAndModel(): { providerId: string; model: string } {
  const config = configStore.get()
  const providerId = config.mcpToolsProviderId || "openai"
  let model = "gpt-4o-mini"
  if (providerId === "openai") {
    model = config.mcpToolsOpenaiModel || "gpt-4o-mini"
  } else if (providerId === "groq") {
    model = config.mcpToolsGroqModel || "llama-3.3-70b-versatile"
  } else if (providerId === "gemini") {
    model = config.mcpToolsGeminiModel || "gemini-1.5-flash-002"
  }
  return { providerId, model }
}

export async function summarizeContent(content: string, sessionId?: string): Promise<string> {
  // Skip if already summarized to prevent duplicate summarization
  // when the same conversation is processed multiple times
  if (isAlreadySummarized(content)) {
    if (isDebugLLM()) logLLM("ContextBudget: skipping already-summarized content")
    return content
  }

  const { providerId: provider } = getProviderAndModel() // align with agent provider
  const MAX_TOKENS_HINT = 400 // soft guidance via prompt only
  const CHUNK_SIZE = 16000 // ~4k tokens per chunk (roughly)

  const makePrompt = (src: string) => `You will receive output from tools or chat messages. Summarize concisely while PRESERVING:
- Exact tool names (including prefixes like server:tool_name)
- Exact parameter names (keys) used in tool arguments
- Any IDs, file paths, URLs, and key numeric values
Rules:
- Do NOT invent values; if a value is very long, indicate it as truncated
- Keep bullet points or compact JSON-like lines
- Target <= ${MAX_TOKENS_HINT} tokens

SOURCE:
${src}`

  const summarizeOnce = async (src: string): Promise<string> => {
    try {
      // Check if session should stop before making LLM call
      if (sessionId && agentSessionStateManager.shouldStopSession(sessionId)) {
        return src
      }
      const summary = await makeTextCompletionWithFetch(makePrompt(src), provider, sessionId)
      return summary?.trim() || src
    } catch (e) {
      return src
    }
  }

  // Small enough: single pass
  if (content.length <= CHUNK_SIZE) {
    const summary = await summarizeOnce(content)
    // Append marker to prevent re-summarization
    return `${summary}\n${SUMMARY_MARKER}`
  }

  // Large content: chunk then combine
  const parts: string[] = []
  for (let i = 0; i < content.length; i += CHUNK_SIZE) {
    parts.push(content.slice(i, i + CHUNK_SIZE))
  }

  const partials: string[] = []
  for (const p of parts) {
    partials.push(await summarizeOnce(p))
  }

  let combined = partials.join("\n")

  // If combined is still large, compress once more
  if (combined.length > CHUNK_SIZE) {
    combined = await summarizeOnce(combined)
  }

  // Append marker to prevent re-summarization
  return `${combined}\n${SUMMARY_MARKER}`
}

export interface ShrinkOptions {
  messages: LLMMessage[]
  availableTools?: Array<{ name: string; description?: string; inputSchema?: any }>
  relevantTools?: Array<{ name: string; description?: string; inputSchema?: any }>
  isAgentMode?: boolean
  targetRatio?: number // default 0.7
  lastNMessages?: number // default 3
  summarizeCharThreshold?: number // default 2000
  sessionId?: string // optional session ID for abort control
  onSummarizationProgress?: (current: number, total: number, message: string) => void // callback for progress updates
}

export interface ShrinkResult {
  messages: LLMMessage[]
  appliedStrategies: string[]
  estTokensBefore: number
  estTokensAfter: number
  maxTokens: number
  /**
   * When compaction was performed (drop_middle strategy), this contains the info needed
   * to persist the compaction to disk. The caller should use this to call
   * conversationService.compactConversation() to persist the changes.
   */
  compaction?: {
    /** Summary of the dropped messages */
    summaryContent: string
    /** Number of messages that were dropped/compacted */
    droppedMessageCount: number
    /**
     * Index (exclusive) up to which messages should be replaced with the summary on disk.
     * This is the index of the first message in the "tail" that is being kept.
     * Messages from 0 to compactUpToIndex-1 will be replaced with the summary.
     */
    compactUpToIndex: number
  }
}

export async function shrinkMessagesForLLM(opts: ShrinkOptions): Promise<ShrinkResult> {
  const config = configStore.get()
  const applied: string[] = []

  const enabled = config.mcpContextReductionEnabled ?? true
  const targetRatio = opts.targetRatio ?? (config.mcpContextTargetRatio ?? 0.7)
  const lastN = opts.lastNMessages ?? (config.mcpContextLastNMessages ?? 3)
  const summarizeThreshold = opts.summarizeCharThreshold ?? (config.mcpContextSummarizeCharThreshold ?? 2000)

  const { providerId, model } = getProviderAndModel()
  if (!enabled) {
    const est = estimateTokensFromMessages(opts.messages)
    // Check for user override first (no network call), else use static default
    const cfg = configStore.get()
    const override = cfg.mcpMaxContextTokensOverride
    const maxTokens = (override && typeof override === "number" && override > 0)
      ? override
      : staticDefaultMaxTokens(providerId, model)
    return { messages: opts.messages, appliedStrategies: [], estTokensBefore: est, estTokensAfter: est, maxTokens }
  }
  const maxTokens = await getMaxContextTokens(providerId, model)
  const targetTokens = Math.floor(maxTokens * targetRatio)

  let messages = [...opts.messages]
  let tokens = estimateTokensFromMessages(messages)

  if (isDebugLLM()) {
    logLLM("ContextBudget: initial", { providerId, model, maxTokens, targetTokens, estTokens: tokens, count: messages.length })
  }

  if (tokens <= targetTokens) {
    return { messages, appliedStrategies: applied, estTokensBefore: tokens, estTokensAfter: tokens, maxTokens }
  }

  // Tier 0: Aggressive truncation of very large tool responses (>5000 chars)
  // This happens BEFORE summarization to avoid expensive LLM calls on huge payloads
  const AGGRESSIVE_TRUNCATE_THRESHOLD = 5000
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.role === "user" && msg.content && msg.content.length > AGGRESSIVE_TRUNCATE_THRESHOLD) {
      // Check if this looks like a tool result (contains JSON arrays/objects)
      if (msg.content.includes('"url":') || msg.content.includes('"id":')) {
        // Truncate aggressively and add note
        messages[i] = {
          ...msg,
          content: msg.content.substring(0, AGGRESSIVE_TRUNCATE_THRESHOLD) +
                   '\n\n... (truncated ' + (msg.content.length - AGGRESSIVE_TRUNCATE_THRESHOLD) +
                   ' characters for context management. Key information preserved above.)'
        }
        applied.push("aggressive_truncate")
        tokens = estimateTokensFromMessages(messages)
        if (tokens <= targetTokens) {
          if (isDebugLLM()) logLLM("ContextBudget: after aggressive_truncate", { estTokens: tokens })
          return { messages, appliedStrategies: applied, estTokensBefore: tokens, estTokensAfter: tokens, maxTokens }
        }
      }
    }
  }

  // Tier 1: Summarize large messages (prefer tool outputs or very long entries)
  // Skip already-summarized messages to prevent duplicate summarization
  const indicesByLength = messages
    .map((m, i) => ({ i, len: m.content?.length || 0, role: m.role, content: m.content }))
    .filter((x) => x.len > summarizeThreshold && x.role !== "system" && !isAlreadySummarized(x.content || ""))
    .sort((a, b) => b.len - a.len)

  const totalToSummarize = indicesByLength.length
  let summarizedCount = 0

  for (const item of indicesByLength) {
    // Check if session should stop before summarizing
    if (opts.sessionId && agentSessionStateManager.shouldStopSession(opts.sessionId)) {
      break
    }

    // Emit progress update before summarization
    summarizedCount++
    if (opts.onSummarizationProgress) {
      const messagePreview = item.content!.substring(0, 100).replace(/\n/g, ' ')
      opts.onSummarizationProgress(
        summarizedCount,
        totalToSummarize,
        `Summarizing large message ${summarizedCount}/${totalToSummarize} (${item.len} chars): ${messagePreview}...`
      )
    }

    const summarized = await summarizeContent(item.content!, opts.sessionId)
    messages[item.i] = { ...messages[item.i], content: summarized }
    applied.push("summarize")
    tokens = estimateTokensFromMessages(messages)
    if (tokens <= targetTokens) break
  }

  if (tokens <= targetTokens) {
    if (isDebugLLM()) logLLM("ContextBudget: after summarize", { estTokens: tokens })
    return { messages, appliedStrategies: applied, estTokensBefore: tokens, estTokensAfter: tokens, maxTokens }
  }

  // Tier 2: Remove middle messages (keep system, first user, last N)
  // If still over budget, reduce lastN to be more aggressive
  const effectiveLastN = tokens > targetTokens * 1.5 ? Math.max(1, Math.floor(lastN / 2)) : lastN

  const systemIdx = messages.findIndex((m) => m.role === "system")
  const firstUserIdx = messages.findIndex((m, idx) => m.role === "user" && idx !== systemIdx)

  const tail = messages.slice(-effectiveLastN)
  const keptSet = new Set<number>()
  if (systemIdx >= 0) keptSet.add(systemIdx)
  if (firstUserIdx >= 0) keptSet.add(firstUserIdx)
  // Add indices for last N
  const baseLen = messages.length
  for (let k = baseLen - effectiveLastN; k < baseLen; k++) {
    if (k >= 0) keptSet.add(k)
  }

  // Calculate compactUpToIndex BEFORE reassigning messages
  // so we can correctly identify which messages will be compacted on disk.
  //
  // IMPORTANT: We need to convert from LLM-array-space to on-disk-conversation-space.
  // The LLM array has a system message at index 0 that doesn't exist on disk:
  //   - LLM array: [system_prompt, msg0, msg1, msg2, ...]
  //   - On-disk:   [msg0, msg1, msg2, ...]
  // So LLM index N corresponds to on-disk index (N - 1) when there's a system message.
  const systemMessageOffset = systemIdx >= 0 ? 1 : 0
  const compactUpToIndex = baseLen - effectiveLastN - systemMessageOffset

  // The cutoff index in LLM-array-space: messages from systemMessageOffset to this index (exclusive)
  // will be compacted on disk.
  const llmCutoffIndex = compactUpToIndex + systemMessageOffset

  // Collect dropped messages for summarization in chronological order.
  // ONLY include messages that will actually be replaced by compaction on disk:
  // - On-disk indices 0 to compactUpToIndex-1 correspond to LLM indices systemMessageOffset to llmCutoffIndex-1
  // - The first user message should only be included if it falls within this range
  // NOTE: We must do this BEFORE reassigning `messages` to `ordered`
  const droppedMessages: LLMMessage[] = []
  for (let i = systemMessageOffset; i < llmCutoffIndex && i < baseLen; i++) {
    // Include any non-system message in the compaction range
    if (messages[i] && messages[i].role !== "system") {
      droppedMessages.push(messages[i])
    }
  }

  const trimmed = messages.filter((_, idx) => keptSet.has(idx))
  // Preserve order: system -> first user -> (chronological tail without duplicates)
  const ordered: LLMMessage[] = []
  if (systemIdx >= 0) ordered.push(messages[systemIdx])
  if (firstUserIdx >= 0 && firstUserIdx !== systemIdx) ordered.push(messages[firstUserIdx])
  for (let k = baseLen - effectiveLastN; k < baseLen; k++) {
    if (k >= 0 && k !== systemIdx && k !== firstUserIdx) ordered.push(messages[k])
  }
  messages = ordered
  applied.push("drop_middle")
  tokens = estimateTokensFromMessages(messages)

  let compaction: ShrinkResult["compaction"] = undefined
  // Only generate compaction if:
  // 1. We have messages to summarize (droppedMessages.length > 0)
  // 2. There's actually a prefix to compact on disk (compactUpToIndex > 0)
  // This prevents wasted summarizeContent() LLM calls when there's nothing to compact
  if (droppedMessages.length > 0 && compactUpToIndex > 0) {
    // Create a summary of the dropped conversation
    const droppedContent = droppedMessages
      .map((m) => `${m.role}: ${m.content?.substring(0, 500) || "(empty)"}`)
      .join("\n\n")

    // Use LLM to summarize the dropped content (if it's substantial)
    let summaryContent: string
    if (droppedContent.length > 500) {
      summaryContent = await summarizeContent(
        `Summarize this conversation history concisely, preserving key facts, decisions, and context:\n\n${droppedContent}`,
        opts.sessionId
      )
    } else {
      summaryContent = `[Previous conversation summary: ${droppedMessages.length} messages compacted]\n${droppedContent}`
    }

    compaction = {
      summaryContent,
      droppedMessageCount: droppedMessages.length,
      compactUpToIndex,
    }
    if (isDebugLLM()) logLLM("ContextBudget: compaction generated", { droppedCount: droppedMessages.length, compactUpToIndex })
  }

  if (tokens <= targetTokens) {
    if (isDebugLLM()) logLLM("ContextBudget: after drop_middle", { estTokens: tokens, kept: messages.length })
    return { messages, appliedStrategies: applied, estTokensBefore: tokens, estTokensAfter: tokens, maxTokens, compaction }
  }

  // Tier 3: Minimal system prompt
  const systemMsgIdx = messages.findIndex((m) => m.role === "system")
  const minimal = constructMinimalSystemPrompt(
    opts.availableTools || [],
    !!opts.isAgentMode,
    opts.relevantTools,
  )
  if (systemMsgIdx >= 0) {
    messages[systemMsgIdx] = { role: "system", content: minimal }
  } else {
    messages.unshift({ role: "system", content: minimal })
  }
  applied.push("minimal_system_prompt")
  tokens = estimateTokensFromMessages(messages)

  if (isDebugLLM()) logLLM("ContextBudget: after minimal_system_prompt", { estTokens: tokens })

  return { messages, appliedStrategies: applied, estTokensBefore: tokens, estTokensAfter: tokens, maxTokens, compaction }
}

