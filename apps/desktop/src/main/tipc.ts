import fs from "fs"
import { logApp, logLLM, getDebugFlags } from "./debug"
import { getRendererHandlers, tipc } from "@egoist/tipc/main"
import {
  showPanelWindow,
  showMainWindow,
  WINDOWS,
  resizePanelForAgentMode,
  resizePanelToNormal,
  closeAgentModeAndHidePanelWindow,
  getWindowRendererHandlers,
  setPanelMode,
  getCurrentPanelMode,
  markManualResize,
  setPanelFocusable,
  emergencyStopAgentMode,
  showPanelWindowAndShowTextInput,
  showPanelWindowAndStartMcpRecording,
} from "./window"
import {
  app,
  clipboard,
  Menu,
  shell,
  systemPreferences,
  dialog,
} from "electron"
import path from "path"
import { configStore, recordingsFolder, conversationsFolder } from "./config"
import {
  Config,
  RecordingHistoryItem,
  MCPConfig,
  MCPServerConfig,
  Conversation,
  ConversationHistoryItem,
  AgentProgressUpdate,
  SessionProfileSnapshot,
} from "../shared/types"
import { inferTransportType, normalizeMcpConfig } from "../shared/mcp-utils"
import { conversationService } from "./conversation-service"
import { RendererHandlers } from "./renderer-handlers"
import {
  postProcessTranscript,
  processTranscriptWithTools,
  processTranscriptWithAgentMode,
} from "./llm"
import { mcpService, MCPToolResult } from "./mcp-service"
import {
  saveCustomPosition,
  updatePanelPosition,
  constrainPositionToScreen,
  PanelPosition,
} from "./panel-position"
import { state, agentProcessManager, suppressPanelAutoShow, isPanelAutoShowSuppressed, toolApprovalManager, agentSessionStateManager } from "./state"


import { startRemoteServer, stopRemoteServer, restartRemoteServer } from "./remote-server"
import { emitAgentProgress } from "./emit-agent-progress"
import { agentSessionTracker } from "./agent-session-tracker"
import { messageQueueService } from "./message-queue-service"
import { profileService } from "./profile-service"
import { handlers } from "./tipc-handlers"

async function initializeMcpWithProgress(config: Config, sessionId: string): Promise<void> {
  const shouldStop = () => agentSessionStateManager.shouldStopSession(sessionId)

  if (shouldStop()) {
    return
  }

  const initStatus = mcpService.getInitializationStatus()

  await emitAgentProgress({
    sessionId,
    currentIteration: 0,
    maxIterations: config.mcpMaxIterations ?? 10,
    steps: [
      {
        id: `mcp_init_${Date.now()}`,
        type: "thinking",
        title: "Initializing MCP tools",
        description: initStatus.progress.currentServer
          ? `Initializing ${initStatus.progress.currentServer} (${initStatus.progress.current}/${initStatus.progress.total})`
          : `Initializing MCP servers (${initStatus.progress.current}/${initStatus.progress.total})`,
        status: "in_progress",
        timestamp: Date.now(),
      },
    ],
    isComplete: false,
  })

  const progressInterval = setInterval(async () => {
    if (shouldStop()) {
      clearInterval(progressInterval)
      return
    }

    const currentStatus = mcpService.getInitializationStatus()
    if (currentStatus.isInitializing) {
      await emitAgentProgress({
        sessionId,
        currentIteration: 0,
        maxIterations: config.mcpMaxIterations ?? 10,
        steps: [
          {
            id: `mcp_init_${Date.now()}`,
            type: "thinking",
            title: "Initializing MCP tools",
            description: currentStatus.progress.currentServer
              ? `Initializing ${currentStatus.progress.currentServer} (${currentStatus.progress.current}/${currentStatus.progress.total})`
              : `Initializing MCP servers (${currentStatus.progress.current}/${currentStatus.progress.total})`,
            status: "in_progress",
            timestamp: Date.now(),
          },
        ],
        isComplete: false,
      })
    } else {
      clearInterval(progressInterval)
    }
  }, 500)

  try {
    await mcpService.initialize()
  } finally {
    clearInterval(progressInterval)
  }

  if (shouldStop()) {
    return
  }

  await emitAgentProgress({
    sessionId,
    currentIteration: 0,
    maxIterations: config.mcpMaxIterations ?? 10,
    steps: [
      {
        id: `mcp_init_complete_${Date.now()}`,
        type: "thinking",
        title: "MCP tools initialized",
        description: `Successfully initialized ${mcpService.getAvailableTools().length} tools`,
        status: "completed",
        timestamp: Date.now(),
      },
    ],
    isComplete: false,
  })
}

