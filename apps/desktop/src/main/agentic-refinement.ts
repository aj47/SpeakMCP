/**
 * Agentic Refinement System
 *
 * Inspired by Poetiq's agentic processes, this module implements:
 * - Iterative solution refinement with feedback loops
 * - Adaptive task type detection and strategy selection
 * - Progress quality tracking and stagnation detection
 * - Intelligent early stopping for unproductive paths
 * - Rich feedback analysis for better decision-making
 *
 * Key Poetiq Insights Applied:
 * 1. "The prompt is an interface, not the intelligence" - The system iteratively refines
 * 2. Generate → Execute → Feedback → Analyze → Refine loop
 * 3. Self-auditing for success with autonomous progress monitoring
 * 4. Adaptive problem-solving with dynamic strategy selection
 * 5. Cost optimization through intelligent early stopping
 */

import { MCPToolResult, MCPToolCall } from "./mcp-service"
import { isDebugLLM, logLLM } from "./debug"

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

/**
 * Represents a strategy for solving a particular type of task
 */
export interface TaskStrategy {
  name: string
  description: string
  /** Keywords that indicate this strategy applies */
  keywords: string[]
  /** Tool name patterns that work well with this strategy */
  preferredToolPatterns: string[]
  /** Maximum iterations before switching strategy */
  maxIterations: number
  /** Whether this strategy benefits from parallel tool execution */
  supportsParallel: boolean
  /** Prompt augmentation for this strategy */
  promptAugmentation: string
}

/**
 * Result of analyzing feedback from tool execution
 */
export interface FeedbackAnalysis {
  /** Overall success score (0-1) */
  successScore: number
  /** Whether meaningful progress was made */
  madeProgress: boolean
  /** Specific issues identified */
  issues: string[]
  /** Suggested next actions */
  suggestions: string[]
  /** Whether the current approach should be abandoned */
  shouldPivot: boolean
  /** Confidence in the analysis (0-1) */
  confidence: number
  /** Extracted data/resources from results */
  extractedResources: Array<{
    type: string
    value: string
    context: string
  }>
}

/**
 * Tracks the quality of progress over iterations
 */
export interface ProgressQuality {
  /** Current iteration */
  iteration: number
  /** Success rate of tool calls in this iteration */
  toolSuccessRate: number
  /** Whether new information was gained */
  newInfoGained: boolean
  /** Whether we're closer to the goal */
  progressTowardsGoal: number
  /** Similarity to previous iteration (for loop detection) */
  similarityToPrevious: number
  /** Cumulative progress score */
  cumulativeScore: number
}

/**
 * Configuration for the refinement system
 */
export interface RefinementConfig {
  /** Maximum consecutive failures before pivoting */
  maxConsecutiveFailures: number
  /** Similarity threshold for stagnation detection */
  stagnationThreshold: number
  /** Minimum progress score to continue */
  minProgressScore: number
  /** Enable adaptive strategy selection */
  adaptiveStrategy: boolean
  /** Enable verbose logging */
  verbose: boolean
}

/**
 * State of the refinement process
 */
export interface RefinementState {
  /** Current strategy being used */
  currentStrategy: TaskStrategy | null
  /** History of progress quality */
  progressHistory: ProgressQuality[]
  /** Consecutive iterations without progress */
  stagnationCount: number
  /** Strategies that have been tried */
  triedStrategies: string[]
  /** Best result so far */
  bestResult: {
    iteration: number
    score: number
    content: string
  } | null
  /** Total tool calls made */
  totalToolCalls: number
  /** Total successful tool calls */
  successfulToolCalls: number
}

// ============================================================================
// PREDEFINED STRATEGIES
// ============================================================================

/**
 * Available task strategies based on common patterns
 */
