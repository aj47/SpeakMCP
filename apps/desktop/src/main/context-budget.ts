import { configStore } from "./config"
import { isDebugLLM, logLLM } from "./debug"
import { makeTextCompletionWithFetch } from "./llm-fetch"
import { constructMinimalSystemPrompt } from "./system-prompts"
import { agentSessionStateManager } from "./state"
import { summarizationService } from "./summarization-service"

export type LLMMessage = { role: string; content: string }

// Simple in-memory cache for provider/model context windows
const contextWindowCache = new Map<string, number>()

function key(providerId: string, model: string) {
  return `${providerId}|${model}`
}

// ============================================================================
// MODEL REGISTRY - Comprehensive context windows for known models
// ============================================================================

interface ModelSpec {
  contextWindow: number
  maxOutputTokens?: number
}

/**
 * Model registry with known context windows.
 * Keys are normalized patterns that will be matched against model names.
 * Order matters: more specific patterns should come first.
 */
const MODEL_REGISTRY: Record<string, ModelSpec> = {
  // -------------------------------------------------------------------------
  // Anthropic Claude models (all 200K context)
  // -------------------------------------------------------------------------
  // Claude 4.x series
  "claude-opus-4.5": { contextWindow: 200_000, maxOutputTokens: 64_000 },
  "claude-opus-4-5": { contextWindow: 200_000, maxOutputTokens: 64_000 },
  "claude-opus-4.1": { contextWindow: 200_000, maxOutputTokens: 32_000 },
  "claude-opus-4-1": { contextWindow: 200_000, maxOutputTokens: 32_000 },
  "claude-opus-4.0": { contextWindow: 200_000, maxOutputTokens: 32_000 },
  "claude-opus-4-0": { contextWindow: 200_000, maxOutputTokens: 32_000 },
  "claude-opus-4": { contextWindow: 200_000, maxOutputTokens: 32_000 },
  "claude-sonnet-4.5": { contextWindow: 200_000, maxOutputTokens: 64_000 },
  "claude-sonnet-4-5": { contextWindow: 200_000, maxOutputTokens: 64_000 },
  "claude-sonnet-4.0": { contextWindow: 200_000, maxOutputTokens: 64_000 },
  "claude-sonnet-4-0": { contextWindow: 200_000, maxOutputTokens: 64_000 },
  "claude-sonnet-4": { contextWindow: 200_000, maxOutputTokens: 64_000 },
  "claude-haiku-4.5": { contextWindow: 200_000, maxOutputTokens: 64_000 },
  "claude-haiku-4-5": { contextWindow: 200_000, maxOutputTokens: 64_000 },
  // Claude 3.x series
  "claude-3.7-sonnet": { contextWindow: 200_000, maxOutputTokens: 64_000 },
  "claude-3-7-sonnet": { contextWindow: 200_000, maxOutputTokens: 64_000 },
  "claude-3.5-sonnet": { contextWindow: 200_000, maxOutputTokens: 8_192 },
  "claude-3-5-sonnet": { contextWindow: 200_000, maxOutputTokens: 8_192 },
  "claude-3.5-haiku": { contextWindow: 200_000, maxOutputTokens: 8_192 },
  "claude-3-5-haiku": { contextWindow: 200_000, maxOutputTokens: 8_192 },
  "claude-3-opus": { contextWindow: 200_000, maxOutputTokens: 4_096 },
  "claude-3-sonnet": { contextWindow: 200_000, maxOutputTokens: 4_096 },
  "claude-3-haiku": { contextWindow: 200_000, maxOutputTokens: 4_096 },
  // Generic Claude fallbacks (match any claude model)
  "claude-opus": { contextWindow: 200_000, maxOutputTokens: 32_000 },
  "claude-sonnet": { contextWindow: 200_000, maxOutputTokens: 64_000 },
  "claude-haiku": { contextWindow: 200_000, maxOutputTokens: 64_000 },
  "claude": { contextWindow: 200_000, maxOutputTokens: 8_192 },

  // -------------------------------------------------------------------------
  // OpenAI models
  // -------------------------------------------------------------------------
  // GPT-5.x series (future-proofing based on pi-mono registry)
  "gpt-5.2": { contextWindow: 128_000, maxOutputTokens: 64_000 },
  "gpt-5.1": { contextWindow: 128_000, maxOutputTokens: 128_000 },
  "gpt-5-codex": { contextWindow: 128_000, maxOutputTokens: 128_000 },
  "gpt-5-mini": { contextWindow: 128_000, maxOutputTokens: 64_000 },
  "gpt-5": { contextWindow: 128_000, maxOutputTokens: 128_000 },
  // GPT-4.x series
  "gpt-4.1": { contextWindow: 128_000, maxOutputTokens: 16_384 },
  "gpt-4o-mini": { contextWindow: 128_000, maxOutputTokens: 16_384 },
  "gpt-4o": { contextWindow: 128_000, maxOutputTokens: 16_384 },
  "gpt-4-turbo": { contextWindow: 128_000, maxOutputTokens: 4_096 },
  "gpt-4-32k": { contextWindow: 32_768, maxOutputTokens: 4_096 },
  "gpt-4": { contextWindow: 128_000, maxOutputTokens: 8_192 },
  // GPT-3.5 series
  "gpt-3.5-turbo-16k": { contextWindow: 16_384, maxOutputTokens: 4_096 },
  "gpt-3.5-turbo": { contextWindow: 16_384, maxOutputTokens: 4_096 },
  "gpt-3.5": { contextWindow: 16_384, maxOutputTokens: 4_096 },
  // o-series reasoning models
  // Note: Include "o-1" and "o-3" patterns because normalizeModelName() inserts
  // hyphens between letters and digits (e.g., "o1" -> "o-1")
  "o3-mini": { contextWindow: 200_000, maxOutputTokens: 100_000 },
  "o-3-mini": { contextWindow: 200_000, maxOutputTokens: 100_000 },
  "o3": { contextWindow: 200_000, maxOutputTokens: 100_000 },
  "o-3": { contextWindow: 200_000, maxOutputTokens: 100_000 },
  "o1-mini": { contextWindow: 128_000, maxOutputTokens: 65_536 },
  "o-1-mini": { contextWindow: 128_000, maxOutputTokens: 65_536 },
  "o1-preview": { contextWindow: 128_000, maxOutputTokens: 32_768 },
  "o-1-preview": { contextWindow: 128_000, maxOutputTokens: 32_768 },
  "o1": { contextWindow: 200_000, maxOutputTokens: 100_000 },
  "o-1": { contextWindow: 200_000, maxOutputTokens: 100_000 },

  // -------------------------------------------------------------------------
  // Google Gemini models
  // -------------------------------------------------------------------------
  "gemini-3-pro": { contextWindow: 1_000_000, maxOutputTokens: 64_000 },
  "gemini-3-flash": { contextWindow: 1_048_576, maxOutputTokens: 65_536 },
  "gemini-2.5-pro": { contextWindow: 1_048_576, maxOutputTokens: 65_536 },
  "gemini-2.5-flash-lite": { contextWindow: 1_048_576, maxOutputTokens: 65_536 },
  "gemini-2.5-flash": { contextWindow: 1_048_576, maxOutputTokens: 65_536 },
  "gemini-2.0-flash-lite": { contextWindow: 1_048_576, maxOutputTokens: 8_192 },
  "gemini-2.0-flash": { contextWindow: 1_048_576, maxOutputTokens: 8_192 },
  "gemini-1.5-pro": { contextWindow: 1_000_000, maxOutputTokens: 8_192 },
  "gemini-1.5-flash-8b": { contextWindow: 1_000_000, maxOutputTokens: 8_192 },
  "gemini-1.5-flash": { contextWindow: 1_000_000, maxOutputTokens: 8_192 },
  "gemini-flash": { contextWindow: 1_048_576, maxOutputTokens: 65_536 },
  "gemini-pro": { contextWindow: 1_000_000, maxOutputTokens: 8_192 },
  "gemini": { contextWindow: 1_000_000, maxOutputTokens: 8_192 },

  // -------------------------------------------------------------------------
  // xAI Grok models
  // -------------------------------------------------------------------------
  "grok-4.1-fast": { contextWindow: 2_000_000, maxOutputTokens: 30_000 },
  "grok-4-fast": { contextWindow: 2_000_000, maxOutputTokens: 30_000 },
  "grok-4": { contextWindow: 256_000, maxOutputTokens: 64_000 },
  "grok-3-mini": { contextWindow: 131_072, maxOutputTokens: 8_192 },
  "grok-3": { contextWindow: 131_072, maxOutputTokens: 8_192 },
  "grok-2-vision": { contextWindow: 8_192, maxOutputTokens: 4_096 },
  "grok-2": { contextWindow: 131_072, maxOutputTokens: 8_192 },
  "grok-code-fast": { contextWindow: 256_000, maxOutputTokens: 10_000 },
  "grok": { contextWindow: 131_072, maxOutputTokens: 8_192 },

  // -------------------------------------------------------------------------
  // Meta Llama models (commonly via Groq, Together, etc.)
  // -------------------------------------------------------------------------
  "llama-3.3-70b": { contextWindow: 128_000, maxOutputTokens: 32_768 },
  "llama-3.2-90b": { contextWindow: 128_000, maxOutputTokens: 4_096 },
  "llama-3.2-11b": { contextWindow: 128_000, maxOutputTokens: 4_096 },
  "llama-3.2-3b": { contextWindow: 128_000, maxOutputTokens: 4_096 },
  "llama-3.2-1b": { contextWindow: 128_000, maxOutputTokens: 4_096 },
  "llama-3.1-405b": { contextWindow: 128_000, maxOutputTokens: 4_096 },
  "llama-3.1-70b": { contextWindow: 128_000, maxOutputTokens: 4_096 },
  "llama-3.1-8b": { contextWindow: 128_000, maxOutputTokens: 4_096 },
  "llama-3-70b": { contextWindow: 8_192, maxOutputTokens: 2_048 },
  "llama-3-8b": { contextWindow: 8_192, maxOutputTokens: 2_048 },
  // Note: "llama3" becomes "llama-3" after normalization, but we keep both
  // for inputs that already have the hyphen or come from different sources
  "llama3": { contextWindow: 8_192, maxOutputTokens: 2_048 },
  "llama-3": { contextWindow: 8_192, maxOutputTokens: 2_048 },
  "llama-70b": { contextWindow: 32_768, maxOutputTokens: 4_096 },
  "llama-8b": { contextWindow: 8_192, maxOutputTokens: 2_048 },
  "llama": { contextWindow: 8_192, maxOutputTokens: 2_048 },

  // -------------------------------------------------------------------------
  // Mistral models
  // -------------------------------------------------------------------------
  "mistral-large": { contextWindow: 128_000, maxOutputTokens: 4_096 },
  "mistral-medium": { contextWindow: 32_000, maxOutputTokens: 4_096 },
  "mistral-small": { contextWindow: 32_000, maxOutputTokens: 4_096 },
  "mixtral-8x22b": { contextWindow: 65_536, maxOutputTokens: 4_096 },
  "mixtral-8x7b": { contextWindow: 32_768, maxOutputTokens: 4_096 },
  "mixtral": { contextWindow: 32_768, maxOutputTokens: 4_096 },
  "mistral-7b": { contextWindow: 8_192, maxOutputTokens: 2_048 },
  "mistral": { contextWindow: 32_000, maxOutputTokens: 4_096 },

  // -------------------------------------------------------------------------
  // DeepSeek models
  // -------------------------------------------------------------------------
  // Note: "deepseek-v3" becomes "deepseek-3" after normalization (v(\d+) -> $1)
  "deepseek-r1": { contextWindow: 128_000, maxOutputTokens: 8_192 },
  "deepseek-r-1": { contextWindow: 128_000, maxOutputTokens: 8_192 },
  "deepseek-v3": { contextWindow: 128_000, maxOutputTokens: 8_192 },
  "deepseek-3": { contextWindow: 128_000, maxOutputTokens: 8_192 },
  "deepseek-coder": { contextWindow: 128_000, maxOutputTokens: 8_192 },
  "deepseek-chat": { contextWindow: 128_000, maxOutputTokens: 8_192 },
  "deepseek": { contextWindow: 128_000, maxOutputTokens: 8_192 },

  // -------------------------------------------------------------------------
  // Qwen models
  // -------------------------------------------------------------------------
  // Note: "qwen3" becomes "qwen-3" after normalization (letter-digit hyphen insertion)
  "qwen3-coder": { contextWindow: 262_144, maxOutputTokens: 262_144 },
  "qwen-3-coder": { contextWindow: 262_144, maxOutputTokens: 262_144 },
  "qwen3-max": { contextWindow: 256_000, maxOutputTokens: 32_768 },
  "qwen-3-max": { contextWindow: 256_000, maxOutputTokens: 32_768 },
  "qwen3-235b": { contextWindow: 262_144, maxOutputTokens: 4_096 },
  "qwen-3-235b": { contextWindow: 262_144, maxOutputTokens: 4_096 },
  "qwen3-72b": { contextWindow: 128_000, maxOutputTokens: 8_192 },
  "qwen-3-72b": { contextWindow: 128_000, maxOutputTokens: 8_192 },
  "qwen3-32b": { contextWindow: 128_000, maxOutputTokens: 8_192 },
  "qwen-3-32b": { contextWindow: 128_000, maxOutputTokens: 8_192 },
  "qwen3-8b": { contextWindow: 128_000, maxOutputTokens: 20_000 },
  "qwen-3-8b": { contextWindow: 128_000, maxOutputTokens: 20_000 },
  "qwen3": { contextWindow: 128_000, maxOutputTokens: 8_192 },
  "qwen-3": { contextWindow: 128_000, maxOutputTokens: 8_192 },
  "qwen2.5": { contextWindow: 128_000, maxOutputTokens: 8_192 },
  "qwen-2.5": { contextWindow: 128_000, maxOutputTokens: 8_192 },
  "qwen2": { contextWindow: 32_768, maxOutputTokens: 4_096 },
  "qwen-2": { contextWindow: 32_768, maxOutputTokens: 4_096 },
  "qwen": { contextWindow: 32_768, maxOutputTokens: 4_096 },
  "qwq": { contextWindow: 32_768, maxOutputTokens: 4_096 },

  // -------------------------------------------------------------------------
  // Cohere models
  // -------------------------------------------------------------------------
  "command-r-plus": { contextWindow: 128_000, maxOutputTokens: 4_096 },
  "command-r": { contextWindow: 128_000, maxOutputTokens: 4_096 },
  "command": { contextWindow: 4_096, maxOutputTokens: 4_096 },
}

