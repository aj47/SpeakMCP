/**
 * LLM Agent Orchestration Module for SpeakMCP Server
 *
 * This module implements the core agent loop for processing user requests
 * with MCP tools. It's a simplified version of the desktop's llm.ts that:
 * - Runs iteratively until the task is complete
 * - Executes MCP tools with retry logic
 * - Handles context budget management
 * - Supports emergency stop
 * - Emits progress updates via callback
 */

import { randomUUID } from "crypto"
import { configStore } from "../config"
import type {
  MCPTool,
  MCPToolCall,
  MCPToolResult,
  LLMToolCallResponse,
  AgentProgressStep,
  AgentProgressUpdate,
} from "../types"
import { state, agentSessionStateManager } from "./state"
import { diagnosticsService } from "./diagnostics"
import {
  makeLLMCallWithFetch,
  type RetryProgressCallback,
} from "./llm-fetch"
import { shrinkMessagesForLLM, estimateTokensFromMessages, getMaxContextTokens, getProviderAndModel } from "./context-budget"
import { constructSystemPrompt } from "./system-prompts"

// ============================================================================
// DEBUG UTILITIES
// ============================================================================

function isDebugLLM(): boolean {
  const config = configStore.get() as Record<string, unknown>
  return config.debugLLM === true || process.env.DEBUG_LLM === "true"
}

function isDebugTools(): boolean {
  const config = configStore.get() as Record<string, unknown>
  return config.debugTools === true || process.env.DEBUG_TOOLS === "true"
}

function logLLM(...args: unknown[]) {
  if (!isDebugLLM()) return
  const ts = new Date().toISOString()
  console.log(`[${ts}] [DEBUG][LLM]`, ...args)
}

function logTools(...args: unknown[]) {
  if (!isDebugTools()) return
  const ts = new Date().toISOString()
  console.log(`[${ts}] [DEBUG][TOOLS]`, ...args)
}

// ============================================================================
// TYPES
// ============================================================================

export interface ConversationHistoryEntry {
  role: "user" | "assistant" | "tool" | "system"
  content: string
  timestamp: number
  toolCalls?: MCPToolCall[]
  toolResults?: MCPToolResult[]
}

export interface AgentModeOptions {
  transcript: string
  conversationHistory?: ConversationHistoryEntry[]
  availableTools: MCPTool[]
  executeToolCall: (name: string, args: Record<string, unknown>) => Promise<MCPToolResult>
  onProgress?: (update: AgentProgressUpdate) => void
  sessionId?: string
  conversationId?: string
  conversationTitle?: string
  userGuidelines?: string
  customSystemPrompt?: string
  maxIterations?: number
}