export const TASK_STRATEGIES: TaskStrategy[] = [
  {
    name: "file_operations",
    description: "File and directory manipulation tasks",
    keywords: ["file", "directory", "folder", "create", "delete", "read", "write", "list", "move", "copy", "rename"],
    preferredToolPatterns: ["file", "directory", "fs", "read", "write", "list"],
    maxIterations: 5,
    supportsParallel: true,
    promptAugmentation: `STRATEGY: File Operations
- Verify paths exist before operations
- Use list operations to confirm state after changes
- Handle permissions errors gracefully
- Prefer relative paths when possible`
  },
  {
    name: "web_automation",
    description: "Web browsing and automation tasks",
    keywords: ["browser", "web", "website", "navigate", "click", "form", "login", "search", "download", "scrape", "url"],
    preferredToolPatterns: ["browser", "navigate", "click", "screenshot", "playwright", "puppeteer"],
    maxIterations: 8,
    supportsParallel: false,
    promptAugmentation: `STRATEGY: Web Automation
- Take screenshots before and after actions to verify state
- Wait for page loads before proceeding
- Handle dynamic content with appropriate waits
- Break complex workflows into small, verifiable steps`
  },
  {
    name: "code_generation",
    description: "Writing and modifying code",
    keywords: ["code", "function", "class", "implement", "fix", "bug", "refactor", "test", "script", "program"],
    preferredToolPatterns: ["write", "edit", "execute", "run", "terminal"],
    maxIterations: 6,
    supportsParallel: false,
    promptAugmentation: `STRATEGY: Code Generation
- Write code incrementally, testing each part
- Run code to verify it works before proceeding
- Handle errors by analyzing output and refining
- Use existing patterns from the codebase`
  },
  {
    name: "data_processing",
    description: "Data analysis and transformation",
    keywords: ["data", "analyze", "process", "transform", "csv", "json", "parse", "extract", "aggregate", "report"],
    preferredToolPatterns: ["read", "write", "execute", "query"],
    maxIterations: 5,
    supportsParallel: true,
    promptAugmentation: `STRATEGY: Data Processing
- Validate data format before processing
- Process in chunks for large datasets
- Verify output matches expected format
- Handle missing or malformed data gracefully`
  },
  {
    name: "system_administration",
    description: "System configuration and management",
    keywords: ["system", "install", "configure", "service", "process", "terminal", "command", "shell", "bash"],
    preferredToolPatterns: ["terminal", "execute", "shell", "command"],
    maxIterations: 7,
    supportsParallel: false,
    promptAugmentation: `STRATEGY: System Administration
- Check current state before making changes
- Use dry-run options when available
- Verify changes were applied successfully
- Have rollback plan for destructive operations`
  },
  {
    name: "information_retrieval",
    description: "Searching and gathering information",
    keywords: ["search", "find", "look", "get", "fetch", "retrieve", "query", "information", "what", "where", "how"],
    preferredToolPatterns: ["search", "query", "fetch", "read", "list"],
    maxIterations: 4,
    supportsParallel: true,
    promptAugmentation: `STRATEGY: Information Retrieval
- Start with broad searches, then narrow down
- Cross-reference multiple sources when possible
- Extract and summarize key findings
- Cite sources for retrieved information`
  },
  {
    name: "general",
    description: "General purpose fallback strategy",
    keywords: [],
    preferredToolPatterns: [],
    maxIterations: 10,
    supportsParallel: false,
    promptAugmentation: `STRATEGY: General
- Break task into smaller steps
- Verify each step before proceeding
- Learn from errors and adjust approach
- Ask for clarification if needed`
  }
]

// ============================================================================
// TASK TYPE DETECTION
// ============================================================================

/**
 * Detects the most appropriate strategy for a given task
 */