/**
 * Normalize a model name for fuzzy matching.
 * Handles variations like:
 * - claude-haiku-4-5-20251001 -> claude-haiku-4-5
 * - claude-haiku-4.5-20251001 -> claude-haiku-4.5
 * - anthropic/claude-3.5-sonnet -> claude-3.5-sonnet
 * - accounts/fireworks/models/llama-v3p1-70b -> llama-v3p1-70b
 * - gpt4 -> gpt-4 (inserts hyphen between letters and digits)
 * - gpt4o -> gpt-4o
 */
function normalizeModelName(model: string): string {
  let normalized = model.toLowerCase()

  // Remove provider prefixes (e.g., "anthropic/", "openai/", "accounts/fireworks/models/")
  // Try patterns from most specific to least specific, stop after first match
  const prefixPatterns = [
    /^accounts\/[^/]+\/models\//, // Fireworks: accounts/fireworks/models/...
    /^[a-z0-9]+\/[a-z0-9-]+\//, // Two-level: provider/subtype/ (e.g., openrouter/anthropic/)
    /^[a-z0-9-]+\//, // Simple prefix: anthropic/, openai/, etc.
  ]
  for (const pattern of prefixPatterns) {
    if (pattern.test(normalized)) {
      normalized = normalized.replace(pattern, "")
      break // Stop after first match to avoid double-stripping
    }
  }

  // Remove date suffixes (e.g., "-20251001", "-2024-06-20")
  normalized = normalized.replace(/-\d{8}$/, "") // YYYYMMDD
  normalized = normalized.replace(/-\d{4}-\d{2}-\d{2}$/, "") // YYYY-MM-DD
  normalized = normalized.replace(/-\d{6}$/, "") // YYMMDD

  // Remove version suffixes like ":latest", ":free", ":exacto"
  normalized = normalized.replace(/:[a-z]+$/, "")

  // Normalize version separators (v3p1 -> 3.1, v3-1 -> 3.1)
  normalized = normalized.replace(/v(\d+)p(\d+)/g, "$1.$2")
  normalized = normalized.replace(/v(\d+)-(\d+)/g, "$1.$2")
  normalized = normalized.replace(/v(\d+)/g, "$1")

  // Insert hyphen between letters and digits where missing (gpt4 -> gpt-4, gpt35 -> gpt-3.5)
  // This handles common variations like "gpt4", "gpt4o", "gpt35" which should match "gpt-4", etc.
  // Pattern: letter followed by digit (without hyphen between them)
  normalized = normalized.replace(/([a-z])(\d)/g, "$1-$2")

  return normalized
}