export interface AgentModeResponse {
  success: boolean
  content: string
  conversationHistory: ConversationHistoryEntry[]
  iterationsUsed: number
  wasAborted?: boolean
  error?: string
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const MAX_TOOL_FAILURES = 3
const MAX_EMPTY_RESPONSES = 3
const MAX_NO_OP_COUNT = 2

/**
 * Create a progress step
 */
function createProgressStep(
  type: AgentProgressStep["type"],
  title: string,
  description: string,
  status: AgentProgressStep["status"],
): AgentProgressStep {
  return {
    id: randomUUID(),
    type,
    title,
    description,
    status,
    timestamp: Date.now(),
  }
}

/**
 * Clean up error messages for display
 */
function cleanErrorMessage(message: string): string {
  // Remove stack traces
  const stackIndex = message.indexOf("\n    at ")
  if (stackIndex > 0) {
    message = message.substring(0, stackIndex)
  }

  // Remove common prefixes
  message = message.replace(/^Error:\s*/i, "")
  message = message.replace(/^MCP Error:\s*/i, "")

  // Truncate if too long
  if (message.length > 500) {
    message = message.substring(0, 500) + "..."
  }

  return message.trim()
}

/**
 * Analyze tool errors to determine recovery strategy
 */
function analyzeToolErrors(toolResults: MCPToolResult[]): {
  hasErrors: boolean
  errorTypes: ("transient" | "permissions" | "authentication" | "validation" | "unknown")[]
  recoverySuggestions: string[]
} {
  const errorTypes: ("transient" | "permissions" | "authentication" | "validation" | "unknown")[] = []
  const recoverySuggestions: string[] = []

  for (const result of toolResults) {
    if (!result.isError) continue

    const errorText = result.content.map((c) => c.text).join(" ").toLowerCase()

    if (errorText.includes("rate limit") || errorText.includes("timeout") || errorText.includes("connection")) {
      errorTypes.push("transient")
      recoverySuggestions.push("Wait and retry")
    } else if (errorText.includes("permission") || errorText.includes("access") || errorText.includes("denied")) {
      errorTypes.push("permissions")
      recoverySuggestions.push("Check permissions")
    } else if (errorText.includes("authentication") || errorText.includes("unauthorized") || errorText.includes("forbidden")) {
      errorTypes.push("authentication")
      recoverySuggestions.push("Check authentication")
    } else if (errorText.includes("invalid") || errorText.includes("required") || errorText.includes("missing")) {
      errorTypes.push("validation")
      recoverySuggestions.push("Check tool arguments")
    } else {
      errorTypes.push("unknown")
    }
  }

  return {
    hasErrors: errorTypes.length > 0,
    errorTypes,
    recoverySuggestions: [...new Set(recoverySuggestions)],
  }
}

/**
 * Execute a tool with retry logic
 */
async function executeToolWithRetries(
  toolCall: MCPToolCall,
  executeToolCall: (name: string, args: Record<string, unknown>) => Promise<MCPToolResult>,
  sessionId: string,
  onProgress?: (message: string) => void,
  maxRetries: number = 2,
): Promise<{
  result: MCPToolResult
  retryCount: number
  cancelledByKill: boolean
  toolCall: MCPToolCall
}> {
  let lastResult: MCPToolResult | null = null
  let retryCount = 0

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Check for stop signal
    if (agentSessionStateManager.shouldStopSession(sessionId)) {
      return {
        result: {
          content: [{ type: "text", text: "Tool execution cancelled by emergency kill switch" }],
          isError: true,
        },
        retryCount: attempt,
        cancelledByKill: true,
        toolCall,
      }
    }

    try {
      if (attempt > 0 && onProgress) {
        onProgress(`Retrying ${toolCall.name} (attempt ${attempt + 1}/${maxRetries + 1})...`)
      }

      const result = await executeToolCall(toolCall.name, toolCall.arguments || {})
      lastResult = result

      // If successful or non-retryable error, return
      if (!result.isError) {
        return { result, retryCount: attempt, cancelledByKill: false, toolCall }
      }

      // Check if error is retryable
      const errorText = result.content.map((c) => c.text).join(" ").toLowerCase()
      const isRetryable =
        errorText.includes("timeout") ||
        errorText.includes("rate limit") ||
        errorText.includes("connection") ||
        errorText.includes("temporary")

      if (!isRetryable) {
        return { result, retryCount: attempt, cancelledByKill: false, toolCall }
      }

      retryCount = attempt + 1

      // Wait before retry with exponential backoff
      const delay = Math.min(1000 * Math.pow(2, attempt), 10000)
      await new Promise((resolve) => setTimeout(resolve, delay))
    } catch (error) {
      lastResult = {
        content: [{ type: "text", text: `Tool execution error: ${(error as Error).message}` }],
        isError: true,
      }
    }
  }

  return {
    result: lastResult || {
      content: [{ type: "text", text: "Tool execution failed after all retries" }],
      isError: true,
    },
    retryCount,
    cancelledByKill: false,
    toolCall,
  }
}

/**
 * Format conversation history for progress updates
 */
function formatConversationForProgress(
  history: ConversationHistoryEntry[],
): AgentProgressUpdate["conversationHistory"] {
  return history.map((entry) => ({
    role: entry.role as "user" | "assistant" | "tool",
    content: entry.content,
    toolCalls: entry.toolCalls,
    toolResults: entry.toolResults,
  }))
}

/**
 * Map conversation history to LLM message format
 */
function mapHistoryToMessages(
  history: ConversationHistoryEntry[],
): Array<{ role: string; content: string }> {
  const messages: Array<{ role: string; content: string }> = []

  for (const entry of history) {
    // Skip system messages in history - they're added separately
    if (entry.role === "system") continue

    // Map tool role to user for LLM compatibility
    const role = entry.role === "tool" ? "user" : entry.role
    messages.push({ role, content: entry.content })
  }

  return messages
}




