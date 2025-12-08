/**
 * MDAP Microagent
 * Executes single subtasks with minimal context and produces action + state outputs
 */

import { MDAPSubtask, MicroagentResult, MicroagentPrompt, MDAPConfig, DEFAULT_MDAP_CONFIG } from './types'
import { makeTextCompletionWithFetch } from '../llm-fetch'
import { configStore } from '../config'
import { logApp } from '../debug'
import { checkRedFlags } from './red-flag'

/**
 * System prompt for microagent execution
 * Designed to be minimal and focused on a single step
 */
const MICROAGENT_SYSTEM_PROMPT = `You are a focused microagent that performs exactly ONE step in a larger task.

YOUR ROLE:
- Execute ONLY the specific subtask described
- Use ONLY the provided current state as input
- Produce a clear action and resulting state
- Do NOT try to do more than asked
- Keep responses concise and focused

OUTPUT FORMAT:
Respond with a JSON object:
{
  "action": "Description of the action taken",
  "result": "The actual result/output of the action",
  "outputState": "The new state after this action (to be passed to next step)"
}

RULES:
1. ONLY perform the single subtask described
2. Do NOT anticipate or perform future steps
3. Be precise and deterministic
4. If the subtask is a calculation, show your work step by step
5. If you cannot complete the subtask, explain why in the action field`

/**
 * Creates a prompt for the microagent
 */
export function createMicroagentPrompt(
  subtask: MDAPSubtask,
  currentState: string
): MicroagentPrompt {
  const userPrompt = `CURRENT STATE:
${currentState}

SUBTASK TO PERFORM:
${subtask.description}

${subtask.expectedOutputFormat ? `EXPECTED OUTPUT FORMAT:\n${subtask.expectedOutputFormat}\n` : ''}

Execute this subtask and provide your response in the specified JSON format.`

  return {
    systemPrompt: MICROAGENT_SYSTEM_PROMPT,
    userPrompt,
    subtask,
    currentState,
  }
}

/**
 * Executes a single microagent call
 */
export async function executeMicroagent(
  subtask: MDAPSubtask,
  currentState: string,
  config: Partial<MDAPConfig> = {}
): Promise<MicroagentResult> {
  const fullConfig = { ...DEFAULT_MDAP_CONFIG, ...config }
  const appConfig = configStore.get()
  const startTime = Date.now()

  const prompt = createMicroagentPrompt(subtask, currentState)
  const fullPrompt = `${prompt.systemPrompt}\n\nUser: ${prompt.userPrompt}`

  try {
    const providerId = fullConfig.microagentModel || appConfig.mcpToolsProviderId || 'openai'
    const response = await makeTextCompletionWithFetch(fullPrompt, providerId)

    // Check for red flags
    const redFlagCheck = checkRedFlags(response, fullConfig)

    if (redFlagCheck.isRedFlagged) {
      logApp(`[MDAP Microagent] Red flag detected for subtask ${subtask.id}: ${redFlagCheck.reason}`)
      return {
        subtaskId: subtask.id,
        action: '',
        outputState: currentState, // Preserve state on failure
        rawResponse: response,
        timestamp: startTime,
        tokenCount: estimateTokenCount(response),
        isRedFlagged: true,
        redFlagReason: redFlagCheck.details || redFlagCheck.reason,
      }
    }

    // Parse the response
    const parsed = parseResponse(response, subtask, currentState)

    return {
      subtaskId: subtask.id,
      action: parsed.action,
      outputState: parsed.outputState,
      rawResponse: response,
      timestamp: startTime,
      tokenCount: estimateTokenCount(response),
      isRedFlagged: false,
    }
  } catch (error) {
    logApp(`[MDAP Microagent] Error executing subtask ${subtask.id}:`, error)
    return {
      subtaskId: subtask.id,
      action: `Error: ${error instanceof Error ? error.message : String(error)}`,
      outputState: currentState,
      rawResponse: '',
      timestamp: startTime,
      tokenCount: 0,
      isRedFlagged: true,
      redFlagReason: 'execution_error',
    }
  }
}

/**
 * Executes multiple microagent calls in parallel for voting
 */
export async function executeParallelMicroagents(
  subtask: MDAPSubtask,
  currentState: string,
  parallelCount: number,
  config: Partial<MDAPConfig> = {}
): Promise<MicroagentResult[]> {
  const promises = Array(parallelCount)
    .fill(null)
    .map(() => executeMicroagent(subtask, currentState, config))

  const results = await Promise.allSettled(promises)

  return results
    .filter((r): r is PromiseFulfilledResult<MicroagentResult> => r.status === 'fulfilled')
    .map(r => r.value)
}

/**
 * Parses the microagent response, extracting action and output state
 */
function parseResponse(
  response: string,
  subtask: MDAPSubtask,
  currentState: string
): { action: string; outputState: string } {
  // Try to parse as JSON first
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return {
        action: parsed.action || parsed.result || response,
        outputState: parsed.outputState || parsed.result || parsed.action || response,
      }
    }
  } catch {
    // JSON parsing failed, use heuristics
  }

  // Fallback: use the entire response as both action and state
  // Try to extract meaningful parts
  const lines = response.trim().split('\n')

  // Look for common patterns
  const actionLine = lines.find(l =>
    l.toLowerCase().includes('action:') ||
    l.toLowerCase().includes('result:')
  )
  const stateLine = lines.find(l =>
    l.toLowerCase().includes('state:') ||
    l.toLowerCase().includes('output:')
  )

  const action = actionLine
    ? actionLine.replace(/^(action|result):\s*/i, '').trim()
    : response.trim()

  const outputState = stateLine
    ? stateLine.replace(/^(state|output):\s*/i, '').trim()
    : action

  return { action, outputState }
}

/**
 * Estimates token count from response (rough approximation)
 */
function estimateTokenCount(text: string): number {
  // Rough approximation: ~4 characters per token
  return Math.ceil(text.length / 4)
}

/**
 * Normalizes a microagent action for comparison in voting
 * Removes formatting differences while preserving semantic meaning
 */
export function normalizeAction(action: string): string {
  return action
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?]+$/, '') // Remove trailing punctuation
    .replace(/^(the\s+)?(answer|result|output)\s*(is\s*)?:?\s*/i, '') // Remove common prefixes
}

/**
 * Compares two actions for semantic equality
 */
export function actionsAreEquivalent(action1: string, action2: string): boolean {
  const norm1 = normalizeAction(action1)
  const norm2 = normalizeAction(action2)

  // Exact match after normalization
  if (norm1 === norm2) {
    return true
  }

  // Check for numerical equivalence (e.g., "42" vs "42.0" vs "forty-two")
  const num1 = parseFloat(norm1)
  const num2 = parseFloat(norm2)
  if (!isNaN(num1) && !isNaN(num2) && num1 === num2) {
    return true
  }

  // Jaccard similarity for longer responses
  if (norm1.length > 20 && norm2.length > 20) {
    const words1 = new Set(norm1.split(/\s+/))
    const words2 = new Set(norm2.split(/\s+/))
    const intersection = new Set([...words1].filter(x => words2.has(x)))
    const union = new Set([...words1, ...words2])
    const similarity = union.size > 0 ? intersection.size / union.size : 0
    return similarity > 0.85 // 85% word overlap
  }

  return false
}
