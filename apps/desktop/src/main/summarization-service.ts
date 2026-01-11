/**
 * Summarization Service for Dual-Model Agent Mode
 * 
 * Uses a "weak" (cheaper/faster) model to summarize agent steps
 * for user-facing UI and memory extraction.
 */

import { generateText } from "ai"
import { createOpenAI } from "@ai-sdk/openai"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { configStore } from "./config"
import { logLLM, isDebugLLM } from "./debug"
import type { LanguageModel } from "ai"
import type { AgentStepSummary } from "../shared/types"

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

type ProviderType = "openai" | "groq" | "gemini"

/**
 * Get the weak model configuration from settings
 */
function getWeakModelConfig(): { providerId: ProviderType; model: string; apiKey: string; baseUrl?: string } | null {
  const config = configStore.get()
  
  if (!config.dualModelEnabled) {
    return null
  }
  
  const providerId = config.dualModelWeakProviderId
  if (!providerId) {
    return null
  }
  
  let model: string
  let apiKey: string
  let baseUrl: string | undefined
  
  switch (providerId) {
    case "openai":
      model = config.dualModelWeakOpenaiModel || "gpt-4o-mini"
      apiKey = config.openaiApiKey || ""
      baseUrl = config.openaiBaseUrl
      break
    case "groq":
      model = config.dualModelWeakGroqModel || "llama-3.1-8b-instant"
      apiKey = config.groqApiKey || ""
      baseUrl = config.groqBaseUrl || "https://api.groq.com/openai/v1"
      break
    case "gemini":
      model = config.dualModelWeakGeminiModel || "gemini-1.5-flash-002"
      apiKey = config.geminiApiKey || ""
      baseUrl = config.geminiBaseUrl
      break
    default:
      return null
  }
  
  if (!apiKey) {
    return null
  }
  
  return { providerId, model, apiKey, baseUrl }
}

/**
 * Create a language model instance for the weak model
 */
function createWeakModel(): LanguageModel | null {
  const modelConfig = getWeakModelConfig()
  if (!modelConfig) {
    return null
  }
  
  const { providerId, model, apiKey, baseUrl } = modelConfig
  
  if (isDebugLLM()) {
    logLLM(`[SummarizationService] Creating weak model: ${providerId}/${model}`)
  }
  
  switch (providerId) {
    case "openai":
    case "groq": {
      const openai = createOpenAI({
        apiKey,
        baseURL: baseUrl,
      })
      return openai.chat(model)
    }
    case "gemini": {
      const google = createGoogleGenerativeAI({
        apiKey,
        baseURL: baseUrl,
      })
      return google(model)
    }
    default:
      return null
  }
}

/**
 * Build the summarization prompt based on the step data
 */
function buildSummarizationPrompt(input: SummarizationInput): string {
  const config = configStore.get()
  const detailLevel = config.dualModelSummaryDetailLevel || "compact"
  
  let contextSection = ""
  
  if (input.agentThought) {
    contextSection += `\n## Agent Reasoning:\n${input.agentThought}\n`
  }
  
  if (input.toolCalls && input.toolCalls.length > 0) {
    contextSection += `\n## Tools Called:\n`
    for (const tc of input.toolCalls) {
      contextSection += `- ${tc.name}: ${JSON.stringify(tc.arguments).slice(0, 200)}...\n`
    }
  }
  
  if (input.toolResults && input.toolResults.length > 0) {
    contextSection += `\n## Tool Results:\n`
    for (const tr of input.toolResults) {
      const status = tr.success ? "✓" : "✗"
      const content = tr.content.slice(0, 500) + (tr.content.length > 500 ? "..." : "")
      contextSection += `- ${status} ${content}\n`
    }
  }
  
  if (input.assistantResponse) {
    contextSection += `\n## Agent Response:\n${input.assistantResponse.slice(0, 1000)}\n`
  }

  const formatInstructions = detailLevel === "compact"
    ? "Be extremely concise. Use 1-2 sentences per field."
    : "Provide detailed explanations for each field."

  return `You are summarizing a step in an AI agent's execution for a human user.

${formatInstructions}

Analyze this agent step and provide a structured summary:
${contextSection}

Respond in this exact JSON format:
{
  "actionSummary": "Brief description of what the agent did",
  "keyFindings": ["Finding 1", "Finding 2"],
  "nextSteps": "What the agent plans to do next (if apparent)",
  "decisionsMade": ["Decision 1"],
  "importance": "low|medium|high|critical"
}

Guidelines for importance:
- "low": Routine operations, simple queries
- "medium": Useful information gathered, normal progress
- "high": Important discoveries, significant decisions
- "critical": Security issues, errors, urgent findings

Respond ONLY with valid JSON, no other text.`
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
      actionSummary: parsed.actionSummary || "Agent executed a step",
      keyFindings: Array.isArray(parsed.keyFindings) ? parsed.keyFindings : [],
      nextSteps: parsed.nextSteps || undefined,
      decisionsMade: Array.isArray(parsed.decisionsMade) ? parsed.decisionsMade : undefined,
      importance: ["low", "medium", "high", "critical"].includes(parsed.importance)
        ? parsed.importance
        : "medium",
    }
  } catch (error) {
    // Fallback if parsing fails
    if (isDebugLLM()) {
      logLLM("[SummarizationService] Failed to parse summary response:", error)
    }

    return {
      id,
      sessionId: input.sessionId,
      stepNumber: input.stepNumber,
      timestamp: Date.now(),
      actionSummary: input.assistantResponse?.slice(0, 100) || "Agent step completed",
      keyFindings: [],
      importance: "medium",
    }
  }
}

/**
 * Check if summarization is enabled and configured
 */
export function isSummarizationEnabled(): boolean {
  const config = configStore.get()
  return config.dualModelEnabled === true && !!config.dualModelWeakProviderId
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

