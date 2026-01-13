import { configStore } from "./config"
import {
  MCPTool,
  MCPToolCall,
  LLMToolCallResponse,
  MCPToolResult,
} from "./mcp-service"
import { AgentProgressStep, AgentProgressUpdate, SessionProfileSnapshot, AgentMemory } from "../shared/types"
import { diagnosticsService } from "./diagnostics"
import { makeStructuredContextExtraction, ContextExtractionResponse } from "./structured-output"
import { makeLLMCallWithFetch, makeTextCompletionWithFetch, RetryProgressCallback, makeLLMCallWithStreaming, StreamingCallback } from "./llm-fetch"
import { constructSystemPrompt } from "./system-prompts"
import { state, agentSessionStateManager } from "./state"
import { isDebugLLM, logLLM, isDebugTools, logTools } from "./debug"
import { shrinkMessagesForLLM, estimateTokensFromMessages } from "./context-budget"
import { emitAgentProgress } from "./emit-agent-progress"
import { agentSessionTracker } from "./agent-session-tracker"
import { conversationService } from "./conversation-service"
import { getCurrentPresetName } from "../shared"
import {
  createAgentTrace,
  endAgentTrace,
  isLangfuseEnabled,
  flushLangfuse,
} from "./langfuse-service"
import {
  isSummarizationEnabled,
  shouldSummarizeStep,
  summarizeAgentStep,
  summarizationService,
  type SummarizationInput,
} from "./summarization-service"
import { memoryService } from "./memory-service"

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
  resources: Array<{ type: string; id: string }>
}> {
  if (conversationHistory.length === 0) {
    return { resources: [] }
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

  const contextExtractionPrompt = `Extract active resource IDs from this conversation:

${conversationText}

Return JSON: {"resources": [{"type": "session|connection|handle|other", "id": "actual_id_value"}]}
Only include currently active/usable resources.`

  try {
    const result = await makeStructuredContextExtraction(
      contextExtractionPrompt,
      config.mcpToolsProviderId,
    )
    return result as { resources: Array<{ type: string; id: string }> }
  } catch (error) {
    return { resources: [] }
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

  if (prompt.includes("{transcript}")) {
    prompt = prompt.replaceAll("{transcript}", transcript)
  } else {
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

  const uniqueAvailableTools = availableTools.filter(
    (tool, index, self) =>
      index === self.findIndex((t) => t.name === tool.name),
  )

  const userGuidelines = config.mcpToolsSystemPrompt
  // Load enabled agent skills instructions for non-agent mode too
  // Use the current profile's skills config
  const { skillsService } = await import("./skills-service")
  const { profileService } = await import("./profile-service")
  const currentProfileId = config.mcpCurrentProfileId
  const enabledSkillIds = currentProfileId
    ? profileService.getEnabledSkillIdsForProfile(currentProfileId)
    : []
  const skillsInstructions = skillsService.getEnabledSkillsInstructionsForProfile(enabledSkillIds)

  // Load memories for context (works independently of dual-model summarization)
  // Memories are filtered by current profile
  // Only load if both memoriesEnabled (system-wide) and dualModelInjectMemories are true
  let relevantMemories: AgentMemory[] = []
  if (config.memoriesEnabled !== false && config.dualModelInjectMemories) {
    const currentProfileId = config.mcpCurrentProfileId
    const allMemories = currentProfileId
      ? await memoryService.getMemoriesByProfile(currentProfileId)
      : await memoryService.getAllMemories()
    // Sort by importance first (critical > high > medium > low), then by recency, before capping
    const importanceOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
    const sortedMemories = [...allMemories].sort((a, b) => {
      const impDiff = importanceOrder[a.importance] - importanceOrder[b.importance]
      if (impDiff !== 0) return impDiff
      return b.createdAt - a.createdAt // More recent first as tiebreaker
    })
    relevantMemories = sortedMemories.slice(0, 10)
    logLLM(`[processTranscriptWithLLM] Loaded ${relevantMemories.length} memories for context (profile: ${currentProfileId || 'global'})`)
  }

  const systemPrompt = constructSystemPrompt(
    uniqueAvailableTools,
    userGuidelines,
    false,
    undefined,
    config.mcpCustomSystemPrompt,
    skillsInstructions,
    relevantMemories,
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

  const { messages: shrunkMessages } = await shrinkMessagesForLLM({
    messages,
    availableTools: uniqueAvailableTools,
    isAgentMode: false,
  })

  const chatProviderId = config.mcpToolsProviderId

  try {
    // Pass tools for native AI SDK tool calling
    const result = await makeLLMCallWithFetch(shrunkMessages, chatProviderId, undefined, undefined, uniqueAvailableTools)
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

/**
 * Result from a single tool execution including metadata for progress tracking
 */
interface ToolExecutionResult {
  toolCall: MCPToolCall
  result: MCPToolResult
  retryCount: number
  cancelledByKill: boolean
}

/**
 * Execute a single tool call with retry logic and kill switch support
 * This helper is used by both sequential and parallel execution modes
 */
async function executeToolWithRetries(
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

      // Wait before retry (exponential backoff)
      await new Promise((resolve) =>
        setTimeout(resolve, Math.pow(2, retryCount) * 1000),
      )

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
  profileSnapshot?: SessionProfileSnapshot, // Profile snapshot for session isolation
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

  // For session isolation: prefer the stored snapshot over the passed-in one
  // This ensures that when reusing an existing sessionId, we maintain the original profile settings
  // and don't allow mid-session profile changes to affect the session
  const storedSnapshot = sessionId ? agentSessionStateManager.getSessionProfileSnapshot(sessionId) : undefined
  const effectiveProfileSnapshot = storedSnapshot ?? profileSnapshot

  // Create session state for this agent run with profile snapshot for isolation
  // Note: createSession is a no-op if the session already exists, so this is safe for resumed sessions
  agentSessionStateManager.createSession(currentSessionId, effectiveProfileSnapshot)

  // Create Langfuse trace for this agent session if enabled
  // - traceId: unique ID for this trace (our agent session ID)
  // - sessionId: groups traces together in Langfuse (our conversation ID)
  if (isLangfuseEnabled()) {
    createAgentTrace(currentSessionId, {
      name: "Agent Session",
      sessionId: currentConversationId,  // Groups all agent sessions in this conversation
      metadata: {
        maxIterations,
        hasHistory: !!previousConversationHistory?.length,
        profileId: effectiveProfileSnapshot?.profileId,
        profileName: effectiveProfileSnapshot?.profileName,
      },
      input: transcript,
      tags: effectiveProfileSnapshot?.profileName
        ? [`profile:${effectiveProfileSnapshot.profileName}`]
        : undefined,
    })
  }

  // Declare variables that need to be accessible in the finally block for Langfuse tracing
  let iteration = 0
  let finalContent = ""
  let wasAborted = false // Track if agent was aborted for observability
  let toolsExecutedInSession = false // Track if ANY tools were executed, survives context shrinking

  try {
  // Track context usage info for progress display
  // Declared here so emit() can access it
  let contextInfoRef: { estTokens: number; maxTokens: number } | undefined = undefined

  // Get model info for progress display
  const providerId = config.mcpToolsProviderId || "openai"
  const modelName = providerId === "openai"
    ? config.mcpToolsOpenaiModel || "gpt-4o-mini"
    : providerId === "groq"
    ? config.mcpToolsGroqModel || "llama-3.3-70b-versatile"
    : providerId === "gemini"
    ? config.mcpToolsGeminiModel || "gemini-1.5-flash-002"
    : "gpt-4o-mini"
  // For OpenAI provider, use the preset name (e.g., "OpenRouter", "Together AI")
  const providerDisplayName = providerId === "openai"
    ? getCurrentPresetName(config.currentModelPresetId, config.modelPresets)
    : providerId === "groq" ? "Groq" : providerId === "gemini" ? "Gemini" : providerId
  const modelInfoRef = { provider: providerDisplayName, model: modelName }

  // Create bound emitter that always includes sessionId, conversationId, snooze state, sessionStartIndex, conversationTitle, and contextInfo
  const emit = (
    update: Omit<AgentProgressUpdate, 'sessionId' | 'conversationId' | 'isSnoozed' | 'conversationTitle'>,
  ) => {
    const isSnoozed = agentSessionTracker.isSessionSnoozed(currentSessionId)
    const session = agentSessionTracker.getSession(currentSessionId)
    const conversationTitle = session?.conversationTitle
    const profileName = session?.profileSnapshot?.profileName

    const fullUpdate: AgentProgressUpdate = {
      ...update,
      sessionId: currentSessionId,
      conversationId: currentConversationId,
      conversationTitle,
      isSnoozed,
      sessionStartIndex,
      // Always include current context info if available
      contextInfo: update.contextInfo ?? contextInfoRef,
      // Always include model info
      modelInfo: modelInfoRef,
      // Include profile name from session snapshot for UI display
      profileName,
      // Dual-model summarization data (from service - single source of truth)
      stepSummaries: summarizationService.getSummaries(currentSessionId),
      latestSummary: summarizationService.getLatestSummary(currentSessionId),
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

  // Helper function to generate a step summary using the weak model (if dual-model enabled)
  const generateStepSummary = async (
    stepNumber: number,
    toolCalls?: MCPToolCall[],
    toolResults?: MCPToolResult[],
    assistantResponse?: string,
    isCompletion?: boolean,
  ) => {
    if (!isSummarizationEnabled()) {
      return null
    }

    const hasToolCalls = !!toolCalls && toolCalls.length > 0
    const isCompletionStep = isCompletion ?? false

    if (!shouldSummarizeStep(hasToolCalls, isCompletionStep)) {
      return null
    }

    const input: SummarizationInput = {
      sessionId: currentSessionId,
      stepNumber,
      toolCalls: toolCalls?.map(tc => ({
        name: tc.name,
        arguments: tc.arguments,
      })),
      toolResults: toolResults?.map(tr => ({
        success: !tr.isError,
        content: Array.isArray(tr.content)
          ? tr.content.map(c => c.text).join("\n")
          : String(tr.content || ""),
        error: tr.isError
          ? (Array.isArray(tr.content) ? tr.content.map(c => c.text).join("\n") : String(tr.content || ""))
          : undefined,
      })),
      assistantResponse,
      recentMessages: conversationHistory.slice(-5).map(m => ({
        role: m.role,
        content: m.content,
      })),
    }

    try {
      const summary = await summarizeAgentStep(input)
      if (summary) {
        summarizationService.addSummary(summary)

        // Auto-save all summaries if enabled (no importance threshold)
        // Associate memory with the session's profile for profile-scoped memories
        if (config.memoriesEnabled !== false && config.dualModelAutoSaveImportant) {
          const profileIdForMemory = effectiveProfileSnapshot?.profileId ?? config.mcpCurrentProfileId
          const memory = memoryService.createMemoryFromSummary(
            summary,
            undefined, // title
            undefined, // userNotes
            undefined, // tags
            undefined, // conversationTitle
            currentConversationId,
            profileIdForMemory,
          )
          memoryService.saveMemory(memory).catch(err => {
            if (isDebugLLM()) {
              logLLM("[Dual-Model] Error auto-saving summary:", err)
            }
          })
        }

        if (isDebugLLM()) {
          logLLM("[Dual-Model] Generated step summary:", {
            stepNumber: summary.stepNumber,
            importance: summary.importance,
            actionSummary: summary.actionSummary,
          })
        }

        return summary
      }
    } catch (error) {
      if (isDebugLLM()) {
        logLLM("[Dual-Model] Error generating step summary:", error)
      }
    }

    return null
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

  // Update initial step with tool count
  initialStep.status = "completed"
  initialStep.description = `Found ${availableTools.length} available tools.`

  // Remove duplicates from available tools to prevent confusion
  const uniqueAvailableTools = availableTools.filter(
    (tool, index, self) =>
      index === self.findIndex((t) => t.name === tool.name),
  )

  // Use profile snapshot for session isolation if available, otherwise fall back to global config
  // This ensures the session uses the profile settings at creation time,
  // even if the global profile is changed during session execution
  const agentModeGuidelines = effectiveProfileSnapshot?.guidelines ?? config.mcpToolsSystemPrompt ?? ""
  const customSystemPrompt = effectiveProfileSnapshot?.systemPrompt ?? config.mcpCustomSystemPrompt

  // Load enabled agent skills instructions for the current profile
  // Skills provide specialized instructions that improve AI performance on specific tasks
  // Use per-profile skills config if available, otherwise fall back to empty (no skills)
  const { skillsService } = await import("./skills-service")
  const enabledSkillIds = effectiveProfileSnapshot?.skillsConfig?.enabledSkillIds ?? []
  logLLM(`[processTranscriptWithAgentMode] Loading skills for session ${currentSessionId}. enabledSkillIds: [${enabledSkillIds.join(', ')}]`)
  const skillsInstructions = skillsService.getEnabledSkillsInstructionsForProfile(enabledSkillIds)
  logLLM(`[processTranscriptWithAgentMode] Skills instructions loaded: ${skillsInstructions ? `${skillsInstructions.length} chars` : 'none'}`)

  // Load memories for agent context (works independently of dual-model summarization)
  // Memories provide context from previous sessions - user preferences, past decisions, important learnings
  // Memories are filtered by the session's profile
  // Only load if both memoriesEnabled (system-wide) and dualModelInjectMemories are true
  let relevantMemories: AgentMemory[] = []
  if (config.memoriesEnabled !== false && config.dualModelInjectMemories) {
    const profileIdForMemories = effectiveProfileSnapshot?.profileId ?? config.mcpCurrentProfileId
    const allMemories = profileIdForMemories
      ? await memoryService.getMemoriesByProfile(profileIdForMemories)
      : await memoryService.getAllMemories()
    // Sort by importance first (critical > high > medium > low), then by recency, before capping
    const importanceOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
    const sortedMemories = [...allMemories].sort((a, b) => {
      const impDiff = importanceOrder[a.importance] - importanceOrder[b.importance]
      if (impDiff !== 0) return impDiff
      return b.createdAt - a.createdAt // More recent first as tiebreaker
    })
    relevantMemories = sortedMemories.slice(0, 30) // Cap at 30 for agent mode
    logLLM(`[processTranscriptWithAgentMode] Loaded ${relevantMemories.length} memories for context (from ${allMemories.length} total, profile: ${profileIdForMemories || 'global'})`)
  }

  // Construct system prompt using the new approach
  const systemPrompt = constructSystemPrompt(
    uniqueAvailableTools,
    agentModeGuidelines,
    true,
    undefined, // relevantTools removed - let LLM decide tool relevance
    customSystemPrompt, // custom base system prompt from profile snapshot or global config
    skillsInstructions, // agent skills instructions
    relevantMemories, // memories from previous sessions
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

  // Track the index where the current user prompt was added
  // This is used to scope tool result checks to only the current turn
  const currentPromptIndex = previousConversationHistory?.length || 0

  logLLM(`[llm.ts processTranscriptWithAgentMode] conversationHistory initialized with ${conversationHistory.length} messages, roles: [${conversationHistory.map(m => m.role).join(', ')}]`)

  // Save the initial user message incrementally
  // Only save if this is a new message (not already in previous conversation history)
  // Check if ANY user message in previousConversationHistory has the same content (not just the last one)
  // This handles retry scenarios where the user message exists but isn't the last message
  // (e.g., after a failed attempt that added assistant/tool messages)
  const userMessageAlreadyExists = previousConversationHistory?.some(
    msg => msg.role === "user" && msg.content === transcript
  ) ?? false
  if (!userMessageAlreadyExists) {
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
      content.includes("You have relevant tools available for this request") ||
      content.includes("Your previous response was empty") ||
      content.includes("Verifier indicates the task is not complete") ||
      content.includes("Please respond with a valid JSON object")

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
    checkForStop: boolean = false,
    activeToolsList: MCPTool[] = uniqueAvailableTools
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
      activeToolsList,
      agentModeGuidelines, // Use session-bound guidelines
      true,
      undefined, // relevantTools removed
      customSystemPrompt, // Use session-bound custom system prompt
      skillsInstructions, // agent skills instructions
      relevantMemories, // memories from previous sessions
    )

    const postVerifySummaryMessages = [
      { role: "system" as const, content: postVerifySystemPrompt },
      ...mapConversationToMessages(true),
    ]

    const { messages: shrunkMessages, estTokensAfter: verifyEstTokens, maxTokens: verifyMaxTokens } = await shrinkMessagesForLLM({
      messages: postVerifySummaryMessages as any,
      availableTools: activeToolsList,
      relevantTools: undefined,
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
    // Update context info for progress display
    contextInfoRef = { estTokens: verifyEstTokens, maxTokens: verifyMaxTokens }

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


  // Emit initial progress
  emit({
    currentIteration: 0,
    maxIterations,
    steps: progressSteps.slice(-3), // Show max 3 steps
    isComplete: false,
    conversationHistory: formatConversationForProgress(conversationHistory),
  })

  // Pi-inspired: Trust the model - no verification counters or artificial limits

  while (iteration < maxIterations) {
    iteration++
    currentIterationRef = iteration // Update ref for retry progress callback

    // Pi-inspired: All tools remain available - let the model adapt to failures
    const activeTools = uniqueAvailableTools
    const currentSystemPrompt = systemPrompt

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
      conversationHistory.push({ role: "assistant", content: finalOutput, timestamp: Date.now() })
      emit({
        currentIteration: iteration,
        maxIterations,
        steps: progressSteps.slice(-3),
        isComplete: true,
        finalContent: finalOutput,
        conversationHistory: formatConversationForProgress(conversationHistory),
      })

      wasAborted = true
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

    // Use the base system prompt (or rebuilt prompt if tools were excluded)
    // This ensures the LLM only sees tools it can actually call
    let contextAwarePrompt = currentSystemPrompt

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

      // Only add resource IDs if there are any - LLM can infer context from conversation history
      if (contextInfo.resources.length > 0) {
        contextAwarePrompt += `\n\nAVAILABLE RESOURCES:\n${contextInfo.resources.map((r) => `- ${r.type.toUpperCase()}: ${r.id}`).join("\n")}`
      }
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
    // Use activeTools (filtered for failures) so context-budget paths like minimal_system_prompt
    // don't list tools that are no longer callable, which could confuse the LLM
    const { messages: shrunkMessages, estTokensAfter, maxTokens: maxContextTokens } = await shrinkMessagesForLLM({
      messages: messages as any,
      availableTools: activeTools,
      relevantTools: undefined,
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
    // Update context info for progress display
    contextInfoRef = { estTokens: estTokensAfter, maxTokens: maxContextTokens }

    // If stop was requested during context shrinking, exit now
    if (agentSessionStateManager.shouldStopSession(currentSessionId)) {
      logLLM(`Agent session ${currentSessionId} stopped during context shrink`)
      thinkingStep.status = "completed"
      thinkingStep.title = "Agent stopped"
      thinkingStep.description = "Emergency stop triggered"
      const killNote = "\n\n(Agent mode was stopped by emergency kill switch)"
      const finalOutput = (finalContent || "") + killNote
      conversationHistory.push({ role: "assistant", content: finalOutput, timestamp: Date.now() })
      emit({
        currentIteration: iteration,
        maxIterations,
        steps: progressSteps.slice(-3),
        isComplete: true,
        finalContent: finalOutput,
        conversationHistory: formatConversationForProgress(conversationHistory),
      })
      wasAborted = true
      break
    }

    // Make LLM call (abort-aware) with streaming for real-time UI updates
    let llmResponse: any
    try {
      // Create streaming callback that emits progress updates as content streams in
      let lastStreamEmitTime = 0
      const STREAM_EMIT_THROTTLE_MS = 50

      const onStreamingUpdate: StreamingCallback = (_chunk, accumulated) => {
        const now = Date.now()
        // Update the thinking step with streaming content (always)
        thinkingStep.llmContent = accumulated

        // Throttle emit calls to reduce log spam
        if (now - lastStreamEmitTime < STREAM_EMIT_THROTTLE_MS) {
          return // Skip emit, but content is updated
        }
        lastStreamEmitTime = now

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

      // activeTools is already computed at the start of each iteration
      llmResponse = await makeLLMCall(shrunkMessages, config, onRetryProgress, onStreamingUpdate, currentSessionId, activeTools)

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
        conversationHistory.push({ role: "assistant", content: finalOutput, timestamp: Date.now() })
        emit({
          currentIteration: iteration,
          maxIterations,
          steps: progressSteps.slice(-3),
          isComplete: true,
          finalContent: finalOutput,
          conversationHistory: formatConversationForProgress(conversationHistory),
        })
        wasAborted = true
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
        conversationHistory.push({ role: "assistant", content: finalOutput, timestamp: Date.now() })
        emit({
          currentIteration: iteration,
          maxIterations,
          steps: progressSteps.slice(-3),
          isComplete: true,
          finalContent: finalOutput,
          conversationHistory: formatConversationForProgress(conversationHistory),
        })
        wasAborted = true
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
    // A response is valid if it has either:
    // 1. Non-empty content, OR
    // 2. Valid toolCalls (tool-only responses have empty content), OR
    // 3. Empty content with needsMoreWork=false AND no toolCalls (LLM intentionally completed with finish_reason='stop')
    const hasValidContent = llmResponse?.content && llmResponse.content.trim().length > 0
    const hasValidToolCalls = llmResponse?.toolCalls && Array.isArray(llmResponse.toolCalls) && llmResponse.toolCalls.length > 0
    // Check for intentional empty completion (finish_reason='stop' in llm-fetch.ts returns this)
    // IMPORTANT: If there are toolCalls, they take precedence over intentional-empty completion
    // to ensure tool execution is not skipped
    const isIntentionalEmptyCompletion = llmResponse?.needsMoreWork === false && llmResponse?.content === "" && !hasValidToolCalls

    if (!llmResponse || (!hasValidContent && !hasValidToolCalls && !isIntentionalEmptyCompletion)) {
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

    // Handle intentional empty completion from LLM (finish_reason='stop')
    // Pi-inspired: Trust the model when it explicitly signals completion
    if (isIntentionalEmptyCompletion) {
      logLLM("✅ LLM intentionally completed with empty response (finish_reason=stop) - trusting model")

      // Mark thinking step as completed
      thinkingStep.status = "completed"
      thinkingStep.title = "Agent completed"
      thinkingStep.description = "Model completed without additional content"

      // Add completion step
      const completionStep = createProgressStep(
        "completion",
        "Task completed",
        "The model completed without additional content",
        "completed",
      )
      progressSteps.push(completionStep)

      // Emit final progress with empty content
      emit({
        currentIteration: iteration,
        maxIterations,
        steps: progressSteps.slice(-3),
        isComplete: true,
        finalContent: "",
        conversationHistory: formatConversationForProgress(conversationHistory),
      })

      // End Langfuse trace for early completion
      if (isLangfuseEnabled()) {
        endAgentTrace(currentSessionId, {
          output: "",
          metadata: { totalIterations: iteration, earlyCompletion: true },
        })
        flushLangfuse().catch(() => {})
      }

      return {
        content: "",
        conversationHistory,
        totalIterations: iteration,
      }
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
      // Pi-inspired: Trust the model when it explicitly signals completion
      // Only nudge if content has invalid tool markers (model confused about interface)
      const contentText = (llmResponse.content || "")
      const hasToolMarkers = /<\|tool_calls_section_begin\|>|<\|tool_call_begin\|>/i.test(contentText)
      if (hasToolMarkers) {
        conversationHistory.push({ role: "assistant", content: contentText.replace(/<\|[^|]*\|>/g, "").trim(), timestamp: Date.now() })
        conversationHistory.push({ role: "user", content: "Please use the native tool-calling interface to call the tools directly, rather than describing them in text.", timestamp: Date.now() })
        continue
      }

      // Agent explicitly indicated completion - trust it
      finalContent = llmResponse.content || ""

      // Add to history
      if (finalContent.trim().length > 0) {
        addMessage("assistant", finalContent)
      }

      // Add completion step
      const completionStep = createProgressStep(
        "completion",
        "Task completed",
        "Successfully completed the requested task",
        "completed",
      )
      progressSteps.push(completionStep)

      // Emit final progress immediately for UI feedback
      emit({
        currentIteration: iteration,
        maxIterations,
        steps: progressSteps.slice(-3),
        isComplete: true,
        finalContent,
        conversationHistory: formatConversationForProgress(conversationHistory),
      })

      // Generate final completion summary (if dual-model enabled)
      // Await and emit follow-up to ensure the final summary is included
      if (isSummarizationEnabled()) {
        const lastToolCalls = conversationHistory
          .filter(m => m.toolCalls && m.toolCalls.length > 0)
          .flatMap(m => m.toolCalls || [])
          .slice(-5)
        const lastToolResults = conversationHistory
          .filter(m => m.toolResults && m.toolResults.length > 0)
          .flatMap(m => m.toolResults || [])
          .slice(-5)

        try {
          const completionSummary = await generateStepSummary(
            iteration,
            lastToolCalls,
            lastToolResults,
            finalContent,
            true, // isCompletion: this is the final completion step
          )

          // If a summary was generated, emit a follow-up progress update
          // to ensure the UI receives the completion summary
          if (completionSummary) {
            emit({
              currentIteration: iteration,
              maxIterations,
              steps: progressSteps.slice(-3),
              isComplete: true,
              finalContent,
              conversationHistory: formatConversationForProgress(conversationHistory),
            })
          }
        } catch (err) {
          if (isDebugLLM()) {
            logLLM("[Dual-Model] Completion summarization error:", err)
          }
        }
      }

      break
    }

    // Pi-inspired: Handle responses without tool calls
    // Trust the model's decision - if it provides content, it's done thinking
    if (!hasToolCalls && !explicitlyComplete) {
      const contentText = llmResponse.content || ""
      const trimmedContent = contentText.trim()

      // If model provides any substantive response, trust it as complete
      // This prevents infinite loops and respects the model's judgment
      if (trimmedContent.length > 0 && !isToolCallPlaceholder(contentText)) {
        if (isDebugLLM()) {
          logLLM("Pi-inspired: Accepting response as complete (trusting model)", {
            responseLength: trimmedContent.length,
            responsePreview: trimmedContent.substring(0, 100),
          })
        }
        finalContent = contentText
        addMessage("assistant", contentText)
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

      // Empty response without explicit completion - model may need more context
      // Add a gentle nudge only if response is empty
      if (trimmedContent.length === 0) {
        addMessage("user", "Please provide a response or use the available tools to complete the task.")
        continue
      }
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

    // Check for stop signal before starting tool execution
    if (agentSessionStateManager.shouldStopSession(currentSessionId)) {
      logLLM(`Agent session ${currentSessionId} stopped before tool execution`)
      const killNote = "\n\n(Agent mode was stopped by emergency kill switch)"
      const finalOutput = (finalContent || "") + killNote
      conversationHistory.push({ role: "assistant", content: finalOutput, timestamp: Date.now() })
      emit({
        currentIteration: iteration,
        maxIterations,
        steps: progressSteps.slice(-3),
        isComplete: true,
        finalContent: finalOutput,
        conversationHistory: formatConversationForProgress(conversationHistory),
      })
      wasAborted = true
      break
    }

    // Determine execution mode: parallel or sequential
    // Sequential execution is used when config mcpParallelToolExecution is set to false
    // Default is parallel execution when multiple tools are called
    const forceSequential = config.mcpParallelToolExecution === false
    const useParallelExecution = !forceSequential && toolCallsArray.length > 1

    if (useParallelExecution) {
      // PARALLEL EXECUTION: Execute all tool calls concurrently
      if (isDebugTools()) {
        logTools(`Executing ${toolCallsArray.length} tool calls in parallel`, toolCallsArray.map(t => t.name))
      }

      // Create progress steps for all tools upfront
      // Use array index as key to avoid collisions when same tool is called with identical args
      const toolCallSteps: AgentProgressStep[] = []
      for (const toolCall of toolCallsArray) {
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
        toolCallSteps.push(toolCallStep)
      }

      // Emit progress showing all tools starting in parallel
      emit({
        currentIteration: iteration,
        maxIterations,
        steps: progressSteps.slice(-Math.min(toolCallsArray.length * 2, 6)),
        isComplete: false,
        conversationHistory: formatConversationForProgress(conversationHistory),
      })

      // Execute all tools in parallel
      const executionPromises = toolCallsArray.map(async (toolCall, index) => {
        const toolCallStep = toolCallSteps[index]

        const onToolProgress = (message: string) => {
          toolCallStep.description = message
          emit({
            currentIteration: iteration,
            maxIterations,
            steps: progressSteps.slice(-Math.min(toolCallsArray.length * 2, 6)),
            isComplete: false,
            conversationHistory: formatConversationForProgress(conversationHistory),
          })
        }

        const execResult = await executeToolWithRetries(
          toolCall,
          executeToolCall,
          currentSessionId,
          onToolProgress,
          2, // maxRetries
        )

        // Update the progress step with the result
        toolCallStep.status = execResult.result.isError ? "error" : "completed"
        toolCallStep.toolResult = {
          success: !execResult.result.isError,
          content: execResult.result.content.map((c) => c.text).join("\n"),
          error: execResult.result.isError
            ? execResult.result.content.map((c) => c.text).join("\n")
            : undefined,
        }

        // Add tool result step
        const toolResultStep = createProgressStep(
          "tool_result",
          `${toolCall.name} ${execResult.result.isError ? "failed" : "completed"}`,
          execResult.result.isError
            ? `Tool execution failed${execResult.retryCount > 0 ? ` after ${execResult.retryCount} retries` : ""}`
            : "Tool executed successfully",
          execResult.result.isError ? "error" : "completed",
        )
        toolResultStep.toolResult = toolCallStep.toolResult
        progressSteps.push(toolResultStep)

        return execResult
      })

      // Wait for all tools to complete
      const executionResults = await Promise.all(executionPromises)

      // Check if any tool was cancelled by kill switch
      const anyCancelled = executionResults.some(r => r.cancelledByKill)
      if (anyCancelled) {
        const killNote = "\n\n(Agent mode was stopped by emergency kill switch)"
        const finalOutput = (finalContent || "") + killNote
        conversationHistory.push({ role: "assistant", content: finalOutput, timestamp: Date.now() })
        emit({
          currentIteration: iteration,
          maxIterations,
          steps: progressSteps.slice(-Math.min(toolCallsArray.length * 2, 6)),
          isComplete: true,
          finalContent: finalOutput,
          conversationHistory: formatConversationForProgress(conversationHistory),
        })
        wasAborted = true
        break
      }

      // Collect results in order
      for (const execResult of executionResults) {
        toolResults.push(execResult.result)
        toolsExecutedInSession = true
        if (execResult.result.isError) {
          failedTools.push(execResult.toolCall.name)
        }
      }

      // Emit final progress for parallel execution
      emit({
        currentIteration: iteration,
        maxIterations,
        steps: progressSteps.slice(-Math.min(toolCallsArray.length * 2, 6)),
        isComplete: false,
        conversationHistory: formatConversationForProgress(conversationHistory),
      })
    } else {
      // SEQUENTIAL EXECUTION: Execute tool calls one at a time
      if (isDebugTools()) {
        const reason = toolCallsArray.length <= 1
          ? "Single tool call"
          : "Config disabled parallel execution"
        logTools(`Executing ${toolCallsArray.length} tool calls sequentially - ${reason}`, toolCallsArray.map(t => t.name))
      }
      for (const [, toolCall] of toolCallsArray.entries()) {
        if (isDebugTools()) {
          logTools("Executing planned tool call", toolCall)
        }
        // Check for stop signal before executing each tool
        if (agentSessionStateManager.shouldStopSession(currentSessionId)) {
          logLLM(`Agent session ${currentSessionId} stopped during tool execution`)
          const killNote = "\n\n(Agent mode was stopped by emergency kill switch)"
          const finalOutput = (finalContent || "") + killNote
          conversationHistory.push({ role: "assistant", content: finalOutput, timestamp: Date.now() })
          emit({
            currentIteration: iteration,
            maxIterations,
            steps: progressSteps.slice(-3),
            isComplete: true,
            finalContent: finalOutput,
            conversationHistory: formatConversationForProgress(conversationHistory),
          })
          wasAborted = true
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

        // Create progress callback to update tool execution step
        const onToolProgress = (message: string) => {
          toolCallStep.description = message
          emit({
            currentIteration: iteration,
            maxIterations,
            steps: progressSteps.slice(-3),
            isComplete: false,
            conversationHistory: formatConversationForProgress(conversationHistory),
          })
        }

        const execResult = await executeToolWithRetries(
          toolCall,
          executeToolCall,
          currentSessionId,
          onToolProgress,
          2, // maxRetries
        )

        if (execResult.cancelledByKill) {
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
          const killNote = "\n\n(Agent mode was stopped by emergency kill switch)"
          const finalOutput = (finalContent || "") + killNote
          conversationHistory.push({ role: "assistant", content: finalOutput, timestamp: Date.now() })
          emit({
            currentIteration: iteration,
            maxIterations,
            steps: progressSteps.slice(-3),
            isComplete: true,
            finalContent: finalOutput,
            conversationHistory: formatConversationForProgress(conversationHistory),
          })
          wasAborted = true
          break
        }

        toolResults.push(execResult.result)
        toolsExecutedInSession = true

        // Track failed tools for better error reporting
        if (execResult.result.isError) {
          failedTools.push(toolCall.name)
        }

        // Update tool call step with result
        toolCallStep.status = execResult.result.isError ? "error" : "completed"
        toolCallStep.toolResult = {
          success: !execResult.result.isError,
          content: execResult.result.content.map((c) => c.text).join("\n"),
          error: execResult.result.isError
            ? execResult.result.content.map((c) => c.text).join("\n")
            : undefined,
        }

        // Add tool result step with enhanced error information
        const toolResultStep = createProgressStep(
          "tool_result",
          `${toolCall.name} ${execResult.result.isError ? "failed" : "completed"}`,
          execResult.result.isError
            ? `Tool execution failed${execResult.retryCount > 0 ? ` after ${execResult.retryCount} retries` : ""}`
            : "Tool executed successfully",
          execResult.result.isError ? "error" : "completed",
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
      wasAborted = true
      break
    }


    // Note: Assistant response with tool calls was already added before tool execution
    // This ensures the tool call request is visible immediately in the UI

    // Keep tool results intact for full visibility in UI
    // The UI will handle display and truncation as needed
    const processedToolResults = toolResults

    // Always add a tool message if any tools were executed, even if results are empty
    // This ensures the verifier sees tool execution evidence in conversationHistory
    if (processedToolResults.length > 0) {
      // For each result, use "[No output]" if the content is empty and not an error
      const resultsWithPlaceholders = processedToolResults.map((result) => {
        const contentText = result.content?.map((c) => c.text).join("").trim() || ""
        if (!result.isError && contentText.length === 0) {
          return {
            ...result,
            content: [{ type: "text" as const, text: "[No output]" }],
          }
        }
        return result
      })

      const toolResultsText = resultsWithPlaceholders
        .map((result) => result.content.map((c) => c.text).join("\n"))
        .join("\n\n")

      addMessage("tool", toolResultsText, undefined, resultsWithPlaceholders)

      // Emit progress update immediately after adding tool results so UI shows them
      emit({
        currentIteration: iteration,
        maxIterations,
        steps: progressSteps.slice(-3),
        isComplete: false,
        conversationHistory: formatConversationForProgress(conversationHistory),
      })
    }

    // Generate step summary after tool execution (if dual-model enabled)
    // Fire-and-forget: summaries are for UI display, not needed for agent's next decision
    generateStepSummary(
      iteration,
      toolCallsArray,
      toolResults,
      llmResponse.content || undefined,
    ).catch(err => {
      if (isDebugLLM()) {
        logLLM("[Dual-Model] Background summarization error:", err)
      }
    })

    // Enhanced completion detection with better error handling
    const hasErrors = toolResults.some((result) => result.isError)
    const allToolsSuccessful = toolResults.length > 0 && !hasErrors

    if (hasErrors) {
      // Pi-inspired: Let the model see errors and adapt - no tool exclusion tracking
      // The model can decide whether to retry, use alternatives, or complete with explanation
      const errorAnalysis = analyzeToolErrors(toolResults)

      // Add error summary to conversation history for LLM context
      const errorSummary = `Tool execution errors occurred:
${failedTools
  .map((toolName) => {
    const failedResult = toolResults.find((r) => r.isError)
    const errorText =
      failedResult?.content.map((c) => c.text).join(" ") || "Unknown error"
    return `- ${toolName}: ${errorText}`
  })
  .join("\n")}

${errorAnalysis.recoveryStrategy}`

      conversationHistory.push({
        role: "tool",
        content: errorSummary,
        timestamp: Date.now(),
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
          timestamp: Date.now(),
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
          agentModeGuidelines, // Use session-bound guidelines
          true, // isAgentMode
          undefined, // relevantTools
          customSystemPrompt, // Use session-bound custom system prompt
          skillsInstructions, // agent skills instructions
          relevantMemories, // memories from previous sessions
        )

        const summaryMessages = [
          { role: "system" as const, content: contextAwarePrompt },
          ...mapConversationToMessages(),
        ]

        const { messages: shrunkSummaryMessages, estTokensAfter: summaryEstTokens, maxTokens: summaryMaxTokens } = await shrinkMessagesForLLM({
          messages: summaryMessages as any,
          availableTools: uniqueAvailableTools,
          relevantTools: undefined,
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
        // Update context info for progress display
        contextInfoRef = { estTokens: summaryEstTokens, maxTokens: summaryMaxTokens }


        try {
          const summaryResponse = await makeLLMCall(shrunkSummaryMessages, config, onRetryProgress, undefined, currentSessionId)

          // Check if stop was requested during summary generation
          if (agentSessionStateManager.shouldStopSession(currentSessionId)) {
            logLLM(`Agent session ${currentSessionId} stopped during summary generation`)
            const killNote = "\n\n(Agent mode was stopped by emergency kill switch)"
            const finalOutput = (finalContent || "") + killNote
            conversationHistory.push({ role: "assistant", content: finalOutput, timestamp: Date.now() })
            emit({
              currentIteration: iteration,
              maxIterations,
              steps: progressSteps.slice(-3),
              isComplete: true,
              finalContent: finalOutput,
              conversationHistory: formatConversationForProgress(conversationHistory),
            })
            wasAborted = true
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
            timestamp: Date.now(),
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
            timestamp: Date.now(),
          })
        }
      } else {
        // Agent provided sufficient content, use it as final content
        finalContent = lastAssistantContent
      }


      // Pi-inspired: No verification - trust the model's completion signal
      // Just ensure final content is in history
      if (finalContent.trim().length > 0) {
        conversationHistory.push({ role: "assistant", content: finalContent, timestamp: Date.now() })
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
          timestamp: Date.now(),
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
          agentModeGuidelines, // Use session-bound guidelines
          true, // isAgentMode
          undefined, // relevantTools
          customSystemPrompt, // Use session-bound custom system prompt
          skillsInstructions, // agent skills instructions
          relevantMemories, // memories from previous sessions
        )

        const summaryMessages = [
          { role: "system" as const, content: contextAwarePrompt },
          ...mapConversationToMessages(),
        ]

        const { messages: shrunkSummaryMessages, estTokensAfter: summaryEstTokens2, maxTokens: summaryMaxTokens2 } = await shrinkMessagesForLLM({
          messages: summaryMessages as any,
          availableTools: uniqueAvailableTools,
          relevantTools: undefined,
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
        // Update context info for progress display
        contextInfoRef = { estTokens: summaryEstTokens2, maxTokens: summaryMaxTokens2 }


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
            timestamp: Date.now(),
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
            timestamp: Date.now(),
          })
        }

        // Pi-inspired: Summary was generated above, trust it
      } else {
        // Agent provided sufficient content, use it as final content
        finalContent = assistantContent
        conversationHistory.push({
          role: "assistant",
          content: finalContent,
          timestamp: Date.now(),
        })
      }

      // Pi-inspired: No verification - trust the model when it says needsMoreWork=false
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
        timestamp: Date.now(),
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

    return {
      content: finalContent,
      conversationHistory,
      totalIterations: iteration,
    }
  } finally {
    // End Langfuse trace for this agent session if enabled
    // This is in a finally block to ensure traces are closed even on unexpected exceptions
    if (isLangfuseEnabled()) {
      endAgentTrace(currentSessionId, {
        output: finalContent,
        metadata: {
          totalIterations: iteration,
          wasAborted,
        },
      })
      // Flush to ensure trace is sent
      flushLangfuse().catch(() => {})
    }

    // Clean up session state at the end of agent processing
    agentSessionStateManager.cleanupSession(currentSessionId)
  }
}

async function makeLLMCall(
  messages: Array<{ role: string; content: string }>,
  config: any,
  onRetryProgress?: RetryProgressCallback,
  onStreamingUpdate?: StreamingCallback,
  sessionId?: string,
  tools?: MCPTool[],
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
      if (tools) {
        logLLM("Tools →", {
          count: tools.length,
          names: tools.map(t => t.name),
        })
      }
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

      // Track the last accumulated streaming content to use as the final text
      // This ensures the user sees the same content they watched stream in
      let lastStreamedContent = ""

      // Track whether streaming failed - if so, we should not use partial/stale content
      // to overwrite the full structured response
      let streamingFailed = false

      // Wrap the callback to ignore updates after the structured call completes
      // and track the accumulated content for consistency
      const wrappedOnStreamingUpdate = (chunk: string, accumulated: string) => {
        if (!streamingAborted) {
          lastStreamedContent = accumulated
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
        // Mark streaming as failed so we don't use partial/stale content
        streamingFailed = true
        if (isDebugLLM()) {
          logLLM("Streaming call failed (non-fatal):", err)
        }
        return null
      })

      // Make the structured call for the actual response
      // Wrap in try/finally to ensure streaming is cleaned up even if the call fails
      let result: LLMToolCallResponse
      try {
        result = await makeLLMCallWithFetch(messages, chatProviderId, onRetryProgress, sessionId, tools)
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

      // Use the streamed content for display consistency if:
      // 1. We have streamed content AND
      // 2. Streaming didn't fail (to avoid using partial/stale content) AND
      // 3. There are no tool calls (to maintain consistency between content and toolCalls)
      // This ensures what the user saw streaming is what they get at the end for text-only responses.
      // When tool calls are present, we keep the structured response content to maintain
      // consistency between content and toolCalls in the conversation history.
      // This prevents downstream agent logic from seeing mismatched text content and tool calls.
      const hasToolCalls = result.toolCalls && result.toolCalls.length > 0
      if (lastStreamedContent && !streamingFailed && !hasToolCalls) {
        result = {
          ...result,
          content: lastStreamedContent,
        }
      }

      if (isDebugLLM()) {
        logLLM("Response ←", result)
        logLLM("=== LLM CALL END ===")
      }
      return result
    }

    // Non-streaming path
    const result = await makeLLMCallWithFetch(messages, chatProviderId, onRetryProgress, sessionId, tools)
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