/**
 * Calculate a match score between a normalized model name and a registry pattern.
 * Higher score = better match.
 * Returns 0 if no match.
 */
function calculateMatchScore(normalizedModel: string, pattern: string): number {
  // Exact match is best
  if (normalizedModel === pattern) return 1000

  // Check if model contains the pattern
  if (!normalizedModel.includes(pattern)) return 0

  // Score based on:
  // 1. Pattern length (longer = more specific = better)
  // 2. Position in model name (earlier = better)
  // 3. Whether it's a word boundary match
  const position = normalizedModel.indexOf(pattern)
  const lengthScore = pattern.length * 10
  const positionScore = (normalizedModel.length - position) // Earlier is better
  const boundaryBonus = (position === 0 || normalizedModel[position - 1] === "-") ? 50 : 0

  return lengthScore + positionScore + boundaryBonus
}

/**
 * Look up context window for a model using fuzzy matching.
 * Returns the best matching spec or undefined if no match.
 */
function lookupModelSpec(model: string): ModelSpec | undefined {
  const normalized = normalizeModelName(model)

  let bestMatch: { pattern: string; spec: ModelSpec; score: number } | undefined

  for (const [pattern, spec] of Object.entries(MODEL_REGISTRY)) {
    const score = calculateMatchScore(normalized, pattern)
    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { pattern, spec, score }
    }
  }

  if (bestMatch && isDebugLLM()) {
    logLLM("ModelRegistry: matched", {
      original: model,
      normalized,
      matchedPattern: bestMatch.pattern,
      score: bestMatch.score,
      contextWindow: bestMatch.spec.contextWindow,
    })
  }

  return bestMatch?.spec
}

