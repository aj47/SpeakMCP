/**
 * ACP Main Agent Handler
 *
 * Routes transcripts to an ACP agent instead of the LLM API when ACP mode is enabled.
 * This allows using agents like Claude Code as the "brain" for SpeakMCP.
 */

import { acpService, ACPContentBlock } from "./acp-service"
import {
  getSessionForConversation,
  setSessionForConversation,
  clearSessionForConversation,
  touchSession,
} from "./acp-session-state"
import { emitAgentProgress } from "./emit-agent-progress"
import { AgentProgressUpdate, AgentProgressStep } from "../shared/types"
import { logApp } from "./debug"
import { conversationService } from "./conversation-service"

export interface ACPMainAgentOptions {
  /** Name of the ACP agent to use */
  agentName: string
  /** SpeakMCP conversation ID */
  conversationId: string
  /** Force creating a new session even if one exists */
  forceNewSession?: boolean
  /** Session ID for progress tracking (from agentSessionTracker) */
  sessionId: string
  /** Callback for progress updates */
  onProgress?: (update: AgentProgressUpdate) => void
}

export interface ACPMainAgentResult {
  /** Whether the request succeeded */
  success: boolean
  /** The agent's response text */
  response?: string
  /** The ACP session ID (for future prompts) */
  acpSessionId?: string
  /** Why the agent stopped */
  stopReason?: string
  /** Error message if failed */
  error?: string
}

/**
 * Process a transcript using an ACP agent as the main agent.
 * This bypasses the normal LLM API call and routes directly to the ACP agent.
 */
export async function processTranscriptWithACPAgent(
  transcript: string,
  options: ACPMainAgentOptions
): Promise<ACPMainAgentResult> {
  const { agentName, conversationId, forceNewSession, sessionId, onProgress } = options

  logApp(`[ACP Main] Processing transcript with agent ${agentName} for conversation ${conversationId}`)

  // Track accumulated text across all session updates for streaming display
  let accumulatedText = ""

  // Load existing conversation history for UI display
  type ConversationHistoryMessage = {
    role: "user" | "assistant" | "tool"
    content: string
    timestamp?: number
  }
  let conversationHistory: ConversationHistoryMessage[] = []

  try {
    const conversation = await conversationService.loadConversation(conversationId)
    if (conversation) {
      conversationHistory = conversation.messages.map(m => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
      }))
    }
  } catch (err) {
    logApp(`[ACP Main] Failed to load conversation history: ${err}`)
  }

  // Emit progress with optional streaming content and conversation history
  const emitProgress = async (
    steps: AgentProgressStep[],
    isComplete: boolean,
    finalContent?: string,
    streamingContent?: { text: string; isStreaming: boolean }
  ) => {
    const update: AgentProgressUpdate = {
      sessionId,
      conversationId,
      currentIteration: 1,
      maxIterations: 1,
      steps,
      isComplete,
      finalContent,
      streamingContent,
      conversationHistory,
    }
    await emitAgentProgress(update)
    onProgress?.(update)
  }

  // Note: User message is already added to conversation by createMcpTextInput or processQueuedMessages
  // So we don't add it here - it's already in the loaded conversationHistory

  // Show thinking step
  await emitProgress([
    {
      id: `acp-thinking-${Date.now()}`,
      type: "thinking",
      title: `Sending to ${agentName}...`,
      status: "in_progress",
      timestamp: Date.now(),
    },
  ], false)

  try {
    // Get or create ACP session
    const existingSession = forceNewSession ? undefined : getSessionForConversation(conversationId)
    let acpSessionId: string | undefined

    if (existingSession && existingSession.agentName === agentName) {
      // Reuse existing session
      acpSessionId = existingSession.sessionId
      touchSession(conversationId)
      logApp(`[ACP Main] Reusing existing session ${acpSessionId}`)
    } else {
      // Create new session
      acpSessionId = await acpService.getOrCreateSession(agentName, true)
      if (!acpSessionId) {
        throw new Error(`Failed to create session with agent ${agentName}`)
      }
      setSessionForConversation(conversationId, acpSessionId, agentName)
      logApp(`[ACP Main] Created new session ${acpSessionId}`)
    }

    // Set up progress listener for session updates
    const progressHandler = (event: {
      agentName: string
      sessionId: string
      content?: ACPContentBlock[]
      isComplete?: boolean
    }) => {
      if (event.sessionId !== acpSessionId) return

      // Map content blocks to progress steps and accumulate text
      const steps: AgentProgressStep[] = []
      if (event.content) {
        for (const block of event.content) {
          if (block.type === "text" && block.text) {
            // Accumulate text for streaming display
            accumulatedText += block.text
            steps.push({
              id: `acp-text-${Date.now()}`,
              type: "thinking",
              title: "Agent response",
              description: block.text.substring(0, 200) + (block.text.length > 200 ? "..." : ""),
              status: event.isComplete ? "completed" : "in_progress",
              timestamp: Date.now(),
              llmContent: accumulatedText, // Use accumulated text, not just this block
            })
          } else if (block.type === "tool_use" && block.name) {
            steps.push({
              id: `acp-tool-${Date.now()}`,
              type: "tool_call",
              title: `Tool: ${block.name}`,
              status: "in_progress",
              timestamp: Date.now(),
            })
          }
        }
      }

      // Always emit with streaming content to show accumulated text
      emitProgress(
        steps.length > 0 ? steps : [{
          id: `acp-streaming-${Date.now()}`,
          type: "thinking",
          title: "Agent response",
          status: "in_progress",
          timestamp: Date.now(),
          llmContent: accumulatedText,
        }],
        event.isComplete ?? false,
        undefined,
        {
          text: accumulatedText,
          isStreaming: !event.isComplete,
        }
      )
    }

    acpService.on("sessionUpdate", progressHandler)

    try {
      // Send the prompt
      const result = await acpService.sendPrompt(agentName, acpSessionId, transcript)

      // Use accumulated text if result.response is empty but we received streaming content
      const finalResponse = result.response || accumulatedText || undefined

      // Add assistant response to conversation history for display
      if (finalResponse) {
        conversationHistory.push({
          role: "assistant",
          content: finalResponse,
          timestamp: Date.now(),
        })
      }

      // Emit completion with final accumulated text
      await emitProgress([
        {
          id: `acp-complete-${Date.now()}`,
          type: "completion",
          title: result.success ? "Response complete" : "Request failed",
          description: result.error,
          status: result.success ? "completed" : "error",
          timestamp: Date.now(),
          llmContent: finalResponse,
        },
      ], true, finalResponse, {
        text: finalResponse || "",
        isStreaming: false,
      })

      logApp(`[ACP Main] Completed - success: ${result.success}, response length: ${finalResponse?.length || 0}`)

      return {
        success: result.success,
        response: finalResponse,
        acpSessionId,
        stopReason: result.stopReason,
        error: result.error,
      }
    } finally {
      acpService.off("sessionUpdate", progressHandler)
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logApp(`[ACP Main] Error: ${errorMessage}`)

    await emitProgress([
      {
        id: `acp-error-${Date.now()}`,
        type: "completion",
        title: "Error",
        description: errorMessage,
        status: "error",
        timestamp: Date.now(),
      },
    ], true, undefined, {
      text: accumulatedText,
      isStreaming: false,
    })

    return {
      success: false,
      error: errorMessage,
    }
  }
}

/**
 * Start a new session for a conversation, discarding previous context.
 */
export function startNewACPSession(conversationId: string): void {
  clearSessionForConversation(conversationId)
  logApp(`[ACP Main] Cleared session for conversation ${conversationId}`)
}