// ============================================================================
// MAIN AGENT LOOP
// ============================================================================

/**
 * Process a user transcript with agent mode - iterative tool calling until task completion
 *
 * This is the core agent loop that:
 * 1. Constructs the system prompt with available tools
 * 2. Makes LLM calls with tool calling enabled
 * 3. Executes tool calls and feeds results back
 * 4. Continues until the task is complete or max iterations reached
 * 5. Handles context budget management and emergency stop
 */
export async function processTranscriptWithAgentMode(
  options: AgentModeOptions,
): Promise<AgentModeResponse> {
  const {
    transcript,
    availableTools,
    executeToolCall,
    onProgress,
    conversationId,
    conversationTitle,
    userGuidelines,
    customSystemPrompt,
  } = options

  // Get config
  const config = configStore.get() as Record<string, unknown>
  const maxIterations = options.maxIterations ?? (config.mcpMaxIterations as number) ?? 25

  // Generate session ID
  const sessionId = options.sessionId || randomUUID()
  const currentSessionId = sessionId

  // Initialize session state
  agentSessionStateManager.createSession(currentSessionId)

  // Track state
  let conversationHistory: ConversationHistoryEntry[] = [...(options.conversationHistory || [])]
  const progressSteps: AgentProgressStep[] = []
  let finalContent = ""
  let wasAborted = false
  let iteration = 0
  let emptyResponseCount = 0
  let noOpCount = 0
  const toolFailureCount = new Map<string, number>()
  let toolsExecutedInSession = false

  // Emit helper
  const emit = (update: Partial<AgentProgressUpdate>) => {
    if (!onProgress) return
    // Check for stop signal before emitting
    if (agentSessionStateManager.shouldStopSession(currentSessionId)) {
      return
    }
    onProgress({
      sessionId: currentSessionId,
      conversationId,
      conversationTitle,
      currentIteration: update.currentIteration ?? iteration,
      maxIterations: update.maxIterations ?? maxIterations,
      steps: update.steps ?? progressSteps.slice(-3),
      isComplete: update.isComplete ?? false,
      finalContent: update.finalContent,
      conversationHistory: update.conversationHistory ?? formatConversationForProgress(conversationHistory),
      streamingContent: update.streamingContent,
    })
  }

  // Add message to conversation history
  const addMessage = (
    role: ConversationHistoryEntry["role"],
    content: string,
    toolCalls?: MCPToolCall[],
    toolResults?: MCPToolResult[],
  ) => {
    conversationHistory.push({
      role,
      content,
      timestamp: Date.now(),
      toolCalls,
      toolResults,
    })
  }

  // Retry progress callback
  const onRetryProgress: RetryProgressCallback = (info) => {
    if (info.isRetrying) {
      const retryStep = createProgressStep(
        "retry",
        `Retrying (attempt ${info.attempt})`,
        info.reason,
        "running",
      )
      retryStep.retryCount = info.attempt
      retryStep.retryReason = info.reason
      progressSteps.push(retryStep)
      emit({
        currentIteration: iteration,
        maxIterations,
        steps: progressSteps.slice(-3),
        isComplete: false,
      })
    }
  }

  try {
    // Add initial user message if this is a new conversation
    if (conversationHistory.length === 0 || conversationHistory[conversationHistory.length - 1].role !== "user") {
      addMessage("user", transcript)
    }

    // Create initial progress step
    const thinkingStep = createProgressStep(
      "thinking",
      "Processing request",
      "Analyzing your request and planning actions...",
      "running",
    )
    progressSteps.push(thinkingStep)
    emit({
      currentIteration: iteration,
      maxIterations,
      steps: progressSteps.slice(-3),
      isComplete: false,
    })

    // Filter out failed tools from available tools
    const getActiveTools = (): MCPTool[] => {
      return availableTools.filter((tool) => {
        const failCount = toolFailureCount.get(tool.name) || 0
        return failCount < MAX_TOOL_FAILURES
      })
    }

    // Main agent loop
    while (iteration < maxIterations) {
      iteration++
      agentSessionStateManager.updateIterationCount(currentSessionId, iteration)

      // Check for stop signal
      if (agentSessionStateManager.shouldStopSession(currentSessionId)) {
        logLLM(`Agent session ${currentSessionId} stopped by kill switch`)
        const killNote = "\n\n(Agent mode was stopped by emergency kill switch)"
        finalContent = (finalContent || "") + killNote
        addMessage("assistant", finalContent)
        emit({
          currentIteration: iteration,
          maxIterations,
          steps: progressSteps.slice(-3),
          isComplete: true,
          finalContent,
        })
        wasAborted = true
        break
      }

      if (isDebugLLM()) {
        logLLM(`Agent iteration ${iteration}/${maxIterations}`)
      }

      // Get active tools (excluding failed ones)
      const activeTools = getActiveTools()

      // Construct system prompt
      const systemPrompt = constructSystemPrompt(
        activeTools,
        userGuidelines,
        true, // isAgentMode
        undefined, // errorContext
        customSystemPrompt,
      )

      // Build messages for LLM
      const historyMessages = mapHistoryToMessages(conversationHistory)
      const allMessages = [
        { role: "system", content: systemPrompt },
        ...historyMessages,
      ]

      // Apply context budget management
      const { providerId, model } = getProviderAndModel()
      const maxTokens = await getMaxContextTokens(providerId, model)

      const { messages: shrunkMessages, appliedStrategies } = await shrinkMessagesForLLM({
        messages: allMessages,
        availableTools: activeTools,
        isAgentMode: true,
        sessionId: currentSessionId,
        onSummarizationProgress: (current, total, message) => {
          const contextStep = createProgressStep(
            "context_reduction",
            `Context reduction (${current}/${total})`,
            message,
            "running",
          )
          progressSteps.push(contextStep)
          emit({
            currentIteration: iteration,
            maxIterations,
            steps: progressSteps.slice(-3),
            isComplete: false,
          })
        },
      })

      if (appliedStrategies.length > 0 && isDebugLLM()) {
        logLLM("Applied context reduction strategies:", appliedStrategies)
      }

      // Make LLM call
      let llmResponse: LLMToolCallResponse
      try {
        llmResponse = await makeLLMCallWithFetch(
          shrunkMessages,
          undefined, // Use default provider
          onRetryProgress,
          currentSessionId,
          activeTools,
        )
      } catch (error) {
        diagnosticsService.logError("llm", "Agent LLM call failed", error)
        const errorMessage = `LLM call failed: ${(error as Error).message}`
        const errorStep = createProgressStep("error", "LLM Error", errorMessage, "error")
        progressSteps.push(errorStep)
        emit({
          currentIteration: iteration,
          maxIterations,
          steps: progressSteps.slice(-3),
          isComplete: true,
          finalContent: errorMessage,
        })
        return {
          success: false,
          content: errorMessage,
          conversationHistory,
          iterationsUsed: iteration,
          error: errorMessage,
        }
      }

      // Check for stop signal after LLM call
      if (agentSessionStateManager.shouldStopSession(currentSessionId)) {
        logLLM(`Agent session ${currentSessionId} stopped after LLM call`)
        const killNote = "\n\n(Agent mode was stopped by emergency kill switch)"
        finalContent = (llmResponse.content || "") + killNote
        addMessage("assistant", finalContent)
        emit({
          currentIteration: iteration,
          maxIterations,
          steps: progressSteps.slice(-3),
          isComplete: true,
          finalContent,
        })
        wasAborted = true
        break
      }

      // Handle empty response
      if (!llmResponse.content && (!llmResponse.toolCalls || llmResponse.toolCalls.length === 0)) {
        emptyResponseCount++
        logLLM(`Empty response count: ${emptyResponseCount}/${MAX_EMPTY_RESPONSES}`)

        if (emptyResponseCount >= MAX_EMPTY_RESPONSES) {
          const emptyError = "LLM returned empty responses repeatedly. Please try again."
          addMessage("assistant", emptyError)
          emit({
            currentIteration: iteration,
            maxIterations,
            steps: progressSteps.slice(-3),
            isComplete: true,
            finalContent: emptyError,
          })
          return {
            success: false,
            content: emptyError,
            conversationHistory,
            iterationsUsed: iteration,
            error: "Empty responses from LLM",
          }
        }

        // Nudge the LLM
        addMessage("user", "Please provide a response or use the available tools to complete the task.")
        continue
      }

      // Reset empty response counter on valid response
      emptyResponseCount = 0

      // Extract tool calls
      const toolCallsArray = llmResponse.toolCalls || []

      // Handle no tool calls (text-only response)
      if (toolCallsArray.length === 0) {
        const content = llmResponse.content || ""

        // Check for no-op (LLM responding without making progress)
        if (content.trim().length < 50 && toolsExecutedInSession) {
          noOpCount++
          if (noOpCount >= MAX_NO_OP_COUNT) {
            // Nudge the LLM to take action or provide a complete answer
            const nudgeMessage = "You have relevant tools available. Please either call tools directly or provide a complete answer."
            addMessage("user", nudgeMessage)
            noOpCount = 0
            continue
          }
        } else {
          noOpCount = 0
        }

        // Check if the LLM indicates it's done
        if (llmResponse.needsMoreWork === false || content.includes("I have completed") || content.includes("I've completed")) {
          finalContent = content
          addMessage("assistant", content)

          const completionStep = createProgressStep(
            "completion",
            "Task completed",
            content.length > 100 ? content.substring(0, 100) + "..." : content,
            "complete",
          )
          progressSteps.push(completionStep)
          emit({
            currentIteration: iteration,
            maxIterations,
            steps: progressSteps.slice(-3),
            isComplete: true,
            finalContent: content,
            streamingContent: { text: content, isStreaming: false },
          })
          break
        }

        // Add assistant message and continue
        addMessage("assistant", content)
        finalContent = content
        emit({
          currentIteration: iteration,
          maxIterations,
          steps: progressSteps.slice(-3),
          isComplete: false,
          streamingContent: { text: content, isStreaming: true },
        })

        // If needsMoreWork is explicitly undefined (not set), check if we should continue
        if (llmResponse.needsMoreWork === undefined && !toolsExecutedInSession) {
          // First response with no tools - might be a simple question
          // Complete the request
          const completionStep = createProgressStep(
            "completion",
            "Response provided",
            "Completed without tool usage",
            "complete",
          )
          progressSteps.push(completionStep)
          emit({
            currentIteration: iteration,
            maxIterations,
            steps: progressSteps.slice(-3),
            isComplete: true,
            finalContent: content,
            streamingContent: { text: content, isStreaming: false },
          })
          break
        }

        continue
      }

      // Reset no-op counter when tools are called
      noOpCount = 0

      // Add assistant response with tool calls to history BEFORE executing
      addMessage("assistant", llmResponse.content || "", llmResponse.toolCalls)

      // Emit progress showing tool calls
      emit({
        currentIteration: iteration,
        maxIterations,
        steps: progressSteps.slice(-3),
        isComplete: false,
      })

      // Check for stop signal before tool execution
      if (agentSessionStateManager.shouldStopSession(currentSessionId)) {
        logLLM(`Agent session ${currentSessionId} stopped before tool execution`)
        const killNote = "\n\n(Agent mode was stopped by emergency kill switch)"
        finalContent = (finalContent || "") + killNote
        addMessage("assistant", finalContent)
        emit({
          currentIteration: iteration,
          maxIterations,
          steps: progressSteps.slice(-3),
          isComplete: true,
          finalContent,
        })
        wasAborted = true
        break
      }

      // Execute tool calls
      const toolResults: MCPToolResult[] = []
      const failedTools: string[] = []

      // Determine execution mode (parallel vs sequential)
      const forceSequential = config.mcpParallelToolExecution === false
      const useParallelExecution = !forceSequential && toolCallsArray.length > 1

      if (useParallelExecution) {
        // PARALLEL EXECUTION
        if (isDebugTools()) {
          logTools(`Executing ${toolCallsArray.length} tool calls in parallel`)
        }

        // Create progress steps for all tools
        const toolCallSteps: AgentProgressStep[] = []
        for (const toolCall of toolCallsArray) {
          const toolCallStep = createProgressStep(
            "tool_call",
            `Executing ${toolCall.name}`,
            `Running with: ${JSON.stringify(toolCall.arguments).substring(0, 100)}...`,
            "running",
          )
          toolCallStep.toolName = toolCall.name
          toolCallStep.toolInput = toolCall.arguments
          progressSteps.push(toolCallStep)
          toolCallSteps.push(toolCallStep)
        }

        emit({
          currentIteration: iteration,
          maxIterations,
          steps: progressSteps.slice(-Math.min(toolCallsArray.length * 2, 6)),
          isComplete: false,
        })

        // Execute all in parallel
        const executionPromises = toolCallsArray.map(async (toolCall, index) => {
          const toolCallStep = toolCallSteps[index]

          const onToolProgress = (message: string) => {
            toolCallStep.description = message
            emit({
              currentIteration: iteration,
              maxIterations,
              steps: progressSteps.slice(-Math.min(toolCallsArray.length * 2, 6)),
              isComplete: false,
            })
          }

          const execResult = await executeToolWithRetries(
            toolCall,
            executeToolCall,
            currentSessionId,
            onToolProgress,
            2,
          )

          // Update step with result
          toolCallStep.status = execResult.result.isError ? "error" : "complete"
          toolCallStep.toolOutput = execResult.result.content.map((c) => c.text).join("\n")
          toolCallStep.isError = execResult.result.isError

          return execResult
        })

        const executionResults = await Promise.all(executionPromises)

        // Check for cancellation
        const anyCancelled = executionResults.some((r) => r.cancelledByKill)
        if (anyCancelled) {
          const killNote = "\n\n(Agent mode was stopped by emergency kill switch)"
          finalContent = (finalContent || "") + killNote
          addMessage("assistant", finalContent)
          emit({
            currentIteration: iteration,
            maxIterations,
            steps: progressSteps.slice(-Math.min(toolCallsArray.length * 2, 6)),
            isComplete: true,
            finalContent,
          })
          wasAborted = true
          break
        }

        // Collect results
        for (const execResult of executionResults) {
          toolResults.push(execResult.result)
          toolsExecutedInSession = true
          if (execResult.result.isError) {
            failedTools.push(execResult.toolCall.name)
          }
        }
      } else {
        // SEQUENTIAL EXECUTION
        if (isDebugTools()) {
          logTools(`Executing ${toolCallsArray.length} tool calls sequentially`)
        }

        for (const toolCall of toolCallsArray) {
          // Check for stop signal
          if (agentSessionStateManager.shouldStopSession(currentSessionId)) {
            logLLM(`Agent session ${currentSessionId} stopped during tool execution`)
            const killNote = "\n\n(Agent mode was stopped by emergency kill switch)"
            finalContent = (finalContent || "") + killNote
            addMessage("assistant", finalContent)
            emit({
              currentIteration: iteration,
              maxIterations,
              steps: progressSteps.slice(-3),
              isComplete: true,
              finalContent,
            })
            wasAborted = true
            break
          }

          // Create tool call step
          const toolCallStep = createProgressStep(
            "tool_call",
            `Executing ${toolCall.name}`,
            `Running with: ${JSON.stringify(toolCall.arguments).substring(0, 100)}...`,
            "running",
          )
          toolCallStep.toolName = toolCall.name
          toolCallStep.toolInput = toolCall.arguments
          progressSteps.push(toolCallStep)

          emit({
            currentIteration: iteration,
            maxIterations,
            steps: progressSteps.slice(-3),
            isComplete: false,
          })

          const onToolProgress = (message: string) => {
            toolCallStep.description = message
            emit({
              currentIteration: iteration,
              maxIterations,
              steps: progressSteps.slice(-3),
              isComplete: false,
            })
          }

          const execResult = await executeToolWithRetries(
            toolCall,
            executeToolCall,
            currentSessionId,
            onToolProgress,
            2,
          )

          if (execResult.cancelledByKill) {
            toolCallStep.status = "error"
            toolCallStep.isError = true
            const killNote = "\n\n(Agent mode was stopped by emergency kill switch)"
            finalContent = (finalContent || "") + killNote
            addMessage("assistant", finalContent)
            emit({
              currentIteration: iteration,
              maxIterations,
              steps: progressSteps.slice(-3),
              isComplete: true,
              finalContent,
            })
            wasAborted = true
            break
          }

          toolResults.push(execResult.result)
          toolsExecutedInSession = true

          if (execResult.result.isError) {
            failedTools.push(toolCall.name)
          }

          // Update step with result
          toolCallStep.status = execResult.result.isError ? "error" : "complete"
          toolCallStep.toolOutput = execResult.result.content.map((c) => c.text).join("\n")
          toolCallStep.isError = execResult.result.isError

          // Create tool result step
          const toolResultStep = createProgressStep(
            "tool_result",
            `${toolCall.name} ${execResult.result.isError ? "failed" : "completed"}`,
            execResult.result.isError
              ? `Failed${execResult.retryCount > 0 ? ` after ${execResult.retryCount} retries` : ""}`
              : "Executed successfully",
            execResult.result.isError ? "error" : "complete",
          )
          progressSteps.push(toolResultStep)

          emit({
            currentIteration: iteration,
            maxIterations,
            steps: progressSteps.slice(-3),
            isComplete: false,
          })
        }
      }

      // If aborted during tool execution, exit
      if (wasAborted) break

      // Update failure counts for failed tools
      for (const toolName of failedTools) {
        const currentCount = toolFailureCount.get(toolName) || 0
        toolFailureCount.set(toolName, currentCount + 1)
        if (currentCount + 1 >= MAX_TOOL_FAILURES) {
          logLLM(`Tool ${toolName} has failed ${MAX_TOOL_FAILURES} times, excluding from future iterations`)
        }
      }

      // Format tool results and add to conversation history
      const toolResultsText = toolResults
        .map((result, i) => {
          const toolName = toolCallsArray[i]?.name || "unknown"
          const content = result.content.map((c) => c.text).join("\n")
          const prefix = result.isError ? `[${toolName}] ERROR: ` : `[${toolName}] `
          return `${prefix}${content}`
        })
        .join("\n\n")

      addMessage("tool", toolResultsText, undefined, toolResults)

      // Analyze errors and provide recovery hints if needed
      const errorAnalysis = analyzeToolErrors(toolResults)
      if (errorAnalysis.hasErrors && errorAnalysis.recoverySuggestions.length > 0) {
        const recoveryHint = `\n\nRecovery suggestions: ${errorAnalysis.recoverySuggestions.join(", ")}`
        logLLM("Tool error recovery suggestions:", errorAnalysis.recoverySuggestions)
      }

      // Emit progress update with tool results
      emit({
        currentIteration: iteration,
        maxIterations,
        steps: progressSteps.slice(-3),
        isComplete: false,
      })

      // Continue to next iteration to process tool results
    }

    // Handle max iterations reached
    if (iteration >= maxIterations && !wasAborted) {
      const maxIterNote = `\n\n(Reached maximum iterations: ${maxIterations})`
      finalContent = (finalContent || "Task incomplete.") + maxIterNote
      addMessage("assistant", maxIterNote)

      const maxIterStep = createProgressStep(
        "error",
        "Max iterations reached",
        `Agent loop stopped after ${maxIterations} iterations`,
        "error",
      )
      progressSteps.push(maxIterStep)

      emit({
        currentIteration: iteration,
        maxIterations,
        steps: progressSteps.slice(-3),
        isComplete: true,
        finalContent,
      })
    }

    return {
      success: !wasAborted && iteration < maxIterations,
      content: finalContent,
      conversationHistory,
      iterationsUsed: iteration,
      wasAborted,
    }
  } catch (error) {
    diagnosticsService.logError("llm", "Agent mode error", error)
    const errorMessage = `Agent error: ${(error as Error).message}`

    const errorStep = createProgressStep("error", "Agent Error", cleanErrorMessage(errorMessage), "error")
    progressSteps.push(errorStep)

    emit({
      currentIteration: iteration,
      maxIterations,
      steps: progressSteps.slice(-3),
      isComplete: true,
      finalContent: errorMessage,
    })

    return {
      success: false,
      content: errorMessage,
      conversationHistory,
      iterationsUsed: iteration,
      error: errorMessage,
    }
  } finally {
    // Clean up session state
    agentSessionStateManager.cleanupSession(currentSessionId)
  }
}