export function detectTaskType(
  transcript: string,
  availableTools: Array<{ name: string; description: string }>
): TaskStrategy {
  const transcriptLower = transcript.toLowerCase()
  const scores: Array<{ strategy: TaskStrategy; score: number }> = []

  for (const strategy of TASK_STRATEGIES) {
    let score = 0

    // Check keyword matches
    for (const keyword of strategy.keywords) {
      if (transcriptLower.includes(keyword.toLowerCase())) {
        score += 2
      }
    }

    // Check tool pattern matches
    for (const tool of availableTools) {
      const toolNameLower = tool.name.toLowerCase()
      const toolDescLower = tool.description.toLowerCase()

      for (const pattern of strategy.preferredToolPatterns) {
        if (toolNameLower.includes(pattern) || toolDescLower.includes(pattern)) {
          score += 1
        }
      }
    }

    if (strategy.name !== "general") {
      scores.push({ strategy, score })
    }
  }

  // Sort by score and return best match, or general if no good match
  scores.sort((a, b) => b.score - a.score)

  if (scores.length > 0 && scores[0].score > 0) {
    if (isDebugLLM()) {
      logLLM(`[agentic-refinement] Detected task type: ${scores[0].strategy.name} (score: ${scores[0].score})`)
    }
    return scores[0].strategy
  }

  return TASK_STRATEGIES.find(s => s.name === "general")!
}

// ============================================================================
// FEEDBACK ANALYSIS
// ============================================================================

/**
 * Analyzes feedback from tool execution to guide next steps
 */
export function analyzeFeedback(
  toolResults: MCPToolResult[],
  toolCalls: MCPToolCall[],
  previousAnalysis?: FeedbackAnalysis
): FeedbackAnalysis {
  const issues: string[] = []
  const suggestions: string[] = []
  const extractedResources: FeedbackAnalysis["extractedResources"] = []

  let successCount = 0
  let totalCount = toolResults.length

  for (let i = 0; i < toolResults.length; i++) {
    const result = toolResults[i]
    const call = toolCalls[i]

    if (!result.isError) {
      successCount++

      // Extract useful information from successful results
      const content = result.content.map(c => c.text).join(" ")

      // Look for IDs, paths, URLs, etc.
      const idPatterns = [
        { type: "session_id", pattern: /session[_-]?id[:\s]+([^\s,]+)/i },
        { type: "file_path", pattern: /(?:path|file)[:\s]+([^\s,]+)/i },
        { type: "url", pattern: /(https?:\/\/[^\s]+)/i },
        { type: "id", pattern: /\b(?:id)[:\s]+([a-zA-Z0-9_-]+)/i },
      ]

      for (const { type, pattern } of idPatterns) {
        const match = content.match(pattern)
        if (match) {
          extractedResources.push({
            type,
            value: match[1],
            context: call?.name || "unknown"
          })
        }
      }
    } else {
      // Analyze errors
      const errorText = result.content.map(c => c.text).join(" ").toLowerCase()

      if (errorText.includes("not found") || errorText.includes("does not exist")) {
        issues.push(`Resource not found for ${call?.name || "unknown tool"}`)
        suggestions.push("Verify the resource exists before accessing it")
      } else if (errorText.includes("permission") || errorText.includes("denied")) {
        issues.push(`Permission denied for ${call?.name || "unknown tool"}`)
        suggestions.push("Check permissions or try alternative approach")
      } else if (errorText.includes("timeout")) {
        issues.push(`Timeout for ${call?.name || "unknown tool"}`)
        suggestions.push("Consider breaking into smaller operations or retrying")
      } else if (errorText.includes("invalid") || errorText.includes("malformed")) {
        issues.push(`Invalid input for ${call?.name || "unknown tool"}`)
        suggestions.push("Verify input format matches expected schema")
      } else {
        issues.push(`Error in ${call?.name || "unknown tool"}: ${errorText.substring(0, 100)}`)
      }
    }
  }

  // Calculate scores
  const successScore = totalCount > 0 ? successCount / totalCount : 0
  const madeProgress = successCount > 0 || extractedResources.length > 0

  // Determine if we should pivot based on consecutive failures
  const shouldPivot = (
    successScore === 0 &&
    previousAnalysis?.successScore === 0 &&
    issues.length > 0
  )

  // Add general suggestions based on patterns
  if (successScore < 0.5 && !shouldPivot) {
    suggestions.push("Consider verifying prerequisites before tool calls")
  }

  if (issues.some(i => i.includes("not found"))) {
    suggestions.push("Try listing available resources first")
  }

  const confidence = Math.min(1, 0.5 + (totalCount * 0.1))

  if (isDebugLLM()) {
    logLLM(`[agentic-refinement] Feedback analysis:`, {
      successScore,
      madeProgress,
      issueCount: issues.length,
      extractedResources: extractedResources.length,
      shouldPivot
    })
  }

  return {
    successScore,
    madeProgress,
    issues,
    suggestions,
    shouldPivot,
    confidence,
    extractedResources
  }
}

