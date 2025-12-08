/**
 * MDAP Voting System
 * Implements the First-to-ahead-by-k voting mechanism from the MAKER framework
 * Multiple agents attempt the same subtask, and answers compete until consensus
 */

import {
  MDAPSubtask,
  MicroagentResult,
  Vote,
  VotingSession,
  MDAPConfig,
  DEFAULT_MDAP_CONFIG,
  hashAnswer,
} from './types'
import { executeMicroagent, normalizeAction, actionsAreEquivalent } from './microagent'
import { shouldRetry, scoreResponseQuality, detectCorrelatedErrors } from './red-flag'
import { logApp } from '../debug'

/**
 * Creates a new voting session for a subtask
 */
export function createVotingSession(subtaskId: string): VotingSession {
  return {
    subtaskId,
    votes: new Map(),
    leadMargin: 0,
    totalSamples: 0,
    isComplete: false,
  }
}

/**
 * Adds a result to the voting session
 * Returns true if the vote was counted, false if it was red-flagged
 */
export function addVote(
  session: VotingSession,
  result: MicroagentResult
): boolean {
  session.totalSamples++

  // Red-flagged responses don't get votes
  if (result.isRedFlagged) {
    logApp(`[MDAP Voting] Red-flagged response discarded for subtask ${session.subtaskId}`)
    return false
  }

  // Normalize and hash the action for comparison
  const normalizedAction = normalizeAction(result.action)
  const actionHash = hashAnswer(normalizedAction)

  // Check if this answer matches any existing vote (allowing for minor variations)
  let matchingHash: string | null = null
  for (const [existingHash, vote] of session.votes) {
    if (actionsAreEquivalent(vote.answer, result.action)) {
      matchingHash = existingHash
      break
    }
  }

  if (matchingHash) {
    // Add to existing vote
    const existingVote = session.votes.get(matchingHash)!
    existingVote.voteCount++
    existingVote.results.push(result)
    // Use the highest quality response's state
    const bestResult = existingVote.results.reduce((best, curr) =>
      scoreResponseQuality(curr.rawResponse) > scoreResponseQuality(best.rawResponse) ? curr : best
    )
    existingVote.state = bestResult.outputState
  } else {
    // Create new vote
    const newVote: Vote = {
      subtaskId: session.subtaskId,
      answer: result.action,
      state: result.outputState,
      voteCount: 1,
      results: [result],
    }
    session.votes.set(actionHash, newVote)
  }

  // Update leading answer
  updateLeadingAnswer(session)

  return true
}

/**
 * Updates the leading answer and margin in a voting session
 */
function updateLeadingAnswer(session: VotingSession): void {
  let maxVotes = 0
  let secondMaxVotes = 0
  let leadingHash: string | undefined

  for (const [hash, vote] of session.votes) {
    if (vote.voteCount > maxVotes) {
      secondMaxVotes = maxVotes
      maxVotes = vote.voteCount
      leadingHash = hash
    } else if (vote.voteCount > secondMaxVotes) {
      secondMaxVotes = vote.voteCount
    }
  }

  session.leadingAnswer = leadingHash
  session.leadMargin = maxVotes - secondMaxVotes
}

/**
 * Checks if voting is complete (leading answer has k-vote lead)
 */
export function isVotingComplete(
  session: VotingSession,
  kThreshold: number
): boolean {
  return session.leadMargin >= kThreshold
}

/**
 * Gets the winning result from a completed voting session
 */
export function getWinningResult(session: VotingSession): MicroagentResult | undefined {
  if (!session.leadingAnswer) {
    return undefined
  }

  const winningVote = session.votes.get(session.leadingAnswer)
  if (!winningVote) {
    return undefined
  }

  // Return the highest quality result from the winning vote
  return winningVote.results.reduce((best, curr) =>
    scoreResponseQuality(curr.rawResponse) > scoreResponseQuality(best.rawResponse) ? curr : best
  )
}

/**
 * Main voting function: runs the First-to-ahead-by-k algorithm
 * Samples votes until one answer achieves a k-vote lead
 */
