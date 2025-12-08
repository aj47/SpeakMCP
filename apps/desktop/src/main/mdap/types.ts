/**
 * MDAP (Massively Decomposed Agentic Processes) Types
 * Based on the MAKER framework from "Solving a Million-Step LLM Task with Zero Errors"
 */

/**
 * A single subtask in the decomposed task chain
 */
export interface MDAPSubtask {
  id: string
  index: number
  description: string
  inputState: string
  expectedOutputFormat?: string
  dependencies?: string[] // IDs of subtasks this one depends on
}

/**
 * Result from a microagent execution
 */
export interface MicroagentResult {
  subtaskId: string
  action: string
  outputState: string
  rawResponse: string
  timestamp: number
  tokenCount?: number
  isRedFlagged: boolean
  redFlagReason?: string
}

/**
 * A vote for a particular answer
 */
export interface Vote {
  subtaskId: string
  answer: string // The action taken
  state: string // The resulting state
  voteCount: number
  results: MicroagentResult[]
}

/**
 * Voting session state
 */
export interface VotingSession {
  subtaskId: string
  votes: Map<string, Vote> // Key is hash of answer
  leadingAnswer?: string
  leadMargin: number
  totalSamples: number
  isComplete: boolean
  winningResult?: MicroagentResult
}

/**
 * Red-flag detection result
 */
export interface RedFlagResult {
  isRedFlagged: boolean
  reason?: 'response_too_long' | 'format_violation' | 'hallucination_detected' | 'repetition_detected'
  details?: string
}

/**
 * MDAP execution configuration
 */
export interface MDAPConfig {
  // Voting configuration
  kThreshold: number // Minimum lead required to win (default: 3)
  maxSamplesPerSubtask: number // Maximum samples before giving up (default: 20)

  // Red-flagging thresholds
  maxResponseTokens: number // Responses longer than this are flagged (default: 700)
  enableFormatValidation: boolean // Check for format violations

  // Decomposition settings
  maxSubtasks: number // Maximum subtasks to decompose into (default: 100)
  decompositionModel?: string // Model to use for decomposition

  // Execution settings
  parallelMicroagents: number // Number of parallel microagent calls (default: 3)
  microagentModel?: string // Model to use for microagents (smaller is often better)

  // Debug settings
  enableDebugLogging: boolean
  saveIntermediateResults: boolean
}

/**
 * Default MDAP configuration
 */
export const DEFAULT_MDAP_CONFIG: MDAPConfig = {
  kThreshold: 3,
  maxSamplesPerSubtask: 20,
  maxResponseTokens: 700,
  enableFormatValidation: true,
  maxSubtasks: 100,
  parallelMicroagents: 3,
  enableDebugLogging: false,
  saveIntermediateResults: false,
}

/**
 * MDAP execution state
 */
export interface MDAPState {
  sessionId: string
  taskDescription: string
  subtasks: MDAPSubtask[]
  currentSubtaskIndex: number
  completedSubtasks: number
  votingSessions: Map<string, VotingSession>
  stateChain: string[] // Chain of states from each completed subtask
  isComplete: boolean
  finalResult?: string
  error?: string
  startTime: number
  endTime?: number

  // Statistics
  totalLLMCalls: number
  totalRedFlags: number
  totalVotes: number
}

// MDAPProgressUpdate is defined in shared/types.ts for UI compatibility
// Re-export from there for backwards compatibility
export type { MDAPProgressUpdate, MDAPVotingProgress, MDAPSubtaskProgress } from '../../shared/types'

/**
 * Decomposition result from the task analyzer
 */
export interface DecompositionResult {
  originalTask: string
  subtasks: MDAPSubtask[]
  initialState: string
  estimatedComplexity: 'simple' | 'moderate' | 'complex'
  suggestedKThreshold: number
}

/**
 * Microagent prompt template
 */
export interface MicroagentPrompt {
  systemPrompt: string
  userPrompt: string
  subtask: MDAPSubtask
  currentState: string
}

/**
 * Hash function for vote deduplication
 * Creates a stable hash of an answer for voting
 */
export function hashAnswer(answer: string): string {
  // Simple hash function for answer comparison
  // Normalize whitespace and case for comparison
  const normalized = answer.trim().toLowerCase().replace(/\s+/g, ' ')

  // FNV-1a hash
  let hash = 2166136261
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }

  return (hash >>> 0).toString(16)
}

/**
 * Check if a task is suitable for MDAP decomposition
 */
export function isTaskSuitableForMDAP(task: string): {
  suitable: boolean
  reason?: string
} {
  const lowerTask = task.toLowerCase()

  // Tasks that benefit from MDAP
  const mdapPatterns = [
    /calculate|compute|math|arithmetic/i,
    /step\s*by\s*step/i,
    /sequence|series|chain/i,
    /multiple\s*(steps|operations|tasks)/i,
    /process\s*(each|all|every)/i,
    /transform|convert|translate/i,
    /parse|analyze|extract/i,
    /generate\s*(list|items|entries)/i,
  ]

  // Tasks that don't benefit from MDAP
  const nonMdapPatterns = [
    /what\s+is|explain|describe/i, // Simple questions
    /help\s+me\s+understand/i, // Explanations
    /opinion|think|feel/i, // Subjective
  ]

  for (const pattern of nonMdapPatterns) {
    if (pattern.test(lowerTask)) {
      return {
        suitable: false,
        reason: 'Task appears to be a simple question or subjective request'
      }
    }
  }

  for (const pattern of mdapPatterns) {
    if (pattern.test(lowerTask)) {
      return {
        suitable: true,
        reason: 'Task involves multiple steps that can be decomposed'
      }
    }
  }

  // Default: let the system try decomposition
  return {
    suitable: true,
    reason: 'Task may benefit from decomposition'
  }
}
