import { configStore } from "./config"
import {
  MCPTool,
  MCPToolCall,
  LLMToolCallResponse,
  MCPToolResult,
} from "./mcp-service"
import { AgentProgressStep, AgentProgressUpdate } from "../shared/types"
import { getRendererHandlers } from "@egoist/tipc/main"
import { WINDOWS, showPanelWindow } from "./window"
import { RendererHandlers } from "./renderer-handlers"
import { diagnosticsService } from "./diagnostics"
import { makeStructuredContextExtraction, ContextExtractionResponse } from "./structured-output"
import { makeLLMCallWithFetch, makeTextCompletionWithFetch } from "./llm-fetch"
import { constructSystemPrompt } from "./system-prompts"
import { state } from "./state"
import { isDebugLLM, logLLM, isDebugTools, logTools } from "./debug"

/**
 * Use LLM to extract useful context from conversation history
 */
async function extractContextFromHistory(
  conversationHistory: Array<{
    role: "user" | "assistant" | "tool"
    content: string
    toolCalls?: MCPToolCall[]
    toolResults?: MCPToolResult[]
  }>,
  config: any,
): Promise<{
  contextSummary: string
  resources: Array<{ type: string; id: string; parameter: string }>
}> {
  if (conversationHistory.length === 0) {
    return { contextSummary: "", resources: [] }
  }

  // Create a condensed version of the conversation for analysis
  const conversationText = conversationHistory
    .map((entry) => {
      let text = `${entry.role.toUpperCase()}: ${entry.content}`

      if (entry.toolCalls) {
        text += `\nTOOL_CALLS: ${entry.toolCalls.map((tc) => `${tc.name}(${JSON.stringify(tc.arguments)})`).join(", ")}`
      }

      if (entry.toolResults) {
        text += `\nTOOL_RESULTS: ${entry.toolResults.map((tr) => (tr.isError ? "ERROR" : "SUCCESS")).join(", ")}`
      }

      return text
    })
    .join("\n\n")

  const contextExtractionPrompt = `Analyze the following conversation history and extract useful context information that would be needed for continuing the conversation.

CONVERSATION HISTORY:
${conversationText}

Your task is to identify and extract:
1. Resource identifiers (session IDs, connection IDs, file handles, workspace IDs, etc.)
2. Important file paths or locations mentioned
3. Current state or status information
4. Any other context that would be useful for subsequent tool calls

Respond with a JSON object in this exact format:
{
  "contextSummary": "Brief summary of the current state and what has been accomplished",
  "resources": [
    {
      "type": "session|connection|handle|workspace|channel|other",
      "id": "the actual ID value",
      "parameter": "the parameter name this ID should be used for (e.g., sessionId, connectionId)"
    }
  ]
}

Focus on extracting actual resource identifiers that tools would need, not just mentioning them.
Only include resources that are currently active and usable.
Keep the contextSummary concise but informative.`

  try {
    const result = await makeStructuredContextExtraction(
      contextExtractionPrompt,
      config.mcpToolsProviderId,
    )
    return result as { contextSummary: string; resources: Array<{ type: string; id: string; parameter: string }> }
  } catch (error) {
    return { contextSummary: "", resources: [] }
  }
}

/**
 * Analyze tool errors and provide recovery strategies
 */
function analyzeToolErrors(toolResults: MCPToolResult[]): {
  recoveryStrategy: string
  errorTypes: string[]
} {
  const errorTypes: string[] = []
  const errorMessages = toolResults
    .filter((r) => r.isError)
    .map((r) => r.content.map((c) => c.text).join(" "))
    .join(" ")

  // Categorize error types
  if (errorMessages.includes("Session not found")) {
    errorTypes.push("session_lost")
  }
  if (
    errorMessages.includes("timeout") ||
    errorMessages.includes("connection")
  ) {
    errorTypes.push("connectivity")
  }
  if (
    errorMessages.includes("permission") ||
    errorMessages.includes("access")
  ) {
    errorTypes.push("permissions")
  }
  if (
    errorMessages.includes("not found") ||
    errorMessages.includes("does not exist")
  ) {
    errorTypes.push("resource_missing")
  }

  // Generate recovery strategy based on error types
  let recoveryStrategy = "RECOVERY STRATEGIES:\n"

  if (errorTypes.includes("session_lost")) {
    recoveryStrategy +=
      "- For session errors: Create a new session using ht_create_session first\n"
  }
  if (errorTypes.includes("connectivity")) {
    recoveryStrategy +=
      "- For connectivity issues: Wait a moment and retry, or check if the service is running\n"
  }
  if (errorTypes.includes("permissions")) {
    recoveryStrategy +=
      "- For permission errors: Try alternative file locations or check access rights\n"
  }
  if (errorTypes.includes("resource_missing")) {
    recoveryStrategy +=
      "- For missing resources: Verify the resource exists or create it first\n"
  }

  if (errorTypes.length === 0) {
    recoveryStrategy +=
      "- General: Try breaking down the task into smaller steps or use alternative tools\n"
  }

  return { recoveryStrategy, errorTypes }
}