// Unified agent mode processing function
async function processWithAgentMode(
  text: string,
  conversationId?: string,
  existingSessionId?: string, // Optional: reuse existing session instead of creating new one
  startSnoozed: boolean = false, // Whether to start session snoozed (default: false to show panel)
): Promise<string> {
  const config = configStore.get()

  // NOTE: Don't clear all agent progress here - we support multiple concurrent sessions
  // Each session manages its own progress lifecycle independently

  // Agent mode state is managed per-session via agentSessionStateManager

  // Determine profile snapshot for session isolation
  // If reusing an existing session, use its stored snapshot to maintain isolation
  // Only capture a new snapshot from the current global profile when creating a new session
  let profileSnapshot: SessionProfileSnapshot | undefined

  if (existingSessionId) {
    // Try to get the stored profile snapshot from the existing session
    profileSnapshot = agentSessionStateManager.getSessionProfileSnapshot(existingSessionId)
      ?? agentSessionTracker.getSessionProfileSnapshot(existingSessionId)
  }

  // Only capture a new snapshot if we don't have one from an existing session
  if (!profileSnapshot) {
    const currentProfile = profileService.getCurrentProfile()
    if (currentProfile) {
      profileSnapshot = {
        profileId: currentProfile.id,
        profileName: currentProfile.name,
        guidelines: currentProfile.guidelines,
        systemPrompt: currentProfile.systemPrompt,
        mcpServerConfig: currentProfile.mcpServerConfig,
        modelConfig: currentProfile.modelConfig,
      }
    }
  }

  // Start tracking this agent session (or reuse existing one)
  let conversationTitle = text.length > 50 ? text.substring(0, 50) + "..." : text
  // When creating a new session from keybind/UI, start unsnoozed so panel shows immediately
  const sessionId = existingSessionId || agentSessionTracker.startSession(conversationId, conversationTitle, startSnoozed, profileSnapshot)

  try {
    // Initialize MCP with progress feedback
    await initializeMcpWithProgress(config, sessionId)

    // Register any existing MCP server processes with the agent process manager
    // This handles the case where servers were already initialized before agent mode was activated
    mcpService.registerExistingProcessesWithAgentManager()

    // Get available tools filtered by profile snapshot if available (for session isolation)
    // This ensures revived sessions use the same tool list they started with
    const availableTools = profileSnapshot?.mcpServerConfig
      ? mcpService.getAvailableToolsForProfile(profileSnapshot.mcpServerConfig)
      : mcpService.getAvailableTools()

    // Use agent mode for iterative tool calling
    const executeToolCall = async (toolCall: any, onProgress?: (message: string) => void): Promise<MCPToolResult> => {
      // Handle inline tool approval if enabled in config
      if (config.mcpRequireApprovalBeforeToolCall) {
        // Request approval and wait for user response via the UI
        const { approvalId, promise: approvalPromise } = toolApprovalManager.requestApproval(
          sessionId,
          toolCall.name,
          toolCall.arguments
        )

        // Emit progress update with pending approval to show approve/deny buttons
        await emitAgentProgress({
          sessionId,
          currentIteration: 0, // Will be updated by the agent loop
          maxIterations: config.mcpMaxIterations ?? 10,
          steps: [],
          isComplete: false,
          pendingToolApproval: {
            approvalId,
            toolName: toolCall.name,
            arguments: toolCall.arguments,
          },
        })

        // Wait for user response
        const approved = await approvalPromise

        // Clear the pending approval from the UI by emitting without pendingToolApproval
        await emitAgentProgress({
          sessionId,
          currentIteration: 0,
          maxIterations: config.mcpMaxIterations ?? 10,
          steps: [],
          isComplete: false,
          // No pendingToolApproval - clears it
        })

        if (!approved) {
          return {
            content: [
              {
                type: "text",
                text: `Tool call denied by user: ${toolCall.name}`,
              },
            ],
            isError: true,
          }
        }
      }

      // Execute the tool call (approval either not required or was granted)
      // Pass profileSnapshot.mcpServerConfig for session-aware server availability checks
      return await mcpService.executeToolCall(toolCall, onProgress, true, profileSnapshot?.mcpServerConfig)
    }

    // Load previous conversation history if continuing a conversation
    // IMPORTANT: Load this BEFORE emitting initial progress to ensure consistency
    let previousConversationHistory:
      | Array<{
          role: "user" | "assistant" | "tool"
          content: string
          toolCalls?: any[]
          toolResults?: any[]
          timestamp?: number
        }>
      | undefined

    if (conversationId) {
      logLLM(`[tipc.ts processWithAgentMode] Loading conversation history for conversationId: ${conversationId}`)
      const conversation =
        await conversationService.loadConversation(conversationId)

      if (conversation && conversation.messages.length > 0) {
        logLLM(`[tipc.ts processWithAgentMode] Loaded conversation with ${conversation.messages.length} messages`)
        // Convert conversation messages to the format expected by agent mode
        // Exclude the last message since it's the current user input that will be added
        const messagesToConvert = conversation.messages.slice(0, -1)
        logLLM(`[tipc.ts processWithAgentMode] Converting ${messagesToConvert.length} messages (excluding last message)`)
        previousConversationHistory = messagesToConvert.map((msg) => ({
          role: msg.role,
          content: msg.content,
          toolCalls: msg.toolCalls,
          timestamp: msg.timestamp,
          // Convert toolResults from stored format (content as string) to MCPToolResult format (content as array)
          toolResults: msg.toolResults?.map((tr) => ({
            content: [
              {
                type: "text" as const,
                // Use content for successful results, error message for failures
                text: tr.success ? tr.content : (tr.error || tr.content),
              },
            ],
            isError: !tr.success,
          })),
        }))

        logLLM(`[tipc.ts processWithAgentMode] previousConversationHistory roles: [${previousConversationHistory.map(m => m.role).join(', ')}]`)
      } else {
        logLLM(`[tipc.ts processWithAgentMode] No conversation found or conversation is empty`)
      }
    } else {
      logLLM(`[tipc.ts processWithAgentMode] No conversationId provided, starting fresh conversation`)
    }

    // Focus this session in the panel window so it's immediately visible
    // Note: Initial progress will be emitted by processTranscriptWithAgentMode
    // to avoid duplicate user messages in the conversation history
    try {
      getWindowRendererHandlers("panel")?.focusAgentSession.send(sessionId)
    } catch (e) {
      logApp("[tipc] Failed to focus new agent session:", e)
    }

    const agentResult = await processTranscriptWithAgentMode(
      text,
      availableTools,
      executeToolCall,
      config.mcpMaxIterations ?? 10, // Use configured max iterations or default to 10
      previousConversationHistory,
      conversationId, // Pass conversation ID for linking to conversation history
      sessionId, // Pass session ID for progress routing and isolation
      undefined, // onProgress callback (not used here, progress is emitted via emitAgentProgress)
      profileSnapshot, // Pass profile snapshot for session isolation
    )

    // Mark session as completed
    agentSessionTracker.completeSession(sessionId, "Agent completed successfully")

    return agentResult.content
  } catch (error) {
    // Mark session as errored
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    agentSessionTracker.errorSession(sessionId, errorMessage)

    // Emit error progress update to the UI so users see the error message
    await emitAgentProgress({
      sessionId,
      conversationId: conversationId || "",
      conversationTitle: conversationTitle,
      currentIteration: 1,
      maxIterations: config.mcpMaxIterations ?? 10,
      steps: [{
        id: `error_${Date.now()}`,
        type: "thinking",
        title: "Error",
        description: errorMessage,
        status: "error",
        timestamp: Date.now(),
      }],
      isComplete: true,
      finalContent: `Error: ${errorMessage}`,
      conversationHistory: [
        { role: "user", content: text, timestamp: Date.now() },
        { role: "assistant", content: `Error: ${errorMessage}`, timestamp: Date.now() }
      ],
    })

    throw error
  } finally {

  }
}
import { diagnosticsService } from "./diagnostics"
import { updateTrayIcon } from "./tray"
import { isAccessibilityGranted } from "./utils"
import { writeText, writeTextWithFocusRestore } from "./keyboard"
import { preprocessTextForTTS, validateTTSText } from "@speakmcp/shared"
import { preprocessTextForTTSWithLLM } from "./tts-llm-preprocessing"