// ============================================================================
// PROGRESS QUALITY TRACKING
// ============================================================================

/**
 * Creates a new refinement state
 */
export function createRefinementState(initialStrategy?: TaskStrategy): RefinementState {
  return {
    currentStrategy: initialStrategy || null,
    progressHistory: [],
    stagnationCount: 0,
    triedStrategies: initialStrategy ? [initialStrategy.name] : [],
    bestResult: null,
    totalToolCalls: 0,
    successfulToolCalls: 0
  }
}

/**
 * Updates refinement state with new iteration results
 */
export function updateRefinementState(
  state: RefinementState,
  iteration: number,
  feedback: FeedbackAnalysis,
  responseContent: string,
  config: RefinementConfig
): RefinementState {
  // Calculate progress quality for this iteration
  const previousQuality = state.progressHistory[state.progressHistory.length - 1]

  // Calculate similarity to previous response (simple approach)
  let similarityToPrevious = 0
  if (state.bestResult && responseContent) {
    const prevWords = new Set(state.bestResult.content.toLowerCase().split(/\s+/))
    const currWords = new Set(responseContent.toLowerCase().split(/\s+/))
    const intersection = new Set([...prevWords].filter(x => currWords.has(x)))
    const union = new Set([...prevWords, ...currWords])
    similarityToPrevious = union.size > 0 ? intersection.size / union.size : 0
  }

  // Calculate progress towards goal (heuristic based on feedback)
  const progressTowardsGoal = feedback.madeProgress
    ? Math.min(1, (previousQuality?.progressTowardsGoal || 0) + 0.2 * feedback.successScore)
    : (previousQuality?.progressTowardsGoal || 0) * 0.9

  // Calculate cumulative score
  const cumulativeScore = (
    feedback.successScore * 0.4 +
    (feedback.madeProgress ? 0.3 : 0) +
    progressTowardsGoal * 0.3
  )

  const quality: ProgressQuality = {
    iteration,
    toolSuccessRate: feedback.successScore,
    newInfoGained: feedback.extractedResources.length > 0 || feedback.madeProgress,
    progressTowardsGoal,
    similarityToPrevious,
    cumulativeScore
  }

  // Update best result if this is better
  const newBestResult = !state.bestResult || cumulativeScore > state.bestResult.score
    ? { iteration, score: cumulativeScore, content: responseContent }
    : state.bestResult

  // Update stagnation count
  const isStagnating = (
    similarityToPrevious > config.stagnationThreshold ||
    (feedback.successScore === 0 && previousQuality?.toolSuccessRate === 0)
  )
  const newStagnationCount = isStagnating
    ? state.stagnationCount + 1
    : 0

  // Update tool call stats
  const newTotalToolCalls = state.totalToolCalls + (feedback.successScore > 0 ? 1 : 0)
  const newSuccessfulToolCalls = state.successfulToolCalls + (feedback.successScore > 0 ? Math.round(feedback.successScore * 1) : 0)

  if (isDebugLLM()) {
    logLLM(`[agentic-refinement] Progress quality:`, {
      iteration,
      cumulativeScore,
      stagnationCount: newStagnationCount,
      isStagnating
    })
  }

  return {
    ...state,
    progressHistory: [...state.progressHistory, quality],
    stagnationCount: newStagnationCount,
    bestResult: newBestResult,
    totalToolCalls: newTotalToolCalls,
    successfulToolCalls: newSuccessfulToolCalls
  }
}