export async function postProcessTranscript(transcript: string) {
  const config = configStore.get()

  if (
    !config.transcriptPostProcessingEnabled ||
    !config.transcriptPostProcessingPrompt
  ) {
    return transcript
  }

  const prompt = config.transcriptPostProcessingPrompt.replace(
    "{transcript}",
    transcript,
  )

  const chatProviderId = config.transcriptPostProcessingProviderId

  try {
    const result = await makeTextCompletionWithFetch(prompt, chatProviderId)
    return result
  } catch (error) {
    throw error
  }
}

export async function processTranscriptWithTools(
  transcript: string,
  availableTools: MCPTool[],
): Promise<LLMToolCallResponse> {
  const config = configStore.get()

  if (!config.mcpToolsEnabled) {
    return { content: transcript }
  }

  // Remove duplicates from available tools to prevent confusion
  const uniqueAvailableTools = availableTools.filter(
    (tool, index, self) =>
      index === self.findIndex((t) => t.name === tool.name),
  )

  // Construct system prompt using the new approach
  const userGuidelines = config.mcpToolsSystemPrompt
  const systemPrompt = constructSystemPrompt(
    uniqueAvailableTools,
    userGuidelines,
    false,
  )

  const messages = [
    {
      role: "system",
      content: systemPrompt,
    },
    {
      role: "user",
      content: transcript,
    },
  ]

  const chatProviderId = config.mcpToolsProviderId

  try {
    const result = await makeLLMCallWithFetch(messages, chatProviderId)
    return result
  } catch (error) {
    throw error
  }
}

export interface AgentModeResponse {
  content: string
  conversationHistory: Array<{
    role: "user" | "assistant" | "tool"
    content: string
    toolCalls?: MCPToolCall[]
    toolResults?: MCPToolResult[]
  }>
  totalIterations: number
}

// Helper function to emit progress updates to the renderer with better error handling
function emitAgentProgress(update: AgentProgressUpdate) {
  const panel = WINDOWS.get("panel")
  if (!panel) {
    console.warn("Panel window not available for progress update")
    return
  }

  // Show the panel window if it's not visible
  if (!panel.isVisible()) {
    showPanelWindow()
  }

  // Also send updates to main window if it's open for live progress visualization
  const main = WINDOWS.get("main")
  if (main && main.isVisible()) {
    const mainHandlers = getRendererHandlers<RendererHandlers>(main.webContents)
    setTimeout(() => mainHandlers.agentProgressUpdate.send(update), 10)
  }

  try {
    const handlers = getRendererHandlers<RendererHandlers>(panel.webContents)
    if (!handlers.agentProgressUpdate) {
      console.warn("Agent progress handler not available")
      return
    }

    // Add a small delay to ensure UI updates are processed
    setTimeout(() => {
      try {
        handlers.agentProgressUpdate.send(update)
      } catch (error) {
        console.warn("Failed to send progress update:", error)
      }
    }, 10)
  } catch (error) {
    console.warn("Failed to get renderer handlers:", error)
  }
}