const t = tipc.create()

const getRecordingHistory = () => {
  try {
    const history = JSON.parse(
      fs.readFileSync(path.join(recordingsFolder, "history.json"), "utf8"),
    ) as RecordingHistoryItem[]

    // sort desc by createdAt
    return history.sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
}

const saveRecordingsHitory = (history: RecordingHistoryItem[]) => {
  fs.writeFileSync(
    path.join(recordingsFolder, "history.json"),
    JSON.stringify(history),
  )
}

/**
 * Process queued messages for a conversation after the current session completes.
 * This function peeks at messages and only removes them after successful processing.
 * Uses a per-conversation lock to prevent concurrent processing of the same queue.
 */
export async function processQueuedMessages(conversationId: string): Promise<void> {

  // Try to acquire processing lock - if another processor is already running, skip
  if (!messageQueueService.tryAcquireProcessingLock(conversationId)) {
    return
  }

  try {
    while (true) {
      // Check if queue is paused (e.g., by kill switch) before processing next message
      if (messageQueueService.isQueuePaused(conversationId)) {
        logLLM(`[processQueuedMessages] Queue is paused for ${conversationId}, stopping processing`)
        return
      }

      // Peek at the next message without removing it
      const queuedMessage = messageQueueService.peek(conversationId)
      if (!queuedMessage) {
        return // No more messages in queue
      }

      logLLM(`[processQueuedMessages] Processing queued message ${queuedMessage.id} for ${conversationId}`)

      // Mark as processing - if this fails, the message was removed/modified between peek and now
      const markingSucceeded = messageQueueService.markProcessing(conversationId, queuedMessage.id)
      if (!markingSucceeded) {
        logLLM(`[processQueuedMessages] Message ${queuedMessage.id} was removed/modified before processing, re-checking queue`)
        continue
      }

      try {
        // Only add to conversation history if not already added (prevents duplicates on retry)
        if (!queuedMessage.addedToHistory) {
          // Add the queued message to the conversation
          const addResult = await conversationService.addMessageToConversation(
            conversationId,
            queuedMessage.text,
            "user",
          )
          // If adding to history failed (conversation not found/IO error), treat as failure
          // Don't continue processing since the message wasn't recorded
          if (!addResult) {
            throw new Error("Failed to add message to conversation history")
          }
          // Mark as added to history so retries don't duplicate
          messageQueueService.markAddedToHistory(conversationId, queuedMessage.id)
        }

        // Determine if we should start snoozed based on panel visibility
        // If the panel is currently visible, the user is actively watching - don't snooze
        // If the panel is hidden, process in background to avoid unwanted pop-ups
        const panelWindow = WINDOWS.get("panel")
        const isPanelVisible = panelWindow?.isVisible() ?? false
        const shouldStartSnoozed = !isPanelVisible
        logLLM(`[processQueuedMessages] Panel visible: ${isPanelVisible}, startSnoozed: ${shouldStartSnoozed}`)

        // Find and revive the existing session for this conversation to maintain session continuity
        // This ensures queued messages execute in the same session context as the original conversation
        let existingSessionId: string | undefined
        const foundSessionId = agentSessionTracker.findSessionByConversationId(conversationId)
        if (foundSessionId) {
          // Only start snoozed if panel is not visible
          const revived = agentSessionTracker.reviveSession(foundSessionId, shouldStartSnoozed)
          if (revived) {
            existingSessionId = foundSessionId
            logLLM(`[processQueuedMessages] Revived session ${existingSessionId} for conversation ${conversationId}, snoozed: ${shouldStartSnoozed}`)
          }
        }

        // Process with agent mode
        // If panel is visible, user is watching - show the execution
        // If panel is hidden, run in background without pop-ups
        await processWithAgentMode(queuedMessage.text, conversationId, existingSessionId, shouldStartSnoozed)

        // Only remove the message after successful processing
        messageQueueService.markProcessed(conversationId, queuedMessage.id)

        // Continue to check for more queued messages
      } catch (error) {
        logLLM(`[processQueuedMessages] Error processing queued message ${queuedMessage.id}:`, error)
        // Mark the message as failed so users can see it in the UI
        const errorMessage = error instanceof Error ? error.message : "Unknown error"
        messageQueueService.markFailed(conversationId, queuedMessage.id, errorMessage)
        // Stop processing - user needs to handle the failed message
        break
      }
    }
  } finally {
    // Always release the lock when done
    messageQueueService.releaseProcessingLock(conversationId)
  }
}

export const router = {
  // Import all modular handlers
  ...handlers,

  // Keep complex MCP handlers that depend on local helper functions in this file
  // These handlers use processWithAgentMode, initializeMcpWithProgress, processQueuedMessages,
  // and other complex helper functions that are tightly coupled to the agent mode implementation

  createMcpTextInput: t.procedure
    .input<{
      text: string
      conversationId?: string
      fromTile?: boolean // When true, session runs in background (snoozed) - panel won't show
    }>()
    .action(async ({ input }) => {
      const config = configStore.get()

      // Create or get conversation ID
      let conversationId = input.conversationId
      if (!conversationId) {
        const conversation = await conversationService.createConversation(
          input.text,
          "user",
        )
        conversationId = conversation.id
      } else {
        // Check if message queuing is enabled and there's an active session
        if (config.mcpMessageQueueEnabled !== false) {
          const activeSessionId = agentSessionTracker.findSessionByConversationId(conversationId)
          if (activeSessionId) {
            const session = agentSessionTracker.getSession(activeSessionId)
            if (session && session.status === "active") {
              // Queue the message instead of starting a new session
              const queuedMessage = messageQueueService.enqueue(conversationId, input.text)
              logApp(`[createMcpTextInput] Queued message ${queuedMessage.id} for active session ${activeSessionId}`)
              return { conversationId, queued: true, queuedMessageId: queuedMessage.id }
            }
          }
        }

        // Add user message to existing conversation
        await conversationService.addMessageToConversation(
          conversationId,
          input.text,
          "user",
        )
      }

      // Try to find and revive an existing session for this conversation
      // This handles the case where user continues from history
      let existingSessionId: string | undefined
      if (input.conversationId) {
        const foundSessionId = agentSessionTracker.findSessionByConversationId(input.conversationId)
        if (foundSessionId) {
          // Pass fromTile to reviveSession so it stays snoozed when continuing from a tile
          const revived = agentSessionTracker.reviveSession(foundSessionId, input.fromTile ?? false)
          if (revived) {
            existingSessionId = foundSessionId
          }
        }
      }

      // Fire-and-forget: Start agent processing without blocking
      // This allows multiple sessions to run concurrently
      // Pass existingSessionId to reuse the session if found
      // When fromTile=true, start snoozed so the floating panel doesn't appear
      processWithAgentMode(input.text, conversationId, existingSessionId, input.fromTile ?? false)
        .then((finalResponse) => {
          // Save to history after completion
          const history = getRecordingHistory()
          const item: RecordingHistoryItem = {
            id: Date.now().toString(),
            createdAt: Date.now(),
            duration: 0, // Text input has no duration
            transcript: finalResponse,
          }
          history.push(item)
          saveRecordingsHitory(history)

          const main = WINDOWS.get("main")
          if (main) {
            getRendererHandlers<RendererHandlers>(
              main.webContents,
            ).refreshRecordingHistory.send()
          }

          // Auto-paste if enabled
          const pasteConfig = configStore.get()
          if (pasteConfig.mcpAutoPasteEnabled && state.focusedAppBeforeRecording) {
            setTimeout(async () => {
              try {
                await writeText(finalResponse)
              } catch (error) {
                // Ignore paste errors
              }
            }, pasteConfig.mcpAutoPasteDelay || 1000)
          }
        })
        .catch((error) => {
          logLLM("[createMcpTextInput] Agent processing error:", error)
        })
        .finally(() => {
          // Process queued messages after this session completes (success or error)
          processQueuedMessages(conversationId!).catch((err) => {
            logLLM("[createMcpTextInput] Error processing queued messages:", err)
          })
        })

      // Return immediately with conversation ID
      // Progress updates will be sent via emitAgentProgress
      return { conversationId }
    }),

  createMcpRecording: t.procedure
    .input<{
      recording: ArrayBuffer
      duration: number
      conversationId?: string
      sessionId?: string
      fromTile?: boolean // When true, session runs in background (snoozed) - panel won't show
    }>()
    .action(async ({ input }) => {
      fs.mkdirSync(recordingsFolder, { recursive: true })

      const config = configStore.get()
      let transcript: string

      // Check if message queuing is enabled and there's an active session for this conversation
      // If so, we'll transcribe the audio and queue the transcript instead of processing immediately
      if (input.conversationId && config.mcpMessageQueueEnabled !== false) {
        const activeSessionId = agentSessionTracker.findSessionByConversationId(input.conversationId)
        if (activeSessionId) {
          const session = agentSessionTracker.getSession(activeSessionId)
          if (session && session.status === "active") {
            // Active session exists - transcribe audio and queue the result
            logApp(`[createMcpRecording] Active session ${activeSessionId} found for conversation ${input.conversationId}, will queue transcript`)

            // Transcribe the audio first
            const form = new FormData()
            form.append(
              "file",
              new File([input.recording], "recording.webm", { type: "audio/webm" }),
            )
            form.append(
              "model",
              config.sttProviderId === "groq" ? "whisper-large-v3" : "whisper-1",
            )
            form.append("response_format", "json")

            if (config.sttProviderId === "groq" && config.groqSttPrompt?.trim()) {
              form.append("prompt", config.groqSttPrompt.trim())
            }

            const languageCode = config.sttProviderId === "groq"
              ? config.groqSttLanguage || config.sttLanguage
              : config.openaiSttLanguage || config.sttLanguage

            if (languageCode && languageCode !== "auto") {
              form.append("language", languageCode)
            }

            const groqBaseUrl = config.groqBaseUrl || "https://api.groq.com/openai/v1"
            const openaiBaseUrl = config.openaiBaseUrl || "https://api.openai.com/v1"

            const transcriptResponse = await fetch(
              config.sttProviderId === "groq"
                ? `${groqBaseUrl}/audio/transcriptions`
                : `${openaiBaseUrl}/audio/transcriptions`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${config.sttProviderId === "groq" ? config.groqApiKey : config.openaiApiKey}`,
                },
                body: form,
              },
            )

            if (!transcriptResponse.ok) {
              const message = `${transcriptResponse.statusText} ${(await transcriptResponse.text()).slice(0, 300)}`
              throw new Error(message)
            }

            const json: { text: string } = await transcriptResponse.json()
            transcript = json.text

            // Save the recording file
            const recordingId = Date.now().toString()
            fs.writeFileSync(
              path.join(recordingsFolder, `${recordingId}.webm`),
              Buffer.from(input.recording),
            )

            // Queue the transcript instead of processing immediately
            const queuedMessage = messageQueueService.enqueue(input.conversationId, transcript)
            logApp(`[createMcpRecording] Queued voice transcript ${queuedMessage.id} for active session ${activeSessionId}`)

            return { conversationId: input.conversationId, queued: true, queuedMessageId: queuedMessage.id }
          }
        }
      }

      // No active session or queuing disabled - proceed with normal processing
      // Emit initial loading progress immediately BEFORE transcription
      // This ensures users see feedback during the (potentially long) STT call
      const tempConversationId = input.conversationId || `temp_${Date.now()}`

      // Determine profile snapshot for session isolation
      // If reusing an existing session, use its stored snapshot to maintain isolation
      // Only capture a new snapshot from the current global profile when creating a new session
      let profileSnapshot: SessionProfileSnapshot | undefined

      if (input.sessionId) {
        // Try to get the stored profile snapshot from the existing session
        profileSnapshot = agentSessionStateManager.getSessionProfileSnapshot(input.sessionId)
          ?? agentSessionTracker.getSessionProfileSnapshot(input.sessionId)
      } else if (input.conversationId) {
        // Try to find existing session for this conversation and get its profile snapshot
        const existingSessionId = agentSessionTracker.findSessionByConversationId(input.conversationId)
        if (existingSessionId) {
          profileSnapshot = agentSessionStateManager.getSessionProfileSnapshot(existingSessionId)
            ?? agentSessionTracker.getSessionProfileSnapshot(existingSessionId)
        }
      }

      // Only capture a new snapshot if we don't have one from an existing session
      if (!profileSnapshot) {
        const currentProfile = profileService.getCurrentProfile()
        if (currentProfile) {
          profileSnapshot = {
            profileId: currentProfile.id,
            profileName: currentProfile.name,
            guidelines: currentProfile.guidelines,
            systemPrompt: currentProfile.systemPrompt,
            mcpServerConfig: currentProfile.mcpServerConfig,
            modelConfig: currentProfile.modelConfig,
          }
        }
      }

      // If sessionId is provided, try to revive that session.
      // Otherwise, if conversationId is provided, try to find and revive a session for that conversation.
      // This handles the case where user continues from history (only conversationId is set).
      // When fromTile=true, sessions start snoozed so the floating panel doesn't appear.
      const startSnoozed = input.fromTile ?? false
      let sessionId: string
      if (input.sessionId) {
        // Try to revive the existing session by ID
        // Pass startSnoozed so session stays snoozed when continuing from a tile
        const revived = agentSessionTracker.reviveSession(input.sessionId, startSnoozed)
        if (revived) {
          sessionId = input.sessionId
          // Update the session title while transcribing
          agentSessionTracker.updateSession(sessionId, {
            conversationTitle: "Transcribing...",
            lastActivity: "Transcribing audio...",
          })
        } else {
          // Session not found, create a new one with profile snapshot
          sessionId = agentSessionTracker.startSession(tempConversationId, "Transcribing...", startSnoozed, profileSnapshot)
        }
      } else if (input.conversationId) {
        // No sessionId but have conversationId - try to find existing session for this conversation
        const existingSessionId = agentSessionTracker.findSessionByConversationId(input.conversationId)
        if (existingSessionId) {
          // Pass startSnoozed so session stays snoozed when continuing from a tile
          const revived = agentSessionTracker.reviveSession(existingSessionId, startSnoozed)
          if (revived) {
            sessionId = existingSessionId
            // Update the session title while transcribing
            agentSessionTracker.updateSession(sessionId, {
              conversationTitle: "Transcribing...",
              lastActivity: "Transcribing audio...",
            })
          } else {
            // Revive failed, create new session with profile snapshot
            sessionId = agentSessionTracker.startSession(tempConversationId, "Transcribing...", startSnoozed, profileSnapshot)
          }
        } else {
          // No existing session for this conversation, create new with profile snapshot
          sessionId = agentSessionTracker.startSession(tempConversationId, "Transcribing...", startSnoozed, profileSnapshot)
        }
      } else {
        // No sessionId or conversationId provided, create a new session with profile snapshot
        sessionId = agentSessionTracker.startSession(tempConversationId, "Transcribing...", startSnoozed, profileSnapshot)
      }

      try {
        // Emit initial "initializing" progress update
        await emitAgentProgress({
          sessionId,
          conversationId: tempConversationId,
          currentIteration: 0,
          maxIterations: 1,
          steps: [{
            id: `transcribe_${Date.now()}`,
            type: "thinking",
            title: "Transcribing audio",
            description: "Processing audio input...",
            status: "in_progress",
            timestamp: Date.now(),
          }],
          isComplete: false,
          isSnoozed: false,
          conversationTitle: "Transcribing...",
          conversationHistory: [],
        })

        // First, transcribe the audio using the same logic as regular recording
      // Use OpenAI or Groq for transcription
      const form = new FormData()
      form.append(
        "file",
        new File([input.recording], "recording.webm", { type: "audio/webm" }),
      )
      form.append(
        "model",
        config.sttProviderId === "groq" ? "whisper-large-v3" : "whisper-1",
      )
      form.append("response_format", "json")

      if (config.sttProviderId === "groq" && config.groqSttPrompt?.trim()) {
        form.append("prompt", config.groqSttPrompt.trim())
      }

      // Add language parameter if specified
      const languageCode = config.sttProviderId === "groq"
        ? config.groqSttLanguage || config.sttLanguage
        : config.openaiSttLanguage || config.sttLanguage;

      if (languageCode && languageCode !== "auto") {
        form.append("language", languageCode)
      }

      const groqBaseUrl = config.groqBaseUrl || "https://api.groq.com/openai/v1"
      const openaiBaseUrl = config.openaiBaseUrl || "https://api.openai.com/v1"

      const transcriptResponse = await fetch(
        config.sttProviderId === "groq"
          ? `${groqBaseUrl}/audio/transcriptions`
          : `${openaiBaseUrl}/audio/transcriptions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.sttProviderId === "groq" ? config.groqApiKey : config.openaiApiKey}`,
          },
          body: form,
        },
      )

      if (!transcriptResponse.ok) {
        const message = `${transcriptResponse.statusText} ${(await transcriptResponse.text()).slice(0, 300)}`
        throw new Error(message)
      }

      const json: { text: string } = await transcriptResponse.json()
      transcript = json.text

      // Create or continue conversation
      let conversationId = input.conversationId
      let conversation: Conversation | null = null

      if (!conversationId) {
        // Create new conversation with the transcript
        conversation = await conversationService.createConversation(
          transcript,
          "user",
        )
        conversationId = conversation.id
      } else {
        // Load existing conversation and add user message
        conversation =
          await conversationService.loadConversation(conversationId)
        if (conversation) {
          await conversationService.addMessageToConversation(
            conversationId,
            transcript,
            "user",
          )
        } else {
          conversation = await conversationService.createConversation(
            transcript,
            "user",
          )
          conversationId = conversation.id
        }
      }

      // Update session with actual conversation ID and title after transcription
      const conversationTitle = transcript.length > 50 ? transcript.substring(0, 50) + "..." : transcript
      agentSessionTracker.updateSession(sessionId, {
        conversationId,
        conversationTitle,
      })

      // Save the recording file immediately
      const recordingId = Date.now().toString()
      fs.writeFileSync(
        path.join(recordingsFolder, `${recordingId}.webm`),
        Buffer.from(input.recording),
      )

        // Fire-and-forget: Start agent processing without blocking
        // This allows multiple sessions to run concurrently
        // Pass the sessionId to avoid creating a duplicate session
        processWithAgentMode(transcript, conversationId, sessionId)
        .then((finalResponse) => {
          // Save to history after completion
          const history = getRecordingHistory()
          const item: RecordingHistoryItem = {
            id: recordingId,
            createdAt: Date.now(),
            duration: input.duration,
            transcript: finalResponse,
          }
          history.push(item)
          saveRecordingsHitory(history)

          const main = WINDOWS.get("main")
          if (main) {
            getRendererHandlers<RendererHandlers>(
              main.webContents,
            ).refreshRecordingHistory.send()
          }
        })
          .catch((error) => {
            logLLM("[createMcpRecording] Agent processing error:", error)
          })
          .finally(() => {
            // Process queued messages after this session completes (success or error)
            processQueuedMessages(conversationId!).catch((err) => {
              logLLM("[createMcpRecording] Error processing queued messages:", err)
            })
          })

        // Return immediately with conversation ID
        // Progress updates will be sent via emitAgentProgress
        return { conversationId }
      } catch (error) {
        // Handle transcription or conversation creation errors
        logLLM("[createMcpRecording] Transcription error:", error)

        // Clean up the session and emit error state
        await emitAgentProgress({
          sessionId,
          conversationId: tempConversationId,
          currentIteration: 1,
          maxIterations: 1,
          steps: [{
            id: `transcribe_error_${Date.now()}`,
            type: "completion",
            title: "Transcription failed",
            description: error instanceof Error ? error.message : "Unknown transcription error",
            status: "error",
            timestamp: Date.now(),
          }],
          isComplete: true,
          isSnoozed: false,
          conversationTitle: "Transcription Error",
          conversationHistory: [],
          finalContent: `Transcription failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        })

        // Mark the session as errored to clean up the UI
        agentSessionTracker.errorSession(sessionId, error instanceof Error ? error.message : "Transcription failed")

        // Re-throw the error so the caller knows transcription failed
        throw error
      }
    }),
}


export type Router = typeof router
