/**
 * MDAP Service
 * Main orchestrator for Massively Decomposed Agentic Processes
 * Coordinates decomposition, microagent execution, voting, and progress reporting
 */

import {
  MDAPConfig,
  MDAPState,
  MDAPSubtask,
  DEFAULT_MDAP_CONFIG,
  VotingSession,
  isTaskSuitableForMDAP,
} from './types'
import { MDAPProgressUpdate } from '../../shared/types'
import { decomposeTask, validateDecomposition, estimateKThreshold, optimizeDecomposition } from './decomposer'
import { runParallelVoting, getVotingSummary } from './voting'
import { logApp } from '../debug'
import { agentSessionStateManager } from '../state'

/**
 * MDAP Session Manager
 * Tracks active MDAP sessions and provides coordination
 */
class MDAPSessionManager {
  private sessions: Map<string, MDAPState> = new Map()

  /**
   * Creates a new MDAP session
   */
  createSession(taskDescription: string): MDAPState {
    const sessionId = `mdap_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    const state: MDAPState = {
      sessionId,
      taskDescription,
      subtasks: [],
      currentSubtaskIndex: 0,
      completedSubtasks: 0,
      votingSessions: new Map(),
      stateChain: [],
      isComplete: false,
      startTime: Date.now(),
      totalLLMCalls: 0,
      totalRedFlags: 0,
      totalVotes: 0,
    }

    this.sessions.set(sessionId, state)
    return state
  }

  /**
   * Gets a session by ID
   */
  getSession(sessionId: string): MDAPState | undefined {
    return this.sessions.get(sessionId)
  }

  /**
   * Updates session state
   */
  updateSession(sessionId: string, updates: Partial<MDAPState>): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      Object.assign(session, updates)
    }
  }

  /**
   * Removes a completed session
   */
  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  /**
   * Gets all active sessions
   */
  getActiveSessions(): MDAPState[] {
    return Array.from(this.sessions.values()).filter(s => !s.isComplete)
  }
}

// Global session manager instance
const mdapSessionManager = new MDAPSessionManager()

/**
 * Creates progress update from current state
 * Returns a type compatible with the shared MDAPProgressUpdate interface
 */
function createProgressUpdate(state: MDAPState): MDAPProgressUpdate {
  const currentSubtask = state.subtasks[state.currentSubtaskIndex]
  const votingSession = currentSubtask
    ? state.votingSessions.get(currentSubtask.id)
    : undefined

  // Determine subtask status
  const getSubtaskStatus = (): 'pending' | 'voting' | 'completed' | 'failed' => {
    if (!votingSession) return 'pending'
    if (votingSession.isComplete) {
      return votingSession.winningResult ? 'completed' : 'failed'
    }
    return 'voting'
  }

  return {
    sessionId: state.sessionId,
    taskDescription: state.taskDescription,
    totalSubtasks: state.subtasks.length,
    completedSubtasks: state.completedSubtasks,
    currentSubtask: currentSubtask
      ? {
          index: currentSubtask.index,
          description: currentSubtask.description,
          status: getSubtaskStatus(),
          votingProgress: votingSession
            ? {
                leadingAnswer: votingSession.leadingAnswer
                  ? state.votingSessions.get(currentSubtask.id)?.votes.get(votingSession.leadingAnswer)?.answer?.substring(0, 50)
                  : undefined,
                leadMargin: votingSession.leadMargin,
                totalSamples: votingSession.totalSamples,
                targetMargin: 3, // k-threshold
                uniqueAnswers: votingSession.votes.size,
              }
            : undefined,
          winningAnswer: votingSession?.winningResult?.action,
        }
      : undefined,
    stateChain: state.stateChain,
    isComplete: state.isComplete,
    finalResult: state.finalResult,
    error: state.error,
    statistics: {
      totalLLMCalls: state.totalLLMCalls,
      totalRedFlags: state.totalRedFlags,
      totalVotes: state.totalVotes,
      elapsedMs: Date.now() - state.startTime,
    },
  }
}

/**
 * Main MDAP execution function
 * Decomposes a task and executes it step by step with voting
 */
export async function executeMDAP(
  task: string,
  config: Partial<MDAPConfig> = {},
  onProgress?: (update: MDAPProgressUpdate) => void,
  agentSessionId?: string // For integration with agent session tracker
): Promise<{
  success: boolean
  result?: string
  state: MDAPState
}> {
  const fullConfig = { ...DEFAULT_MDAP_CONFIG, ...config }

  // Create MDAP session
  const state = mdapSessionManager.createSession(task)
  logApp(`[MDAP Service] Starting MDAP session ${state.sessionId} for task: ${task.substring(0, 100)}...`)

  // Helper to emit progress
  const emitProgress = () => {
    if (onProgress) {
      onProgress(createProgressUpdate(state))
    }
  }

  // Helper to check for stop signal
  const shouldStop = () => {
    if (agentSessionId) {
      return agentSessionStateManager.shouldStopSession(agentSessionId)
    }
    return false
  }

  try {
    // Step 1: Check task suitability
    const suitability = isTaskSuitableForMDAP(task)
    logApp(`[MDAP Service] Task suitability: ${suitability.suitable} - ${suitability.reason}`)

    // Step 2: Decompose task
    logApp(`[MDAP Service] Decomposing task...`)
    const decomposition = await decomposeTask(task, fullConfig)

    // Validate decomposition
    const validation = validateDecomposition(decomposition)
    if (!validation.valid) {
      logApp(`[MDAP Service] Invalid decomposition: ${validation.issues.join(', ')}`)
      state.error = `Decomposition failed: ${validation.issues.join(', ')}`
      state.isComplete = true
      emitProgress()
      return { success: false, state }
    }

    // Optimize decomposition (merge too-small subtasks)
    const optimizedSubtasks = optimizeDecomposition(decomposition.subtasks)
    state.subtasks = optimizedSubtasks
    logApp(`[MDAP Service] Decomposed into ${optimizedSubtasks.length} subtasks`)

    // Estimate k-threshold based on task complexity
    const kThreshold = fullConfig.kThreshold || estimateKThreshold(optimizedSubtasks.length)
    logApp(`[MDAP Service] Using k-threshold: ${kThreshold}`)

    // Initialize state chain with initial state
    state.stateChain.push(decomposition.initialState)
    emitProgress()

    // Step 3: Execute subtasks with voting
    for (let i = 0; i < state.subtasks.length; i++) {
      // Check for stop signal
      if (shouldStop()) {
        logApp(`[MDAP Service] Session ${state.sessionId} stopped by kill switch`)
        state.error = 'Stopped by user'
        state.isComplete = true
        emitProgress()
        return { success: false, state }
      }

      const subtask = state.subtasks[i]
      state.currentSubtaskIndex = i
      emitProgress()

      logApp(`[MDAP Service] Executing subtask ${i + 1}/${state.subtasks.length}: ${subtask.description.substring(0, 50)}...`)

      // Get current state for this subtask
      const currentState = state.stateChain[state.stateChain.length - 1]

      // Run voting for this subtask
      const votingResult = await runParallelVoting(
        subtask,
        currentState,
        { ...fullConfig, kThreshold },
        (session) => {
          state.votingSessions.set(subtask.id, session)
          state.totalVotes = session.totalSamples
          state.totalLLMCalls += 1
          if (session.totalSamples > 0) {
            const lastResult = Array.from(session.votes.values())
              .flatMap(v => v.results)
              .find(r => r.isRedFlagged)
            if (lastResult) {
              state.totalRedFlags++
            }
          }
          emitProgress()
        }
      )

      state.votingSessions.set(subtask.id, votingResult.session)

      if (!votingResult.success || !votingResult.winner) {
        logApp(`[MDAP Service] Voting failed for subtask ${i + 1}`)

        // Try to continue with best available answer
        if (votingResult.winner) {
          logApp(`[MDAP Service] Using best available answer despite low confidence`)
          state.stateChain.push(votingResult.winner.outputState)
          state.completedSubtasks++
        } else {
          state.error = `Voting failed for subtask ${i + 1}: No consensus reached`
          state.isComplete = true
          emitProgress()
          return { success: false, state }
        }
      } else {
        // Success - advance state
        state.stateChain.push(votingResult.winner.outputState)
        state.completedSubtasks++
        logApp(`[MDAP Service] Subtask ${i + 1} completed: ${votingResult.winner.action.substring(0, 50)}...`)
      }

      emitProgress()
    }

    // Step 4: Generate final result
    state.isComplete = true
    state.endTime = Date.now()
    state.finalResult = state.stateChain[state.stateChain.length - 1]

    logApp(`[MDAP Service] MDAP completed successfully in ${state.endTime - state.startTime}ms`)
    logApp(`[MDAP Service] Statistics: ${state.totalLLMCalls} LLM calls, ${state.totalVotes} votes, ${state.totalRedFlags} red flags`)

    emitProgress()

    return {
      success: true,
      result: state.finalResult,
      state,
    }
  } catch (error) {
    logApp(`[MDAP Service] Error executing MDAP:`, error)
    state.error = error instanceof Error ? error.message : String(error)
    state.isComplete = true
    state.endTime = Date.now()
    emitProgress()

    return { success: false, state }
  } finally {
    // Cleanup session after some delay to allow UI to show final state
    setTimeout(() => {
      mdapSessionManager.removeSession(state.sessionId)
    }, 60000) // Keep for 1 minute
  }
}

/**
 * Checks if MDAP mode should be used for a given task
 */
export function shouldUseMDAP(
  task: string,
  config: Partial<MDAPConfig> = {}
): { recommended: boolean; reason: string } {
  // Check task suitability
  const suitability = isTaskSuitableForMDAP(task)

  if (!suitability.suitable) {
    return { recommended: false, reason: suitability.reason || 'Task not suitable for MDAP' }
  }

  // Check task length (very short tasks don't benefit)
  if (task.split(/\s+/).length < 5) {
    return { recommended: false, reason: 'Task too simple for MDAP decomposition' }
  }

  // Check for explicit step indicators
  if (/step\s*by\s*step|multiple\s*steps/i.test(task)) {
    return { recommended: true, reason: 'Task explicitly requests step-by-step execution' }
  }

  return {
    recommended: suitability.suitable,
    reason: suitability.reason || 'Task may benefit from MDAP decomposition',
  }
}

/**
 * Gets the current state of an MDAP session
 */
export function getMDAPSessionState(sessionId: string): MDAPState | undefined {
  return mdapSessionManager.getSession(sessionId)
}

/**
 * Gets all active MDAP sessions
 */
export function getActiveMDAPSessions(): MDAPState[] {
  return mdapSessionManager.getActiveSessions()
}

/**
 * Stops an MDAP session
 */
export function stopMDAPSession(sessionId: string): boolean {
  const session = mdapSessionManager.getSession(sessionId)
  if (session) {
    session.error = 'Stopped by user'
    session.isComplete = true
    session.endTime = Date.now()
    return true
  }
  return false
}

// Export session manager for advanced usage
export { mdapSessionManager }