// Helper function to create progress steps
function createProgressStep(
  type: AgentProgressStep["type"],
  title: string,
  description?: string,
  status: AgentProgressStep["status"] = "pending",
): AgentProgressStep {
  return {
    id: `step_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
    type,
    title,
    description,
    status,
    timestamp: Date.now(),
  }
}

// Helper function to analyze tool capabilities and match them to user requests
function analyzeToolCapabilities(
  availableTools: MCPTool[],
  transcript: string,
): { summary: string; relevantTools: MCPTool[] } {
  const transcriptLower = transcript.toLowerCase()
  const relevantTools: MCPTool[] = []

  // Define capability patterns based on common keywords and tool descriptions
  const patterns = {
    filesystem: {
      keywords: [
        "file",
        "directory",
        "folder",
        "desktop",
        "list",
        "ls",
        "contents",
        "browse",
        "create",
        "write",
        "read",
      ],
      toolDescriptionKeywords: [
        "file",
        "directory",
        "folder",
        "filesystem",
        "path",
        "create",
        "write",
        "read",
        "list",
      ],
    },
    terminal: {
      keywords: [
        "command",
        "execute",
        "run",
        "terminal",
        "shell",
        "bash",
        "script",
      ],
      toolDescriptionKeywords: [
        "command",
        "execute",
        "terminal",
        "shell",
        "session",
        "run",
      ],
    },
    system: {
      keywords: ["system", "process", "status", "info", "monitor", "snapshot"],
      toolDescriptionKeywords: [
        "system",
        "process",
        "status",
        "monitor",
        "snapshot",
        "info",
      ],
    },
    web: {
      keywords: ["web", "http", "api", "request", "url", "fetch", "search"],
      toolDescriptionKeywords: [
        "web",
        "http",
        "api",
        "request",
        "url",
        "fetch",
        "search",
        "browser",
      ],
    },
    communication: {
      keywords: [
        "send",
        "message",
        "email",
        "notification",
        "slack",
        "discord",
      ],
      toolDescriptionKeywords: [
        "send",
        "message",
        "email",
        "notification",
        "slack",
        "discord",
        "communicate",
      ],
    },
  }

  // Check which patterns match the transcript
  const matchedCapabilities: string[] = []

  for (const [capability, pattern] of Object.entries(patterns)) {
    const hasKeyword = pattern.keywords.some((keyword) =>
      transcriptLower.includes(keyword),
    )

    // Find tools that match this capability based on their descriptions
    const capabilityTools = availableTools.filter((tool) => {
      const toolNameLower = tool.name.toLowerCase()
      const toolDescLower = tool.description.toLowerCase()

      return pattern.toolDescriptionKeywords.some(
        (keyword) =>
          toolNameLower.includes(keyword) || toolDescLower.includes(keyword),
      )
    })

    if (hasKeyword && capabilityTools.length > 0) {
      matchedCapabilities.push(capability)
      relevantTools.push(...capabilityTools)
    }
  }

  let summary = ""
  if (matchedCapabilities.length > 0) {
    summary = `Detected ${matchedCapabilities.join(", ")} capabilities. Can help with this request using available tools.`
  } else {
    summary = "Analyzing available tools for potential solutions."
  }

  // Remove duplicates from relevant tools
  const uniqueRelevantTools = relevantTools.filter(
    (tool, index, self) =>
      index === self.findIndex((t) => t.name === tool.name),
  )

  return { summary, relevantTools: uniqueRelevantTools }
}

export async function processTranscriptWithAgentMode(
  transcript: string,
  availableTools: MCPTool[],
  executeToolCall: (toolCall: MCPToolCall) => Promise<MCPToolResult>,
  maxIterations: number = 10,
  previousConversationHistory?: Array<{
    role: "user" | "assistant" | "tool"
    content: string
    toolCalls?: MCPToolCall[]
    toolResults?: MCPToolResult[]
  }>,
): Promise<AgentModeResponse> {
  const config = configStore.get()

  if (!config.mcpToolsEnabled || !config.mcpAgentModeEnabled) {
    const fallbackResponse = await processTranscriptWithTools(
      transcript,
      availableTools,
    )
    return {
      content: fallbackResponse.content || "",
      conversationHistory: [
        { role: "user", content: transcript },
        { role: "assistant", content: fallbackResponse.content || "" },
      ],
      totalIterations: 1,
    }
  }

  // Initialize progress tracking
  const progressSteps: AgentProgressStep[] = []

  // Add initial step
  const initialStep = createProgressStep(
    "thinking",
    "Analyzing request",
    "Processing your request and determining next steps",
    "in_progress",
  )
  progressSteps.push(initialStep)

  // Analyze available tool capabilities
  const toolCapabilities = analyzeToolCapabilities(availableTools, transcript)

  // Update initial step with tool analysis
  initialStep.status = "completed"
  initialStep.description = `Found ${availableTools.length} available tools. ${toolCapabilities.summary}`

  // Remove duplicates from available tools to prevent confusion
  const uniqueAvailableTools = availableTools.filter(
    (tool, index, self) =>
      index === self.findIndex((t) => t.name === tool.name),
  )

  // Enhanced user guidelines for agent mode
  let agentModeGuidelines = config.mcpToolsSystemPrompt || ""

  // Add default context awareness guidelines if no custom guidelines provided
  if (!config.mcpToolsSystemPrompt?.trim()) {
    agentModeGuidelines = `CONTEXT AWARENESS:
- Maintain awareness of files created, modified, or referenced in previous operations
- When asked to read "the file" or "that file", refer to the most recently created or mentioned file
- Remember session IDs from terminal operations to reuse them when appropriate
- Build upon previous actions rather than starting from scratch`
  }

  // Construct system prompt using the new approach
  const systemPrompt = constructSystemPrompt(
    uniqueAvailableTools,
    agentModeGuidelines,
    true,
    toolCapabilities.relevantTools,
  )

  // Generic context extraction from chat history - works with any MCP tool
  const extractRecentContext = (
    history: Array<{
      role: string
      content: string
      toolCalls?: any[]
      toolResults?: any[]
    }>,
  ) => {
    // Simply return the recent conversation history - let the LLM understand the context
    // This is much simpler and works with any MCP tool, not just specific ones
    return history.slice(-8) // Last 8 messages provide sufficient context
  }

  const conversationHistory: Array<{
    role: "user" | "assistant" | "tool"
    content: string
    toolCalls?: MCPToolCall[]
    toolResults?: MCPToolResult[]
  }> = [
    ...(previousConversationHistory || []),
    { role: "user", content: transcript },
  ]

  // Helper function to convert conversation history to the format expected by AgentProgressUpdate
  const formatConversationForProgress = (
    history: typeof conversationHistory,
  ) => {
    return history.map((entry) => ({
      role: entry.role,
      content: entry.content,
      toolCalls: entry.toolCalls?.map((tc) => ({
        name: tc.name,
        arguments: tc.arguments,
      })),
      toolResults: entry.toolResults?.map((tr) => ({
        success: !tr.isError,
        content: tr.content.map((c) => c.text).join("\n"),
        error: tr.isError
          ? tr.content.map((c) => c.text).join("\n")
          : undefined,
      })),
      timestamp: Date.now(),
    }))
  }

  // Emit initial progress
  emitAgentProgress({
    currentIteration: 0,
    maxIterations,
    steps: progressSteps.slice(-3), // Show max 3 steps
    isComplete: false,
    conversationHistory: formatConversationForProgress(conversationHistory),
  })

  // Get recent context for the LLM - no specific extraction needed
  const recentContext = extractRecentContext(conversationHistory)

  let iteration = 0
  let finalContent = ""
  let noOpCount = 0 // Track iterations without meaningful progress

  while (iteration < maxIterations) {
    iteration++

    // Check for stop signal
    if (state.shouldStopAgent) {
      console.log("Agent mode stopped by kill switch")

      // Add emergency stop step
      const stopStep = createProgressStep(
        "completion",
        "Agent stopped",
        "Agent mode was stopped by emergency kill switch",
        "error",
      )
      progressSteps.push(stopStep)

      // Emit final progress
      emitAgentProgress({
        currentIteration: iteration,
        maxIterations,
        steps: progressSteps.slice(-3),
        isComplete: true,
        finalContent:
          finalContent +
          "\n\n(Agent mode was stopped by emergency kill switch)",
        conversationHistory: formatConversationForProgress(conversationHistory),
      })

      break
    }

    // Update iteration count in state
    state.agentIterationCount = iteration

    // Update initial step to completed and add thinking step for this iteration
    if (iteration === 1) {
      initialStep.status = "completed"
    }

    const thinkingStep = createProgressStep(
      "thinking",
      `Processing request (iteration ${iteration})`,
      "Analyzing request and planning next actions",
      "in_progress",
    )
    progressSteps.push(thinkingStep)

    // Emit progress update for thinking step
    emitAgentProgress({
      currentIteration: iteration,
      maxIterations,
      steps: progressSteps.slice(-3),
      isComplete: false,
      conversationHistory: formatConversationForProgress(conversationHistory),
    })

    // Use the base system prompt - let the LLM understand context from conversation history
    let contextAwarePrompt = systemPrompt

    // Add enhanced context instruction using LLM-based context extraction
    if (recentContext.length > 1) {
      // Use LLM to extract useful context from conversation history
      const contextInfo = await extractContextFromHistory(
        conversationHistory,
        config,
      )

      contextAwarePrompt += `\n\nCONTEXT AWARENESS:
You have access to the recent conversation history. Use this history to understand:
- Any resources (sessions, files, connections, etc.) that were created or mentioned
- Previous tool calls and their results
- User preferences and workflow patterns
- Any ongoing tasks or processes

${
  contextInfo.contextSummary
    ? `
CURRENT CONTEXT:
${contextInfo.contextSummary}
`
    : ""
}

${
  contextInfo.resources.length > 0
    ? `
AVAILABLE RESOURCES:
${contextInfo.resources.map((r) => `- ${r.type.toUpperCase()}: ${r.id} (use as parameter: ${r.parameter})`).join("\n")}

CRITICAL: When using tools that require resource IDs, you MUST use the exact resource IDs listed above.
DO NOT create fictional or made-up resource identifiers.
`
    : ""
}

RESOURCE USAGE GUIDELINES:
- Always check the conversation history for existing resource IDs before creating new ones
- Use the exact resource ID values provided above
- Match the resource ID to the correct parameter name as specified
- If no suitable resource is available, create a new one using the appropriate creation tool first

NEVER invent resource IDs like "my-session-123" or "temp-connection-id".
Always use actual resource IDs from the conversation history or create new ones properly.`
    }

    // Build messages for LLM call
    const messages = [
      { role: "system", content: contextAwarePrompt },
      ...conversationHistory.map((entry) => {
        if (entry.role === "tool") {
          return {
            role: "user" as const,
            content: `Tool execution results:\n${entry.content}`,
          }
        }
        return {
          role: entry.role as "user" | "assistant",
          content: entry.content,
        }
      }),
    ]

    // Make LLM call
    const llmResponse = await makeLLMCall(messages, config)

    // Display LLM response content to user
    if (llmResponse.content) {
      console.log(llmResponse.content)
    }

    // Update thinking step with actual LLM content and mark as completed
    thinkingStep.status = "completed"
    thinkingStep.llmContent = llmResponse.content || ""
    if (llmResponse.content) {
      // Update title and description to be more meaningful
      thinkingStep.title = "Agent response"
      thinkingStep.description =
        llmResponse.content.length > 100
          ? llmResponse.content.substring(0, 100) + "..."
          : llmResponse.content
    }

    // Emit progress update with the LLM content immediately after setting it
    emitAgentProgress({
      currentIteration: iteration,
      maxIterations,
      steps: progressSteps.slice(-3),
      isComplete: false,
      conversationHistory: formatConversationForProgress(conversationHistory),
    })

    // Check for explicit completion signal
    const toolCallsArray: MCPToolCall[] = Array.isArray(
      (llmResponse as any).toolCalls,
    )
      ? (llmResponse as any).toolCalls
      : []
    if (isDebugTools()) {
      if (
        (llmResponse as any).toolCalls &&
        !Array.isArray((llmResponse as any).toolCalls)
      ) {
        logTools("Non-array toolCalls received from LLM", {
          receivedType: typeof (llmResponse as any).toolCalls,
          value: (llmResponse as any).toolCalls,
        })
      }
      logTools("Planned tool calls from LLM", toolCallsArray)
    }
    const hasToolCalls = toolCallsArray.length > 0
    const explicitlyComplete = llmResponse.needsMoreWork === false

    if (explicitlyComplete && !hasToolCalls) {
      // Agent explicitly indicated completion
      const assistantContent = llmResponse.content || ""

      // Ensure the agent provides a meaningful summary
      if (!assistantContent.trim() || assistantContent.length < 20) {
        // Force the agent to provide a summary by continuing the conversation
        const summaryPrompt = `Please provide a brief summary of your response and what you determined regarding the user's request.`

        conversationHistory.push({
          role: "user",
          content: summaryPrompt,
        })

        // Continue to next iteration to get the summary
        continue
      }

      finalContent = assistantContent
      conversationHistory.push({
        role: "assistant",
        content: finalContent,
      })

      // Add completion step
      const completionStep = createProgressStep(
        "completion",
        "Task completed",
        "Successfully completed the requested task",
        "completed",
      )
      progressSteps.push(completionStep)

      // Emit final progress
      emitAgentProgress({
        currentIteration: iteration,
        maxIterations,
        steps: progressSteps.slice(-3),
        isComplete: true,
        finalContent,
        conversationHistory: formatConversationForProgress(conversationHistory),
      })

      break
    }

    // Handle no-op iterations (no tool calls and no explicit completion)
    if (!hasToolCalls) {
      noOpCount++

      // Check if this is an actionable request that should have executed tools
      const isActionableRequest = toolCapabilities.relevantTools.length > 0

      if (noOpCount >= 2 || (isActionableRequest && noOpCount >= 1)) {
        // Add nudge to push the agent forward
        conversationHistory.push({
          role: "assistant",
          content: llmResponse.content || "",
        })

        const nudgeMessage = isActionableRequest
          ? "You have relevant tools available for this request. Please choose and call at least one tool to make progress, or if you truly cannot proceed, explicitly set needsMoreWork=false and provide a detailed explanation of why no action can be taken."
          : "Please either take action using available tools or explicitly set needsMoreWork=false if the task is complete."

        conversationHistory.push({
          role: "user",
          content: nudgeMessage,
        })

        noOpCount = 0 // Reset counter after nudge
        continue
      }
    } else {
      // Reset no-op counter when tools are called
      noOpCount = 0
    }

    // Execute tool calls with enhanced error handling
    const toolResults: MCPToolResult[] = []
    const failedTools: string[] = []

    for (const toolCall of toolCallsArray) {
      if (isDebugTools()) {
        logTools("Executing planned tool call", toolCall)
      }
      // Check for stop signal before executing each tool
      if (state.shouldStopAgent) {
        console.log("Agent mode stopped during tool execution")
        break
      }

      // Add tool call step
      const toolCallStep = createProgressStep(
        "tool_call",
        `Executing ${toolCall.name}`,
        `Running tool with arguments: ${JSON.stringify(toolCall.arguments)}`,
        "in_progress",
      )
      toolCallStep.toolCall = {
        name: toolCall.name,
        arguments: toolCall.arguments,
      }
      progressSteps.push(toolCallStep)

      // Emit progress update
      emitAgentProgress({
        currentIteration: iteration,
        maxIterations,
        steps: progressSteps.slice(-3),
        isComplete: false,
        conversationHistory: formatConversationForProgress(conversationHistory),
      })

      // Execute tool with retry logic for transient failures
      let result = await executeToolCall(toolCall)
      let retryCount = 0
      const maxRetries = 2

      // Enhanced retry logic for specific error types
      while (result.isError && retryCount < maxRetries) {
        const errorText = result.content
          .map((c) => c.text)
          .join(" ")
          .toLowerCase()

        // Check if this is a retryable error
        const isRetryableError =
          errorText.includes("timeout") ||
          errorText.includes("connection") ||
          errorText.includes("network") ||
          errorText.includes("temporary") ||
          errorText.includes("busy") ||
          errorText.includes("session not found") // Add session errors as retryable

        if (isRetryableError) {
          retryCount++

          // Special handling for resource-related errors
          if (
            errorText.includes("not found") ||
            errorText.includes("invalid") ||
            errorText.includes("expired")
          ) {
            // The retry mechanism will benefit from the updated context extraction
            // which will provide the correct resource IDs from conversation history
          }

          // Wait before retry (exponential backoff)
          await new Promise((resolve) =>
            setTimeout(resolve, Math.pow(2, retryCount) * 1000),
          )

          result = await executeToolCall(toolCall)
        } else {
          break // Don't retry non-transient errors
        }
      }

      toolResults.push(result)

      // Track failed tools for better error reporting
      if (result.isError) {
        failedTools.push(toolCall.name)
      }

      // Context is now extracted from conversation history, no need to track manually

      // Update tool call step with result
      toolCallStep.status = result.isError ? "error" : "completed"
      toolCallStep.toolResult = {
        success: !result.isError,
        content: result.content.map((c) => c.text).join("\n"),
        error: result.isError
          ? result.content.map((c) => c.text).join("\n")
          : undefined,
      }

      // Add tool result step with enhanced error information
      const toolResultStep = createProgressStep(
        "tool_result",
        `${toolCall.name} ${result.isError ? "failed" : "completed"}`,
        result.isError
          ? `Tool execution failed${retryCount > 0 ? ` after ${retryCount} retries` : ""}`
          : "Tool executed successfully",
        result.isError ? "error" : "completed",
      )
      toolResultStep.toolResult = toolCallStep.toolResult
      progressSteps.push(toolResultStep)

      // Emit progress update
      emitAgentProgress({
        currentIteration: iteration,
        maxIterations,
        steps: progressSteps.slice(-3),
        isComplete: false,
        conversationHistory: formatConversationForProgress(conversationHistory),
      })
    }

    // Add assistant response and tool results to conversation
    conversationHistory.push({
      role: "assistant",
      content: llmResponse.content || "",
      toolCalls: llmResponse.toolCalls!,
    })

    const toolResultsText = toolResults
      .map((result) => result.content.map((c) => c.text).join("\n"))
      .join("\n\n")

    conversationHistory.push({
      role: "tool",
      content: toolResultsText,
      toolResults,
    })

    // Enhanced completion detection with better error handling
    const hasErrors = toolResults.some((result) => result.isError)
    const allToolsSuccessful = toolResults.length > 0 && !hasErrors

    if (hasErrors) {
      // Enhanced error analysis and recovery suggestions
      const errorAnalysis = analyzeToolErrors(toolResults)

      // Add detailed error summary to conversation history for LLM context
      const errorSummary = `Tool execution errors occurred:
${failedTools
  .map((toolName) => {
    const failedResult = toolResults.find((r) => r.isError)
    const errorText =
      failedResult?.content.map((c) => c.text).join(" ") || "Unknown error"

    // Check for specific error patterns and suggest fixes
    let suggestion = ""
    if (errorText.includes("Session not found")) {
      suggestion =
        " (Suggestion: Create a new session using ht_create_session first)"
    } else if (
      errorText.includes("timeout") ||
      errorText.includes("connection")
    ) {
      suggestion =
        " (Suggestion: Retry the operation or check server connectivity)"
    } else if (
      errorText.includes("permission") ||
      errorText.includes("access")
    ) {
      suggestion =
        " (Suggestion: Check file permissions or use alternative approach)"
    }

    return `- ${toolName}: ${errorText}${suggestion}`
  })
  .join("\n")}

${errorAnalysis.recoveryStrategy}

IMPORTANT: If you see session-related errors, you MUST create a new session first using ht_create_session,
then extract the session ID from the response and use it in subsequent tool calls.

Please try alternative approaches or provide manual instructions to the user.`

      conversationHistory.push({
        role: "tool",
        content: errorSummary,
      })
    }

    // Check if agent indicated it was done after executing tools
    const agentIndicatedDone = llmResponse.needsMoreWork === false

    if (agentIndicatedDone && allToolsSuccessful) {
      // Agent indicated completion, but we need to ensure it provides a summary
      // Check if the last assistant message provides a meaningful summary
      const lastAssistantContent = llmResponse.content || ""

      // If the agent only made tool calls without providing a summary, request one
      if (!lastAssistantContent.trim() || lastAssistantContent.length < 20) {
        // Force the agent to provide a summary by continuing the conversation
        const summaryPrompt = `Please provide a brief summary of what you accomplished and the results of your actions. Include what worked well and any issues encountered.`

        conversationHistory.push({
          role: "user",
          content: summaryPrompt,
        })

        // Continue to next iteration to get the summary
        // Set final content to the latest assistant response (fallback)
        if (!finalContent) {
          finalContent = llmResponse.content || ""
        }
        continue
      }

      // Create final content that includes the agent's summary
      finalContent = lastAssistantContent

      // Add completion step
      const completionStep = createProgressStep(
        "completion",
        "Task completed",
        "Successfully completed the requested task with summary",
        "completed",
      )
      progressSteps.push(completionStep)

      // Emit final progress
      emitAgentProgress({
        currentIteration: iteration,
        maxIterations,
        steps: progressSteps.slice(-3),
        isComplete: true,
        finalContent,
        conversationHistory: formatConversationForProgress(conversationHistory),
      })

      break
    }

    // Continue iterating if needsMoreWork is true (explicitly set) or undefined (default behavior)
    // Only stop if needsMoreWork is explicitly false or we hit max iterations
    const shouldContinue = llmResponse.needsMoreWork !== false
    if (!shouldContinue) {
      // Agent explicitly indicated no more work needed, but ensure it provides a summary
      const assistantContent = llmResponse.content || ""

      // Ensure the agent provides a meaningful summary
      if (!assistantContent.trim() || assistantContent.length < 20) {
        // Force the agent to provide a summary by continuing the conversation
        const summaryPrompt = `Please provide a brief summary of what you accomplished and the current status of the task.`

        conversationHistory.push({
          role: "user",
          content: summaryPrompt,
        })

        // Continue to next iteration to get the summary
        continue
      }

      finalContent = assistantContent
      conversationHistory.push({
        role: "assistant",
        content: finalContent,
      })

      const completionStep = createProgressStep(
        "completion",
        "Task completed",
        "Agent indicated no more work needed",
        "completed",
      )
      progressSteps.push(completionStep)

      emitAgentProgress({
        currentIteration: iteration,
        maxIterations,
        steps: progressSteps.slice(-3),
        isComplete: true,
        finalContent,
        conversationHistory: formatConversationForProgress(conversationHistory),
      })

      break
    }

    // Set final content to the latest assistant response (fallback)
    if (!finalContent) {
      finalContent = llmResponse.content || ""
    }
  }

  if (iteration >= maxIterations) {
    // Handle maximum iterations reached - always ensure we have a meaningful summary
    const hasRecentErrors = progressSteps
      .slice(-5)
      .some((step) => step.status === "error")

    // If we don't have meaningful final content, get the last assistant response or provide fallback
    if (!finalContent || finalContent.trim().length < 20) {
      const lastAssistantMessage = conversationHistory
        .slice()
        .reverse()
        .find((msg) => msg.role === "assistant")

      if (
        lastAssistantMessage &&
        lastAssistantMessage.content.trim().length >= 20
      ) {
        finalContent = lastAssistantMessage.content
      } else {
        // Provide a fallback summary
        finalContent = hasRecentErrors
          ? "Task was interrupted due to repeated tool failures. Please review the errors above and try again with alternative approaches."
          : "Task reached maximum iteration limit while still in progress. Some actions may have been completed successfully - please review the tool results above."
      }
    }

    // Add context about the termination reason
    const terminationNote = hasRecentErrors
      ? "\n\n(Note: Task incomplete due to repeated tool failures. Please try again or use alternative methods.)"
      : "\n\n(Note: Task may not be fully complete - reached maximum iteration limit. The agent was still working on the request.)"

    finalContent += terminationNote

    // Make sure the final message is added to conversation history
    const lastMessage = conversationHistory[conversationHistory.length - 1]
    if (
      !lastMessage ||
      lastMessage.role !== "assistant" ||
      lastMessage.content !== finalContent
    ) {
      conversationHistory.push({
        role: "assistant",
        content: finalContent,
      })
    }

    // Add timeout completion step with better context
    const timeoutStep = createProgressStep(
      "completion",
      "Maximum iterations reached",
      hasRecentErrors
        ? "Task stopped due to repeated tool failures"
        : "Task stopped due to iteration limit",
      "error",
    )
    progressSteps.push(timeoutStep)

    // Emit final progress
    emitAgentProgress({
      currentIteration: iteration,
      maxIterations,
      steps: progressSteps.slice(-3),
      isComplete: true,
      finalContent,
      conversationHistory: formatConversationForProgress(conversationHistory),
    })
  }

  // Reset the stop flag at the end of agent processing
  state.shouldStopAgent = false

  return {
    content: finalContent,
    conversationHistory,
    totalIterations: iteration,
  }
}

async function makeLLMCall(
  messages: Array<{ role: string; content: string }>,
  config: any,
): Promise<LLMToolCallResponse> {
  const chatProviderId = config.mcpToolsProviderId

  try {
    if (isDebugLLM()) {
      logLLM("Messages →", messages)
    }
    const result = await makeLLMCallWithFetch(messages, chatProviderId)
    if (isDebugLLM()) {
      logLLM("Response ←", result)
    }
    return result
  } catch (error) {
    diagnosticsService.logError("llm", "Agent LLM call failed", error)
    throw error
  }
}
