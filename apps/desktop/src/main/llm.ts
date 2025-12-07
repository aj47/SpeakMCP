import { configStore } from "./config"
import {
  MCPTool,
  MCPToolCall,
  LLMToolCallResponse,
  MCPToolResult,
} from "./mcp-service"
import { AgentProgressStep, AgentProgressUpdate } from "../shared/types"
import { diagnosticsService } from "./diagnostics"
import { makeStructuredContextExtraction, ContextExtractionResponse } from "./structured-output"
import { makeLLMCallWithFetch, makeTextCompletionWithFetch, verifyCompletionWithFetch, RetryProgressCallback, makeLLMCallWithStreaming, StreamingCallback } from "./llm-fetch"
import { constructSystemPrompt } from "./system-prompts"
import { state, agentSessionStateManager } from "./state"
import { isDebugLLM, logLLM, isDebugTools, logTools } from "./debug"
import { shrinkMessagesForLLM } from "./context-budget"
import { emitAgentProgress } from "./emit-agent-progress"
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
    undefined, // relevantTools
    config.mcpCustomSystemPrompt, // custom base system prompt
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
      keywords: [
        "web",
        "http",
        "api",
        "request",
        "url",
        "fetch",
        "search",
        "amazon",
        "google",
        "website",
        "online",
        "browser",
        "navigate",
        "click",
        "form",
        "login",
        "purchase",
        "buy",
        "order",
        "cart",
        "checkout",
        "email",
        "gmail",
        "social media",
        "facebook",
        "twitter",
        "linkedin",
        "instagram",
      ],
      toolDescriptionKeywords: [
        "web",
        "http",
        "api",
        "request",
        "url",
        "fetch",
        "search",
        "browser",
        "navigate",
        "click",
        "snapshot",
        "screenshot",
        "playwright",
        "automation",
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
  executeToolCall: (toolCall: MCPToolCall, onProgress?: (message: string) => void) => Promise<MCPToolResult>,
  maxIterations: number = 10,
  previousConversationHistory?: Array<{
    role: "user" | "assistant" | "tool"
    content: string
    toolCalls?: MCPToolCall[]
    toolResults?: MCPToolResult[]
  }>,
  conversationId?: string, // Conversation ID for linking to conversation history
  sessionId?: string, // Session ID for progress routing and isolation
  onProgress?: (update: AgentProgressUpdate) => void, // Optional callback for external progress consumers (e.g., SSE)
): Promise<AgentModeResponse> {
  const config = configStore.get()

  // Store IDs for use in progress updates
  const currentConversationId = conversationId
  const currentSessionId =
    sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  // Number of messages in the conversation history that predate this agent session.
  // Used by the UI to show only this session's messages while still saving full history.
  // When continuing a conversation, we set this to 0 so the UI shows the full history.
  // The user explicitly wants to see the previous context when they click "Continue".
  const sessionStartIndex = 0

  // Create session state for this agent run
  agentSessionStateManager.createSession(currentSessionId)

  // Create bound emitter that always includes sessionId, conversationId, snooze state, sessionStartIndex, and conversationTitle
  const emit = (
    update: Omit<AgentProgressUpdate, 'sessionId' | 'conversationId' | 'isSnoozed' | 'conversationTitle'>,
  ) => {
    const isSnoozed = agentSessionTracker.isSessionSnoozed(currentSessionId)
    const session = agentSessionTracker.getSession(currentSessionId)
    const conversationTitle = session?.conversationTitle

    const fullUpdate: AgentProgressUpdate = {
      ...update,
      sessionId: currentSessionId,
      conversationId: currentConversationId,
      conversationTitle,
      isSnoozed,
      sessionStartIndex,
    }

    // Fire and forget - don't await, but catch errors
    emitAgentProgress(fullUpdate).catch(err => {
      logLLM("[emit] Failed to emit agent progress:", err)
    })

    // Also call external progress callback if provided (for SSE streaming, etc.)
    if (onProgress) {
      try {
        onProgress(fullUpdate)
      } catch (err) {
        logLLM("[emit] Failed to call onProgress callback:", err)
      }
    }
  }

  // Helper function to save a message incrementally to the conversation
  // This ensures messages are persisted even if the agent crashes or is stopped
  const saveMessageIncremental = async (
    role: "user" | "assistant" | "tool",
    content: string,
    toolCalls?: MCPToolCall[],
    toolResults?: MCPToolResult[]
  ) => {
    if (!currentConversationId) {
      return // No conversation to save to
    }

    try {
      const { conversationService } = await import("./conversation-service")

      // Convert toolResults from MCPToolResult format to stored format
      const convertedToolResults = toolResults?.map(tr => ({
        success: !tr.isError,
        content: Array.isArray(tr.content)
          ? tr.content.map(c => c.text).join("\n")
          : String(tr.content || ""),
        error: tr.isError
          ? (Array.isArray(tr.content) ? tr.content.map(c => c.text).join("\n") : String(tr.content || ""))
          : undefined
      }))

      await conversationService.addMessageToConversation(
        currentConversationId,
        content,
        role,
        toolCalls,
        convertedToolResults
      )

      if (isDebugLLM()) {
        logLLM("💾 Saved message incrementally", {
          conversationId: currentConversationId,
          role,
          contentLength: content.length,
          hasToolCalls: !!toolCalls,
          hasToolResults: !!toolResults
        })
      }
    } catch (error) {
      // Log but don't throw - persistence failures shouldn't crash the agent
      logLLM("[saveMessageIncremental] Failed to save message:", error)
      diagnosticsService.logWarning("llm", "Failed to save message incrementally", error)
    }
  }

  // Helper function to add a message to conversation history AND save it incrementally
  // This ensures all messages are both in memory and persisted to disk
  const addMessage = (
    role: "user" | "assistant" | "tool",
    content: string,
    toolCalls?: MCPToolCall[],
    toolResults?: MCPToolResult[],
    timestamp?: number
  ) => {
    // Add to in-memory history
    const message: typeof conversationHistory[0] = {
      role,
      content,
      toolCalls,
      toolResults,
      timestamp: timestamp || Date.now()
    }
    conversationHistory.push(message)

    // Save to disk asynchronously (fire and forget)
    saveMessageIncremental(role, content, toolCalls, toolResults).catch(err => {
      logLLM("[addMessage] Failed to save message:", err)
    })
  }

  // Track current iteration for retry progress callback
  // This is updated in the agent loop and read by onRetryProgress
  let currentIterationRef = 0

  // Create retry progress callback that emits updates to the UI
  // This callback is passed to makeLLMCall to show retry status
  // Note: This callback captures conversationHistory and formatConversationForProgress by reference,
  // so it will have access to them when called (they are defined later in this function)
  const onRetryProgress: RetryProgressCallback = (retryInfo) => {
    emit({
      currentIteration: currentIterationRef,
      maxIterations,
      steps: [], // Empty - retry info is separate from steps
      isComplete: false,
      retryInfo: retryInfo.isRetrying ? retryInfo : undefined,
      // Include conversationHistory to avoid "length: 0" logs in emitAgentProgress
      conversationHistory: typeof formatConversationForProgress === 'function' && conversationHistory
        ? formatConversationForProgress(conversationHistory)
        : [],
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
    config.mcpCustomSystemPrompt, // custom base system prompt
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

  logLLM(`[llm.ts processTranscriptWithAgentMode] Initializing conversationHistory for session ${currentSessionId}`)
  logLLM(`[llm.ts processTranscriptWithAgentMode] previousConversationHistory length: ${previousConversationHistory?.length || 0}`)
  if (previousConversationHistory && previousConversationHistory.length > 0) {
    logLLM(`[llm.ts processTranscriptWithAgentMode] previousConversationHistory roles: [${previousConversationHistory.map(m => m.role).join(', ')}]`)
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

  logLLM(`[llm.ts processTranscriptWithAgentMode] conversationHistory initialized with ${conversationHistory.length} messages, roles: [${conversationHistory.map(m => m.role).join(', ')}]`)

  // Save the initial user message incrementally
  // Only save if this is a new message (not from previous conversation history)
  if (!previousConversationHistory || previousConversationHistory.length === 0 ||
      previousConversationHistory[previousConversationHistory.length - 1]?.content !== transcript) {
    saveMessageIncremental("user", transcript).catch(err => {
      logLLM("[processTranscriptWithAgentMode] Failed to save initial user message:", err)
    })
  }

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

  // Helper to check if content is just a tool call placeholder (not real content)
  const isToolCallPlaceholder = (content: string): boolean => {
    const trimmed = content.trim()
    // Match patterns like "[Calling tools: ...]" or "[Tool: ...]"
    return /^\[(?:Calling tools?|Tool|Tools?):[^\]]+\]$/i.test(trimmed)
  }

  // Helper to detect if agent is repeating the same response (infinite loop)
  const detectRepeatedResponse = (currentResponse: string): boolean => {
    // Get last 3 assistant responses (excluding the current one)
    const assistantResponses = conversationHistory
      .filter(entry => entry.role === "assistant")
      .map(entry => entry.content.trim().toLowerCase())
      .slice(-3)

    if (assistantResponses.length < 2) return false

    const currentTrimmed = currentResponse.trim().toLowerCase()

    // Check if current response is very similar to any of the last 2 responses
    // Using a simple similarity check: if 80% of the content matches
    for (const prevResponse of assistantResponses.slice(-2)) {
      if (prevResponse.length === 0 || currentTrimmed.length === 0) continue

      // Simple similarity: check if responses are nearly identical
      const similarity = calculateSimilarity(currentTrimmed, prevResponse)
      if (similarity > 0.8) {
        return true
      }
    }

    return false
  }

  // Simple similarity calculation (Jaccard similarity on words)
  const calculateSimilarity = (str1: string, str2: string): number => {
    const words1 = new Set(str1.split(/\s+/))
    const words2 = new Set(str2.split(/\s+/))

    const intersection = new Set([...words1].filter(x => words2.has(x)))
    const union = new Set([...words1, ...words2])

    return union.size === 0 ? 0 : intersection.size / union.size
  }

  // Helper to map conversation history to LLM messages format (filters empty content)
  const mapConversationToMessages = (
    addSummaryPrompt: boolean = false
  ): Array<{ role: "user" | "assistant"; content: string }> => {
    const mapped = conversationHistory
      .map((entry) => {
        if (entry.role === "tool") {
          const text = (entry.content || "").trim()
          if (!text) return null
          return { role: "user" as const, content: `Tool execution results:\n${entry.content}` }
        }
        const content = (entry.content || "").trim()
        if (!content) return null
        return { role: entry.role as "user" | "assistant", content }
      })
      .filter(Boolean) as Array<{ role: "user" | "assistant"; content: string }>

    // Add summary prompt if last message is from assistant (ensures LLM has something to respond to)
    if (addSummaryPrompt && mapped.length > 0 && mapped[mapped.length - 1].role === "assistant") {
      mapped.push({ role: "user", content: "Please provide a brief summary of what was accomplished." })
    }
    return mapped
  }

  // Helper to generate post-verify summary (consolidates duplicate logic)
  const generatePostVerifySummary = async (
    currentFinalContent: string,
    checkForStop: boolean = false
  ): Promise<{ content: string; stopped: boolean }> => {
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
      config.mcpCustomSystemPrompt, // custom base system prompt
    )

    const postVerifySummaryMessages = [
      { role: "system" as const, content: postVerifySystemPrompt },
      ...mapConversationToMessages(true),
    ]

    const { messages: shrunkMessages } = await shrinkMessagesForLLM({
      messages: postVerifySummaryMessages as any,
      availableTools: uniqueAvailableTools,
      relevantTools: toolCapabilities.relevantTools,
      isAgentMode: true,
      sessionId: currentSessionId,
      onSummarizationProgress: (current, total) => {
        const lastThinkingStep = progressSteps.findLast(step => step.type === "thinking")
        if (lastThinkingStep) {
          lastThinkingStep.description = `Summarizing for verification (${current}/${total})`
        }
        emit({
          currentIteration: iteration,
          maxIterations,
          steps: progressSteps.slice(-3),
          isComplete: false,
          conversationHistory: formatConversationForProgress(conversationHistory),
        })
      },
    })

    const response = await makeLLMCall(shrunkMessages, config, onRetryProgress, undefined, currentSessionId)

    // Check for stop request if needed
    if (checkForStop && agentSessionStateManager.shouldStopSession(currentSessionId)) {
      logLLM(`Agent session ${currentSessionId} stopped during post-verify summary generation`)
      return { content: currentFinalContent, stopped: true }
    }

    postVerifySummaryStep.status = "completed"
    postVerifySummaryStep.llmContent = response.content || ""
    postVerifySummaryStep.title = "Summary provided"
    postVerifySummaryStep.description = response.content && response.content.length > 100
      ? response.content.substring(0, 100) + "..."
      : response.content || "Summary generated"

    return { content: response.content || currentFinalContent, stopped: false }
  }

  // Build compact verification messages (schema-first verifier)
  const buildVerificationMessages = (finalAssistantText: string) => {
    const maxItems = Math.max(1, config.mcpVerifyContextMaxItems || 10)
    const recent = conversationHistory.slice(-maxItems)
    const messages: Array<{ role: "user" | "assistant" | "system"; content: string }> = []
    messages.push({
      role: "system",
      content:
        `You are a strict completion verifier. Determine if the user's original request has been fully satisfied in the conversation.

IMPORTANT: Mark as COMPLETE if ANY of these conditions are met:
1. The request was successfully fulfilled with concrete actions/results
2. The agent correctly identified the request is IMPOSSIBLE (e.g., can't access private data, lacks permissions, requires unavailable resources)
3. The agent is asking for CLARIFICATION or MORE INFORMATION needed to proceed (this is a valid completion - the ball is in the user's court)
4. The agent has given the SAME RESPONSE multiple times (indicates a loop - accept the response as final)

Examples of VALID completions:
- "I cannot access your Amazon purchase history. Please provide the product link."
- "I don't have permission to access that database. Please provide credentials."
- "Which file would you like me to edit? Please specify the path."
- "I need more details about the feature you want. Can you describe it?"

Only mark as INCOMPLETE if:
- The agent can fulfill the request but hasn't yet
- The agent is making progress but hasn't finished
- The agent hasn't acknowledged the request at all

Return ONLY JSON per schema.`,
    })
    messages.push({ role: "user", content: `Original request:\n${transcript}` })
    for (const entry of recent) {
      if (entry.role === "tool") {
        const text = (entry.content || "").trim()
        if (text) messages.push({ role: "user", content: `Tool results:\n${text}` })
      } else {
        // Ensure non-empty content for assistant messages (Anthropic API requirement)
        let content = entry.content
        if (entry.role === "assistant" && !content?.trim()) {
          if (entry.toolCalls && entry.toolCalls.length > 0) {
            const toolNames = entry.toolCalls.map(tc => tc.name).join(", ")
            content = `[Calling tools: ${toolNames}]`
          } else {
            content = "[Processing...]"
          }
        }
        messages.push({ role: entry.role, content })
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

  let iteration = 0
  let finalContent = ""
  let noOpCount = 0 // Track iterations without meaningful progress

  let verificationFailCount = 0 // Count consecutive verification failures to avoid loops

  while (iteration < maxIterations) {
    iteration++
    currentIterationRef = iteration // Update ref for retry progress callback

    // Check for stop signal (session-specific or global)
    if (agentSessionStateManager.shouldStopSession(currentSessionId)) {
      logLLM(`Agent session ${currentSessionId} stopped by kill switch`)

      // Add emergency stop step
      const stopStep = createProgressStep(
        "completion",
        "Agent stopped",
        "Agent mode was stopped by emergency kill switch",
        "error",
      )
      progressSteps.push(stopStep)

      // Emit final progress (ensure final output is saved in history)
      const killNote = "\n\n(Agent mode was stopped by emergency kill switch)"
      const finalOutput = (finalContent || "") + killNote
      conversationHistory.push({ role: "assistant", content: finalOutput })
      emit({
        currentIteration: iteration,
        maxIterations,
        steps: progressSteps.slice(-3),
        isComplete: true,
        finalContent: finalOutput,
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
    // Recalculate recent context each iteration to include newly added messages
    const currentSessionHistory = conversationHistory.slice(sessionStartIndex)
    const recentContext = extractRecentContext(currentSessionHistory)

    if (recentContext.length > 1) {
      // Use LLM to extract useful context from conversation history
      // IMPORTANT: Only extract context from the current session's messages to prevent
      // context leakage between sessions. sessionStartIndex marks where this session began.
      const contextInfo = await extractContextFromHistory(
        currentSessionHistory,
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
          // For assistant messages, ensure non-empty content
          // Anthropic API requires all messages to have non-empty content
          // except for the optional final assistant message
          let content = entry.content
          if (entry.role === "assistant" && !content?.trim()) {
            // If assistant message has tool calls but no content, describe the tool calls
            if (entry.toolCalls && entry.toolCalls.length > 0) {
              const toolNames = entry.toolCalls.map(tc => tc.name).join(", ")
              content = `[Calling tools: ${toolNames}]`
            } else {
              // Fallback for empty assistant messages without tool calls
              content = "[Processing...]"
            }
          }
          return {
            role: entry.role as "user" | "assistant",
            content,
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
      sessionId: currentSessionId,
      onSummarizationProgress: (current, total, message) => {
        // Update thinking step with summarization progress
        thinkingStep.description = `Summarizing context (${current}/${total})`
        thinkingStep.llmContent = message
        emit({
          currentIteration: iteration,
          maxIterations,
          steps: progressSteps.slice(-3),
          isComplete: false,
          conversationHistory: formatConversationForProgress(conversationHistory),
        })
      },
    })

    // If stop was requested during context shrinking, exit now
    if (agentSessionStateManager.shouldStopSession(currentSessionId)) {
      logLLM(`Agent session ${currentSessionId} stopped during context shrink`)
      thinkingStep.status = "completed"
      thinkingStep.title = "Agent stopped"
      thinkingStep.description = "Emergency stop triggered"
      const killNote = "\n\n(Agent mode was stopped by emergency kill switch)"
      const finalOutput = (finalContent || "") + killNote
      conversationHistory.push({ role: "assistant", content: finalOutput })
      emit({
        currentIteration: iteration,
        maxIterations,
        steps: progressSteps.slice(-3),
        isComplete: true,
        finalContent: finalOutput,
        conversationHistory: formatConversationForProgress(conversationHistory),
      })
      break
    }

    // Make LLM call (abort-aware) with streaming for real-time UI updates
    let llmResponse: any
    try {
      // Create streaming callback that emits progress updates as content streams in
      const onStreamingUpdate: StreamingCallback = (_chunk, accumulated) => {
        // Update the thinking step with streaming content
        thinkingStep.llmContent = accumulated
        // Emit progress update with streaming content
        emit({
          currentIteration: iteration,
          maxIterations,
          steps: progressSteps.slice(-3),
          isComplete: false,
          conversationHistory: formatConversationForProgress(conversationHistory),
          streamingContent: {
            text: accumulated,
            isStreaming: true,
          },
        })
      }

      llmResponse = await makeLLMCall(shrunkMessages, config, onRetryProgress, onStreamingUpdate, currentSessionId)

      // Clear streaming state after response is complete
      emit({
        currentIteration: iteration,
        maxIterations,
        steps: progressSteps.slice(-3),
        isComplete: false,
        conversationHistory: formatConversationForProgress(conversationHistory),
        streamingContent: {
          text: llmResponse?.content || "",
          isStreaming: false,
        },
      })

      // If stop was requested while the LLM call was in-flight and it returned before aborting, exit now
      if (agentSessionStateManager.shouldStopSession(currentSessionId)) {
        logLLM(`Agent session ${currentSessionId} stopped right after LLM response`)
        thinkingStep.status = "completed"
        thinkingStep.title = "Agent stopped"
        thinkingStep.description = "Emergency stop triggered"
        const killNote = "\n\n(Agent mode was stopped by emergency kill switch)"
        const finalOutput = (finalContent || "") + killNote
        conversationHistory.push({ role: "assistant", content: finalOutput })
        emit({
          currentIteration: iteration,
          maxIterations,
          steps: progressSteps.slice(-3),
          isComplete: true,
          finalContent: finalOutput,
          conversationHistory: formatConversationForProgress(conversationHistory),
        })
        break
      }
    } catch (error: any) {
      if (error?.name === "AbortError" || agentSessionStateManager.shouldStopSession(currentSessionId)) {
        logLLM(`LLM call aborted for session ${currentSessionId} due to emergency stop`)
        thinkingStep.status = "completed"
        thinkingStep.title = "Agent stopped"
        thinkingStep.description = "Emergency stop triggered"
        // Ensure final output appears in saved conversation on abort
        const killNote = "\n\n(Agent mode was stopped by emergency kill switch)"
        const finalOutput = (finalContent || "") + killNote
        conversationHistory.push({ role: "assistant", content: finalOutput })
        emit({
          currentIteration: iteration,
          maxIterations,
          steps: progressSteps.slice(-3),
          isComplete: true,
          finalContent: finalOutput,
          conversationHistory: formatConversationForProgress(conversationHistory),
        })
        break
      }

      // Handle empty response errors - retry with guidance
      const errorMessage = (error?.message || String(error)).toLowerCase()
      if (errorMessage.includes("empty") || errorMessage.includes("no text") || errorMessage.includes("no content")) {
        thinkingStep.status = "error"
        thinkingStep.description = "Empty response. Retrying..."
        emit({
          currentIteration: iteration,
          maxIterations,
          steps: progressSteps.slice(-3),
          isComplete: false,
          conversationHistory: formatConversationForProgress(conversationHistory),
        })
        addMessage("user", "Previous request had empty response. Please retry or summarize progress.")
        continue
      }

      // Other errors - throw (llm-fetch.ts handles JSON validation/failedGeneration recovery)
      throw error
    }

    // Validate response is not null/empty
    // A response is valid if it has either content OR toolCalls (tool-only responses have empty content)
    const hasValidContent = llmResponse?.content && llmResponse.content.trim().length > 0
    const hasValidToolCalls = llmResponse?.toolCalls && Array.isArray(llmResponse.toolCalls) && llmResponse.toolCalls.length > 0

    if (!llmResponse || (!hasValidContent && !hasValidToolCalls)) {
      logLLM(`❌ LLM null/empty response on iteration ${iteration}`)
      logLLM("Response details:", {
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
        message: "LLM response has neither content nor toolCalls"
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
      addMessage("user", "Previous request had invalid response. Please retry or summarize progress.")
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

      // Check if there are actionable tools for this request
      const hasActionableTools = toolCapabilities.relevantTools.length > 0
      const hasToolResultsSoFar = conversationHistory.some((e) => e.role === "tool")

      // Check if the response contains substantive content (a real answer, not a placeholder)
      // If the LLM explicitly sets needsMoreWork=false and provides a real answer,
      // we should trust it - even if there are tools that could theoretically be used.
      // This allows the agent to respond directly to simple questions without forcing tool calls.
      const hasSubstantiveContent = contentText.trim().length >= 1 && !isToolCallPlaceholder(contentText)

      // Only apply aggressive heuristics if:
      // 1. There are actually relevant tools for this request
      // 2. No tools have been used yet
      // 3. The agent's response doesn't contain substantive content (i.e., it's just a placeholder)
      if (hasActionableTools && !hasToolResultsSoFar && !hasSubstantiveContent) {
        // If there are actionable tools and no tool results yet, and no real answer provided,
        // nudge the model to produce structured toolCalls to actually perform the work.
        // Only add assistant message if non-empty to avoid blank entries
        if (contentText.trim().length > 0) {
          conversationHistory.push({ role: "assistant", content: contentText.trim() })
        }
        conversationHistory.push({
          role: "user",
          content:
            "Before marking complete: use the available tools to actually perform the steps. Reply with a valid JSON object per the tool-calling schema, including a toolCalls array with concrete parameters.",
        })
        noOpCount = 0
        continue
      }

      // Agent explicitly indicated completion and one of the following:
      // - No actionable tools exist for this request (simple Q&A), OR
      // - Tools were used and work is complete, OR
      // - Agent provided a substantive direct response (allows direct answers without tool calls)
      const assistantContent = llmResponse.content || ""

      finalContent = assistantContent
      if (finalContent.trim().length > 0) {
        addMessage("assistant", finalContent)
      }

      // Optional verification before completing
      // Track if we should skip post-verify summary
      // Skip summary when:
      // 1. Agent is repeating itself (with real content)
      // 2. No tools were called (simple Q&A - nothing to summarize)
      const noToolsCalledYet = !conversationHistory.some((e) => e.role === "tool")
      let skipPostVerifySummary = noToolsCalledYet && !isToolCallPlaceholder(finalContent) && finalContent.trim().length > 0

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

        // Check for infinite loop (repeated responses)
        const isRepeating = detectRepeatedResponse(finalContent)

        const retries = Math.max(0, config.mcpVerifyRetryCount ?? 1)
        let verified = false
        let verification: any = null

        // If agent is repeating itself, skip verification AND post-verify summary
        // UNLESS the content is just a tool call placeholder (not real content)
        // In that case, we still need to generate a proper summary
        if (isRepeating) {
          verified = true
          // Only skip post-verify summary if we have real content (not just a tool call placeholder)
          if (!isToolCallPlaceholder(finalContent) && finalContent.trim().length > 0) {
            skipPostVerifySummary = true  // Skip the summary call - we already have valid content
          }
          verifyStep.status = "completed"
          verifyStep.description = "Agent response is repeating - accepting as final"
          if (isDebugLLM()) {
            logLLM("Infinite loop detected - treating as complete", {
              finalContent: finalContent.substring(0, 200),
              isPlaceholder: isToolCallPlaceholder(finalContent),
              willGenerateSummary: isToolCallPlaceholder(finalContent)
            })
          }
        } else {
          for (let i = 0; i <= retries; i++) {
            verification = await verifyCompletionWithFetch(buildVerificationMessages(finalContent), config.mcpToolsProviderId)
            if (verification?.isComplete === true) { verified = true; break }
          }
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
        if (!skipPostVerifySummary) {
          try {
            const result = await generatePostVerifySummary(finalContent)
            finalContent = result.content
            addMessage("assistant", finalContent)
          } catch (e) {
            // If summary generation fails, proceed with existing finalContent
          }
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
      const contentText = llmResponse.content || ""
      const hasSubstantiveContent = contentText.trim().length >= 1 && !isToolCallPlaceholder(contentText)

      // If no actionable tools and the response has substantive content,
      // accept it as a direct response (e.g., simple Q&A, factual questions)
      if (!isActionableRequest && hasSubstantiveContent) {
        finalContent = contentText
        addMessage("assistant", finalContent)

        // Add completion step for UI consistency with other completion paths
        const completionStep = createProgressStep(
          "completion",
          "Task completed",
          "Question answered directly",
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

      if (noOpCount >= 2 || (isActionableRequest && noOpCount >= 1)) {
        // Add nudge to push the agent forward - require proper JSON format
        // Only add assistant message if non-empty to avoid blank entries
        if (contentText.trim().length > 0) {
          addMessage("assistant", contentText)
        }

        const nudgeMessage = isActionableRequest
          ? "You have relevant tools available for this request. Please respond with a valid JSON object: either call tools using the toolCalls array, or set needsMoreWork=false with a complete answer in the content field."
          : "Please respond with a valid JSON object containing your answer in the content field and needsMoreWork=false if the task is complete."

        addMessage("user", nudgeMessage)

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
    addMessage("assistant", llmResponse.content || "", llmResponse.toolCalls || [])

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
        logLLM(`Agent session ${currentSessionId} stopped during tool execution`)
        // Emit final progress with complete status
        const killNote = "\n\n(Agent mode was stopped by emergency kill switch)"
        const finalOutput = (finalContent || "") + killNote
        conversationHistory.push({ role: "assistant", content: finalOutput })
        emit({
          currentIteration: iteration,
          maxIterations,
          steps: progressSteps.slice(-3),
          isComplete: true,
          finalContent: finalOutput,
          conversationHistory: formatConversationForProgress(conversationHistory),
        })
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

      // Execute tool with cancel-aware race so kill switch can stop mid-tool
      let cancelledByKill = false
      let cancelInterval: NodeJS.Timeout | null = null
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
      // Create progress callback to update tool execution step
      const onToolProgress = (message: string) => {
        toolCallStep.description = message
        // Emit progress update to show processing status
        emit({
          currentIteration: iteration,
          maxIterations,
          steps: progressSteps.slice(-3),
          isComplete: false,
          conversationHistory: formatConversationForProgress(conversationHistory),
        })
      }

      const execPromise = executeToolCall(toolCall, onToolProgress)
      let result = (await Promise.race([
        execPromise,
        stopPromise,
      ])) as MCPToolResult
      // Avoid unhandled rejection if the tool promise rejects after we already stopped
      if (cancelledByKill) {
        execPromise.catch(() => { /* swallow after kill switch */ })
      }
      if (cancelInterval) clearInterval(cancelInterval)

      if (cancelledByKill) {
        // Mark step and emit final progress, then break out of tool loop
        toolCallStep.status = "error"
        toolCallStep.toolResult = {
          success: false,
          content: "Tool execution cancelled by emergency kill switch",
          error: "Cancelled by emergency kill switch",
        }
        const toolResultStep = createProgressStep(
          "tool_result",
          `${toolCall.name} cancelled`,
          "Tool execution cancelled by emergency kill switch",
          "error",
        )
        toolResultStep.toolResult = toolCallStep.toolResult
        progressSteps.push(toolResultStep)
        // Ensure final output appears and is saved when tool execution is cancelled
        const killNote = "\n\n(Agent mode was stopped by emergency kill switch)"
        const finalOutput = (finalContent || "") + killNote
        conversationHistory.push({ role: "assistant", content: finalOutput })
        emit({
          currentIteration: iteration,
          maxIterations,
          steps: progressSteps.slice(-3),
          isComplete: true,
          finalContent: finalOutput,
          conversationHistory: formatConversationForProgress(conversationHistory),
        })
        break
      }

      // If kill switch was pressed during retries, stop retrying
      if (agentSessionStateManager.shouldStopSession(currentSessionId)) {
        // Emit final progress with complete status
        const killNote = "\n\n(Agent mode was stopped by emergency kill switch)"
        const finalOutput = (finalContent || "") + killNote
        conversationHistory.push({ role: "assistant", content: finalOutput })
        emit({
          currentIteration: iteration,
          maxIterations,
          steps: progressSteps.slice(-3),
          isComplete: true,
          finalContent: finalOutput,
          conversationHistory: formatConversationForProgress(conversationHistory),
        })
        break
      }

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

          result = await executeToolCall(toolCall, onToolProgress)
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

    // If stop was requested during tool execution, exit the agent loop now
    if (agentSessionStateManager.shouldStopSession(currentSessionId)) {
      // Emit final progress with complete status
      const killNote = "\n\n(Agent mode was stopped by emergency kill switch)"
      const finalOutput = (finalContent || "") + killNote
      addMessage("assistant", finalOutput)
      emit({
        currentIteration: iteration,
        maxIterations,
        steps: progressSteps.slice(-3),
        isComplete: true,
        finalContent: finalOutput,
        conversationHistory: formatConversationForProgress(conversationHistory),
      })
      break
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

      addMessage("tool", toolResultsText, undefined, meaningfulResults)

      // Emit progress update immediately after adding tool results so UI shows them
      emit({
        currentIteration: iteration,
        maxIterations,
        steps: progressSteps.slice(-3),
        isComplete: false,
        conversationHistory: formatConversationForProgress(conversationHistory),
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
          undefined, // relevantTools
          config.mcpCustomSystemPrompt, // custom base system prompt
        )

        const summaryMessages = [
          { role: "system" as const, content: contextAwarePrompt },
          ...mapConversationToMessages(),
        ]

        const { messages: shrunkSummaryMessages } = await shrinkMessagesForLLM({
          messages: summaryMessages as any,
          availableTools: uniqueAvailableTools,
          relevantTools: toolCapabilities.relevantTools,
          isAgentMode: true,
          sessionId: currentSessionId,
          onSummarizationProgress: (current, total) => {
            summaryStep.description = `Summarizing for summary generation (${current}/${total})`
            emit({
              currentIteration: iteration,
              maxIterations,
              steps: progressSteps.slice(-3),
              isComplete: false,
              conversationHistory: formatConversationForProgress(conversationHistory),
            })
          },
        })


        try {
          const summaryResponse = await makeLLMCall(shrunkSummaryMessages, config, onRetryProgress, undefined, currentSessionId)

          // Check if stop was requested during summary generation
          if (agentSessionStateManager.shouldStopSession(currentSessionId)) {
            logLLM(`Agent session ${currentSessionId} stopped during summary generation`)
            const killNote = "\n\n(Agent mode was stopped by emergency kill switch)"
            const finalOutput = (finalContent || "") + killNote
            conversationHistory.push({ role: "assistant", content: finalOutput })
            emit({
              currentIteration: iteration,
              maxIterations,
              steps: progressSteps.slice(-3),
              isComplete: true,
              finalContent: finalOutput,
              conversationHistory: formatConversationForProgress(conversationHistory),
            })
            break
          }

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
          logLLM("Failed to generate summary:", error)
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
	      // Track if we should skip post-verify summary (when agent is repeating itself)
	      let skipPostVerifySummary2 = false

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

	        // Check for infinite loop (repeated responses)
	        const isRepeating = detectRepeatedResponse(finalContent)

	        const retries = Math.max(0, config.mcpVerifyRetryCount ?? 1)
	        let verified = false
	        let verification: any = null

	        // If agent is repeating itself, skip verification AND post-verify summary
	        // UNLESS the content is just a tool call placeholder (not real content)
	        // In that case, we still need to generate a proper summary
	        if (isRepeating) {
	          verified = true
	          // Only skip post-verify summary if we have real content (not just a tool call placeholder)
	          if (!isToolCallPlaceholder(finalContent) && finalContent.trim().length > 0) {
	            skipPostVerifySummary2 = true  // Skip the summary call - we already have valid content
	          }
	          verifyStep.status = "completed"
	          verifyStep.description = "Agent response is repeating - accepting as final"
	          if (isDebugLLM()) {
	            logLLM("Infinite loop detected - treating as complete", {
	              finalContent: finalContent.substring(0, 200),
	              isPlaceholder: isToolCallPlaceholder(finalContent),
	              willGenerateSummary: isToolCallPlaceholder(finalContent)
	            })
	          }
	        } else {
	          for (let i = 0; i <= retries; i++) {
	            verification = await verifyCompletionWithFetch(buildVerificationMessages(finalContent), config.mcpToolsProviderId)
	            if (verification?.isComplete === true) { verified = true; break }
	          }
	        }

	        // Check if stop was requested during verification
	        if (agentSessionStateManager.shouldStopSession(currentSessionId)) {
	          logLLM(`Agent session ${currentSessionId} stopped during verification`)
	          const killNote = "\n\n(Agent mode was stopped by emergency kill switch)"
	          const finalOutput = (finalContent || "") + killNote
	          conversationHistory.push({ role: "assistant", content: finalOutput })
	          emit({
	            currentIteration: iteration,
	            maxIterations,
	            steps: progressSteps.slice(-3),
	            isComplete: true,
	            finalContent: finalOutput,
	            conversationHistory: formatConversationForProgress(conversationHistory),
	          })
	          break
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
        if (!skipPostVerifySummary2) {
          try {
            const result = await generatePostVerifySummary(finalContent, true)
            if (result.stopped) {
              const killNote = "\n\n(Agent mode was stopped by emergency kill switch)"
              const finalOutput = (finalContent || "") + killNote
              conversationHistory.push({ role: "assistant", content: finalOutput })
              emit({
                currentIteration: iteration,
                maxIterations,
                steps: progressSteps.slice(-3),
                isComplete: true,
                finalContent: finalOutput,
                conversationHistory: formatConversationForProgress(conversationHistory),
              })
              break
            }
            finalContent = result.content
            conversationHistory.push({ role: "assistant", content: finalContent })
          } catch (e) {
            // If summary generation fails, proceed with existing finalContent
          }
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
          undefined, // relevantTools
          config.mcpCustomSystemPrompt, // custom base system prompt
        )

        const summaryMessages = [
          { role: "system" as const, content: contextAwarePrompt },
          ...mapConversationToMessages(),
        ]

        const { messages: shrunkSummaryMessages } = await shrinkMessagesForLLM({
          messages: summaryMessages as any,
          availableTools: uniqueAvailableTools,
          relevantTools: toolCapabilities.relevantTools,
          isAgentMode: true,
          sessionId: currentSessionId,
          onSummarizationProgress: (current, total) => {
            summaryStep.description = `Summarizing for summary generation (${current}/${total})`
            emit({
              currentIteration: iteration,
              maxIterations,
              steps: progressSteps.slice(-3),
              isComplete: false,
              conversationHistory: formatConversationForProgress(conversationHistory),
            })
          },
        })


        try {
          const summaryResponse = await makeLLMCall(shrunkSummaryMessages, config, onRetryProgress, undefined, currentSessionId)

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
          conversationHistory.push({
            role: "assistant",
            content: finalContent,
          })
        } catch (error) {
          // If summary generation fails, fall back to the original content
          logLLM("Failed to generate summary:", error)
          finalContent = assistantContent || "Task completed successfully."
          summaryStep.status = "error"
          summaryStep.description = "Failed to generate summary, using fallback"

          conversationHistory.push({
            role: "assistant",
            content: finalContent,
          })
        }

        // NOTE: Removed duplicate "Post-verify summary" block that was causing empty content issues.
        // The summary was already generated above - making another LLM call here would cause
        // the model to return empty content since it already provided a complete response.

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

	        // Check for infinite loop (repeated responses)
	        const isRepeating = detectRepeatedResponse(finalContent)

	        const retries = Math.max(0, config.mcpVerifyRetryCount ?? 1)
	        let verified = false
	        let verification: any = null

	        // If agent is repeating itself, skip verification and accept as complete
	        if (isRepeating) {
	          verified = true
	          verifyStep.status = "completed"
	          verifyStep.description = "Agent response is repeating - accepting as final"
	          if (isDebugLLM()) {
	            logLLM("Infinite loop detected - treating as complete", { finalContent: finalContent.substring(0, 200) })
	          }
	        } else {
	          for (let i = 0; i <= retries; i++) {
	            verification = await verifyCompletionWithFetch(buildVerificationMessages(finalContent), config.mcpToolsProviderId)
	            if (verification?.isComplete === true) { verified = true; break }
	          }
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
  onRetryProgress?: RetryProgressCallback,
  onStreamingUpdate?: StreamingCallback,
  sessionId?: string,
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

    // If streaming callback is provided and provider supports it, use streaming
    // Note: Streaming is only for display purposes - we still need the full response for tool calls
    if (onStreamingUpdate && chatProviderId !== "gemini") {
      // Create abort controller for streaming - we'll abort when structured call completes
      const streamingAbortController = new AbortController()

      // Register with session manager so user-initiated stop will also cancel streaming
      if (sessionId) {
        agentSessionStateManager.registerAbortController(sessionId, streamingAbortController)
      }

      // Track whether streaming should be aborted (when structured call completes)
      // This prevents late streaming updates from appearing after the response is ready
      let streamingAborted = false

      // Wrap the callback to ignore updates after the structured call completes
      const wrappedOnStreamingUpdate = (chunk: string, accumulated: string) => {
        if (!streamingAborted) {
          onStreamingUpdate(chunk, accumulated)
        }
      }

      // Start a parallel streaming call for real-time display
      // This runs alongside the structured call to provide live feedback
      const streamingPromise = makeLLMCallWithStreaming(
        messages,
        wrappedOnStreamingUpdate,
        chatProviderId,
        sessionId,
        streamingAbortController,
      ).catch(err => {
        // Streaming errors are non-fatal - we still have the structured call
        if (isDebugLLM()) {
          logLLM("Streaming call failed (non-fatal):", err)
        }
        return null
      })

      // Make the structured call for the actual response
      // Wrap in try/finally to ensure streaming is cleaned up even if the call fails
      let result: LLMToolCallResponse
      try {
        result = await makeLLMCallWithFetch(messages, chatProviderId, onRetryProgress, sessionId)
      } finally {
        // Abort streaming request - we have the real response (or error) now
        // This saves bandwidth/tokens by closing the SSE connection immediately
        streamingAborted = true
        streamingAbortController.abort()

        // Unregister the streaming abort controller since we're done with it
        if (sessionId) {
          agentSessionStateManager.unregisterAbortController(sessionId, streamingAbortController)
        }
      }

      if (isDebugLLM()) {
        logLLM("Response ←", result)
        logLLM("=== LLM CALL END ===")
      }
      return result
    }

    // Non-streaming path
    const result = await makeLLMCallWithFetch(messages, chatProviderId, onRetryProgress, sessionId)
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
