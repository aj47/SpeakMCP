/**
 * Langfuse Service
 * Provides observability and monitoring for LLM calls and agent operations.
 *
 * Key features:
 * - LLM call tracing with token counts and costs
 * - Agent session traces
 * - MCP tool call instrumentation
 * - Optional/configurable (won't block functionality if not configured)
 * - Langfuse is an OPTIONAL dependency - this module handles its absence gracefully
 */

import { configStore } from "./config"
import { isDebugLLM, logLLM } from "./debug"
import {
  Langfuse,
  isInstalled,
  type LangfuseInstance,
  type LangfuseTraceClient,
  type LangfuseSpanClient,
  type LangfuseGenerationClient,
} from "./langfuse-loader"

// Singleton Langfuse instance
let langfuseInstance: LangfuseInstance | null = null

// Active traces and spans for linking
const activeTraces = new Map<string, LangfuseTraceClient>()
const activeSpans = new Map<string, LangfuseSpanClient>()
const activeGenerations = new Map<string, LangfuseGenerationClient>()

/**
 * Check if Langfuse package is installed and available
 */
export function isLangfuseInstalled(): boolean {
  return isInstalled
}

/**
 * Check if Langfuse is enabled and configured.
 * Returns false if:
 * - langfuse package is not installed
 * - langfuseEnabled is false in config
 * - API keys are not configured
 */
export function isLangfuseEnabled(): boolean {
  if (!isInstalled) return false
  const config = configStore.get()
  return !!(config.langfuseEnabled && config.langfuseSecretKey && config.langfusePublicKey)
}

/**
 * Get or create the Langfuse instance
 */
export function getLangfuse(): LangfuseInstance | null {
  if (!isLangfuseEnabled() || !Langfuse) {
    return null
  }

  if (langfuseInstance) {
    return langfuseInstance
  }

  const config = configStore.get()

  try {
    langfuseInstance = new Langfuse({
      secretKey: config.langfuseSecretKey!,
      publicKey: config.langfusePublicKey!,
      baseUrl: config.langfuseBaseUrl || "https://cloud.langfuse.com",
      flushAt: 5, // Flush after 5 events for responsiveness
      flushInterval: 1000, // Flush every 1 second
    })

    if (isDebugLLM()) {
      logLLM("Langfuse initialized", {
        baseUrl: config.langfuseBaseUrl || "https://cloud.langfuse.com",
      })
    }

    return langfuseInstance
  } catch (error) {
    console.error("[Langfuse] Failed to initialize:", error)
    return null
  }
}

/**
 * Reinitialize Langfuse when config changes
 */
export function reinitializeLangfuse(): void {
  if (langfuseInstance) {
    langfuseInstance.shutdownAsync().catch(console.error)
    langfuseInstance = null
  }
  // Clear all active traces/spans
  activeTraces.clear()
  activeSpans.clear()
  activeGenerations.clear()
}

/**
 * Create a new trace for an agent session
 *
 * Langfuse concepts:
 * - sessionId: Groups multiple traces together (e.g., a conversation thread)
 * - trace id: Individual trace within a session (e.g., one agent interaction)
 * - userId: The user who initiated the trace
 * - tags: Categorization labels for filtering in the Langfuse dashboard
 * - release: Application version for tracking across releases
 *
 * @param traceId - Unique ID for this trace (our internal sessionId)
 * @param options - Trace configuration options
 */
export function createAgentTrace(
  traceId: string,
  options: {
    name?: string
    userId?: string
    sessionId?: string  // Langfuse session ID (groups traces together, e.g., conversation ID)
    metadata?: Record<string, unknown>
    input?: string
    tags?: string[]
    release?: string
  }
): LangfuseTraceClient | null {
  const langfuse = getLangfuse()
  if (!langfuse) return null

  try {
    const trace = langfuse.trace({
      id: traceId,
      name: options.name || "Agent Session",
      userId: options.userId,
      sessionId: options.sessionId,  // This groups traces in Langfuse's Sessions view
      metadata: options.metadata,
      input: options.input,
      tags: options.tags,
      release: options.release,
    })
    activeTraces.set(traceId, trace)

    if (isDebugLLM()) {
      logLLM("[Langfuse] Created trace", {
        traceId,
        sessionId: options.sessionId,
        name: options.name,
        hasTags: !!options.tags?.length,
      })
    }

    return trace
  } catch (error) {
    console.error("[Langfuse] Failed to create trace:", error)
    return null
  }
}

