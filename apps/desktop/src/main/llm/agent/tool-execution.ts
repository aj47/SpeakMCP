/**
 * Tool Execution Module
 * Handles tool call execution with retry logic and kill switch support
 */

import type { MCPToolCall, MCPToolResult } from "../../mcp-service"
import { agentSessionStateManager } from "../../state"
import { isDebugTools, logTools } from "../../debug"

/**
 * Result from a single tool execution including metadata
 */
export interface ToolExecutionResult {
  toolCall: MCPToolCall
  result: MCPToolResult
  retryCount: number
  cancelledByKill: boolean
}

/**
 * Tool name patterns that require sequential execution to avoid race conditions.
 * These are typically browser automation tools that modify shared state.
 */
export const SEQUENTIAL_EXECUTION_TOOL_PATTERNS: string[] = [
  // Playwright browser tools that modify DOM or browser state
  "browser_click",
  "browser_drag",
  "browser_type",
  "browser_fill_form",
  "browser_hover",
  "browser_press_key",
  "browser_select_option",
  "browser_file_upload",
  "browser_handle_dialog",
  "browser_navigate",
  "browser_navigate_back",
  "browser_close",
  "browser_resize",
  "browser_tabs",
  "browser_wait_for",
  "browser_evaluate",
  "browser_run_code",
  // Vision-based coordinate tools
  "browser_mouse_click_xy",
  "browser_mouse_drag_xy",
  "browser_mouse_move_xy",
]

/**
 * Check if a tool call requires sequential execution based on its name
 */
export function toolRequiresSequentialExecution(toolName: string): boolean {
  const baseName = toolName.includes(":") ? toolName.split(":")[1] : toolName
  return SEQUENTIAL_EXECUTION_TOOL_PATTERNS.some((pattern) => baseName === pattern)
}

/**
 * Check if any tools in the batch require sequential execution
 */
export function batchRequiresSequentialExecution(toolCalls: MCPToolCall[]): boolean {
  return toolCalls.some((tc) => toolRequiresSequentialExecution(tc.name))
}

/**
 * Execute a single tool call with retry logic and kill switch support
 */
export async function executeToolWithRetries(
  toolCall: MCPToolCall,
  executeToolCall: (toolCall: MCPToolCall, onProgress?: (message: string) => void) => Promise<MCPToolResult>,
  currentSessionId: string,
  onToolProgress: (message: string) => void,
  maxRetries: number = 2,
): Promise<ToolExecutionResult> {
  // Check for stop signal before starting
  if (agentSessionStateManager.shouldStopSession(currentSessionId)) {
    return {
      toolCall,
      result: {
        content: [{ type: "text", text: "Tool execution cancelled by emergency kill switch" }],
        isError: true,
      },
      retryCount: 0,
      cancelledByKill: true,
    }
  }

  // Execute tool with cancel-aware race so kill switch can stop mid-tool
  let cancelledByKill = false
  let cancelInterval: ReturnType<typeof setInterval> | null = null

  const stopPromise: Promise<MCPToolResult> = new Promise((resolve) => {
    cancelInterval = setInterval(() => {
      if (agentSessionStateManager.shouldStopSession(currentSessionId)) {
        cancelledByKill = true
        if (cancelInterval) clearInterval(cancelInterval)
        resolve({
          content: [{ type: "text", text: "Tool execution cancelled by emergency kill switch" }],
          isError: true,
        })
      }
    }, 100)
  })

  const execPromise = executeToolCall(toolCall, onToolProgress)
  let result = (await Promise.race([execPromise, stopPromise])) as MCPToolResult

  // Avoid unhandled rejection if the tool promise rejects after we already stopped
  if (cancelledByKill) {
    execPromise.catch(() => {
      /* swallow after kill switch */
    })
  }
  if (cancelInterval) clearInterval(cancelInterval)

  if (cancelledByKill) {
    return {
      toolCall,
      result,
      retryCount: 0,
      cancelledByKill: true,
    }
  }

  // Enhanced retry logic for specific error types
  let retryCount = 0
  while (result.isError && retryCount < maxRetries) {
    // Check kill switch before retrying
    if (agentSessionStateManager.shouldStopSession(currentSessionId)) {
      return {
        toolCall,
        result: {
          content: [{ type: "text", text: "Tool execution cancelled by emergency kill switch" }],
          isError: true,
        },
        retryCount,
        cancelledByKill: true,
      }
    }

    const errorText = result.content.map((c) => c.text).join(" ").toLowerCase()

    // Check if this is a retryable error
    const isRetryableError =
      errorText.includes("timeout") ||
      errorText.includes("connection") ||
      errorText.includes("network") ||
      errorText.includes("temporary") ||
      errorText.includes("busy")

    if (isRetryableError) {
      retryCount++

      // Wait before retry (exponential backoff)
      await new Promise((resolve) => setTimeout(resolve, Math.pow(2, retryCount) * 1000))

      result = await executeToolCall(toolCall, onToolProgress)
    } else {
      break // Don't retry non-transient errors
    }
  }

  return {
    toolCall,
    result,
    retryCount,
    cancelledByKill: false,
  }
}

