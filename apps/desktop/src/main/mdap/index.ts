/**
 * MDAP (Massively Decomposed Agentic Processes) Module
 *
 * Implementation of the MAKER framework from the paper:
 * "Solving a Million-Step LLM Task with Zero Errors"
 *
 * Key components:
 * - Task Decomposition (MAD - Maximal Agentic Decomposition)
 * - Microagent Execution
 * - First-to-ahead-by-k Voting
 * - Red-flagging for error detection
 */

// Types
export * from './types'

// Decomposition
export {
  decomposeTask,
  validateDecomposition,
  estimateKThreshold,
  recursiveDecompose,
  optimizeDecomposition,
} from './decomposer'

// Microagent execution
export {
  createMicroagentPrompt,
  executeMicroagent,
  executeParallelMicroagents,
  normalizeAction,
  actionsAreEquivalent,
} from './microagent'

// Voting system
export {
  createVotingSession,
  addVote,
  isVotingComplete,
  getWinningResult,
  runVoting,
  runParallelVoting,
  calculateWinProbability,
  estimateExpectedSamples,
  getVotingSummary,
} from './voting'

// Red-flagging
export {
  checkRedFlags,
  detectCorrelatedErrors,
  scoreResponseQuality,
  shouldRetry,
} from './red-flag'

// Main service
export {
  executeMDAP,
  shouldUseMDAP,
  getMDAPSessionState,
  getActiveMDAPSessions,
  stopMDAPSession,
  mdapSessionManager,
} from './service'
