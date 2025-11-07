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
import { makeLLMCallWithFetch, makeTextCompletionWithFetch, verifyCompletionWithFetch } from "./llm-fetch"
import { constructSystemPrompt } from "./system-prompts"
import { state, agentSessionStateManager } from "./state"
import { isDebugLLM, logLLM, isDebugTools, logTools } from "./debug"
import { shrinkMessagesForLLM } from "./context-budget"
import { agentSessionTracker } from "./agent-session-tracker"

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
 * Analyze tool errors and provide generic recovery strategies
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

  // Categorize error types generically
  if (
    errorMessages.includes("timeout") ||
    errorMessages.includes("connection")
  ) {
    errorTypes.push("connectivity")
  }
  if (
    errorMessages.includes("permission") ||
    errorMessages.includes("access") ||
    errorMessages.includes("denied")
  ) {
    errorTypes.push("permissions")
  }
  if (
    errorMessages.includes("not found") ||
    errorMessages.includes("does not exist") ||
    errorMessages.includes("missing")
  ) {
    errorTypes.push("resource_missing")
  }

  // Generate generic recovery strategy
  let recoveryStrategy = "RECOVERY STRATEGIES:\n"

  if (errorTypes.includes("connectivity")) {
    recoveryStrategy +=
      "- For connectivity issues: Wait a moment and retry, or check if the service is available\n"
  }
  if (errorTypes.includes("permissions")) {
    recoveryStrategy +=
      "- For permission errors: Try alternative approaches or check access rights\n"
  }
  if (errorTypes.includes("resource_missing")) {
    recoveryStrategy +=
      "- For missing resources: Verify the resource exists or try creating it first\n"
  }

  // Always provide generic fallback advice
  recoveryStrategy +=
    "- General: Try breaking down the task into smaller steps, use alternative tools, or try a different approach\n"

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

  let prompt = config.transcriptPostProcessingPrompt

  // Check if the prompt contains the {transcript} placeholder
  if (prompt.includes("{transcript}")) {
    // Replace all occurrences of the placeholder with the actual transcript
    prompt = prompt.replaceAll("{transcript}", transcript)
  } else {
    // If no placeholder is found, append the transcript to the prompt
    prompt = prompt + "\n\n" + transcript
  }

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

  // Apply context budget management before LLM call
  const { messages: shrunkMessages } = await shrinkMessagesForLLM({
    messages,
    availableTools: uniqueAvailableTools,
    isAgentMode: false,
  })

  const chatProviderId = config.mcpToolsProviderId

  try {
    const result = await makeLLMCallWithFetch(shrunkMessages, chatProviderId)
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
// Note: This function now expects sessionId to be included in the update object
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
  conversationId?: string, // Conversation ID for linking to conversation history
  sessionId?: string, // Session ID for progress routing and isolation
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

  // Store IDs for use in progress updates
  const currentConversationId = conversationId
  const currentSessionId = sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

  // Create session state for this agent run
  agentSessionStateManager.createSession(currentSessionId)

  // Create bound emitter that always includes sessionId, conversationId, and snooze state
  const emit = (update: Omit<AgentProgressUpdate, 'sessionId' | 'conversationId' | 'isSnoozed'>) => {
    const isSnoozed = agentSessionTracker.isSessionSnoozed(currentSessionId)

    emitAgentProgress({
      ...update,
      sessionId: currentSessionId,
      conversationId: currentConversationId,
      isSnoozed,
    })
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
    timestamp?: number
  }> = [
    ...(previousConversationHistory || []),
    { role: "user", content: transcript, timestamp: Date.now() },
  ]

  // Helper function to convert conversation history to the format expected by AgentProgressUpdate
  const formatConversationForProgress = (
    history: typeof conversationHistory,
  ) => {
    const isNudge = (content: string) =>
      content.includes("Please either take action using available tools") ||
      content.includes("You have relevant tools available for this request")

    return history
      .filter((entry) => !(entry.role === "user" && isNudge(entry.content)))
      .map((entry) => ({
        role: entry.role,
        content: entry.content,
        toolCalls: entry.toolCalls?.map((tc) => ({
          name: tc.name,
          arguments: tc.arguments,
        })),
        toolResults: entry.toolResults?.map((tr) => {
          // Safely handle content - it should be an array, but add defensive check
          const contentText = Array.isArray(tr.content)
            ? tr.content.map((c) => c.text).join("\n")
            : String(tr.content || "")

          return {
            success: !tr.isError,
            content: contentText,
            error: tr.isError ? contentText : undefined,
          }
        }),
        // Preserve original timestamp if available, otherwise use current time
        timestamp: entry.timestamp || Date.now(),
      }))
  }

  // Build compact verification messages (schema-first verifier)
  const buildVerificationMessages = (finalAssistantText: string) => {
    const maxItems = Math.max(1, config.mcpVerifyContextMaxItems || 10)
    const recent = conversationHistory.slice(-maxItems)
    const messages: Array<{ role: "user" | "assistant" | "system"; content: string }> = []
    messages.push({
      role: "system",
      content:
        "You are a strict completion verifier. Determine if the user's original request has been fully satisfied in the conversation. Be conservative: if uncertain, mark not complete and list what's missing. Return ONLY JSON per schema.",
    })
    messages.push({ role: "user", content: `Original request:\n${transcript}` })
    for (const entry of recent) {
      if (entry.role === "tool") {
        const text = (entry.content || "").trim()
        if (text) messages.push({ role: "user", content: `Tool results:\n${text}` })
      } else {
        messages.push({ role: entry.role, content: entry.content })
      }
    }
    if (finalAssistantText?.trim()) {
      messages.push({ role: "assistant", content: finalAssistantText })
    }
    messages.push({
      role: "user",
      content:
        "Return a JSON object with fields: isComplete (boolean), confidence (0..1), missingItems (string[]), reason (string). No extra commentary.",
    })
    return messages
  }


  // Emit initial progress
  emit({
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

  let executedToolsThisIteration = false // Whether any tools were executed in the current iteration

  let verificationFailCount = 0 // Count consecutive verification failures to avoid loops

  while (iteration < maxIterations) {
    iteration++

    // Check for stop signal (session-specific or global)
    if (agentSessionStateManager.shouldStopSession(currentSessionId)) {
      console.log(`Agent session ${currentSessionId} stopped by kill switch`)

      // Add emergency stop step
      const stopStep = createProgressStep(
        "completion",
        "Agent stopped",
        "Agent mode was stopped by emergency kill switch",
        "error",
      )
      progressSteps.push(stopStep)

      // Emit final progress
      emit({
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

    // Update iteration count in session state
    agentSessionStateManager.updateIterationCount(currentSessionId, iteration)

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
    emit({
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
      ...conversationHistory
        .map((entry) => {
          if (entry.role === "tool") {
            const text = (entry.content || "").trim()
            if (!text) return null
            return {
              role: "user" as const,
              content: `Tool execution results:\n${entry.content}`,
            }
          }
          return {
            role: entry.role as "user" | "assistant",
            content: entry.content,
          }
        })
        .filter(Boolean as any),
    ]

    // Apply context budget management before the agent LLM call
    const { messages: shrunkMessages } = await shrinkMessagesForLLM({
      messages: messages as any,
      availableTools: uniqueAvailableTools,
      relevantTools: toolCapabilities.relevantTools,
      isAgentMode: true,
    })


    // Make LLM call (abort-aware)
    let llmResponse: any
    try {
      llmResponse = await makeLLMCall(shrunkMessages, config)
    } catch (error: any) {
      if (error?.name === "AbortError" || agentSessionStateManager.shouldStopSession(currentSessionId)) {
        console.log(`LLM call aborted for session ${currentSessionId} due to emergency stop`)
        thinkingStep.status = "completed"
        thinkingStep.title = "Agent stopped"
        thinkingStep.description = "Emergency stop triggered"
        emit({
          currentIteration: iteration,
          maxIterations,
          steps: progressSteps.slice(-3),
          isComplete: true,
          finalContent: finalContent + "\n\n(Agent mode was stopped by emergency kill switch)",
          conversationHistory: formatConversationForProgress(conversationHistory),
        })
        break
      }

      // Handle empty/null response errors gracefully
      const errorMessage = (error?.message || String(error)).toLowerCase()
      if (errorMessage.includes("empty") || errorMessage.includes("no text") || errorMessage.includes("no content")) {
        console.error(`LLM empty response on iteration ${iteration}:`, error?.message || error)
        diagnosticsService.logError("llm", "Empty LLM response in agent mode", error)
        thinkingStep.status = "error"
        thinkingStep.description = "Empty response. Retrying..."
        emit({
          currentIteration: iteration,
          maxIterations,
          steps: progressSteps.slice(-3),
          isComplete: false,
          conversationHistory: formatConversationForProgress(conversationHistory),
        })
        conversationHistory.push({ role: "user", content: "Previous request had empty response. Please retry or summarize progress." })
        continue
      }

      throw error
    }

    // Validate response is not null/empty
    if (!llmResponse || !llmResponse.content) {
      console.error(`❌ LLM null/empty response on iteration ${iteration}`)
      console.error("Response details:", {
        hasResponse: !!llmResponse,
        responseType: typeof llmResponse,
        responseKeys: llmResponse ? Object.keys(llmResponse) : [],
        content: llmResponse?.content,
        contentType: typeof llmResponse?.content,
        hasToolCalls: !!llmResponse?.toolCalls,
        toolCallsCount: llmResponse?.toolCalls?.length || 0,
        needsMoreWork: llmResponse?.needsMoreWork,
        fullResponse: JSON.stringify(llmResponse, null, 2)
      })
      diagnosticsService.logError("llm", "Null/empty LLM response in agent mode", {
        iteration,
        response: llmResponse,
        message: "LLM response is null or has no content"
      })
      thinkingStep.status = "error"
      thinkingStep.description = "Invalid response. Retrying..."
      emit({
        currentIteration: iteration,
        maxIterations,
        steps: progressSteps.slice(-3),
        isComplete: false,
        conversationHistory: formatConversationForProgress(conversationHistory),
      })
      conversationHistory.push({ role: "user", content: "Previous request had invalid response. Please retry or summarize progress." })
      continue
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
    emit({
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
    // Track whether tools are planned this iteration
    executedToolsThisIteration = toolCallsArray.length > 0

      }
      logTools("Planned tool calls from LLM", toolCallsArray)
    }
    const hasToolCalls = toolCallsArray.length > 0
    const explicitlyComplete = llmResponse.needsMoreWork === false

    if (explicitlyComplete && !hasToolCalls) {
      // Agent claims completion but provided no toolCalls.
      // If the content still contains tool-call markers, treat as not complete and nudge for structured toolCalls.
      const contentText = (llmResponse.content || "")
      const hasToolMarkers = /<\|tool_calls_section_begin\|>|<\|tool_call_begin\|>/i.test(contentText)
      if (hasToolMarkers) {
        conversationHistory.push({ role: "assistant", content: contentText.replace(/<\|[^|]*\|>/g, "").trim() })
        conversationHistory.push({ role: "user", content: "Please return a valid JSON object with toolCalls per the schema so we can proceed." })
        continue
      }

      // If actionable tools exist and the assistant only states intent (no toolCalls), do not finalize.
      const intentOnly = /\b(fetching|get(ting)?|retriev(ing|e)|searching|planning|analyzing|processing|scanning|starting|preparing|i'?ll|i\s+will|let'?s|trying|attempting|checking|reading|writing|applying|connecting|opening|creating|updating|deleting|installing|running)\b/i.test(contentText)
      if (intentOnly) {
        conversationHistory.push({ role: "assistant", content: contentText.trim() })
        conversationHistory.push({ role: "user", content: "Important: Use the available tools to actually perform the steps. Reply with a valid JSON object per the tool-calling schema, including a toolCalls array with concrete parameters. Do not only state intent." })
        continue
      }

      // Agent explicitly indicated completion
      const assistantContent = llmResponse.content || ""

      finalContent = assistantContent
      conversationHistory.push({ role: "assistant", content: finalContent })

      // If there are actionable tools and no tool results yet, do not verify or finalize.
      // Nudge the model to produce structured toolCalls to actually perform the work.
      const hasToolResultsSoFar = conversationHistory.some((e) => e.role === "tool")
      const hasActionableTools = toolCapabilities.relevantTools.length > 0
      if (hasActionableTools && !hasToolResultsSoFar) {
        conversationHistory.push({
          role: "user",
          content:
            "Before marking complete: use the available tools to actually perform the steps. Reply with a valid JSON object per the tool-calling schema, including a toolCalls array with concrete parameters.",
        })
        noOpCount = 0
        continue
      }

      // Optional verification before completing
      if (config.mcpVerifyCompletionEnabled) {
        const verifyStep = createProgressStep(
          "thinking",
          "Verifying completion",
          "Checking that the user's request has been achieved",
          "in_progress",
        )
        progressSteps.push(verifyStep)
        emit({
          currentIteration: iteration,
          maxIterations,
          steps: progressSteps.slice(-3),
          isComplete: false,
          conversationHistory: formatConversationForProgress(conversationHistory),
        })

        const retries = Math.max(0, config.mcpVerifyRetryCount ?? 1)
        let verified = false
        let verification: any = null
        for (let i = 0; i <= retries; i++) {
          verification = await verifyCompletionWithFetch(buildVerificationMessages(finalContent), config.mcpToolsProviderId)
          if (verification?.isComplete === true) { verified = true; break }
        }

        if (!verified) {
          verifyStep.status = "error"
          verifyStep.description = "Verification failed: continuing to address missing items"
          const missing = (verification?.missingItems || []).filter((s: string) => s && s.trim()).map((s: string) => `- ${s}`).join("\n")
          const reason = verification?.reason ? `Reason: ${verification.reason}` : ""
          const userNudge = `Verifier indicates the task is not complete.\n${reason}\n${missing ? `Missing items:\n${missing}` : ""}\nPlease continue and complete the remaining work.`
          conversationHistory.push({ role: "user", content: userNudge })
          verificationFailCount++
          // If we haven't executed any tools and we keep failing verification, demand structured tool calls
          const hasToolResultsSoFar = conversationHistory.some((e) => e.role === "tool")
          if (!hasToolResultsSoFar && verificationFailCount >= 2) {
            conversationHistory.push({ role: "user", content: "Important: Do not just state intent. Use available tools and reply with a valid JSON object that includes a toolCalls array with concrete parameters to fetch IDs and apply labels." })
          verificationFailCount = 0 // reset on success

          }
          noOpCount = 0
          continue
        }
        verifyStep.status = "completed"
        verifyStep.description = "Verification passed"
      }

        // Post-verify: produce a concise final summary for the user
        try {
          const postVerifySummaryStep = createProgressStep(
            "thinking",
            "Summarizing results",
            "Creating a concise final summary of what was achieved",
            "in_progress",
          )
          progressSteps.push(postVerifySummaryStep)
          emit({
            currentIteration: iteration,
            maxIterations,
            steps: progressSteps.slice(-3),
            isComplete: false,
            conversationHistory: formatConversationForProgress(conversationHistory),
          })

          // Build a fresh system prompt and messages for the summary
          const postVerifySystemPrompt = constructSystemPrompt(
            uniqueAvailableTools,
            config.mcpToolsSystemPrompt,
            true, // isAgentMode
            toolCapabilities.relevantTools,
          )

          const postVerifySummaryMessages = [
            { role: "system", content: postVerifySystemPrompt },
            ...conversationHistory
              .map((entry) => {
                if (entry.role === "tool") {
                  const text = (entry.content || "").trim()
                  if (!text) return null
                  return { role: "user" as const, content: `Tool execution results:\n${entry.content}` }
                }
                return { role: entry.role as "user" | "assistant", content: entry.content }
              })
              .filter(Boolean as any),
          ]

          const { messages: shrunkPostVerifySummaryMessages } = await shrinkMessagesForLLM({
            messages: postVerifySummaryMessages as any,
            availableTools: uniqueAvailableTools,
            relevantTools: toolCapabilities.relevantTools,
            isAgentMode: true,
          })

          const postVerifySummaryResponse = await makeLLMCall(shrunkPostVerifySummaryMessages, config)

          // Update summary step with the response and use it as final content
          postVerifySummaryStep.status = "completed"
          postVerifySummaryStep.llmContent = postVerifySummaryResponse.content || ""
          postVerifySummaryStep.title = "Summary provided"
          postVerifySummaryStep.description = postVerifySummaryResponse.content && postVerifySummaryResponse.content.length > 100
            ? postVerifySummaryResponse.content.substring(0, 100) + "..."
            : postVerifySummaryResponse.content || "Summary generated"

          finalContent = postVerifySummaryResponse.content || finalContent

          // Append as the final assistant message
          conversationHistory.push({ role: "assistant", content: finalContent })
        } catch (e) {
          // If summary generation fails, proceed with existing finalContent
        }


      // Add completion step
      const completionStep = createProgressStep(
        "completion",
        "Task completed",
        "Successfully completed the requested task",
        "completed",
      )
      progressSteps.push(completionStep)

      // Emit final progress
      emit({
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
    if (!hasToolCalls && !explicitlyComplete) {
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

    // Add assistant response with tool calls to conversation history BEFORE executing tools
    // This ensures the tool call request is visible immediately in the UI
    conversationHistory.push({
      role: "assistant",
      content: llmResponse.content || "",
      toolCalls: llmResponse.toolCalls || [],
      timestamp: Date.now(),
    })

    // Emit progress update to show tool calls immediately
    emit({
      currentIteration: iteration,
      maxIterations,
      steps: progressSteps.slice(-3),
      isComplete: false,
      conversationHistory: formatConversationForProgress(conversationHistory),
    })

    // Apply intelligent tool result processing to all queries to prevent context overflow

    for (const toolCall of toolCallsArray) {
      if (isDebugTools()) {
        logTools("Executing planned tool call", toolCall)
      }
      // Check for stop signal before executing each tool
      if (agentSessionStateManager.shouldStopSession(currentSessionId)) {
        console.log(`Agent session ${currentSessionId} stopped during tool execution`)
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
      emit({
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
          errorText.includes("busy")

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
      emit({
        currentIteration: iteration,
        maxIterations,
        steps: progressSteps.slice(-3),
        isComplete: false,
        conversationHistory: formatConversationForProgress(conversationHistory),
      })
    }

    // Note: Assistant response with tool calls was already added before tool execution
    // This ensures the tool call request is visible immediately in the UI

    // Keep tool results intact for full visibility in UI
    // The UI will handle display and truncation as needed
    const processedToolResults = toolResults

    const meaningfulResults = processedToolResults.filter((r) =>
      r.isError || (r.content?.map((c) => c.text).join("").trim().length > 0),
    )

    if (meaningfulResults.length > 0) {
      const toolResultsText = meaningfulResults
        .map((result) => result.content.map((c) => c.text).join("\n"))
        .join("\n\n")

      conversationHistory.push({
        role: "tool",
        content: toolResultsText,
        toolResults: meaningfulResults,
        timestamp: Date.now(),
      })
    }

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

    // Check for error patterns and provide generic suggestions
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

${errorAnalysis.recoveryStrategy}

Please try alternative approaches, break down the task into smaller steps, or provide manual instructions to the user.`

      conversationHistory.push({
        role: "tool",
        content: errorSummary,
      })
    }

    // Check if agent indicated it was done after executing tools
    const agentIndicatedDone = llmResponse.needsMoreWork === false

    if (agentIndicatedDone && allToolsSuccessful) {
      // Agent indicated completion, but we need to ensure we have a proper summary
      // If the last assistant content was just tool calls, prompt for a summary
      const lastAssistantContent = llmResponse.content || ""

      // Check if the last assistant message was primarily tool calls without much explanation
      const hasToolCalls = llmResponse.toolCalls && llmResponse.toolCalls.length > 0
      const hasMinimalContent = lastAssistantContent.trim().length < 50

      if (hasToolCalls && (hasMinimalContent || !lastAssistantContent.trim())) {
        // The agent just made tool calls without providing a summary
        // Prompt the agent to provide a concise summary of what was accomplished
        const summaryPrompt = "Please provide a concise summary of what you just accomplished with the tool calls. Focus on the key results and outcomes for the user."

        conversationHistory.push({
          role: "user",
          content: summaryPrompt,
        })

        // Create a summary request step
        const summaryStep = createProgressStep(
          "thinking",
          "Generating summary",
          "Requesting final summary of completed actions",
          "in_progress",
        )
        progressSteps.push(summaryStep)

        // Emit progress update for summary request
        emit({
          currentIteration: iteration,
          maxIterations,
          steps: progressSteps.slice(-3),
          isComplete: false,
          conversationHistory: formatConversationForProgress(conversationHistory),
        })

        // Get the summary from the agent
        const contextAwarePrompt = constructSystemPrompt(
          uniqueAvailableTools,
          config.mcpToolsSystemPrompt,
          true, // isAgentMode
        )

        const summaryMessages = [
          { role: "system", content: contextAwarePrompt },
          ...conversationHistory
            .map((entry) => {
              if (entry.role === "tool") {
                const text = (entry.content || "").trim()
                if (!text) return null
                return {
                  role: "user" as const,
                  content: `Tool execution results:\n${entry.content}`,
                }
              }
              return {
                role: entry.role as "user" | "assistant",
                content: entry.content,
              }
            })
            .filter(Boolean as any),
        ]

        // Apply context budget management to the summary request as well
        const { messages: shrunkSummaryMessages } = await shrinkMessagesForLLM({
          messages: summaryMessages as any,
          availableTools: uniqueAvailableTools,
          relevantTools: toolCapabilities.relevantTools,
          isAgentMode: true,
        })


        try {
          const summaryResponse = await makeLLMCall(shrunkSummaryMessages, config)

          // Update summary step with the response
          summaryStep.status = "completed"
          summaryStep.llmContent = summaryResponse.content || ""
          summaryStep.title = "Summary provided"
          summaryStep.description = summaryResponse.content && summaryResponse.content.length > 100
            ? summaryResponse.content.substring(0, 100) + "..."
            : summaryResponse.content || "Summary generated"

          // Use the summary as final content
          finalContent = summaryResponse.content || lastAssistantContent

          // Add the summary to conversation history
          conversationHistory.push({
            role: "assistant",
            content: finalContent,
          })
        } catch (error) {
          // If summary generation fails, fall back to the original content
          console.warn("Failed to generate summary:", error)
          finalContent = lastAssistantContent || "Task completed successfully."
          summaryStep.status = "error"
          summaryStep.description = "Failed to generate summary, using fallback"

          conversationHistory.push({
            role: "assistant",
            content: finalContent,
          })
        }
      } else {
        // Agent provided sufficient content, use it as final content
        finalContent = lastAssistantContent
      }


	      // Optional verification before completing after tools
	      if (config.mcpVerifyCompletionEnabled) {
	        const verifyStep = createProgressStep(
	          "thinking",
	          "Verifying completion",
	          "Checking that the user's request has been achieved",
	          "in_progress",
	        )
	        progressSteps.push(verifyStep)
	        emit({
	          currentIteration: iteration,
	          maxIterations,
	          steps: progressSteps.slice(-3),
          isComplete: false,
	          conversationHistory: formatConversationForProgress(conversationHistory),
	        })

	        const retries = Math.max(0, config.mcpVerifyRetryCount ?? 1)
	        let verified = false
	        let verification: any = null
	        for (let i = 0; i <= retries; i++) {
	          verification = await verifyCompletionWithFetch(buildVerificationMessages(finalContent), config.mcpToolsProviderId)
	          if (verification?.isComplete === true) { verified = true; break }
	        }

	        if (!verified) {
	          verifyStep.status = "error"
	          verifyStep.description = "Verification failed: continuing to address missing items"
	          const missing = (verification?.missingItems || []).filter((s: string) => s && s.trim()).map((s: string) => `- ${s}`).join("\n")
	          const reason = verification?.reason ? `Reason: ${verification.reason}` : ""
	          const userNudge = `Verifier indicates the task is not complete.\n${reason}\n${missing ? `Missing items:\n${missing}` : ""}\nPlease continue and complete the remaining work.`
	          conversationHistory.push({ role: "user", content: userNudge })
	          noOpCount = 0
	          continue
	        }
	        verifyStep.status = "completed"
	        verifyStep.description = "Verification passed"
	      }

        // Post-verify: produce a concise final summary for the user
        try {
          const postVerifySummaryStep = createProgressStep(
            "thinking",
            "Summarizing results",
            "Creating a concise final summary of what was achieved",
            "in_progress",
          )
          progressSteps.push(postVerifySummaryStep)
          emit({
            currentIteration: iteration,
            maxIterations,
            steps: progressSteps.slice(-3),
            isComplete: false,
            conversationHistory: formatConversationForProgress(conversationHistory),
          })

          const postVerifySystemPrompt = constructSystemPrompt(
            uniqueAvailableTools,
            config.mcpToolsSystemPrompt,
            true,
            toolCapabilities.relevantTools,
          )

          const postVerifySummaryMessages = [
            { role: "system", content: postVerifySystemPrompt },
            ...conversationHistory
              .map((entry) => {
                if (entry.role === "tool") {
                  const text = (entry.content || "").trim()
                  if (!text) return null
                  return { role: "user" as const, content: `Tool execution results:\n${entry.content}` }
                }
                return { role: entry.role as "user" | "assistant", content: entry.content }
              })
              .filter(Boolean as any),
          ]

          const { messages: shrunkPostVerifySummaryMessages } = await shrinkMessagesForLLM({
            messages: postVerifySummaryMessages as any,
            availableTools: uniqueAvailableTools,
            relevantTools: toolCapabilities.relevantTools,
            isAgentMode: true,
          })

          const postVerifySummaryResponse = await makeLLMCall(
            shrunkPostVerifySummaryMessages,
            config,
          )

          postVerifySummaryStep.status = "completed"
          postVerifySummaryStep.llmContent = postVerifySummaryResponse.content || ""
          postVerifySummaryStep.title = "Summary provided"
          postVerifySummaryStep.description = postVerifySummaryResponse.content && postVerifySummaryResponse.content.length > 100
            ? postVerifySummaryResponse.content.substring(0, 100) + "..."
            : postVerifySummaryResponse.content || "Summary generated"

          finalContent = postVerifySummaryResponse.content || finalContent
          conversationHistory.push({ role: "assistant", content: finalContent })
        } catch (e) {
          // If summary generation fails, proceed with existing finalContent
        }


      // Add completion step
      const completionStep = createProgressStep(
        "completion",
        "Task completed",
        "Successfully completed the requested task with summary",
        "completed",
      )
      progressSteps.push(completionStep)

      // Emit final progress
      emit({
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
      // Agent explicitly indicated no more work needed
      const assistantContent = llmResponse.content || ""

      // Check if we just executed tools and need a summary
      const hasToolCalls = llmResponse.toolCalls && llmResponse.toolCalls.length > 0
      const hasMinimalContent = assistantContent.trim().length < 50

      if (hasToolCalls && (hasMinimalContent || !assistantContent.trim())) {
        // The agent just made tool calls without providing a summary
        // Prompt the agent to provide a concise summary of what was accomplished
        const summaryPrompt = "Please provide a concise summary of what you just accomplished with the tool calls. Focus on the key results and outcomes for the user."

        conversationHistory.push({
          role: "user",
          content: summaryPrompt,
        })

        // Create a summary request step
        const summaryStep = createProgressStep(
          "thinking",
          "Generating summary",
          "Requesting final summary of completed actions",
          "in_progress",
        )
        progressSteps.push(summaryStep)

        // Emit progress update for summary request
        emit({
          currentIteration: iteration,
          maxIterations,
          steps: progressSteps.slice(-3),
          isComplete: false,
          conversationHistory: formatConversationForProgress(conversationHistory),
        })

        // Get the summary from the agent
        const contextAwarePrompt = constructSystemPrompt(
          uniqueAvailableTools,
          config.mcpToolsSystemPrompt,
          true, // isAgentMode
        )

        const summaryMessages = [
          { role: "system", content: contextAwarePrompt },
          ...conversationHistory
            .map((entry) => {
              if (entry.role === "tool") {
                const text = (entry.content || "").trim()
                if (!text) return null
                return {
                  role: "user" as const,
                  content: `Tool execution results:\n${entry.content}`,
                }
              }
              return {
                role: entry.role as "user" | "assistant",
                content: entry.content,
              }
            })
            .filter(Boolean as any),
        ]

        // Apply context budget management to the summary request as well
        const { messages: shrunkSummaryMessages } = await shrinkMessagesForLLM({
          messages: summaryMessages as any,
          availableTools: uniqueAvailableTools,
          relevantTools: toolCapabilities.relevantTools,
          isAgentMode: true,
        })


        try {
          const summaryResponse = await makeLLMCall(shrunkSummaryMessages, config)

          // Update summary step with the response
          summaryStep.status = "completed"
          summaryStep.llmContent = summaryResponse.content || ""
          summaryStep.title = "Summary provided"
          summaryStep.description = summaryResponse.content && summaryResponse.content.length > 100
            ? summaryResponse.content.substring(0, 100) + "..."
            : summaryResponse.content || "Summary generated"

          // Use the summary as final content
          finalContent = summaryResponse.content || assistantContent

          // Add the summary to conversation history

        // Post-verify: produce a concise final summary for the user
        try {
          const postVerifySummaryStep = createProgressStep(
            "thinking",
            "Summarizing results",
            "Creating a concise final summary of what was achieved",
            "in_progress",
          )
          progressSteps.push(postVerifySummaryStep)
          emit({
            currentIteration: iteration,
            maxIterations,
            steps: progressSteps.slice(-3),
            isComplete: false,
            conversationHistory: formatConversationForProgress(conversationHistory),
          })

          const postVerifySystemPrompt = constructSystemPrompt(
            uniqueAvailableTools,
            config.mcpToolsSystemPrompt,
            true,
            toolCapabilities.relevantTools,
          )

          const postVerifySummaryMessages = [
            { role: "system", content: postVerifySystemPrompt },
            ...conversationHistory
              .map((entry) => {
                if (entry.role === "tool") {
                  const text = (entry.content || "").trim()
                  if (!text) return null
                  return { role: "user" as const, content: `Tool execution results:\n${entry.content}` }
                }
                return { role: entry.role as "user" | "assistant", content: entry.content }
              })
              .filter(Boolean as any),
          ]

          const { messages: shrunkPostVerifySummaryMessages } = await shrinkMessagesForLLM({
            messages: postVerifySummaryMessages as any,
            availableTools: uniqueAvailableTools,
            relevantTools: toolCapabilities.relevantTools,
            isAgentMode: true,
          })

          const postVerifySummaryResponse = await makeLLMCall(
            shrunkPostVerifySummaryMessages,
            config,
          )

          postVerifySummaryStep.status = "completed"
          postVerifySummaryStep.llmContent = postVerifySummaryResponse.content || ""
          postVerifySummaryStep.title = "Summary provided"
          postVerifySummaryStep.description = postVerifySummaryResponse.content && postVerifySummaryResponse.content.length > 100
            ? postVerifySummaryResponse.content.substring(0, 100) + "..."
            : postVerifySummaryResponse.content || "Summary generated"

          finalContent = postVerifySummaryResponse.content || finalContent
          conversationHistory.push({ role: "assistant", content: finalContent })
        } catch (e) {
          // If summary generation fails, proceed with existing finalContent
        }

        // If there are actionable tools and we haven't executed any tools yet,
        // skip verification and force the model to produce structured toolCalls instead of intent-only text.
        const hasAnyToolResultsSoFar = conversationHistory.some((e) => e.role === "tool")
        const hasActionableTools = toolCapabilities.relevantTools.length > 0
        if (hasActionableTools && !hasAnyToolResultsSoFar) {
          conversationHistory.push({
            role: "user",
            content:
              "Before verifying or completing: use the available tools to actually perform the steps. Reply with a valid JSON object per the tool-calling schema, including a toolCalls array with concrete parameters.",
          })
          noOpCount = 0
          continue
        }

          conversationHistory.push({
            role: "assistant",
            content: finalContent,
          })
        } catch (error) {
          // If summary generation fails, fall back to the original content
          console.warn("Failed to generate summary:", error)
          finalContent = assistantContent || "Task completed successfully."
          summaryStep.status = "error"
          summaryStep.description = "Failed to generate summary, using fallback"

          conversationHistory.push({
            role: "assistant",
            content: finalContent,
          })
        }
      } else {
        // Agent provided sufficient content, use it as final content
        finalContent = assistantContent
        conversationHistory.push({
          role: "assistant",
          content: finalContent,
        })
      }


	      // Optional verification before completing (general stop condition)
	      if (config.mcpVerifyCompletionEnabled) {
	        const verifyStep = createProgressStep(
	          "thinking",
	          "Verifying completion",
	          "Checking that the user's request has been achieved",
	          "in_progress",
	        )
	        progressSteps.push(verifyStep)
	        emit({
	          currentIteration: iteration,
          isComplete: false,
	          maxIterations,
	          steps: progressSteps.slice(-3),
	          conversationHistory: formatConversationForProgress(conversationHistory),
	        })

	        const retries = Math.max(0, config.mcpVerifyRetryCount ?? 1)
	        let verified = false
	        let verification: any = null
	        for (let i = 0; i <= retries; i++) {
	          verification = await verifyCompletionWithFetch(buildVerificationMessages(finalContent), config.mcpToolsProviderId)
	          if (verification?.isComplete === true) { verified = true; break }
	        }

	        if (!verified) {
	          verifyStep.status = "error"
	          verifyStep.description = "Verification failed: continuing to address missing items"
	          const missing = (verification?.missingItems || []).filter((s: string) => s && s.trim()).map((s: string) => `- ${s}`).join("\n")
	          const reason = verification?.reason ? `Reason: ${verification.reason}` : ""
	          const userNudge = `Verifier indicates the task is not complete.\n${reason}\n${missing ? `Missing items:\n${missing}` : ""}\nPlease continue and complete the remaining work.`
	          conversationHistory.push({ role: "user", content: userNudge })
	          noOpCount = 0
	          continue
	        }
	        verifyStep.status = "completed"
	        verifyStep.description = "Verification passed"
	      }

      const completionStep = createProgressStep(
        "completion",
        "Task completed",
        "Agent indicated no more work needed",
        "completed",
      )
      progressSteps.push(completionStep)

      emit({
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

    // If we don't have final content, get the last assistant response or provide fallback
    if (!finalContent) {
      const lastAssistantMessage = conversationHistory
        .slice()
        .reverse()
        .find((msg) => msg.role === "assistant")

      if (lastAssistantMessage) {
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
    emit({
      currentIteration: iteration,
      maxIterations,
      steps: progressSteps.slice(-3),
      isComplete: true,
      finalContent,
      conversationHistory: formatConversationForProgress(conversationHistory),
    })
  }

  // Clean up session state at the end of agent processing
  agentSessionStateManager.cleanupSession(currentSessionId)

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
      logLLM("=== LLM CALL START ===")
      logLLM("Messages →", {
        count: messages.length,
        totalChars: messages.reduce((sum, msg) => sum + msg.content.length, 0),
        messages: messages,
      })
    }
    const result = await makeLLMCallWithFetch(messages, chatProviderId)
    if (isDebugLLM()) {
      logLLM("Response ←", result)
      logLLM("=== LLM CALL END ===")
    }
    return result
  } catch (error) {
    if (isDebugLLM()) {
      logLLM("LLM CALL ERROR:", error)
    }
    diagnosticsService.logError("llm", "Agent LLM call failed", error)
    throw error
  }
}
