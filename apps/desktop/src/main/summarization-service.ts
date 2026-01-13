/**
 * Summarization Service for Dual-Model Agent Mode
 *
 * Uses a "weak" (cheaper/faster) model to summarize agent steps
 * for user-facing UI and memory extraction.
 */

import { generateText } from "ai"
import { createOpenAI } from "@ai-sdk/openai"
import { configStore } from "./config"
import { logLLM, isDebugLLM } from "./debug"
import { getBuiltInModelPresets, DEFAULT_MODEL_PRESET_ID } from "../shared/index"
import type { LanguageModel } from "ai"
import type { AgentStepSummary, ModelPreset } from "../shared/types"

export interface SummarizationInput {
  sessionId: string
  stepNumber: number

  // Context about what happened
  agentThought?: string          // Agent's reasoning/thinking
  toolCalls?: Array<{
    name: string
    arguments: any
  }>
  toolResults?: Array<{
    success: boolean
    content: string
    error?: string
  }>
  assistantResponse?: string     // Final response text from agent

  // Full conversation context (last few messages for context)
  recentMessages?: Array<{
    role: "user" | "assistant" | "tool"
    content: string
  }>
}

/**
 * Get a preset by ID, merging built-in presets with saved data
 */
function getPresetById(presetId: string): ModelPreset | undefined {
  const config = configStore.get()
  const builtIn = getBuiltInModelPresets()
  const savedPresets = config.modelPresets || []

  // Merge built-in presets with saved properties
  const allPresets = builtIn.map(preset => {
    const saved = savedPresets.find(s => s.id === preset.id)
    return saved ? { ...preset, ...Object.fromEntries(Object.entries(saved).filter(([_, v]) => v !== undefined)) } : preset
  })

  // Add custom presets
  const customPresets = savedPresets.filter(p => !p.isBuiltIn)
  allPresets.push(...customPresets)

  return allPresets.find(p => p.id === presetId)
}

/**
 * Get the weak model configuration from settings using presets
 */
function getWeakModelConfig(): { model: string; apiKey: string; baseUrl: string } | null {
  const config = configStore.get()

  if (!config.dualModelEnabled) {
    return null
  }

  // Get preset ID - fall back to current model preset if not set
  const presetId = config.dualModelWeakPresetId || config.currentModelPresetId || DEFAULT_MODEL_PRESET_ID
  const preset = getPresetById(presetId)

  if (!preset || !preset.apiKey) {
    return null
  }

  // Get model name - fall back to a default if not set
  const model = config.dualModelWeakModelName || preset.mcpToolsModel || "gpt-4o-mini"

  return {
    model,
    apiKey: preset.apiKey,
    baseUrl: preset.baseUrl,
  }
}

/**
 * Create a language model instance for the weak model
 */
function createWeakModel(): LanguageModel | null {
  const modelConfig = getWeakModelConfig()
  if (!modelConfig) {
    return null
  }

  const { model, apiKey, baseUrl } = modelConfig

  if (isDebugLLM()) {
    logLLM(`[SummarizationService] Creating weak model: ${model} at ${baseUrl}`)
  }

  // All presets use OpenAI-compatible API
  const openai = createOpenAI({
    apiKey,
    baseURL: baseUrl,
  })
  return openai.chat(model)
}

/**
 * Build the summarization prompt based on the step data
 */
function buildSummarizationPrompt(input: SummarizationInput): string {
  let contextSection = ""

  if (input.agentThought) {
    contextSection += `Reasoning: ${input.agentThought.slice(0, 300)}\n`
  }

  if (input.toolCalls && input.toolCalls.length > 0) {
    contextSection += `Tools: ${input.toolCalls.map(tc => tc.name).join(", ")}\n`
  }

  if (input.toolResults && input.toolResults.length > 0) {
    const results = input.toolResults.map(tr => tr.success ? "ok" : "fail").join(",")
    contextSection += `Results: ${results}\n`
  }

  if (input.assistantResponse) {
    contextSection += `Response: ${input.assistantResponse.slice(0, 500)}\n`
  }

  return `Extract key info as ONE ultra-compact line.
${contextSection}
Output JSON:
{
  "actionSummary": "single line max 80 chars, skip grammar, just key facts",
  "importance": "low|medium|high|critical"
}

Examples of good actionSummary:
- "user prefers dark mode"
- "api key in .env not env vars"
- "uses pnpm, hates npm"
- "auth fails when token expired"

importance: low=routine, medium=useful, high=discovery, critical=error

JSON only:`
}

