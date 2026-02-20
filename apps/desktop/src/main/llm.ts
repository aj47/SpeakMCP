import { configStore } from "./config"
import {
  MCPTool,
  MCPToolCall,
  LLMToolCallResponse,
  MCPToolResult,
} from "./mcp-service"
import { AgentProgressStep, AgentProgressUpdate, SessionProfileSnapshot, AgentMemory } from "../shared/types"
import { diagnosticsService } from "./diagnostics"

import { makeLLMCallWithFetch, makeTextCompletionWithFetch, verifyCompletionWithFetch, RetryProgressCallback, makeLLMCallWithStreaming, StreamingCallback } from "./llm-fetch"
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

const MARK_WORK_COMPLETE_TOOL = "speakmcp-settings:mark_work_complete"

/**
 * Clean error message by removing stack traces and noise
 */
function cleanErrorMessage(errorText: string): string {
  // Remove stack traces (lines starting with "at " after an error)
  const lines = errorText.split('\n')
  const cleanedLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    // Skip stack trace lines
    if (trimmed.startsWith('at ')) continue
    // Skip file path lines
    if (trimmed.match(/^\s*at\s+.*\.(js|ts|mjs):\d+/)) continue
    // Skip empty lines in stack traces
    if (cleanedLines.length > 0 && trimmed === '' && lines.indexOf(line) > 0) {
      const prevLine = lines[lines.indexOf(line) - 1]?.trim()
      if (prevLine?.startsWith('at ')) continue
    }
    cleanedLines.push(line)
  }

  let cleaned = cleanedLines.join('\n').trim()

  // Remove duplicate error class names (e.g., "CodeExecutionTimeoutError: Code execution timed out")
  cleaned = cleaned.replace(/(\w+Error):\s*\1:/g, '$1:')

  // Truncate if still too long
  if (cleaned.length > 500) {
    cleaned = cleaned.substring(0, 500) + '...'
  }

  return cleaned
}

/**
 * Analyze tool errors and categorize them
 */