/**
 * Get context window for a model, with fuzzy matching and provider fallbacks.
 */
function getModelContextWindow(providerId: string, model: string): number {
  // Try fuzzy match in registry first
  const spec = lookupModelSpec(model)
  if (spec) return spec.contextWindow

  // Provider-specific fallbacks for models not in registry
  const lower = model.toLowerCase()

  if (providerId === "groq") {
    // Groq models - conservative defaults
    if (lower.includes("70b") || lower.includes("405b")) return 32_768
    if (lower.includes("8b") || lower.includes("9b")) return 8_192
    return 32_768
  }

  if (providerId === "openai") {
    // Unknown OpenAI model - use conservative default to avoid oversized requests
    // (legacy models like GPT-3.5 have 16K, embedding models even less)
    return 16_000
  }

  if (providerId === "anthropic") {
    // Unknown Anthropic model - use conservative default
    // (older Claude models may have smaller contexts)
    return 100_000
  }

  if (providerId === "gemini" || providerId === "google") {
    // Unknown Google model - use conservative default
    // (some Gemini variants have smaller contexts than the flagship)
    return 128_000
  }

  // Generic fallback - conservative
  if (isDebugLLM()) {
    logLLM("ModelRegistry: no match, using fallback", { providerId, model, fallback: 64_000 })
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
  // Use model registry with fuzzy matching for context window lookup
  if (!result) result = getModelContextWindow(providerId, model)

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
  const { providerId: provider } = getProviderAndModel() // align with agent provider
  const MAX_TOKENS_HINT = 400 // soft guidance via prompt only
  const CHUNK_SIZE = 16000 // ~4k tokens per chunk (roughly)

  const makePrompt = (src: string) => `Summarize tool output or conversation focusing on WHAT WAS LEARNED, not what was executed.

PRESERVE (exact format):
- Tool names with prefixes: [server:tool_name] - keep this exact format
- IDs, file paths, URLs, numeric values
- Key data points and findings

FOCUS ON:
- What information was discovered or retrieved
- What elements/data are visible or available
- What actions succeeded or failed and WHY
- Key observations that inform next steps

DO NOT:
- Just say "tool executed successfully" - describe what it returned
- Lose the [toolName] prefix format
- Invent or hallucinate values

Target: ~${MAX_TOKENS_HINT} tokens. Be concise but preserve actionable information.

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
    return await summarizeOnce(content)
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

  return combined
}

/**
 * Build a context summary from stored session summaries
 * This allows the LLM to know what work was accomplished even if messages were dropped
 */
function buildContextFromSummaries(sessionId: string): string | null {
  const MAX_ACTION_SUMMARY_LENGTH = 150
  const MAX_TOTAL_SUMMARY_LENGTH = 2000

  const summaries = summarizationService.getSummaries(sessionId)
  if (summaries.length === 0) return null

  // Get important summaries
  const important = summarizationService.getImportantSummaries(sessionId)
  const toInclude = important.length > 0 ? important : summaries.slice(-5)

  if (toInclude.length === 0) return null

  const lines = toInclude.map(s => {
    const status = s.importance === "critical" ? "⚠️" : "✓"
    // Truncate actionSummary if it exceeds max length
    const truncatedSummary =
      s.actionSummary.length > MAX_ACTION_SUMMARY_LENGTH
        ? s.actionSummary.slice(0, MAX_ACTION_SUMMARY_LENGTH - 3) + "..."
        : s.actionSummary
    return `${status} Step ${s.stepNumber}: ${truncatedSummary}`
  })

  const result = `[Session Progress Summary]\n${lines.join("\n")}`

  // Truncate total summary if it exceeds max length
  if (result.length > MAX_TOTAL_SUMMARY_LENGTH) {
    return result.slice(0, MAX_TOTAL_SUMMARY_LENGTH - 3) + "..."
  }

  return result
}

/**
 * Parse tool name from content that uses format: [toolName] content...
 * Returns { toolName, content } where content is the part after the tool name prefix
 */
function parseToolNameFromContent(content: string): { toolName: string; resultContent: string } {
  // Match format: [toolName] content... or [toolName] ERROR: content...
  const match = content.match(/^\[([^\]]+)\]\s*(?:ERROR:\s*)?(.*)$/s)
  if (match) {
    return { toolName: match[1], resultContent: match[2] }
  }
  return { toolName: 'unknown', resultContent: content }
}

/**
 * Summarize tool messages that would be dropped during context shrinking.
 * Creates semantic summaries preserving tool names and what was learned.
 * Format: [toolName] brief description of outcome/data
 * @param toolMessages Array of tool messages that would be dropped
 * @returns A summary string under 800 chars
 */
function summarizeToolMessagesForDropping(toolMessages: LLMMessage[]): string {
  if (toolMessages.length === 0) return ""

  const summaries: string[] = []
  let totalLength = 0
  const MAX_SUMMARY_LENGTH = 800

  for (const msg of toolMessages) {
    const content = msg.content || ""
    const { toolName, resultContent } = parseToolNameFromContent(content)

    // Detect error status from content
    const isError = content.toLowerCase().includes("[error]") ||
                    content.toLowerCase().includes("] error:") ||
                    resultContent.toLowerCase().startsWith("error")

    // Extract semantic brief - focus on what was learned/returned
    let brief: string
    const firstLine = resultContent.split("\n")[0].trim()

    if (isError) {
      // For errors, extract the error type/message
      brief = `FAILED: ${firstLine.substring(0, 60)}`
    } else if (resultContent.length === 0 || resultContent === "[No output]") {
      brief = "completed (no output)"
    } else {
      // Extract meaningful brief - first 80 chars of first line
      brief = firstLine.length > 80 ? firstLine.substring(0, 77) + "..." : firstLine
    }

    const entry = `[${toolName}] ${brief}`

    // Check if adding this would exceed limit
    if (totalLength + entry.length + 2 > MAX_SUMMARY_LENGTH) {
      summaries.push(`... and ${toolMessages.length - summaries.length} more tool results`)
      break
    }

    summaries.push(entry)
    totalLength += entry.length + 2 // +2 for newline
  }

  return `Previously executed tools:\n${summaries.join("\n")}`
}

export interface ShrinkOptions {
  messages: LLMMessage[]
  availableTools?: Array<{ name: string; description?: string; inputSchema?: any }>
  relevantTools?: Array<{ name: string; description?: string; inputSchema?: any }>
  /** Optional compact skill index (IDs) so Tier-3 minimal prompts don't drop skills entirely. */
  skillsIndex?: string
  isAgentMode?: boolean
  targetRatio?: number // default 0.7
  lastNMessages?: number // default 3
  summarizeCharThreshold?: number // default 2000
  sessionId?: string // optional session ID for abort control and progress injection
  onSummarizationProgress?: (current: number, total: number, message: string) => void // callback for progress updates
}

export interface ShrinkResult {
  messages: LLMMessage[]
  appliedStrategies: string[]
  estTokensBefore: number
  estTokensAfter: number
  maxTokens: number
  toolResultsSummarized?: boolean
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
      : getModelContextWindow(providerId, model)
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
  const indicesByLength = messages
    .map((m, i) => ({ i, len: m.content?.length || 0, role: m.role, content: m.content }))
    .filter((x) => x.len > summarizeThreshold && x.role !== "system")
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

  const keptSet = new Set<number>()
  if (systemIdx >= 0) keptSet.add(systemIdx)
  if (firstUserIdx >= 0) keptSet.add(firstUserIdx)
  // Add indices for last N
  const baseLen = messages.length
  for (let k = baseLen - effectiveLastN; k < baseLen; k++) {
    if (k >= 0) keptSet.add(k)
  }

  // Find tool messages that would be dropped (not in keptSet)
  const toolMessagesToBeDropped: LLMMessage[] = []
  for (let i = 0; i < messages.length; i++) {
    if (!keptSet.has(i) && messages[i].role === "tool") {
      toolMessagesToBeDropped.push(messages[i])
    }
  }

  // Summarize tool messages before dropping them
  let toolResultsSummarized = false
  let toolSummaryMessage: LLMMessage | null = null
  if (toolMessagesToBeDropped.length > 0) {
    const summary = summarizeToolMessagesForDropping(toolMessagesToBeDropped)
    if (summary) {
      toolSummaryMessage = { role: "assistant", content: summary }
      toolResultsSummarized = true
      logLLM(`[Context Budget] Summarized ${toolMessagesToBeDropped.length} tool results before drop_middle`)
    }
  }

  // Preserve order: system -> first user -> tool summary (if any) -> (chronological tail without duplicates)
  const ordered: LLMMessage[] = []
  if (systemIdx >= 0) ordered.push(messages[systemIdx])
  if (firstUserIdx >= 0 && firstUserIdx !== systemIdx) ordered.push(messages[firstUserIdx])
  // Insert tool summary right after first user message
  if (toolSummaryMessage) ordered.push(toolSummaryMessage)
  for (let k = baseLen - effectiveLastN; k < baseLen; k++) {
    if (k >= 0 && k !== systemIdx && k !== firstUserIdx) ordered.push(messages[k])
  }
  messages = ordered
  applied.push("drop_middle")
  tokens = estimateTokensFromMessages(messages)

  // If we dropped tools, try to inject session progress from summaries
  if (toolResultsSummarized && opts.sessionId) {
    const progressSummary = buildContextFromSummaries(opts.sessionId)
    if (progressSummary) {
      // Find first user message and inject progress after it
      const firstUserIdx = messages.findIndex(m => m.role === "user")
      if (firstUserIdx >= 0 && firstUserIdx < messages.length - 1) {
        messages.splice(firstUserIdx + 1, 0, { role: "assistant", content: progressSummary })
        tokens = estimateTokensFromMessages(messages)
        if (isDebugLLM()) logLLM("[Context Budget] Injected session progress summary from summarization service")
      }
    }
  }

  if (tokens <= targetTokens) {
    if (isDebugLLM()) logLLM("ContextBudget: after drop_middle", { estTokens: tokens, kept: messages.length })
    return { messages, appliedStrategies: applied, estTokensBefore: tokens, estTokensAfter: tokens, maxTokens, toolResultsSummarized }
  }

  // Tier 3: Minimal system prompt
  const systemMsgIdx = messages.findIndex((m) => m.role === "system")
  const minimal = constructMinimalSystemPrompt(
    opts.availableTools || [],
    !!opts.isAgentMode,
    opts.relevantTools,
    opts.skillsIndex,
  )
  if (systemMsgIdx >= 0) {
    messages[systemMsgIdx] = { role: "system", content: minimal }
  } else {
    messages.unshift({ role: "system", content: minimal })
  }
  applied.push("minimal_system_prompt")
  tokens = estimateTokensFromMessages(messages)

  if (isDebugLLM()) logLLM("ContextBudget: after minimal_system_prompt", { estTokens: tokens })

  return { messages, appliedStrategies: applied, estTokensBefore: tokens, estTokensAfter: tokens, maxTokens, toolResultsSummarized }
}