// ============================================================================
// STAGNATION DETECTION & EARLY STOPPING
// ============================================================================

/**
 * Determines if the agent should stop early or try a different approach
 */
export function shouldStopOrPivot(
  state: RefinementState,
  feedback: FeedbackAnalysis,
  config: RefinementConfig
): { action: "continue" | "pivot" | "stop"; reason: string } {
  // Check for explicit pivot recommendation from feedback
  if (feedback.shouldPivot) {
    return {
      action: "pivot",
      reason: "Consecutive failures suggest current approach is not working"
    }
  }

  // Check stagnation threshold
  if (state.stagnationCount >= config.maxConsecutiveFailures) {
    // If we have untried strategies, pivot
    const untriedStrategies = TASK_STRATEGIES.filter(
      s => !state.triedStrategies.includes(s.name) && s.name !== "general"
    )

    if (untriedStrategies.length > 0) {
      return {
        action: "pivot",
        reason: `Stagnation detected after ${state.stagnationCount} iterations, trying different strategy`
      }
    }

    // If we've tried all strategies, stop
    return {
      action: "stop",
      reason: "All strategies exhausted without progress"
    }
  }

  // Check minimum progress score
  const recentProgress = state.progressHistory.slice(-3)
  if (recentProgress.length >= 3) {
    const avgScore = recentProgress.reduce((sum, p) => sum + p.cumulativeScore, 0) / recentProgress.length
    if (avgScore < config.minProgressScore) {
      return {
        action: "pivot",
        reason: `Average progress score (${avgScore.toFixed(2)}) below threshold`
      }
    }
  }

  return { action: "continue", reason: "Making progress" }
}

/**
 * Selects the next strategy to try when pivoting
 */
export function selectNextStrategy(
  state: RefinementState,
  transcript: string,
  availableTools: Array<{ name: string; description: string }>
): TaskStrategy | null {
  // Get strategies we haven't tried
  const untried = TASK_STRATEGIES.filter(
    s => !state.triedStrategies.includes(s.name)
  )

  if (untried.length === 0) {
    return null
  }

  // Re-detect based on current context (might choose differently now)
  const detected = detectTaskType(transcript, availableTools)

  // If the detected strategy is untried, use it
  if (!state.triedStrategies.includes(detected.name)) {
    return detected
  }

  // Otherwise, pick the first untried strategy
  return untried[0]
}

// ============================================================================
// REFINEMENT PROMPT GENERATION
// ============================================================================

/**
 * Generates a refinement prompt based on feedback analysis
 */