function analyzeToolErrors(toolResults: MCPToolResult[]): {
  errorTypes: string[]
} {
  const errorTypes: string[] = []
  const errorMessages = toolResults
    .filter((r) => r.isError)
    .map((r) => r.content.map((c) => c.text).join(" ").toLowerCase())
    .join(" ")

  // Categorize error types
  if (errorMessages.includes("timeout")) {
    errorTypes.push("timeout")
  }
  if (errorMessages.includes("connection") || errorMessages.includes("network")) {
    errorTypes.push("connectivity")
  }
  if (errorMessages.includes("permission") || errorMessages.includes("access") || errorMessages.includes("denied")) {
    errorTypes.push("permissions")
  }
  if (errorMessages.includes("not found") || errorMessages.includes("does not exist") || errorMessages.includes("missing")) {
    errorTypes.push("not_found")
  }
  if (errorMessages.includes("invalid") || errorMessages.includes("expected")) {
    errorTypes.push("invalid_params")
  }

  return { errorTypes }
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
    undefined, // personaProperties - not used in non-agent mode
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
    // Strip any raw tool-marker tokens (e.g. <|tool_call_begin|>) that
    // makeLLMCallWithFetch preserves for the agent loop's recovery path.
    // This non-agent flow returns content directly to the renderer.
    if (result.content) {
      const stripped = result.content.replace(/<\|[^|]*\|>/g, "").trim()
      // Only update if stripping produced non-empty content; if the response
      // was marker-only, replace with empty string rather than falling back
      // to the raw marker text (which would leak special tokens to the renderer).
      result.content = stripped || ""
    }
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

  // Track step summaries for dual-model mode
  const stepSummaries: import("../shared/types").AgentStepSummary[] = []

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
	          if (memory) {
	            memoryService.saveMemory(memory).catch(err => {
	              if (isDebugLLM()) {
	                logLLM("[Dual-Model] Error auto-saving summary:", err)
	              }
	            })
	          }
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

  // Helper function to add a message to the in-memory conversation history ONLY (not persisted).
  // Use for internal prompt-engineering nudges that should never appear in saved transcripts.
  const addEphemeralMessage = (
    role: "user" | "assistant" | "tool",
    content: string,
    toolCalls?: MCPToolCall[],
    toolResults?: MCPToolResult[],
    timestamp?: number
  ) => {
    const message: typeof conversationHistory[0] = {
      role,
      content,
      toolCalls,
      toolResults,
      timestamp: timestamp || Date.now(),
    }

    conversationHistory.push(message)
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
  // Get skills instructions from profile snapshot (typically set by personas)
  const personaSkillsInstructions = effectiveProfileSnapshot?.skillsInstructions
  // Get persona properties from profile snapshot (dynamic key-value pairs)
  const personaProperties = effectiveProfileSnapshot?.personaProperties

  // Load enabled agent skills instructions for the current profile
  // Skills provide specialized instructions that improve AI performance on specific tasks
  // Use per-profile skills config if available, otherwise fall back to empty (no skills)
  const { skillsService } = await import("./skills-service")
  const enabledSkillIds = effectiveProfileSnapshot?.skillsConfig?.enabledSkillIds ?? []
  logLLM(`[processTranscriptWithAgentMode] Loading skills for session ${currentSessionId}. enabledSkillIds: [${enabledSkillIds.join(', ')}]`)
  const profileSkillsInstructions = skillsService.getEnabledSkillsInstructionsForProfile(enabledSkillIds)
  logLLM(`[processTranscriptWithAgentMode] Skills instructions loaded: ${profileSkillsInstructions ? `${profileSkillsInstructions.length} chars` : 'none'}`)

  // Combine persona-level and profile-level skills instructions
  const skillsInstructions = [personaSkillsInstructions, profileSkillsInstructions].filter(Boolean).join('\n\n') || undefined

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
    personaProperties, // dynamic persona properties
    relevantMemories, // memories from previous sessions
  )

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

  // Track empty response retries to prevent infinite loops
  let emptyResponseRetryCount = 0

  // Helper function to convert conversation history to the format expected by AgentProgressUpdate
  const formatConversationForProgress = (
    history: typeof conversationHistory,
  ) => {
    const isNudge = (content: string) =>
      content.includes("Please either take action using available tools") ||
      content.includes("You have relevant tools available for this request") ||
      content.includes("Your previous response was empty") ||
      content.includes("Verifier indicates the task is not complete") ||
      content.includes("Please respond with a valid JSON object") ||
      content.includes("Use available tools directly via native function-calling") ||
      content.includes("Provide a complete final answer") ||
      content.includes("Your last response was not a final deliverable") ||
      content.includes("Your last response was empty or non-deliverable") ||
      content.includes("Continue and finish remaining work") ||
      (content.includes("If all requested work is complete, call") &&
        content.includes(MARK_WORK_COMPLETE_TOOL))

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

  // Helper to detect "status update" responses that describe future work instead of delivering results
  const isProgressUpdateResponse = (content: string): boolean => {
    const trimmed = content.trim()
    if (!trimmed) return false

    // Structured responses are usually deliverables, not progress updates
    const lowerRaw = trimmed.toLowerCase()
    const hasStructuredDeliverable =
      /\n[-*]\s|\n\d+\.\s/.test(trimmed) ||
      /\bhere(?:'s| is)\b/.test(lowerRaw)
    if (hasStructuredDeliverable) {
      return false
    }

    const normalized = lowerRaw.replace(/\s+/g, " ")
    const wordCount = normalized.split(" ").filter(Boolean).length

    // Keep this detector focused on short "I'm about to do X" updates to reduce false positives
    if (wordCount > 40) {
      return false
    }

    return /(?:^|[.!?]\s+)(?:let me|i'?ll|i will|i'm going to|now i'?ll|next i'?ll|i need to|i still need to|i should)\b/.test(normalized)
  }

  const isDeliverableResponse = (content: string, minLength: number = 1): boolean => {
    const trimmed = content.trim()
    if (trimmed.length < minLength) return false
    if (isToolCallPlaceholder(trimmed)) return false
    if (isProgressUpdateResponse(trimmed)) return false
    return true
  }

  interface IncompleteTaskDetails {
    missingItems?: string[]
    reason?: string
  }

  const normalizeMissingItems = (items?: string[]): string[] =>
    Array.isArray(items)
      ? items
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter((item) => item.length > 0)
      : []

  const buildIncompleteTaskFallback = (
    _lastResponse: string,
    details?: IncompleteTaskDetails
  ): string => {
    const missingItems = normalizeMissingItems(details?.missingItems)
    const reason = typeof details?.reason === "string" ? details.reason.trim() : ""

    if (!reason && missingItems.length === 0) {
      return "I couldn't complete the request after multiple attempts. Please try again with a narrower scope or additional guidance."
    }

    const parts: string[] = ["I couldn't complete the request after multiple attempts."]

    if (reason) {
      parts.push(`Reason: ${reason}`)
    }

    if (missingItems.length > 0) {
      const shownItems = missingItems.slice(0, 3)
      const remainingCount = missingItems.length - shownItems.length
      const summary = shownItems.join("; ")
      parts.push(
        remainingCount > 0
          ? `Missing items: ${summary}; and ${remainingCount} more.`
          : `Missing items: ${summary}.`
      )
    }

    parts.push("Please try again with a narrower scope or additional guidance.")
    return parts.join(" ")
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
          // Tool results already contain tool name prefix (format: [toolName] content...)
          // Just pass through without adding generic "Tool execution results:" wrapper
          return { role: "user" as const, content: text }
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
      personaProperties, // dynamic persona properties
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

  // Build compact verification messages (schema-first verifier)
  const buildVerificationMessages = (finalAssistantText: string, currentVerificationFailCount: number = 0) => {
    const maxItems = Math.max(1, config.mcpVerifyContextMaxItems || 20)
    const recent = conversationHistory.slice(-maxItems)
    const messages: Array<{ role: "user" | "assistant" | "system"; content: string }> = []

    // Track the last assistant content added to avoid duplicates
    let lastAddedAssistantContent: string | null = null

    messages.push({
      role: "system",
      content:
        `You are a completion verifier. Determine if the user's original request has been FULLY DELIVERED to the user.

FIRST, CHECK THESE BLOCKERS (if ANY are true, mark INCOMPLETE):
- The agent stated intent to do more work (e.g., "Let me...", "I'll...", "Now I'll...", "I'm going to...")
- The agent's response is a status update rather than a deliverable (e.g., "I've extracted the data" without presenting results)
- The user asked for information/analysis that was NOT directly provided in the agent's response
- Tool results exist but the agent hasn't synthesized/presented them to the user
- The response is empty or just acknowledges the request

ONLY IF NO BLOCKERS, mark COMPLETE if:
1. The agent directly answered the user's question or fulfilled their request
2. The agent explained why the request is impossible and cannot proceed
3. The agent is asking for clarification needed to proceed
4. The agent explicitly confirmed completion ("Done", "Here's your summary", "Task complete")

IMPORTANT - Do NOT mark complete just because:
- Tools executed successfully (results must be PRESENTED to user)
- Data was gathered (it must be SUMMARIZED/DELIVERED)
- The agent made progress (the FINAL deliverable must exist)

Return ONLY JSON per schema.`,
    })
    messages.push({ role: "user", content: `Original request:\n${transcript}` })
    for (const entry of recent) {
      if (entry.role === "tool") {
        const text = (entry.content || "").trim()
        // Tool results already contain tool name prefix (format: [toolName] content...)
        // Pass through directly without adding redundant wrapper
        messages.push({ role: "user", content: text || "[No tool output]" })
      } else if (entry.role === "user") {
        // Skip empty user messages
        const text = (entry.content || "").trim()
        if (text) {
          messages.push({ role: "user", content: text })
        }
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
        if (entry.role === "assistant") {
          lastAddedAssistantContent = content
        }
      }
    }
    // Only add finalAssistantText if it's different from the last assistant message added
    if (finalAssistantText?.trim() && finalAssistantText.trim() !== lastAddedAssistantContent?.trim()) {
      messages.push({ role: "assistant", content: finalAssistantText })
    }

    // Build the JSON request with optional verification attempt note (combined into single message)
    let jsonRequestContent = "Return a JSON object with fields: isComplete (boolean), confidence (0..1), missingItems (string[]), reason (string). No extra commentary."
    if (currentVerificationFailCount > 0) {
      jsonRequestContent += `\n\nNote: This is verification attempt #${currentVerificationFailCount + 1}. If the task appears reasonably complete, please mark as complete to avoid infinite loops.`
    }
    messages.push({ role: "user", content: jsonRequestContent })

    return messages
  }

  // Verification failure limit - after this many failed completion checks, end as incomplete
  const VERIFICATION_FAIL_LIMIT = 5

  // Empty response retry limit - after this many retries, break to prevent infinite loops
  const MAX_EMPTY_RESPONSE_RETRIES = 3

  /**
   * Result of running verification and handling the outcome
   */
  interface VerificationHandlerResult {
    /** Whether the loop should continue (verification failed and we should retry) */
    shouldContinue: boolean
    /** Whether verification passed. false can mean either CONTINUE (shouldContinue=true) or FORCE_INCOMPLETE (forcedByLimit=true); callers must check forcedByLimit to distinguish a real incomplete from a retry. */
    isComplete: boolean
    /** Updated verification failure count */
    newFailCount: number
    /** Whether to skip post-verify summary (reserved for caller policy) */
    skipPostVerifySummary: boolean
    /** Whether completion was forced due verification limit */
    forcedByLimit: boolean
    /** Optional details about missing deliverables when forced incomplete */
    incompleteDetails?: IncompleteTaskDetails
  }

  /**
   * Centralized verification state machine.
   *
   * States:
   * - COMPLETE: verifier confirms completion
   * - CONTINUE: verifier rejects completion and provides nudge
   * - FORCE_INCOMPLETE: fail budget exhausted; caller should finalize with fallback
   */
  async function runVerificationAndHandleResult(
    finalContent: string,
    verifyStep: AgentProgressStep,
    currentFailCount: number,
    options: {
      /** Whether to add tool usage nudge after 2 failures */
      nudgeForToolUsage?: boolean
      /** Index where the current user prompt was added (for scoping tool result checks) */
      currentPromptIndex?: number
    } = {}
  ): Promise<VerificationHandlerResult> {
    const {
      nudgeForToolUsage = false,
      currentPromptIndex: promptIndex,
    } = options

    const retries = Math.max(0, config.mcpVerifyRetryCount ?? 1)
    const skipPostVerifySummary = false

    const maybeNudgeToolUsage = (newFailCount: number) => {
      if (!nudgeForToolUsage || newFailCount < 2) return

      // Scope to current turn if promptIndex is provided, otherwise check entire conversation.
      // When promptIndex is provided, only check the slice for that turn (not the session-wide flag)
      // to avoid suppressing nudges for later turns that haven't used tools yet.
      const hasToolResultsSoFar = promptIndex !== undefined
        ? conversationHistory.slice(promptIndex + 1).some((e) => e.role === "tool")
        : toolsExecutedInSession || conversationHistory.some((e) => e.role === "tool")

      if (!hasToolResultsSoFar) {
        conversationHistory.push({
          role: "user",
          content: "Use available tools directly via native function-calling. Do not respond with intent-only updates.",
          timestamp: Date.now(),
        })
      }
    }

    // Gate 1: response must be a deliverable, not a status update or placeholder.
    if (!isDeliverableResponse(finalContent)) {
      const newFailCount = currentFailCount + 1
      if (newFailCount >= VERIFICATION_FAIL_LIMIT) {
        verifyStep.status = "error"
        verifyStep.description = "Verification budget exhausted - ending as incomplete"
        return {
          shouldContinue: false,
          isComplete: false,
          newFailCount,
          skipPostVerifySummary: true,
          forcedByLimit: true,
          incompleteDetails: {
            reason: "No final deliverable was produced.",
          },
        }
      }

      verifyStep.status = "error"
      verifyStep.description = "Response is not a final deliverable"
      const preview = finalContent.trim()
      const clipped = preview.length > 180 ? `${preview.substring(0, 177)}...` : preview
      conversationHistory.push({
        role: "user",
        content: clipped
          ? `Your last response was not a final deliverable: "${clipped}". Provide final results or clearly state what's blocked.`
          : "Your last response was empty or non-deliverable. Provide final results or clearly state what's blocked.",
        timestamp: Date.now(),
      })
      maybeNudgeToolUsage(newFailCount)
      return {
        shouldContinue: true,
        isComplete: false,
        newFailCount,
        skipPostVerifySummary,
        forcedByLimit: false,
      }
    }

    // Gate 2: run verifier with bounded retries.
    let verification: any = null
    let verified = false
    for (let i = 0; i <= retries; i++) {
      verification = await verifyCompletionWithFetch(
        buildVerificationMessages(finalContent, currentFailCount),
        config.mcpToolsProviderId,
        currentSessionId,
      )
      if (verification?.isComplete === true) {
        verified = true
        break
      }
    }

    if (verified) {
      verifyStep.status = "completed"
      verifyStep.description = "Verification passed"
      return {
        shouldContinue: false,
        isComplete: true,
        newFailCount: 0,
        skipPostVerifySummary,
        forcedByLimit: false,
      }
    }

    // Gate 3: verification failed; either continue with nudge or force incomplete.
    const newFailCount = currentFailCount + 1
    const missingItems = normalizeMissingItems(verification?.missingItems)
    const verificationReason =
      typeof verification?.reason === "string" && verification.reason.trim().length > 0
        ? verification.reason.trim()
        : ""

    if (newFailCount >= VERIFICATION_FAIL_LIMIT) {
      verifyStep.status = "error"
      verifyStep.description = "Verification budget exhausted - ending as incomplete"
      return {
        shouldContinue: false,
        isComplete: false,
        newFailCount,
        skipPostVerifySummary: true,
        forcedByLimit: true,
        incompleteDetails: {
          reason: verificationReason || "Completion criteria were not met before verification retry limit.",
          missingItems,
        },
      }
    }

    verifyStep.status = "error"
    verifyStep.description = "Verification failed - continue iteration"
    const missing = missingItems
      .map((s: string) => `- ${s}`)
      .join("\n")
    const reason = verificationReason
      ? `Reason: ${verificationReason}`
      : "Reason: Completion criteria not met."
    const userNudge = `${reason}\n${missing ? `Missing items:\n${missing}` : ""}\nContinue and finish remaining work.`
    conversationHistory.push({ role: "user", content: userNudge, timestamp: Date.now() })
    maybeNudgeToolUsage(newFailCount)

    return {
      shouldContinue: true,
      isComplete: false,
      newFailCount,
      skipPostVerifySummary,
      forcedByLimit: false,
    }
  }

  // Emit initial progress
  emit({
    currentIteration: 0,
    maxIterations,
    steps: progressSteps.slice(-3), // Show max 3 steps
    isComplete: false,
    conversationHistory: formatConversationForProgress(conversationHistory),
  })

  let noOpCount = 0 // Track iterations without meaningful progress
  let totalNudgeCount = 0 // Track total nudges to prevent infinite nudge loops
  const MAX_NUDGES = 3 // Max nudges before forcing an incomplete fallback
  let completionSignalHintCount = 0 // Avoid repeatedly injecting explicit-completion hints
  const MAX_COMPLETION_SIGNAL_HINTS = 2
  let verificationFailCount = 0 // Count consecutive verification failures to avoid loops
  const toolFailureCount = new Map<string, number>() // Track failures per tool name
  const MAX_TOOL_FAILURES = 3 // Max times a tool can fail before being excluded

  while (iteration < maxIterations) {
    iteration++
    currentIterationRef = iteration // Update ref for retry progress callback

    // Filter out tools that have failed too many times - compute at start of iteration
    // so the same filtered list is used consistently throughout (LLM call + heuristics)
    const activeTools = uniqueAvailableTools.filter(tool => {
      const failures = toolFailureCount.get(tool.name) || 0
      return failures < MAX_TOOL_FAILURES
    })

    // Log when tools have been excluded
    const excludedToolCount = uniqueAvailableTools.length - activeTools.length
    if (excludedToolCount > 0 && iteration === 1) {
      // Only log on first iteration after exclusion to avoid spam
      logLLM(`ℹ️ ${excludedToolCount} tool(s) excluded due to repeated failures`)
    }

    // Rebuild system prompt if tools were excluded to keep LLM's view of tools in sync
    // This ensures the system prompt lists only the tools that are actually available
    let currentSystemPrompt = systemPrompt
    if (excludedToolCount > 0) {
      currentSystemPrompt = constructSystemPrompt(
        activeTools,
        agentModeGuidelines,
        true,
        undefined, // relevantTools removed - let LLM decide tool relevance
        customSystemPrompt, // custom base system prompt from profile snapshot or global config
        skillsInstructions, // agent skills instructions
      )
      logLLM(`[processTranscriptWithAgentMode] Rebuilt system prompt with ${activeTools.length} active tools (excluded ${excludedToolCount})`)
    }

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

    // Build messages for LLM call
    const messages = [
      { role: "system", content: currentSystemPrompt },
      ...conversationHistory
        .map((entry) => {
          if (entry.role === "tool") {
            const text = (entry.content || "").trim()
            if (!text) return null
            // Tool results already contain tool name prefix (format: [toolName] content...)
            // Pass through directly without adding redundant wrapper
            return {
              role: "user" as const,
              content: text,
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
    // All active tools are sent to the LLM - progressive disclosure tools
    // (list_server_tools, get_tool_schema) allow the LLM to discover tools dynamically
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
        emptyResponseRetryCount++
        if (emptyResponseRetryCount >= MAX_EMPTY_RESPONSE_RETRIES) {
          logLLM(`❌ Empty response retry limit exceeded (${MAX_EMPTY_RESPONSE_RETRIES} retries)`)
          diagnosticsService.logError("llm", "Empty response retry limit exceeded", {
            iteration,
            retryCount: emptyResponseRetryCount,
            limit: MAX_EMPTY_RESPONSE_RETRIES
          })
          thinkingStep.status = "error"
          thinkingStep.description = "Empty response limit exceeded"
          const emptyResponseFinalContent = "I encountered repeated empty responses and couldn't complete the task. Please try again."
          conversationHistory.push({ role: "assistant", content: emptyResponseFinalContent, timestamp: Date.now() })
          emit({
            currentIteration: iteration,
            maxIterations,
            steps: progressSteps.slice(-3),
            isComplete: true,
            finalContent: emptyResponseFinalContent,
            conversationHistory: formatConversationForProgress(conversationHistory),
          })
          break
        }
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

    // Validate response is not null/empty.
    // A response is valid if it has either:
    // 1. Non-empty content, OR
    // 2. Valid toolCalls (tool-only responses can have empty content).
    const hasValidContent = llmResponse?.content && llmResponse.content.trim().length > 0
    const hasValidToolCalls = llmResponse?.toolCalls && Array.isArray(llmResponse.toolCalls) && llmResponse.toolCalls.length > 0

    if (!llmResponse || (!hasValidContent && !hasValidToolCalls)) {
      emptyResponseRetryCount++
      logLLM(`❌ LLM null/empty response on iteration ${iteration} (retry ${emptyResponseRetryCount}/${MAX_EMPTY_RESPONSE_RETRIES})`)
      logLLM("Response details:", {
        hasResponse: !!llmResponse,
        responseType: typeof llmResponse,
        responseKeys: llmResponse ? Object.keys(llmResponse) : [],
        content: llmResponse?.content,
        contentType: typeof llmResponse?.content,
        hasToolCalls: !!llmResponse?.toolCalls,
        toolCallsCount: llmResponse?.toolCalls?.length || 0,
        fullResponse: JSON.stringify(llmResponse, null, 2)
      })
      diagnosticsService.logError("llm", "Null/empty LLM response in agent mode", {
        iteration,
        response: llmResponse,
        message: "LLM response has neither content nor toolCalls",
        retryCount: emptyResponseRetryCount,
        limit: MAX_EMPTY_RESPONSE_RETRIES
      })
      if (emptyResponseRetryCount >= MAX_EMPTY_RESPONSE_RETRIES) {
        logLLM(`❌ Empty response retry limit exceeded (${MAX_EMPTY_RESPONSE_RETRIES} retries)`)
        thinkingStep.status = "error"
        thinkingStep.description = "Empty response limit exceeded"
        const emptyResponseFinalContent = "I encountered repeated empty responses and couldn't complete the task. Please try again."
        conversationHistory.push({ role: "assistant", content: emptyResponseFinalContent, timestamp: Date.now() })
        emit({
          currentIteration: iteration,
          maxIterations,
          steps: progressSteps.slice(-3),
          isComplete: true,
          finalContent: emptyResponseFinalContent,
          conversationHistory: formatConversationForProgress(conversationHistory),
        })
        break
      }
      thinkingStep.status = "error"
      thinkingStep.description = "Invalid response. Retrying..."
      emit({
        currentIteration: iteration,
        maxIterations,
        steps: progressSteps.slice(-3),
        isComplete: false,
        conversationHistory: formatConversationForProgress(conversationHistory),
      })
      // Check if recent messages contain truncated content that might be confusing
      const recentMessages = conversationHistory.slice(-3)
      const hasTruncatedContent = recentMessages.some(m =>
        m.content?.includes('[Truncated') ||
        m.content?.includes('[truncated]') ||
        m.content?.includes('(truncated')
      )
      const retryMessage = hasTruncatedContent
        ? "Previous request had empty response. The tool output was truncated which may have caused confusion. Please either: (1) try a different approach to get the data you need, (2) work with the partial data available, or (3) summarize your progress so far."
        : "Previous request had empty response. Please retry or summarize progress."
      addMessage("user", retryMessage)
      continue
    }

    // Reset empty response counter on successful response
    emptyResponseRetryCount = 0

    // Update thinking step with actual LLM content and mark as completed.
    // Strip any raw tool-marker tokens (e.g. <|tool_call_begin|>) so they
    // don't leak into the progress UI before the marker-recovery branch runs.
    const displayContent = (llmResponse.content || "").replace(/<\|[^|]*\|>/g, "").trim()
    thinkingStep.status = "completed"
    thinkingStep.llmContent = displayContent
    if (displayContent) {
      // Update title and description to be more meaningful
      thinkingStep.title = "Agent response"
      thinkingStep.description =
        displayContent.length > 100
          ? displayContent.substring(0, 100) + "..."
          : displayContent
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
    const completionToolCalled = toolCallsArray.some((toolCall) => toolCall.name === MARK_WORK_COMPLETE_TOOL)
    // Don't treat mark_work_complete as confirmed completion yet.
    // We defer completion until after tool execution confirms the whole batch succeeded.
    const hasToolCalls = toolCallsArray.length > 0

    // Handle no-op iterations (no tool calls).
    if (!hasToolCalls) {
      noOpCount++

      const hasToolsAvailable = activeTools.length > 0
      const hasCompletionSignalTool = activeTools.some(
        (tool) => tool.name === MARK_WORK_COMPLETE_TOOL,
      )
      const contentText = llmResponse.content || ""
      const trimmedContent = contentText.trim()
      const hasToolMarkers = /<\|tool_calls_section_begin\|>|<\|tool_call_begin\|>/i.test(contentText)

      if (hasToolMarkers) {
        const cleaned = contentText.replace(/<\|[^|]*\|>/g, "").trim()
        if (cleaned.length > 0) {
          addMessage("assistant", cleaned)
        }
        addMessage(
          "user",
          "Please use the native tool-calling interface to call the tools directly, rather than describing them in text.",
        )
        noOpCount = 0
        continue
      }

      // Scope tool evidence to this user prompt (current turn)
      const hasToolResultsInCurrentTurn =
        toolsExecutedInSession || conversationHistory.slice(currentPromptIndex + 1).some((e) => e.role === "tool")

      // For no-tool responses, require a bit more substance before treating as completion candidate.
      // Use a low threshold (2 chars) to avoid rejecting legitimate short answers like "Yes." or "42"
      // while still filtering truly empty/whitespace-only responses.
      const hasSubstantiveResponse = hasToolResultsInCurrentTurn
        ? isDeliverableResponse(contentText)
        : isDeliverableResponse(contentText, 2)

      // Unified completion candidate handling:
      // Any substantive response is either:
      // - accepted directly for no-tool/simple flows, or
      // - treated as in-progress status for tool-driven flows until explicit completion.
      if (hasSubstantiveResponse) {
        const canBypassVerification = !config.mcpVerifyCompletionEnabled || !hasToolsAvailable

        if (canBypassVerification) {
          finalContent = contentText
          addMessage("assistant", finalContent)
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

        if (hasCompletionSignalTool) {
          // Safety: also fall through when noOpCount exceeds the nudge threshold
          // (noOpCount >= 2), so we don't churn until maxIterations when the model
          // keeps returning substantive text but never calls mark_work_complete.
          const noOpThresholdReached = noOpCount >= 2
          if (completionSignalHintCount < MAX_COMPLETION_SIGNAL_HINTS && !noOpThresholdReached) {
            // In tool-driven tasks, substantive text without explicit completion is usually
            // a progress/status update. Keep iterating and reserve verifier calls for explicit
            // completion signals from mark_work_complete.
            if (trimmedContent.length > 0) {
              addMessage("assistant", contentText)
            }
            // Internal completion nudge: include in LLM context, but do NOT persist to disk.
            addEphemeralMessage(
              "user",
              `If all requested work is complete, call ${MARK_WORK_COMPLETE_TOOL} with a concise summary and then provide the final answer. Otherwise continue working and call more tools.`,
            )
            completionSignalHintCount++
            // Do NOT reset noOpCount here. Substantive text without tool calls or explicit
            // completion in a tool-driven task is still a no-op from a progress standpoint.
            // The single increment at the top of the !hasToolCalls block already counted
            // this iteration (there is no second increment), so the noOpThresholdReached
            // check above will trigger the fallthrough naturally.
            continue
          }

          // Hints exhausted (or noOpCount threshold reached) and model still hasn't
          // called mark_work_complete. Intentionally fall through to the verification/
          // fallback path below so we don't spin until maxIterations with no new
          // guidance. This is a safety valve — the fallback path will treat the
          // substantive text as a completion candidate and run verification, which
          // may either continue the loop or finalize.
        }

        // Fallback/verification path: reached when either (a) the completion signal
        // tool is unavailable for this session/profile, or (b) the tool is available
        // but all completion-signal hints have been exhausted without the model calling
        // mark_work_complete. In case (b) this acts as a safety valve so we don't spin
        // until maxIterations — we treat the substantive text as a completion candidate
        // and run verification, which may either continue the loop or finalize.
        finalContent = contentText
        const noToolsCalledYet = !conversationHistory.some((e) => e.role === "tool")
        let skipPostVerifySummary =
          (config.mcpFinalSummaryEnabled === false) ||
          (noToolsCalledYet && isDeliverableResponse(finalContent))
        let completionForcedByVerificationLimit = false
        let completionForcedIncompleteDetails: IncompleteTaskDetails | undefined

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

          const result = await runVerificationAndHandleResult(
            finalContent,
            verifyStep,
            verificationFailCount,
            {
              nudgeForToolUsage: true,
              currentPromptIndex,
            },
          )
          verificationFailCount = result.newFailCount
          completionForcedByVerificationLimit = result.forcedByLimit
          completionForcedIncompleteDetails = result.incompleteDetails
          if (result.skipPostVerifySummary) {
            skipPostVerifySummary = true
          }

          if (result.shouldContinue) {
            if (finalContent.trim().length > 0) {
              addMessage("assistant", finalContent)
            }
            noOpCount = 0
            continue
          }
        }

        if (!skipPostVerifySummary && !completionForcedByVerificationLimit) {
          try {
            const result = await generatePostVerifySummary(finalContent, false, activeTools)
            finalContent = result.content
            if (finalContent.trim().length > 0) {
              addMessage("assistant", finalContent)
            }
          } catch (e) {
            if (finalContent.trim().length > 0) {
              addMessage("assistant", finalContent)
            }
          }
        } else if (!completionForcedByVerificationLimit) {
          if (finalContent.trim().length > 0) {
            addMessage("assistant", finalContent)
          }
        }

        if (completionForcedByVerificationLimit) {
          finalContent = buildIncompleteTaskFallback(finalContent, completionForcedIncompleteDetails)
          addMessage("assistant", finalContent)
        }

        const completionStep = createProgressStep(
          "completion",
          completionForcedByVerificationLimit ? "Task incomplete" : "Task completed",
          completionForcedByVerificationLimit
            ? "Verification did not confirm completion before retry limit"
            : "Successfully completed the requested task",
          completionForcedByVerificationLimit ? "error" : "completed",
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
              true,
            )

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

      // Nudge path for non-deliverable/no-progress responses.
      if (config.mcpVerifyCompletionEnabled && (noOpCount >= 2 || (hasToolsAvailable && noOpCount >= 1))) {
        if (totalNudgeCount >= MAX_NUDGES) {
          finalContent = buildIncompleteTaskFallback(contentText)
          addMessage("assistant", finalContent)
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

        if (trimmedContent.length > 0 && !isToolCallPlaceholder(contentText)) {
          addMessage("assistant", contentText)
        }

        const nudgeMessage = hasToolsAvailable
          ? "Use available tools directly via native function-calling, or provide a complete final answer."
          : "Provide a complete final answer."
        addMessage("user", nudgeMessage)

        noOpCount = 0
        totalNudgeCount++
        continue
      }

      // With verification disabled and no substantive completion candidate, exit as incomplete.
      if (!config.mcpVerifyCompletionEnabled) {
        finalContent = buildIncompleteTaskFallback(contentText)
        addMessage("assistant", finalContent)
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
    } else {
      // Reset no-op counter when tools are called
      noOpCount = 0
      // Reset nudge count when tools are actually being used - this allows
      // nudging to work per "stuck segment" rather than globally across the run.
      // If the agent gets stuck again later, it should have a fresh nudge budget.
      totalNudgeCount = 0
      completionSignalHintCount = 0
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

      // Format tool results with tool name prefix for better context preservation
      // Format: [toolName] content... or [toolName] ERROR: content...
      const toolResultsText = resultsWithPlaceholders
        .map((result, i) => {
          const toolName = toolCallsArray[i]?.name || 'unknown'
          const content = result.content.map((c) => c.text).join("\n")
          const prefix = result.isError ? `[${toolName}] ERROR: ` : `[${toolName}] `
          return `${prefix}${content}`
        })
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

    // Deferred completion signal: only treat mark_work_complete as a completion signal
    // after all tools in the batch have executed successfully. If any tool (including
    // mark_work_complete itself) returned an error, keep iterating so the agent can recover.
    const completionSignalConfirmed = completionToolCalled && allToolsSuccessful

    if (hasErrors) {
      // Enhanced error analysis and recovery suggestions
      const errorAnalysis = analyzeToolErrors(toolResults)

      // Track per-tool failures
      for (let i = 0; i < toolResults.length; i++) {
        const result = toolResults[i]
        if (result.isError) {
          // Get the tool name from toolCallsArray by index
          const toolName = toolCallsArray[i]?.name || "unknown"
          const currentCount = toolFailureCount.get(toolName) || 0
          toolFailureCount.set(toolName, currentCount + 1)

          if (currentCount + 1 >= MAX_TOOL_FAILURES) {
            logLLM(`⚠️ Tool "${toolName}" has failed ${MAX_TOOL_FAILURES} times - will be excluded`)
          }
        }
      }

      // Check for unrecoverable errors that should trigger early completion
      const hasUnrecoverableError = errorAnalysis.errorTypes?.some(
        type => type === "permissions" || type === "authentication"
      )
      if (hasUnrecoverableError) {
        // Build list of tools that failed with unrecoverable errors in THIS batch only
        // (not all historical failures from toolFailureCount, which could mislead the model)
        const currentUnrecoverableTools: string[] = []
        for (let i = 0; i < toolResults.length; i++) {
          const result = toolResults[i]
          if (result.isError) {
            const errorText = result.content.map((c) => c.text).join(" ").toLowerCase()
            if (errorText.includes("permission") || errorText.includes("access") ||
                errorText.includes("denied") || errorText.includes("authentication") ||
                errorText.includes("unauthorized") || errorText.includes("forbidden")) {
              const toolName = toolCallsArray[i]?.name || "unknown"
              currentUnrecoverableTools.push(toolName)
            }
          }
        }

        if (currentUnrecoverableTools.length > 0) {
          const failedToolNames = currentUnrecoverableTools.join(", ")
          logLLM(`⚠️ Unrecoverable errors detected for tools: ${failedToolNames}`)
          // Add note to conversation so LLM knows to wrap up
          conversationHistory.push({
            role: "user",
            content: `Note: Some tools (${failedToolNames}) have unrecoverable errors (permissions/authentication). Please complete what you can or explain what cannot be done.`,
            timestamp: Date.now()
          })
        }
      }

      // Add clean error summary to conversation history for LLM context
      const errorSummary = failedTools
        .map((toolName, idx) => {
          const failedResult = toolResults.filter((r) => r.isError)[idx]
          const rawError = failedResult?.content.map((c) => c.text).join(" ") || "Unknown error"
          const cleanedError = cleanErrorMessage(rawError)
          const failureCount = toolFailureCount.get(toolName) || 1
          return `TOOL FAILED: ${toolName} (attempt ${failureCount}/${MAX_TOOL_FAILURES})\nError: ${cleanedError}`
        })
        .join("\n\n")

      conversationHistory.push({
        role: "tool",
        content: errorSummary,
        timestamp: Date.now(),
      })
    }

    // Check if agent indicated completion after executing tools.
    if (completionSignalConfirmed) {
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
          personaProperties, // dynamic persona properties
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


	      // Optional verification before completing after tools
	      // Track if we should skip post-verify summary (when agent is repeating itself or disabled)
	      let skipPostVerifySummary2 = config.mcpFinalSummaryEnabled === false
	      let completionForcedByVerificationLimit2 = false
	      let completionForcedIncompleteDetails2: IncompleteTaskDetails | undefined

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

	        const result = await runVerificationAndHandleResult(
	          finalContent,
	          verifyStep,
	          verificationFailCount
	        )
	        verificationFailCount = result.newFailCount
	        completionForcedByVerificationLimit2 = result.forcedByLimit
	        completionForcedIncompleteDetails2 = result.incompleteDetails
	        if (result.skipPostVerifySummary) {
	          skipPostVerifySummary2 = true
	        }

	        // Check if stop was requested during verification
	        if (agentSessionStateManager.shouldStopSession(currentSessionId)) {
	          logLLM(`Agent session ${currentSessionId} stopped during verification`)
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

	        if (result.shouldContinue) {
	          noOpCount = 0
	          continue
	        }
	      }

        // Post-verify: produce a concise final summary for the user
        // Skip when forced incomplete - the fallback message below will be the only assistant message
        if (!skipPostVerifySummary2 && !completionForcedByVerificationLimit2) {
          try {
            const result = await generatePostVerifySummary(finalContent, true, activeTools)
            if (result.stopped) {
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
              break
            }
            finalContent = result.content
            if (finalContent.trim().length > 0) {
              conversationHistory.push({ role: "assistant", content: finalContent, timestamp: Date.now() })
            }
          } catch (e) {
            // If summary generation fails, still add the existing finalContent to history
            // so the mobile client has the complete conversation
            if (finalContent.trim().length > 0) {
              conversationHistory.push({ role: "assistant", content: finalContent, timestamp: Date.now() })
            }
          }
	        } else if (!completionForcedByVerificationLimit2) {
	          // Even when skipping post-verify summary, ensure the final content is in history
	          // This prevents intermediate messages from disappearing on mobile
	          if (finalContent.trim().length > 0) {
	            conversationHistory.push({ role: "assistant", content: finalContent, timestamp: Date.now() })
	          }
	        }

	      if (completionForcedByVerificationLimit2) {
	        finalContent = buildIncompleteTaskFallback(finalContent, completionForcedIncompleteDetails2)
	        conversationHistory.push({ role: "assistant", content: finalContent, timestamp: Date.now() })
	      }


	      // Add completion step
	      const completionStep = createProgressStep(
	        "completion",
	        completionForcedByVerificationLimit2 ? "Task incomplete" : "Task completed",
	        completionForcedByVerificationLimit2
	          ? "Verification did not confirm completion before retry limit"
	          : "Successfully completed the requested task with summary",
	        completionForcedByVerificationLimit2 ? "error" : "completed",
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
        // Signal streaming to stop IMMEDIATELY
        streamingAborted = true
        streamingAbortController.abort()

        // Wait briefly for streaming to acknowledge the abort (prevents race)
        // This ensures streaming callbacks don't fire after we return
        await Promise.race([
          streamingPromise,
          new Promise(resolve => setTimeout(resolve, 100))  // 100ms max wait
        ]).catch(() => {}) // Ignore any errors

        // Unregister after streaming has stopped
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