/**
 * Get an existing trace by session ID
 */
export function getAgentTrace(sessionId: string): LangfuseTraceClient | null {
  return activeTraces.get(sessionId) || null
}

/**
 * End a trace with output
 */
export function endAgentTrace(
  sessionId: string,
  options: {
    output?: string
    metadata?: Record<string, unknown>
  }
): void {
  const trace = activeTraces.get(sessionId)
  if (!trace) return

  try {
    trace.update({
      output: options.output,
      metadata: options.metadata,
    })
    activeTraces.delete(sessionId)
  } catch (error) {
    console.error("[Langfuse] Failed to end trace:", error)
  }
}

/**
 * Create a span for a tool call
 */
export function createToolSpan(
  traceId: string,
  spanId: string,
  options: {
    name: string
    input?: Record<string, unknown>
    metadata?: Record<string, unknown>
  }
): LangfuseSpanClient | null {
  const trace = activeTraces.get(traceId)
  if (!trace) return null

  try {
    const span = trace.span({
      name: options.name,
      input: options.input,
      metadata: options.metadata,
    })
    activeSpans.set(spanId, span)
    return span
  } catch (error) {
    console.error("[Langfuse] Failed to create span:", error)
    return null
  }
}

/**
 * End a tool span with output
 */
export function endToolSpan(
  spanId: string,
  options: {
    output?: unknown
    metadata?: Record<string, unknown>
    level?: "DEBUG" | "DEFAULT" | "WARNING" | "ERROR"
    statusMessage?: string
  }
): void {
  const span = activeSpans.get(spanId)
  if (!span) return

  try {
    span.end({
      output: options.output,
      metadata: options.metadata,
      level: options.level,
      statusMessage: options.statusMessage,
    })
    activeSpans.delete(spanId)
  } catch (error) {
    console.error("[Langfuse] Failed to end span:", error)
  }
}

/**
 * Create a generation for an LLM call
 */
export function createLLMGeneration(
  traceId: string | null,
  generationId: string,
  options: {
    name: string
    model: string
    modelParameters?: Record<string, unknown>
    input: unknown
    metadata?: Record<string, unknown>
  }
): LangfuseGenerationClient | null {
  const langfuse = getLangfuse()
  if (!langfuse) return null

  try {
    // If we have a trace, create the generation under it
    const trace = traceId ? activeTraces.get(traceId) : null

    // Cast metadata to any to satisfy Langfuse's flexible type
    const generation = trace
      ? trace.generation({
          name: options.name,
          model: options.model,
          modelParameters: options.modelParameters as any,
          input: options.input,
          metadata: options.metadata as any,
        })
      : langfuse.generation({
          name: options.name,
          model: options.model,
          modelParameters: options.modelParameters as any,
          input: options.input,
          metadata: options.metadata as any,
        })

    activeGenerations.set(generationId, generation)
    return generation
  } catch (error) {
    console.error("[Langfuse] Failed to create generation:", error)
    return null
  }
}

/**
 * End an LLM generation with output and usage metrics
 */
export function endLLMGeneration(
  generationId: string,
  options: {
    output?: string
    usage?: {
      promptTokens?: number
      completionTokens?: number
      totalTokens?: number
    }
    metadata?: Record<string, unknown>
    level?: "DEBUG" | "DEFAULT" | "WARNING" | "ERROR"
    statusMessage?: string
  }
): void {
  const generation = activeGenerations.get(generationId)
  if (!generation) return

  try {
    generation.end({
      output: options.output,
      usage: options.usage,
      metadata: options.metadata,
      level: options.level,
      statusMessage: options.statusMessage,
    })
    activeGenerations.delete(generationId)
  } catch (error) {
    console.error("[Langfuse] Failed to end generation:", error)
  }
}

/**
 * Flush all pending events to Langfuse
 */
export async function flushLangfuse(): Promise<void> {
  const langfuse = getLangfuse()
  if (!langfuse) return

  try {
    await langfuse.flushAsync()
  } catch (error) {
    console.error("[Langfuse] Failed to flush:", error)
  }
}

/**
 * Shutdown Langfuse gracefully
 */
export async function shutdownLangfuse(): Promise<void> {
  if (langfuseInstance) {
    try {
      await langfuseInstance.shutdownAsync()
    } catch (error) {
      console.error("[Langfuse] Failed to shutdown:", error)
    }
    langfuseInstance = null
  }
  activeTraces.clear()
  activeSpans.clear()
  activeGenerations.clear()
}