export function generateRefinementPrompt(
  feedback: FeedbackAnalysis,
  state: RefinementState,
  originalTranscript: string
): string {
  const parts: string[] = []

  // Add strategy-specific guidance if available
  if (state.currentStrategy) {
    parts.push(state.currentStrategy.promptAugmentation)
  }

  // Add feedback summary
  if (feedback.issues.length > 0) {
    parts.push(`\nPREVIOUS ISSUES ENCOUNTERED:`)
    feedback.issues.forEach((issue, i) => {
      parts.push(`${i + 1}. ${issue}`)
    })
  }

  // Add suggestions
  if (feedback.suggestions.length > 0) {
    parts.push(`\nSUGGESTED IMPROVEMENTS:`)
    feedback.suggestions.forEach((suggestion, i) => {
      parts.push(`${i + 1}. ${suggestion}`)
    })
  }

  // Add extracted resources
  if (feedback.extractedResources.length > 0) {
    parts.push(`\nAVAILABLE RESOURCES FROM PREVIOUS STEPS:`)
    feedback.extractedResources.forEach(resource => {
      parts.push(`- ${resource.type}: ${resource.value} (from ${resource.context})`)
    })
  }

  // Add progress summary
  if (state.progressHistory.length > 0) {
    const latestProgress = state.progressHistory[state.progressHistory.length - 1]
    parts.push(`\nPROGRESS STATUS:`)
    parts.push(`- Tool success rate: ${(latestProgress.toolSuccessRate * 100).toFixed(0)}%`)
    parts.push(`- Progress towards goal: ${(latestProgress.progressTowardsGoal * 100).toFixed(0)}%`)
    if (state.stagnationCount > 0) {
      parts.push(`- NOTICE: ${state.stagnationCount} iteration(s) without meaningful progress`)
    }
  }

  // Add refinement instruction
  parts.push(`\nREFINEMENT INSTRUCTION:
Based on the above feedback, refine your approach to better address the original request:
"${originalTranscript}"

Focus on:
1. Addressing the specific issues identified
2. Using the available resources effectively
3. Verifying each step before proceeding
4. Breaking down complex operations into verifiable steps`)

  return parts.join("\n")
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

export const DEFAULT_REFINEMENT_CONFIG: RefinementConfig = {
  maxConsecutiveFailures: 3,
  stagnationThreshold: 0.8,
  minProgressScore: 0.15,
  adaptiveStrategy: true,
  verbose: false
}

// ============================================================================
// MAIN REFINEMENT ORCHESTRATOR
// ============================================================================

/**
 * Orchestrates the refinement process for an agent iteration
 * Returns guidance for the next iteration
 */
export function orchestrateRefinement(
  transcript: string,
  iteration: number,
  toolCalls: MCPToolCall[],
  toolResults: MCPToolResult[],
  responseContent: string,
  availableTools: Array<{ name: string; description: string }>,
  currentState: RefinementState,
  config: RefinementConfig = DEFAULT_REFINEMENT_CONFIG
): {
  updatedState: RefinementState
  feedback: FeedbackAnalysis
  decision: { action: "continue" | "pivot" | "stop"; reason: string }
  refinementPrompt: string
  newStrategy?: TaskStrategy
} {
  // Initialize strategy if not set
  let state = currentState
  if (!state.currentStrategy && config.adaptiveStrategy) {
    const strategy = detectTaskType(transcript, availableTools)
    state = {
      ...state,
      currentStrategy: strategy,
      triedStrategies: [...state.triedStrategies, strategy.name]
    }
  }

  // Analyze feedback from tool execution
  const previousFeedback = state.progressHistory.length > 0
    ? analyzeFeedback([], [], undefined) // Previous analysis would be stored separately in full impl
    : undefined
  const feedback = analyzeFeedback(toolResults, toolCalls, previousFeedback)

  // Update state with new progress
  state = updateRefinementState(state, iteration, feedback, responseContent, config)

  // Determine next action
  const decision = shouldStopOrPivot(state, feedback, config)

  // Generate refinement prompt
  let refinementPrompt = ""
  let newStrategy: TaskStrategy | undefined

  if (decision.action === "pivot") {
    // Try to select a new strategy
    const nextStrategy = selectNextStrategy(state, transcript, availableTools)
    if (nextStrategy) {
      newStrategy = nextStrategy
      state = {
        ...state,
        currentStrategy: nextStrategy,
        triedStrategies: [...state.triedStrategies, nextStrategy.name],
        stagnationCount: 0 // Reset stagnation counter on pivot
      }
    }
  }

  refinementPrompt = generateRefinementPrompt(feedback, state, transcript)

  return {
    updatedState: state,
    feedback,
    decision,
    refinementPrompt,
    newStrategy
  }
}