/**
 * Parse the LLM response into a structured summary
 */
function parseSummaryResponse(response: string, input: SummarizationInput): AgentStepSummary {
  const id = `summary_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

  try {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error("No JSON found in response")
    }

    const parsed = JSON.parse(jsonMatch[0])

    return {
      id,
      sessionId: input.sessionId,
      stepNumber: input.stepNumber,
      timestamp: Date.now(),
      actionSummary: String(parsed.actionSummary || "step done").slice(0, 80),
      importance: ["low", "medium", "high", "critical"].includes(parsed.importance)
        ? parsed.importance
        : "medium",
    }
  } catch (error) {
    if (isDebugLLM()) {
      logLLM("[SummarizationService] Failed to parse summary response:", error)
    }

    return {
      id,
      sessionId: input.sessionId,
      stepNumber: input.stepNumber,
      timestamp: Date.now(),
      actionSummary: input.assistantResponse?.slice(0, 80) || "step done",
      importance: "medium",
    }
  }
}

/**
 * Check if summarization is enabled and configured
 */
export function isSummarizationEnabled(): boolean {
  const config = configStore.get()
  // Check if dual model is enabled and we have a valid weak model preset
  const presetId = config.dualModelWeakPresetId || config.currentModelPresetId || DEFAULT_MODEL_PRESET_ID
  const preset = getPresetById(presetId)
  return config.dualModelEnabled === true && !!preset && !!preset.apiKey
}

/**
 * Check if we should summarize this step based on frequency settings
 */
export function shouldSummarizeStep(
  hasToolCalls: boolean,
  isCompletion: boolean
): boolean {
  const config = configStore.get()

  if (!isSummarizationEnabled()) {
    return false
  }

  const frequency = config.dualModelSummarizationFrequency || "every_response"

  if (frequency === "every_response") {
    return true
  }

  // major_steps_only: summarize when there are tool calls or at completion
  return hasToolCalls || isCompletion
}

/**
 * Generate a summary for an agent step using the weak model
 */
export async function summarizeAgentStep(
  input: SummarizationInput
): Promise<AgentStepSummary | null> {
  if (!isSummarizationEnabled()) {
    return null
  }

  const model = createWeakModel()
  if (!model) {
    if (isDebugLLM()) {
      logLLM("[SummarizationService] Weak model not configured, skipping summarization")
    }
    return null
  }

  const prompt = buildSummarizationPrompt(input)

  try {
    if (isDebugLLM()) {
      logLLM("[SummarizationService] Generating summary for step", input.stepNumber)
    }

    const result = await generateText({
      model,
      prompt,
    })

    const summary = parseSummaryResponse(result.text || "", input)

    if (isDebugLLM()) {
      logLLM("[SummarizationService] Generated summary:", summary)
    }

    return summary
  } catch (error) {
    if (isDebugLLM()) {
      logLLM("[SummarizationService] Error generating summary:", error)
    }
    return null
  }
}

/**
 * Summarization service singleton
 */
class SummarizationService {
  private summariesBySession: Map<string, AgentStepSummary[]> = new Map()

  /**
   * Add a summary to the session's collection
   */
  addSummary(summary: AgentStepSummary): void {
    const existing = this.summariesBySession.get(summary.sessionId) || []
    existing.push(summary)
    this.summariesBySession.set(summary.sessionId, existing)
  }

  /**
   * Get all summaries for a session
   */
  getSummaries(sessionId: string): AgentStepSummary[] {
    return this.summariesBySession.get(sessionId) || []
  }

  /**
   * Get the latest summary for a session
   */
  getLatestSummary(sessionId: string): AgentStepSummary | undefined {
    const summaries = this.getSummaries(sessionId)
    return summaries[summaries.length - 1]
  }

  /**
   * Clear summaries for a session
   */
  clearSession(sessionId: string): void {
    this.summariesBySession.delete(sessionId)
  }

  /**
   * Get high-importance summaries that should be saved
   */
  getImportantSummaries(sessionId: string): AgentStepSummary[] {
    return this.getSummaries(sessionId).filter(
      s => s.importance === "high" || s.importance === "critical"
    )
  }
}

export const summarizationService = new SummarizationService()