export async function runVoting(
  subtask: MDAPSubtask,
  currentState: string,
  config: Partial<MDAPConfig> = {},
  onProgress?: (session: VotingSession) => void
): Promise<{
  session: VotingSession
  winner: MicroagentResult | undefined
  success: boolean
}> {
  const fullConfig = { ...DEFAULT_MDAP_CONFIG, ...config }
  const session = createVotingSession(subtask.id)

  let consecutiveRedFlags = 0
  const maxConsecutiveRedFlags = 5 // Give up if we keep hitting red flags

  while (
    !isVotingComplete(session, fullConfig.kThreshold) &&
    session.totalSamples < fullConfig.maxSamplesPerSubtask
  ) {
    // Execute microagent
    const result = await executeMicroagent(subtask, currentState, config)

    // Check for retry
    let finalResult = result
    let retryCount = 0
    while (
      finalResult.isRedFlagged &&
      shouldRetry({ isRedFlagged: true, reason: finalResult.redFlagReason as any }, retryCount)
    ) {
      retryCount++
      logApp(`[MDAP Voting] Retrying subtask ${subtask.id} (attempt ${retryCount + 1})`)
      finalResult = await executeMicroagent(subtask, currentState, config)
    }

    // Add vote
    const voteCounted = addVote(session, finalResult)

    if (!voteCounted) {
      consecutiveRedFlags++
      if (consecutiveRedFlags >= maxConsecutiveRedFlags) {
        logApp(`[MDAP Voting] Too many consecutive red flags for subtask ${subtask.id}`)
        break
      }
    } else {
      consecutiveRedFlags = 0
    }

    // Emit progress
    if (onProgress) {
      onProgress(session)
    }

    // Check for correlated errors
    const allResults = Array.from(session.votes.values())
      .flatMap(v => v.results)
      .map(r => ({ response: r.rawResponse, isRedFlagged: r.isRedFlagged }))

    const correlationCheck = detectCorrelatedErrors(allResults)
    if (correlationCheck.hasCorrelatedErrors) {
      logApp(`[MDAP Voting] Correlated errors detected: ${correlationCheck.correlationType}`)
      // Continue but log the issue
    }
  }

  // Mark complete and get winner
  session.isComplete = true

  if (isVotingComplete(session, fullConfig.kThreshold)) {
    const winner = getWinningResult(session)
    session.winningResult = winner
    return { session, winner, success: true }
  }

  // No clear winner - use the leading answer if there is one
  if (session.leadingAnswer) {
    const winner = getWinningResult(session)
    session.winningResult = winner
    logApp(`[MDAP Voting] No k-threshold winner, using leading answer with margin ${session.leadMargin}`)
    return { session, winner, success: session.leadMargin > 0 }
  }

  return { session, winner: undefined, success: false }
}

/**
 * Runs parallel voting with multiple concurrent microagent calls
 * More efficient for high-latency LLM calls
 */
export async function runParallelVoting(
  subtask: MDAPSubtask,
  currentState: string,
  config: Partial<MDAPConfig> = {},
  onProgress?: (session: VotingSession) => void
): Promise<{
  session: VotingSession
  winner: MicroagentResult | undefined
  success: boolean
}> {
  const fullConfig = { ...DEFAULT_MDAP_CONFIG, ...config }
  const session = createVotingSession(subtask.id)

  // Run batches of parallel calls
  const batchSize = fullConfig.parallelMicroagents

  while (
    !isVotingComplete(session, fullConfig.kThreshold) &&
    session.totalSamples < fullConfig.maxSamplesPerSubtask
  ) {
    // Calculate remaining samples needed
    const remainingSamples = fullConfig.maxSamplesPerSubtask - session.totalSamples
    const currentBatchSize = Math.min(batchSize, remainingSamples)

    // Execute batch in parallel
    const batchPromises = Array(currentBatchSize)
      .fill(null)
      .map(() => executeMicroagent(subtask, currentState, config))

    const results = await Promise.all(batchPromises)

    // Add all results to voting
    for (const result of results) {
      addVote(session, result)
    }

    // Emit progress
    if (onProgress) {
      onProgress(session)
    }

    // Early exit if we have a clear winner
    if (isVotingComplete(session, fullConfig.kThreshold)) {
      break
    }
  }

  // Mark complete and get winner
  session.isComplete = true

  if (isVotingComplete(session, fullConfig.kThreshold)) {
    const winner = getWinningResult(session)
    session.winningResult = winner
    return { session, winner, success: true }
  }

  // Use leading answer if available
  if (session.leadingAnswer) {
    const winner = getWinningResult(session)
    session.winningResult = winner
    return { session, winner, success: session.leadMargin > 0 }
  }

  return { session, winner: undefined, success: false }
}

/**
 * Calculates the theoretical probability of correct answer given per-step accuracy
 * p(aᵢ=a*) = 1/(1+((1-p)/p)^k)
 */
export function calculateWinProbability(
  perStepAccuracy: number,
  kThreshold: number
): number {
  const p = perStepAccuracy
  const k = kThreshold
  const odds = Math.pow((1 - p) / p, k)
  return 1 / (1 + odds)
}

/**
 * Estimates the expected number of samples needed to reach k-threshold
 */
export function estimateExpectedSamples(
  perStepAccuracy: number,
  kThreshold: number
): number {
  // Rough estimate based on MAKER paper analysis
  // Expected samples ≈ k * (1/p + 1/(1-p)) for binary case
  // For multiple answers, this is more complex
  const p = perStepAccuracy
  if (p <= 0.5) {
    return Infinity // Unlikely to converge
  }
  return Math.ceil(kThreshold * 2 / (2 * p - 1))
}

/**
 * Gets a summary of the voting session for debugging/UI
 */
export function getVotingSummary(session: VotingSession): {
  totalVotes: number
  uniqueAnswers: number
  leadingMargin: number
  votes: Array<{ answer: string; count: number }>
} {
  const votes = Array.from(session.votes.values())
    .map(v => ({
      answer: v.answer.substring(0, 100) + (v.answer.length > 100 ? '...' : ''),
      count: v.voteCount,
    }))
    .sort((a, b) => b.count - a.count)

  return {
    totalVotes: session.totalSamples,
    uniqueAnswers: session.votes.size,
    leadingMargin: session.leadMargin,
    votes,
  }
}