/**
 * Execute tool calls in parallel
 */
export async function executeToolsInParallel(
  toolCalls: MCPToolCall[],
  executeToolCall: (toolCall: MCPToolCall, onProgress?: (message: string) => void) => Promise<MCPToolResult>,
  currentSessionId: string,
  onToolProgress: (toolIndex: number, message: string) => void,
  maxRetries: number = 2,
): Promise<ToolExecutionResult[]> {
  if (isDebugTools()) {
    logTools(
      `Executing ${toolCalls.length} tool calls in parallel`,
      toolCalls.map((t) => t.name),
    )
  }

  const executionPromises = toolCalls.map(async (toolCall, index) => {
    return executeToolWithRetries(
      toolCall,
      executeToolCall,
      currentSessionId,
      (message) => onToolProgress(index, message),
      maxRetries,
    )
  })

  return Promise.all(executionPromises)
}

/**
 * Execute tool calls sequentially
 */
export async function executeToolsSequentially(
  toolCalls: MCPToolCall[],
  executeToolCall: (toolCall: MCPToolCall, onProgress?: (message: string) => void) => Promise<MCPToolResult>,
  currentSessionId: string,
  onToolProgress: (toolIndex: number, message: string) => void,
  maxRetries: number = 2,
): Promise<ToolExecutionResult[]> {
  if (isDebugTools()) {
    logTools(
      `Executing ${toolCalls.length} tool calls sequentially`,
      toolCalls.map((t) => t.name),
    )
  }

  const results: ToolExecutionResult[] = []

  for (let i = 0; i < toolCalls.length; i++) {
    const toolCall = toolCalls[i]

    // Check for stop signal before executing each tool
    if (agentSessionStateManager.shouldStopSession(currentSessionId)) {
      break
    }

    if (isDebugTools()) {
      logTools("Executing planned tool call", toolCall)
    }

    const result = await executeToolWithRetries(
      toolCall,
      executeToolCall,
      currentSessionId,
      (message) => onToolProgress(i, message),
      maxRetries,
    )

    results.push(result)

    if (result.cancelledByKill) {
      break
    }
  }

  return results
}

/**
 * Build error summary for failed tools
 */
export function buildToolErrorSummary(
  failedTools: string[],
  toolResults: MCPToolResult[],
  recoveryStrategy: string,
): string {
  return `Tool execution errors occurred:
${failedTools
  .map((toolName) => {
    const failedResult = toolResults.find((r) => r.isError)
    const errorText = failedResult?.content.map((c) => c.text).join(" ") || "Unknown error"

    let suggestion = ""
    if (
      errorText.includes("timeout") ||
      errorText.includes("connection") ||
      errorText.includes("network")
    ) {
      suggestion = " (Suggestion: Try again or check connectivity)"
    } else if (
      errorText.includes("permission") ||
      errorText.includes("access") ||
      errorText.includes("denied")
    ) {
      suggestion = " (Suggestion: Try a different approach)"
    } else if (
      errorText.includes("not found") ||
      errorText.includes("missing") ||
      errorText.includes("does not exist")
    ) {
      suggestion = " (Suggestion: Verify the resource exists or try alternatives)"
    } else if (errorText.includes("Expected string, received array")) {
      suggestion = " (Fix: Parameter type mismatch - check tool schema)"
    } else if (errorText.includes("Expected array, received string")) {
      suggestion = " (Fix: Parameter should be an array, not a string)"
    } else if (errorText.includes("invalid_type")) {
      suggestion = " (Fix: Check parameter types match tool schema)"
    }

    return `- ${toolName}: ${errorText}${suggestion}`
  })
  .join("\n")}

${recoveryStrategy}

Please try alternative approaches, break down the task into smaller steps, or provide manual instructions to the user.`
}
