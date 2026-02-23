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
  WAVEFORM_MIN_HEIGHT,
  TEXT_INPUT_MIN_HEIGHT,
  PROGRESS_MIN_HEIGHT,
  MIN_WAVEFORM_WIDTH,
  clearPanelOpenedWithMain,
  resizePanelForWaveformPreview,
} from "./window"
import {
  app,
  clipboard,
  Menu,
  shell,
  systemPreferences,
  dialog,
  BrowserWindow,
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
  ACPAgentConfig,
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
import { mcpService, MCPToolResult, WHATSAPP_SERVER_NAME, getInternalWhatsAppServerPath } from "./mcp-service"
import {
  saveCustomPosition,
  updatePanelPosition,
  constrainPositionToScreen,
  PanelPosition,
} from "./panel-position"
import { state, agentProcessManager, suppressPanelAutoShow, isPanelAutoShowSuppressed, toolApprovalManager, agentSessionStateManager } from "./state"


import { startRemoteServer, stopRemoteServer, restartRemoteServer, printQRCodeToTerminal } from "./remote-server"
import { emitAgentProgress } from "./emit-agent-progress"
import { agentSessionTracker } from "./agent-session-tracker"
import { messageQueueService } from "./message-queue-service"
import { agentProfileService, createSessionSnapshotFromProfile, toolConfigToMcpServerConfig } from "./agent-profile-service"
import { acpService, ACPRunRequest } from "./acp-service"
import { processTranscriptWithACPAgent } from "./acp-main-agent"
import { fetchModelsDevData, getModelFromModelsDevByProviderId, findBestModelMatch, refreshModelsDevCache } from "./models-dev-service"
import * as parakeetStt from "./parakeet-stt"
import { loopService } from "./loop-service"

/**
 * Convert Float32Array audio samples to WAV format buffer
 */
function float32ToWav(samples: Float32Array, sampleRate: number): Buffer {
  const numChannels = 1
  const bitsPerSample = 16
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8)
  const blockAlign = numChannels * (bitsPerSample / 8)
  const dataSize = samples.length * (bitsPerSample / 8)
  const headerSize = 44
  const totalSize = headerSize + dataSize

  const buffer = Buffer.alloc(totalSize)
  let offset = 0

  // RIFF header
  buffer.write('RIFF', offset); offset += 4
  buffer.writeUInt32LE(totalSize - 8, offset); offset += 4
  buffer.write('WAVE', offset); offset += 4

  // fmt subchunk
  buffer.write('fmt ', offset); offset += 4
  buffer.writeUInt32LE(16, offset); offset += 4 // subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, offset); offset += 2  // audioFormat (1 = PCM)
  buffer.writeUInt16LE(numChannels, offset); offset += 2
  buffer.writeUInt32LE(sampleRate, offset); offset += 4
  buffer.writeUInt32LE(byteRate, offset); offset += 4
  buffer.writeUInt16LE(blockAlign, offset); offset += 2
  buffer.writeUInt16LE(bitsPerSample, offset); offset += 2

  // data subchunk
  buffer.write('data', offset); offset += 4
  buffer.writeUInt32LE(dataSize, offset); offset += 4

  // Convert Float32 samples to 16-bit PCM
  for (let i = 0; i < samples.length; i++) {
    // Clamp to [-1, 1] and scale to 16-bit signed integer range
    const sample = Math.max(-1, Math.min(1, samples[i]))
    const intSample = Math.round(sample * 32767)
    buffer.writeInt16LE(intSample, offset)
    offset += 2
  }

  return buffer
}

async function initializeMcpWithProgress(config: Config, sessionId: string): Promise<void> {
  const shouldStop = () => agentSessionStateManager.shouldStopSession(sessionId)
  const effectiveMaxIterations = config.mcpUnlimitedIterations ? Infinity : (config.mcpMaxIterations ?? 10)

  if (shouldStop()) {
    return
  }

  const initStatus = mcpService.getInitializationStatus()

  await emitAgentProgress({
    sessionId,
    currentIteration: 0,
    maxIterations: effectiveMaxIterations,
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
        maxIterations: effectiveMaxIterations,
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
    maxIterations: effectiveMaxIterations,
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
  const effectiveMaxIterations = config.mcpUnlimitedIterations ? Infinity : (config.mcpMaxIterations ?? 10)

  // Check if ACP main agent mode is enabled - route to ACP agent instead of LLM API
  if (config.mainAgentMode === "acp" && config.mainAgentName) {
    logLLM(`[processWithAgentMode] ACP mode enabled, routing to agent: ${config.mainAgentName}`)

    // Create conversation title for session tracking
    const conversationTitle = text.length > 50 ? text.substring(0, 50) + "..." : text

    // Start tracking this agent session (or reuse existing one)
    const sessionId = existingSessionId || agentSessionTracker.startSession(conversationId, conversationTitle, startSnoozed)

    // Process with ACP agent
    const result = await processTranscriptWithACPAgent(text, {
      agentName: config.mainAgentName,
      conversationId: conversationId || sessionId,
      sessionId,
    })

    // Save assistant response to conversation history if we have a conversation ID
    // Note: User message is already added by createMcpTextInput or processQueuedMessages
    if (conversationId && result.response) {
      await conversationService.addMessageToConversation(
        conversationId,
        result.response,
        "assistant"
      )
    }

    // Mark session as completed
    if (result.success) {
      logLLM(`[processWithAgentMode] ACP mode completed successfully for session ${sessionId}, conversation ${conversationId}`)
      agentSessionTracker.completeSession(sessionId, "ACP agent completed successfully")
    } else {
      logLLM(`[processWithAgentMode] ACP mode failed for session ${sessionId}: ${result.error}`)
      agentSessionTracker.errorSession(sessionId, result.error || "Unknown error")
    }

    logLLM(`[processWithAgentMode] ACP mode returning, queue processing should trigger in .finally()`)
    return result.response || result.error || "No response from agent"
  }

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
    const currentProfile = agentProfileService.getCurrentProfile()
    if (currentProfile) {
      profileSnapshot = createSessionSnapshotFromProfile(currentProfile)
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
          maxIterations: effectiveMaxIterations,
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

        // Clear the pending approval from the UI by explicitly setting pendingToolApproval to undefined
        await emitAgentProgress({
          sessionId,
          currentIteration: 0,
          maxIterations: effectiveMaxIterations,
          steps: [],
          isComplete: false,
          pendingToolApproval: undefined, // Explicitly clear to sync state across all windows
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
      // Pass sessionId for ACP router tools progress, and profileSnapshot.mcpServerConfig for session-aware server availability
      return await mcpService.executeToolCall(toolCall, onProgress, true, sessionId, profileSnapshot?.mcpServerConfig)
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
      // Use loadConversationWithCompaction to automatically compact old conversations on load
      // Pass sessionId so that compaction summarization can be cancelled by emergency stop
      const conversation =
        await conversationService.loadConversationWithCompaction(conversationId, sessionId)

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

    // Focus interactive sessions in the panel window.
    // Background/snoozed sessions (e.g. scheduled loops) should not steal focus.
    if (!startSnoozed) {
      try {
        getWindowRendererHandlers("panel")?.focusAgentSession.send(sessionId)
      } catch (e) {
        logApp("[tipc] Failed to focus new agent session:", e)
      }
    }

    const agentResult = await processTranscriptWithAgentMode(
      text,
      availableTools,
      executeToolCall,
      effectiveMaxIterations, // Use configured max iterations or Infinity if unlimited mode
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
      maxIterations: effectiveMaxIterations,
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

export async function runAgentLoopSession(
  text: string,
  conversationId: string,
  existingSessionId: string
): Promise<string> {
  return processWithAgentMode(text, conversationId, existingSessionId, true)
}
import { diagnosticsService } from "./diagnostics"
import { memoryService } from "./memory-service"
import { summarizationService } from "./summarization-service"
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
async function processQueuedMessages(conversationId: string): Promise<void> {
  logLLM(`[processQueuedMessages] Starting queue processing for ${conversationId}`)

  // Try to acquire processing lock - if another processor is already running, skip
  if (!messageQueueService.tryAcquireProcessingLock(conversationId)) {
    logLLM(`[processQueuedMessages] Failed to acquire lock for ${conversationId}`)
    return
  }
  logLLM(`[processQueuedMessages] Acquired lock for ${conversationId}`)

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
        logLLM(`[processQueuedMessages] No more pending messages in queue for ${conversationId}`)
        // Debug: log the actual queue state
        const allMessages = messageQueueService.getQueue(conversationId)
        if (allMessages.length > 0) {
          logLLM(`[processQueuedMessages] Queue has ${allMessages.length} messages but peek returned null. First message status: ${allMessages[0]?.status}`)
        }
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
  restartApp: t.procedure.action(async () => {
    app.relaunch()
    app.quit()
  }),

  getUpdateInfo: t.procedure.action(async () => {
    const { getUpdateInfo } = await import("./updater")
    return getUpdateInfo()
  }),

  quitAndInstall: t.procedure.action(async () => {
    const { quitAndInstall } = await import("./updater")

    quitAndInstall()
  }),

  checkForUpdatesAndDownload: t.procedure.action(async () => {
    const { checkForUpdatesAndDownload } = await import("./updater")

    return checkForUpdatesAndDownload()
  }),

  openMicrophoneInSystemPreferences: t.procedure.action(async () => {
    await shell.openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
    )
  }),

  hidePanelWindow: t.procedure.action(async () => {
    const panel = WINDOWS.get("panel")

    logApp(`[hidePanelWindow] Called. Panel exists: ${!!panel}, visible: ${panel?.isVisible()}`)

    if (panel) {
      suppressPanelAutoShow(1000)
      // Clear the "opened with main" flag since panel is being explicitly hidden
      clearPanelOpenedWithMain()
      panel.hide()
      logApp(`[hidePanelWindow] Panel hidden`)
    }
  }),

  resizePanelForAgentMode: t.procedure.action(async () => {
    resizePanelForAgentMode()
  }),

  resizePanelToNormal: t.procedure.action(async () => {
    resizePanelToNormal()
  }),

  resizePanelForWaveformPreview: t.procedure
    .input<{ showPreview: boolean }>()
    .action(async ({ input }) => {
      resizePanelForWaveformPreview(input.showPreview)
    }),

  setPanelMode: t.procedure
    .input<{ mode: "normal" | "agent" | "textInput" }>()
    .action(async ({ input }) => {
      setPanelMode(input.mode)
      return { success: true }
    }),

  /**
   * Set the focusability of the panel window.
   * Used to enable input interaction when agent has completed or when user wants to queue messages.
   * @param focusable - Whether the panel should be focusable
   * @param andFocus - If true and focusable is true, also focus the window (needed for macOS)
   */
  setPanelFocusable: t.procedure
    .input<{ focusable: boolean; andFocus?: boolean }>()
    .action(async ({ input }) => {
      setPanelFocusable(input.focusable, input.andFocus ?? false)
      return { success: true }
    }),

  debugPanelState: t.procedure.action(async () => {
    const panel = WINDOWS.get("panel")
    const state = {
      exists: !!panel,
      isVisible: panel?.isVisible() || false,
      isDestroyed: panel?.isDestroyed() || false,
      bounds: panel?.getBounds() || null,
      isAlwaysOnTop: panel?.isAlwaysOnTop() || false,
    }
    return state
  }),

  // Panel position management
  setPanelPosition: t.procedure
    .input<{ position: PanelPosition }>()
    .action(async ({ input }) => {
      updatePanelPosition(input.position)

      // Update the panel position if it's currently visible
      const panel = WINDOWS.get("panel")
      if (panel && panel.isVisible()) {
        showPanelWindow()
      }
    }),

  savePanelCustomPosition: t.procedure
    .input<{ x: number; y: number }>()
    .action(async ({ input }) => {
      // Get current panel size to constrain position
      const panel = WINDOWS.get("panel")
      if (panel) {
        const bounds = panel.getBounds()
        const constrainedPosition = constrainPositionToScreen(
          { x: input.x, y: input.y },
          { width: bounds.width, height: bounds.height },
        )

        saveCustomPosition(constrainedPosition)

        // Update the panel position immediately
        panel.setPosition(constrainedPosition.x, constrainedPosition.y)
      }
    }),

  updatePanelPosition: t.procedure
    .input<{ x: number; y: number }>()
    .action(async ({ input }) => {
      const panel = WINDOWS.get("panel")
      if (panel) {
        const bounds = panel.getBounds()
        const constrainedPosition = constrainPositionToScreen(
          { x: input.x, y: input.y },
          { width: bounds.width, height: bounds.height },
        )

        panel.setPosition(constrainedPosition.x, constrainedPosition.y)
      }
    }),

  getPanelPosition: t.procedure.action(async () => {
    const panel = WINDOWS.get("panel")
    if (panel) {
      const bounds = panel.getBounds()
      return { x: bounds.x, y: bounds.y }
    }
    return { x: 0, y: 0 }
  }),

  emergencyStopAgent: t.procedure.action(async () => {
    await emergencyStopAgentMode()

    return { success: true, message: "Agent mode emergency stopped" }
  }),

  clearAgentProgress: t.procedure.action(async () => {
    // Send to all windows so both main and panel can update their state
    for (const [id, win] of WINDOWS.entries()) {
      try {
        getRendererHandlers<RendererHandlers>(win.webContents).clearAgentProgress.send()
      } catch (e) {
        logApp(`[tipc] clearAgentProgress send to ${id} failed:`, e)
      }
    }

    return { success: true }
  }),


  clearAgentSessionProgress: t.procedure
    .input<{ sessionId: string }>()
    .action(async ({ input }) => {
      // Send to all windows (panel and main) so both can update their state
      for (const [id, win] of WINDOWS.entries()) {
        try {
          getRendererHandlers<RendererHandlers>(win.webContents).clearAgentSessionProgress?.send(input.sessionId)
        } catch (e) {
          logApp(`[tipc] clearAgentSessionProgress send to ${id} failed:`, e)
        }
      }
      return { success: true }
    }),

  clearInactiveSessions: t.procedure.action(async () => {
  
    // Clear completed sessions from the tracker
    agentSessionTracker.clearCompletedSessions()

    // Send to all windows so both main and panel can update their state
    for (const [id, win] of WINDOWS.entries()) {
      try {
        getRendererHandlers<RendererHandlers>(win.webContents).clearInactiveSessions?.send()
      } catch (e) {
        logApp(`[tipc] clearInactiveSessions send to ${id} failed:`, e)
      }
    }

    return { success: true }
  }),

  closeAgentModeAndHidePanelWindow: t.procedure.action(async () => {
    closeAgentModeAndHidePanelWindow()
    return { success: true }
  }),

  getAgentStatus: t.procedure.action(async () => {
    return {
      isAgentModeActive: state.isAgentModeActive,
      shouldStopAgent: state.shouldStopAgent,
      agentIterationCount: state.agentIterationCount,
      activeProcessCount: agentProcessManager.getActiveProcessCount(),
    }
  }),

  getAgentSessions: t.procedure.action(async () => {
      return {
      activeSessions: agentSessionTracker.getActiveSessions(),
      recentSessions: agentSessionTracker.getRecentSessions(4),
    }
  }),

  // Get the profile snapshot for a specific session
  // This allows the UI to display which profile a session is using
  getSessionProfileSnapshot: t.procedure
    .input<{ sessionId: string }>()
    .action(async ({ input }) => {
      return agentSessionStateManager.getSessionProfileSnapshot(input.sessionId)
        ?? agentSessionTracker.getSessionProfileSnapshot(input.sessionId)
    }),

  stopAgentSession: t.procedure
    .input<{ sessionId: string }>()
    .action(async ({ input }) => {
        
      // Stop the session in the state manager (aborts LLM requests, kills processes)
      agentSessionStateManager.stopSession(input.sessionId)

      // Cancel any pending tool approvals for this session so executeToolCall doesn't hang
      toolApprovalManager.cancelSessionApprovals(input.sessionId)

      // Pause the message queue for this conversation to prevent processing the next queued message
      // The user can resume the queue later if they want to continue
      const session = agentSessionTracker.getSession(input.sessionId)
      if (session?.conversationId) {
        messageQueueService.pauseQueue(session.conversationId)
        logLLM(`[stopAgentSession] Paused queue for conversation ${session.conversationId}`)
      }

      // Immediately emit a final progress update with isComplete: true
      // This ensures the UI updates immediately without waiting for the agent loop
      // to detect the stop signal and emit its own final update
      await emitAgentProgress({
        sessionId: input.sessionId,
        currentIteration: 0,
        maxIterations: 0,
        steps: [
          {
            id: `stop_${Date.now()}`,
            type: "completion",
            title: "Agent stopped",
            description: "Agent mode was stopped by emergency kill switch. Queue paused.",
            status: "error",
            timestamp: Date.now(),
          },
        ],
        isComplete: true,
        finalContent: "(Agent mode was stopped by emergency kill switch)",
        conversationHistory: [],
      })

      // Mark the session as stopped in the tracker (removes from active sessions UI)
      agentSessionTracker.stopSession(input.sessionId)

      return { success: true }
    }),

  snoozeAgentSession: t.procedure
    .input<{ sessionId: string }>()
    .action(async ({ input }) => {
    
      // Snooze the session (runs in background without stealing focus)
      agentSessionTracker.snoozeSession(input.sessionId)

      return { success: true }
    }),

  unsnoozeAgentSession: t.procedure
    .input<{ sessionId: string }>()
    .action(async ({ input }) => {
    
      // Unsnooze the session (allow it to show progress UI again)
      agentSessionTracker.unsnoozeSession(input.sessionId)

      return { success: true }
    }),

  // Respond to a tool approval request
  respondToToolApproval: t.procedure
    .input<{ approvalId: string; approved: boolean }>()
    .action(async ({ input }) => {
      logApp(`[Tool Approval] respondToToolApproval called: approvalId=${input.approvalId}, approved=${input.approved}`)
      const success = toolApprovalManager.respondToApproval(input.approvalId, input.approved)
      logApp(`[Tool Approval] respondToApproval result: success=${success}`)
      return { success }
    }),

  // Request the Panel window to focus a specific agent session
  focusAgentSession: t.procedure
    .input<{ sessionId: string }>()
    .action(async ({ input }) => {
      try {
        getWindowRendererHandlers("panel")?.focusAgentSession.send(input.sessionId)
      } catch (e) {
        logApp("[tipc] focusAgentSession send failed:", e)
      }
      return { success: true }
    }),

  showContextMenu: t.procedure
    .input<{
      x: number
      y: number
      selectedText?: string
      messageContext?: {
        content: string
        role: "user" | "assistant" | "tool"
        messageId: string
      }
    }>()
    .action(async ({ input, context }) => {
      const items: Electron.MenuItemConstructorOptions[] = []

      if (input.selectedText) {
        items.push({
          label: "Copy",
          click() {
            clipboard.writeText(input.selectedText || "")
          },
        })
      }

      // Add message-specific context menu items
      if (input.messageContext) {
        const { content, role } = input.messageContext

        // Add "Copy Message" option for all message types
        items.push({
          label: "Copy Message",
          click() {
            clipboard.writeText(content)
          },
        })

        // Add separator if we have other items
        if (items.length > 0) {
          items.push({ type: "separator" })
        }
      }

      if (import.meta.env.DEV) {
        items.push({
          label: "Inspect Element",
          click() {
            context.sender.inspectElement(input.x, input.y)
          },
        })
      }

      const panelWindow = WINDOWS.get("panel")
      const isPanelWindow = panelWindow?.webContents.id === context.sender.id

      if (isPanelWindow) {
        items.push({
          label: "Close",
          click() {
            // Clear the "opened with main" flag since panel is being hidden
            clearPanelOpenedWithMain()
            panelWindow?.hide()
          },
        })
      }

      const menu = Menu.buildFromTemplate(items)
      menu.popup({
        x: input.x,
        y: input.y,
      })
    }),

  getMicrophoneStatus: t.procedure.action(async () => {
    return systemPreferences.getMediaAccessStatus("microphone")
  }),

  isAccessibilityGranted: t.procedure.action(async () => {
    return isAccessibilityGranted()
  }),

  requestAccesssbilityAccess: t.procedure.action(async () => {
    if (process.platform === "win32") return true

    return systemPreferences.isTrustedAccessibilityClient(true)
  }),

  requestMicrophoneAccess: t.procedure.action(async () => {
    return systemPreferences.askForMediaAccess("microphone")
  }),

  showPanelWindow: t.procedure.action(async () => {
    showPanelWindow()
  }),

  showPanelWindowWithTextInput: t.procedure
    .input<{ initialText?: string }>()
    .action(async ({ input }) => {
      await showPanelWindowAndShowTextInput(input.initialText)
    }),

  triggerMcpRecording: t.procedure
    .input<{ conversationId?: string; sessionId?: string; fromTile?: boolean }>()
    .action(async ({ input }) => {
      // Always show the panel during recording for waveform feedback
      // The fromTile flag tells the panel to hide after recording ends
      // fromButtonClick=true indicates this was triggered via UI button (not keyboard shortcut)
      await showPanelWindowAndStartMcpRecording(input.conversationId, input.sessionId, input.fromTile, true)
    }),

  showMainWindow: t.procedure
    .input<{ url?: string }>()
    .action(async ({ input }) => {
      showMainWindow(input.url)
    }),

  displayError: t.procedure
    .input<{ title?: string; message: string }>()
    .action(async ({ input }) => {
      dialog.showErrorBox(input.title || "Error", input.message)
    }),

  // OAuth methods
  initiateOAuthFlow: t.procedure
    .input<string>()
    .action(async ({ input: serverName }) => {
      return mcpService.initiateOAuthFlow(serverName)
    }),

  completeOAuthFlow: t.procedure
    .input<{ serverName: string; code: string; state: string }>()
    .action(async ({ input }) => {
      return mcpService.completeOAuthFlow(input.serverName, input.code, input.state)
    }),

  getOAuthStatus: t.procedure
    .input<string>()
    .action(async ({ input: serverName }) => {
      return mcpService.getOAuthStatus(serverName)
    }),

  revokeOAuthTokens: t.procedure
    .input<string>()
    .action(async ({ input: serverName }) => {
      return mcpService.revokeOAuthTokens(serverName)
    }),

  // Parakeet (local) STT model management
  getParakeetModelStatus: t.procedure.action(async () => {
    return parakeetStt.getModelStatus()
  }),

  downloadParakeetModel: t.procedure.action(async () => {
    await parakeetStt.downloadModel()
    return { success: true }
  }),

  initializeParakeetRecognizer: t.procedure
    .input<{ numThreads?: number }>()
    .action(async ({ input }) => {
      await parakeetStt.initializeRecognizer(input.numThreads)
      return { success: true }
    }),

  // Kitten (local) TTS model management
  getKittenModelStatus: t.procedure.action(async () => {
    const { getKittenModelStatus } = await import('./kitten-tts')
    return getKittenModelStatus()
  }),

  downloadKittenModel: t.procedure.action(async () => {
    const { downloadKittenModel } = await import('./kitten-tts')
    await downloadKittenModel((progress) => {
      // Send progress to renderer via webContents, guarding against destroyed windows
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send('kitten-model-download-progress', progress)
        }
      })
    })
    return { success: true }
  }),

  synthesizeWithKitten: t.procedure
    .input<{
      text: string
      voiceId?: number
      speed?: number
    }>()
    .action(async ({ input }) => {
      const { synthesize } = await import('./kitten-tts')
      const result = await synthesize(input.text, input.voiceId, input.speed)
      // Convert Float32Array samples to WAV format
      const wavBuffer = float32ToWav(result.samples, result.sampleRate)
      return {
        audio: wavBuffer.toString('base64'),
        sampleRate: result.sampleRate
      }
    }),

  // Supertonic (local) TTS model management
  getSupertonicModelStatus: t.procedure.action(async () => {
    const { getSupertonicModelStatus } = await import('./supertonic-tts')
    return getSupertonicModelStatus()
  }),

  downloadSupertonicModel: t.procedure.action(async () => {
    const { downloadSupertonicModel } = await import('./supertonic-tts')
    await downloadSupertonicModel((progress) => {
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send('supertonic-model-download-progress', progress)
        }
      })
    })
    return { success: true }
  }),

  synthesizeWithSupertonic: t.procedure
    .input<{
      text: string
      voice?: string
      lang?: string
      speed?: number
      steps?: number
    }>()
    .action(async ({ input }) => {
      const { synthesize } = await import('./supertonic-tts')
      const result = await synthesize(
        input.text,
        input.voice,
        input.lang,
        input.speed,
        input.steps,
      )
      const wavBuffer = float32ToWav(result.samples, result.sampleRate)
      return {
        audio: wavBuffer.toString('base64'),
        sampleRate: result.sampleRate
      }
    }),

  createRecording: t.procedure
    .input<{
      recording: ArrayBuffer
      pcmRecording?: ArrayBuffer
      duration: number
    }>()
    .action(async ({ input }) => {
      fs.mkdirSync(recordingsFolder, { recursive: true })

      const config = configStore.get()
      let transcript: string

      if (config.sttProviderId === "parakeet") {
        // Use Parakeet (local) STT
        if (!parakeetStt.isModelReady()) {
          throw new Error("Parakeet model not downloaded. Please download it in Settings.")
        }

        // Initialize recognizer if needed
        await parakeetStt.initializeRecognizer(config.parakeetNumThreads)

        if (!input.pcmRecording) {
          throw new Error("Parakeet STT requires pre-decoded float32 PCM audio. pcmRecording was not provided.")
        }
        transcript = await parakeetStt.transcribe(input.pcmRecording, 16000)
        transcript = await postProcessTranscript(transcript)
      } else {
        // Use OpenAI or Groq for transcription
        const form = new FormData()
        form.append(
          "file",
          new File([input.recording], "recording.webm", { type: "audio/webm" }),
        )
        form.append(
          "model",
          config.sttProviderId === "groq" ? "whisper-large-v3-turbo" : "whisper-1",
        )
        form.append("response_format", "json")

        // Add prompt parameter for Groq if provided
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
        transcript = await postProcessTranscript(json.text)
      }

      const history = getRecordingHistory()
      const item: RecordingHistoryItem = {
        id: Date.now().toString(),
        createdAt: Date.now(),
        duration: input.duration,
        transcript,
      }
      history.push(item)
      saveRecordingsHitory(history)

      fs.writeFileSync(
        path.join(recordingsFolder, `${item.id}.webm`),
        Buffer.from(input.recording),
      )

      const main = WINDOWS.get("main")
      if (main) {
        getRendererHandlers<RendererHandlers>(
          main.webContents,
        ).refreshRecordingHistory.send()
      }

      const panel = WINDOWS.get("panel")
      if (panel) {
        // Clear the "opened with main" flag since panel is being hidden
        clearPanelOpenedWithMain()
        panel.hide()
      }

      // paste
      clipboard.writeText(transcript)
      if (isAccessibilityGranted()) {
        // Add a small delay for regular transcripts too to be less disruptive
        const pasteDelay = 500 // 0.5 second delay for regular transcripts
        setTimeout(async () => {
          try {
            await writeTextWithFocusRestore(transcript)
          } catch (error) {
            // Don't throw here, just log the error so the recording still gets saved
          }
        }, pasteDelay)
      }
    }),

  transcribeChunk: t.procedure
    .input<{
      recording: ArrayBuffer
      pcmRecording?: ArrayBuffer
    }>()
    .action(async ({ input }) => {
      const config = configStore.get()
      let transcript: string

      if (config.sttProviderId === "parakeet") {
        if (!parakeetStt.isModelReady()) {
          return { text: "" }
        }
        await parakeetStt.initializeRecognizer(config.parakeetNumThreads)
        // Use pcmRecording if provided, otherwise skip preview for Parakeet
        // (WebM buffer would fail validation)
        if (!input.pcmRecording) {
          return { text: "" }
        }
        transcript = await parakeetStt.transcribe(input.pcmRecording, 16000)
      } else {
        const form = new FormData()
        form.append(
          "file",
          new File([input.recording], "recording.webm", { type: "audio/webm" }),
        )
        form.append(
          "model",
          config.sttProviderId === "groq" ? "whisper-large-v3-turbo" : "whisper-1",
        )
        form.append("response_format", "json")

        if (config.sttProviderId === "groq" && config.groqSttPrompt?.trim()) {
          form.append("prompt", config.groqSttPrompt.trim())
        }

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
          const errBody = await transcriptResponse.text().catch(() => "<unreadable>")
          console.error(
            `[transcribeChunk] API error ${transcriptResponse.status} ${transcriptResponse.statusText}: ${errBody}`,
          )
          return { text: "" }
        }

        const json: { text: string } = await transcriptResponse.json()
        transcript = json.text || ""
      }

      return { text: transcript }
    }),

  createTextInput: t.procedure
    .input<{
      text: string
    }>()
    .action(async ({ input }) => {
      const config = configStore.get()
      let processedText = input.text

      // Apply post-processing if enabled
      if (config.transcriptPostProcessingEnabled) {
        try {
          processedText = await postProcessTranscript(input.text)
        } catch (error) {
          // Continue with original text if post-processing fails
        }
      }

      // Save to history
      const history = getRecordingHistory()
      const item: RecordingHistoryItem = {
        id: Date.now().toString(),
        createdAt: Date.now(),
        duration: 0, // Text input has no duration
        transcript: processedText,
      }
      history.push(item)
      saveRecordingsHitory(history)

      const main = WINDOWS.get("main")
      if (main) {
        getRendererHandlers<RendererHandlers>(
          main.webContents,
        ).refreshRecordingHistory.send()
      }

      const panel = WINDOWS.get("panel")
      if (panel) {
        // Clear the "opened with main" flag since panel is being hidden
        clearPanelOpenedWithMain()
        panel.hide()
      }

      // Auto-paste if enabled
      if (config.mcpAutoPasteEnabled && state.focusedAppBeforeRecording) {
        setTimeout(async () => {
          try {
            await writeText(processedText)
          } catch (error) {
            // Ignore paste errors
          }
        }, config.mcpAutoPasteDelay || 1000)
      }
    }),

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
          logLLM(`[createMcpTextInput] .finally() triggered for conversation ${conversationId}, calling processQueuedMessages`)
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
      pcmRecording?: ArrayBuffer
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
            if (config.sttProviderId === "parakeet") {
              // Use Parakeet (local) STT
              if (!parakeetStt.isModelReady()) {
                throw new Error("Parakeet model not downloaded. Please download it in Settings.")
              }

              await parakeetStt.initializeRecognizer(config.parakeetNumThreads)

              if (!input.pcmRecording) {
                throw new Error("Parakeet STT requires pre-decoded float32 PCM audio. pcmRecording was not provided.")
              }
              transcript = await parakeetStt.transcribe(input.pcmRecording, 16000)
            } else {
              const form = new FormData()
              form.append(
                "file",
                new File([input.recording], "recording.webm", { type: "audio/webm" }),
              )
              form.append(
                "model",
                config.sttProviderId === "groq" ? "whisper-large-v3-turbo" : "whisper-1",
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
            }

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
        const currentProfile = agentProfileService.getCurrentProfile()
        if (currentProfile) {
          profileSnapshot = createSessionSnapshotFromProfile(currentProfile)
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
        if (config.sttProviderId === "parakeet") {
          // Use Parakeet (local) STT
          if (!parakeetStt.isModelReady()) {
            throw new Error("Parakeet model not downloaded. Please download it in Settings.")
          }

          await parakeetStt.initializeRecognizer(config.parakeetNumThreads)

          if (!input.pcmRecording) {
            throw new Error("Parakeet STT requires pre-decoded float32 PCM audio. pcmRecording was not provided.")
          }
          transcript = await parakeetStt.transcribe(input.pcmRecording, 16000)
        } else {
          // Use OpenAI or Groq for transcription
          const form = new FormData()
          form.append(
            "file",
            new File([input.recording], "recording.webm", { type: "audio/webm" }),
          )
          form.append(
            "model",
            config.sttProviderId === "groq" ? "whisper-large-v3-turbo" : "whisper-1",
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
        }

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

  getRecordingHistory: t.procedure.action(async () => getRecordingHistory()),

  deleteRecordingItem: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
      const recordings = getRecordingHistory().filter(
        (item) => item.id !== input.id,
      )
      saveRecordingsHitory(recordings)
      fs.unlinkSync(path.join(recordingsFolder, `${input.id}.webm`))
    }),

  deleteRecordingHistory: t.procedure.action(async () => {
    fs.rmSync(recordingsFolder, { force: true, recursive: true })
  }),

  getConfig: t.procedure.action(async () => {
    return configStore.get()
  }),

  // Debug flags - exposed to renderer for synchronized debug logging
  getDebugFlags: t.procedure.action(async () => {
    return getDebugFlags()
  }),

  saveConfig: t.procedure
    .input<{ config: Config }>()
    .action(async ({ input }) => {
      const prev = configStore.get()
      const next = input.config
      const merged = { ...(prev as any), ...(next as any) } as Config

      // Persist merged config (ensures partial updates don't lose existing settings)
      configStore.save(merged)

      // Clear models cache if provider endpoints or API keys changed
      try {
        const providerConfigChanged =
          (prev as any)?.openaiBaseUrl !== (merged as any)?.openaiBaseUrl ||
          (prev as any)?.openaiApiKey !== (merged as any)?.openaiApiKey ||
          (prev as any)?.groqBaseUrl !== (merged as any)?.groqBaseUrl ||
          (prev as any)?.groqApiKey !== (merged as any)?.groqApiKey ||
          (prev as any)?.geminiBaseUrl !== (merged as any)?.geminiBaseUrl ||
          (prev as any)?.geminiApiKey !== (merged as any)?.geminiApiKey

        if (providerConfigChanged) {
          const { clearModelsCache } = await import("./models-service")
          clearModelsCache()
        }
      } catch (_e) {
        // best-effort only; cache will eventually expire
      }

      // Apply login item setting when configuration changes (production only; dev would launch bare Electron)
      try {
        if ((process.env.NODE_ENV === "production" || !process.env.ELECTRON_RENDERER_URL) && process.platform !== "linux") {
          app.setLoginItemSettings({
            openAtLogin: !!merged.launchAtLogin,
            openAsHidden: true,
          })
        }
      } catch (_e) {
        // best-effort only
      }

      // Apply dock icon visibility changes immediately (macOS only)
      if (process.env.IS_MAC) {
        try {
          const prevHideDock = !!(prev as any)?.hideDockIcon
          const nextHideDock = !!(merged as any)?.hideDockIcon

          if (prevHideDock !== nextHideDock) {
            if (nextHideDock) {
              // User wants to hide dock icon - hide it now
              app.setActivationPolicy("accessory")
              app.dock.hide()
            } else {
              // User wants to show dock icon - show it now
              app.dock.show()
              app.setActivationPolicy("regular")
            }
          }
        } catch (_e) {
          // best-effort only
        }
      }

      // Manage Remote Server lifecycle on config changes
      try {
        const prevEnabled = !!(prev as any)?.remoteServerEnabled
        const nextEnabled = !!(merged as any)?.remoteServerEnabled

        if (prevEnabled !== nextEnabled) {
          if (nextEnabled) {
            await startRemoteServer()
          } else {
            await stopRemoteServer()
          }
        } else if (nextEnabled) {
          const changed =
            (prev as any)?.remoteServerPort !== (merged as any)?.remoteServerPort ||
            (prev as any)?.remoteServerBindAddress !== (merged as any)?.remoteServerBindAddress ||
            (prev as any)?.remoteServerApiKey !== (merged as any)?.remoteServerApiKey ||
            (prev as any)?.remoteServerLogLevel !== (merged as any)?.remoteServerLogLevel

          if (changed) {
            await restartRemoteServer()
          }
        }
      } catch (_e) {
        // lifecycle is best-effort
      }

      // Manage WhatsApp MCP server auto-configuration
      // Note: The actual server path is determined at runtime in mcp-service.ts createTransport()
      // This ensures the correct internal bundled path is always used, regardless of what's in config
      try {
        const prevWhatsappEnabled = !!(prev as any)?.whatsappEnabled
        const nextWhatsappEnabled = !!(merged as any)?.whatsappEnabled

        if (prevWhatsappEnabled !== nextWhatsappEnabled) {
          const currentMcpConfig = merged.mcpConfig || { mcpServers: {} }
          const hasWhatsappServer = !!currentMcpConfig.mcpServers?.[WHATSAPP_SERVER_NAME]

          if (nextWhatsappEnabled) {
            // WhatsApp is being enabled
            const { mcpService } = await import("./mcp-service")
            if (!hasWhatsappServer) {
              // Auto-add WhatsApp MCP server config when enabled
              // The path in config is just a placeholder - the actual path is determined
              // at runtime in createTransport() to ensure the correct bundled path is used
              const updatedMcpConfig: MCPConfig = {
                ...currentMcpConfig,
                mcpServers: {
                  ...currentMcpConfig.mcpServers,
                  [WHATSAPP_SERVER_NAME]: {
                    command: "node",
                    args: [getInternalWhatsAppServerPath()],
                    transport: "stdio",
                  },
                },
              }
              merged.mcpConfig = updatedMcpConfig
              configStore.save(merged)
            }
            // Start/restart the WhatsApp server (handles both new and existing configs)
            await mcpService.restartServer(WHATSAPP_SERVER_NAME)
          } else if (!nextWhatsappEnabled && hasWhatsappServer) {
            // Stop the WhatsApp server when disabled (but keep config for re-enabling)
            const { mcpService } = await import("./mcp-service")
            await mcpService.stopServer(WHATSAPP_SERVER_NAME)
          }
        } else if (nextWhatsappEnabled) {
          // Check if WhatsApp settings changed - restart server to pick up new env vars
          // Also watch Remote Server settings since prepareEnvironment() derives callback URL/API key from them
          const whatsappSettingsChanged =
            JSON.stringify((prev as any)?.whatsappAllowFrom) !== JSON.stringify((merged as any)?.whatsappAllowFrom) ||
            (prev as any)?.whatsappAutoReply !== (merged as any)?.whatsappAutoReply ||
            (prev as any)?.whatsappLogMessages !== (merged as any)?.whatsappLogMessages

          // If auto-reply is enabled, also restart when Remote Server settings change
          // This includes remoteServerEnabled because prepareEnvironment() only enables
          // callback URL/API key injection when remote server is enabled
          const remoteServerSettingsChanged = (merged as any)?.whatsappAutoReply && (
            (prev as any)?.remoteServerEnabled !== (merged as any)?.remoteServerEnabled ||
            (prev as any)?.remoteServerPort !== (merged as any)?.remoteServerPort ||
            (prev as any)?.remoteServerApiKey !== (merged as any)?.remoteServerApiKey
          )

          if (whatsappSettingsChanged || remoteServerSettingsChanged) {
            const { mcpService } = await import("./mcp-service")
            const currentMcpConfig = merged.mcpConfig || { mcpServers: {} }
            if (currentMcpConfig.mcpServers?.[WHATSAPP_SERVER_NAME]) {
              await mcpService.restartServer(WHATSAPP_SERVER_NAME)
            }
          }
        }
      } catch (_e) {
        // lifecycle is best-effort
      }

      // Reinitialize Langfuse if any Langfuse config fields changed
      // This ensures config changes take effect without requiring app restart
      try {
        const langfuseConfigChanged =
          (prev as any)?.langfuseEnabled !== (merged as any)?.langfuseEnabled ||
          (prev as any)?.langfuseSecretKey !== (merged as any)?.langfuseSecretKey ||
          (prev as any)?.langfusePublicKey !== (merged as any)?.langfusePublicKey ||
          (prev as any)?.langfuseBaseUrl !== (merged as any)?.langfuseBaseUrl

        if (langfuseConfigChanged) {
          const { reinitializeLangfuse } = await import("./langfuse-service")
          reinitializeLangfuse()
        }
      } catch (_e) {
        // Langfuse reinitialization is best-effort
      }
    }),

  // Check if langfuse package is installed (for UI to show install instructions)
  isLangfuseInstalled: t.procedure.action(async () => {
    try {
      const { isLangfuseInstalled } = await import("./langfuse-service")
      return isLangfuseInstalled()
    } catch {
      return false
    }
  }),

  recordEvent: t.procedure
    .input<{ type: "start" | "end"; mcpMode?: boolean }>()
    .action(async ({ input }) => {
      if (input.type === "start") {
        state.isRecording = true
        // Track MCP mode state so main process knows if we're in MCP toggle mode
        if (input.mcpMode !== undefined) {
          state.isRecordingMcpMode = input.mcpMode
        }
      } else {
        state.isRecording = false
        state.isRecordingMcpMode = false
      }
      updateTrayIcon()
    }),

  clearTextInputState: t.procedure.action(async () => {
    state.isTextInputActive = false
  }),

  // MCP Config File Operations
  loadMcpConfigFile: t.procedure.action(async () => {
    const result = await dialog.showOpenDialog({
      title: "Load MCP Configuration",
      filters: [
        { name: "JSON Files", extensions: ["json"] },
        { name: "All Files", extensions: ["*"] },
      ],
      properties: ["openFile"],
    })

    if (result.canceled || !result.filePaths.length) {
      return null
    }

    try {
      const configContent = fs.readFileSync(result.filePaths[0], "utf8")
      const mcpConfig = JSON.parse(configContent) as MCPConfig
      const { normalized: normalizedConfig } = normalizeMcpConfig(mcpConfig)

      // Basic validation
      if (!normalizedConfig.mcpServers || typeof normalizedConfig.mcpServers !== "object") {
        throw new Error("Invalid MCP config: missing or invalid mcpServers")
      }

      // Validate each server config based on transport type
      for (const [serverName, serverConfig] of Object.entries(
        normalizedConfig.mcpServers,
      )) {
        const transportType = inferTransportType(serverConfig)

        if (transportType === "stdio") {
          // stdio transport requires command and args
          if (!serverConfig.command || !Array.isArray(serverConfig.args)) {
            throw new Error(
              `Invalid server config for "${serverName}": stdio transport requires "command" and "args" fields. For HTTP servers, use "transport": "streamableHttp" with "url" field.`,
            )
          }
        } else if (transportType === "websocket" || transportType === "streamableHttp") {
          // Remote transports require url
          if (!serverConfig.url) {
            throw new Error(
              `Invalid server config for "${serverName}": ${transportType} transport requires "url" field`,
            )
          }
        } else {
          throw new Error(
            `Invalid server config for "${serverName}": unsupported transport type "${transportType}". Valid types: "stdio", "websocket", "streamableHttp"`,
          )
        }
      }

      return normalizedConfig
    } catch (error) {
      throw new Error(
        `Failed to load MCP config: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }),

  validateMcpConfigText: t.procedure
    .input<{ text: string }>()
    .action(async ({ input }) => {
      try {
        const mcpConfig = JSON.parse(input.text) as MCPConfig
        const { normalized: normalizedConfig } = normalizeMcpConfig(mcpConfig)

        // Basic validation - same as file upload
        if (!normalizedConfig.mcpServers || typeof normalizedConfig.mcpServers !== "object") {
          throw new Error("Invalid MCP config: missing or invalid mcpServers")
        }

        // Validate each server config based on transport type
        for (const [serverName, serverConfig] of Object.entries(
          normalizedConfig.mcpServers,
        )) {
          const transportType = inferTransportType(serverConfig)

          if (transportType === "stdio") {
            // stdio transport requires command and args
            if (!serverConfig.command || !Array.isArray(serverConfig.args)) {
              throw new Error(
                `Invalid server config for "${serverName}": stdio transport requires "command" and "args" fields. For HTTP servers, use "transport": "streamableHttp" with "url" field.`,
              )
            }
          } else if (transportType === "websocket" || transportType === "streamableHttp") {
            // Remote transports require url
            if (!serverConfig.url) {
              throw new Error(
                `Invalid server config for "${serverName}": ${transportType} transport requires "url" field`,
              )
            }
          } else {
            throw new Error(
              `Invalid server config for "${serverName}": unsupported transport type "${transportType}". Valid types: "stdio", "websocket", "streamableHttp"`,
            )
          }
        }

        return normalizedConfig
      } catch (error) {
        throw new Error(
          `Invalid MCP config: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }),

  saveMcpConfigFile: t.procedure
    .input<{ config: MCPConfig }>()
    .action(async ({ input }) => {
      const result = await dialog.showSaveDialog({
        title: "Save MCP Configuration",
        defaultPath: "mcp.json",
        filters: [
          { name: "JSON Files", extensions: ["json"] },
          { name: "All Files", extensions: ["*"] },
        ],
      })

      if (result.canceled || !result.filePath) {
        return false
      }

      try {
        fs.writeFileSync(result.filePath, JSON.stringify(input.config, null, 2))
        return true
      } catch (error) {
        throw new Error(
          `Failed to save MCP config: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }),

  validateMcpConfig: t.procedure
    .input<{ config: MCPConfig }>()
    .action(async ({ input }) => {
      try {
        const { normalized: normalizedConfig } = normalizeMcpConfig(input.config)

        if (!normalizedConfig.mcpServers || typeof normalizedConfig.mcpServers !== "object") {
          return { valid: false, error: "Missing or invalid mcpServers" }
        }

        for (const [serverName, serverConfig] of Object.entries(
          normalizedConfig.mcpServers,
        )) {
          const transportType = inferTransportType(serverConfig)

          // Validate based on transport type
          if (transportType === "stdio") {
            // stdio transport requires command and args
            if (!serverConfig.command) {
              return {
                valid: false,
                error: `Server "${serverName}": stdio transport requires "command" field. For HTTP servers, use "transport": "streamableHttp" with "url" field.`,
              }
            }
            if (!Array.isArray(serverConfig.args)) {
              return {
                valid: false,
                error: `Server "${serverName}": stdio transport requires "args" as an array`,
              }
            }
          } else if (transportType === "websocket" || transportType === "streamableHttp") {
            // Remote transports require url
            if (!serverConfig.url) {
              return {
                valid: false,
                error: `Server "${serverName}": ${transportType} transport requires "url" field`,
              }
            }
          } else {
            return {
              valid: false,
              error: `Server "${serverName}": unsupported transport type "${transportType}". Valid types: "stdio", "websocket", "streamableHttp"`,
            }
          }

          // Common validations for all transport types
          if (serverConfig.env && typeof serverConfig.env !== "object") {
            return {
              valid: false,
              error: `Server "${serverName}": env must be an object`,
            }
          }
          if (
            serverConfig.timeout &&
            typeof serverConfig.timeout !== "number"
          ) {
            return {
              valid: false,
              error: `Server "${serverName}": timeout must be a number`,
            }
          }
          if (
            serverConfig.disabled &&
            typeof serverConfig.disabled !== "boolean"
          ) {
            return {
              valid: false,
              error: `Server "${serverName}": disabled must be a boolean`,
            }
          }
        }

        return { valid: true }
      } catch (error) {
        return {
          valid: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }),

  getMcpServerStatus: t.procedure.action(async () => {
    return mcpService.getServerStatus()
  }),

  getMcpInitializationStatus: t.procedure.action(async () => {
    return mcpService.getInitializationStatus()
  }),

  getMcpDetailedToolList: t.procedure.action(async () => {
    return mcpService.getDetailedToolList()
  }),

  setMcpToolEnabled: t.procedure
    .input<{ toolName: string; enabled: boolean }>()
    .action(async ({ input }) => {
      const success = mcpService.setToolEnabled(input.toolName, input.enabled)
      return { success }
    }),

  setMcpServerRuntimeEnabled: t.procedure
    .input<{ serverName: string; enabled: boolean }>()
    .action(async ({ input }) => {
      const success = mcpService.setServerRuntimeEnabled(
        input.serverName,
        input.enabled,
      )
      return { success }
    }),

  getMcpServerRuntimeState: t.procedure
    .input<{ serverName: string }>()
    .action(async ({ input }) => {
      return {
        runtimeEnabled: mcpService.isServerRuntimeEnabled(input.serverName),
        available: mcpService.isServerAvailable(input.serverName),
      }
    }),

  getMcpDisabledTools: t.procedure.action(async () => {
    return mcpService.getDisabledTools()
  }),

  // Diagnostics endpoints
  getDiagnosticReport: t.procedure.action(async () => {
    try {
      return await diagnosticsService.generateDiagnosticReport()
    } catch (error) {
      diagnosticsService.logError(
        "tipc",
        "Failed to generate diagnostic report",
        error,
      )
      throw error
    }
  }),

  saveDiagnosticReport: t.procedure
    .input<{ filePath?: string }>()
    .action(async ({ input }) => {
      try {
        const savedPath = await diagnosticsService.saveDiagnosticReport(
          input.filePath,
        )
        return { success: true, filePath: savedPath }

      } catch (error) {
        diagnosticsService.logError(
          "tipc",
          "Failed to save diagnostic report",
          error,
        )
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }),

  performHealthCheck: t.procedure.action(async () => {
    try {
      return await diagnosticsService.performHealthCheck()
    } catch (error) {
      diagnosticsService.logError(
        "tipc",
        "Failed to perform health check",
        error,
      )
      throw error
    }
  }),

  getRecentErrors: t.procedure
    .input<{ count?: number }>()

    .action(async ({ input }) => {
      return diagnosticsService.getRecentErrors(input.count || 10)
    }),

  clearErrorLog: t.procedure.action(async () => {
    diagnosticsService.clearErrorLog()
    return { success: true }
  }),

  testMcpServerConnection: t.procedure
    .input<{ serverName: string; serverConfig: MCPServerConfig }>()
    .action(async ({ input }) => {
      return mcpService.testServerConnection(
        input.serverName,
        input.serverConfig,
      )
    }),

  restartMcpServer: t.procedure
    .input<{ serverName: string }>()

    .action(async ({ input }) => {
      return mcpService.restartServer(input.serverName)
    }),

  stopMcpServer: t.procedure
    .input<{ serverName: string }>()
    .action(async ({ input }) => {
      return mcpService.stopServer(input.serverName)
    }),

  getMcpServerLogs: t.procedure
    .input<{ serverName: string }>()
    .action(async ({ input }) => {
      return mcpService.getServerLogs(input.serverName)
    }),

  clearMcpServerLogs: t.procedure
    .input<{ serverName: string }>()
    .action(async ({ input }) => {
      mcpService.clearServerLogs(input.serverName)
      return { success: true }
    }),

  // WhatsApp Integration
  whatsappConnect: t.procedure.action(async () => {
    const WHATSAPP_SERVER_NAME = "whatsapp"
    try {
      // Check if WhatsApp server is available
      const serverStatus = mcpService.getServerStatus()
      const whatsappServer = serverStatus[WHATSAPP_SERVER_NAME]
      if (!whatsappServer || !whatsappServer.connected) {
        return { success: false, error: "WhatsApp server is not running. Please enable WhatsApp in settings." }
      }

      // Call the whatsapp_connect tool
      const result = await mcpService.executeToolCall(
        { name: "whatsapp_connect", arguments: {} },
        undefined,
        true // skip approval check for internal calls
      )

      // Check if the tool returned an error result
      if (result.isError) {
        const errorText = result.content?.find((c: any) => c.type === "text")?.text || "Connection failed"
        return { success: false, error: errorText }
      }

      // Parse the result to extract QR code if present
      const textContent = result.content?.find((c: any) => c.type === "text")
      if (textContent?.text) {
        try {
          const parsed = JSON.parse(textContent.text)
          if (parsed.qrCode) {
            return { success: true, qrCode: parsed.qrCode, status: "qr_required" }
          } else if (parsed.status === "qr_required") {
            return { success: true, qrCode: parsed.qrCode, status: "qr_required" }
          }
        } catch {
          // Not JSON, check for connection success message
          if (textContent.text.includes("Connected successfully")) {
            return { success: true, status: "connected", message: textContent.text }
          }
          if (textContent.text.includes("Already connected")) {
            return { success: true, status: "connected", message: textContent.text }
          }
        }
        return { success: true, message: textContent.text }
      }

      return { success: true, message: "Connection initiated" }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }),

  whatsappGetStatus: t.procedure.action(async () => {
    const WHATSAPP_SERVER_NAME = "whatsapp"
    try {
      // Check if WhatsApp server is available
      const serverStatus = mcpService.getServerStatus()
      const whatsappServer = serverStatus[WHATSAPP_SERVER_NAME]
      if (!whatsappServer || !whatsappServer.connected) {
        return { available: false, connected: false, error: "WhatsApp server is not running" }
      }

      // Call the whatsapp_get_status tool
      const result = await mcpService.executeToolCall(
        { name: "whatsapp_get_status", arguments: {} },
        undefined,
        true // skip approval check for internal calls
      )

      // Check if the tool returned an error result
      if (result.isError) {
        const errorText = result.content?.find((c: any) => c.type === "text")?.text || "Failed to get status"
        return { available: true, connected: false, error: errorText }
      }

      // Parse the result
      const textContent = result.content?.find((c: any) => c.type === "text")
      if (textContent?.text) {
        try {
          const parsed = JSON.parse(textContent.text)
          return { available: true, ...parsed }
        } catch {
          return { available: true, message: textContent.text }
        }
      }

      return { available: true, connected: false }
    } catch (error) {
      return { available: false, connected: false, error: error instanceof Error ? error.message : String(error) }
    }
  }),

  whatsappDisconnect: t.procedure.action(async () => {
    const WHATSAPP_SERVER_NAME = "whatsapp"
    try {
      const result = await mcpService.executeToolCall(
        { name: "whatsapp_disconnect", arguments: {} },
        undefined,
        true
      )
      // Check if the tool returned an error result
      if (result.isError) {
        const errorText = result.content?.find((c: any) => c.type === "text")?.text || "Disconnect failed"
        return { success: false, error: errorText }
      }
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }),

  whatsappLogout: t.procedure.action(async () => {
    const WHATSAPP_SERVER_NAME = "whatsapp"
    try {
      const result = await mcpService.executeToolCall(
        { name: "whatsapp_logout", arguments: {} },
        undefined,
        true
      )
      // Check if the tool returned an error result
      if (result.isError) {
        const errorText = result.content?.find((c: any) => c.type === "text")?.text || "Logout failed"
        return { success: false, error: errorText }
      }
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }),

  // Text-to-Speech
  generateSpeech: t.procedure
    .input<{
      text: string
      providerId?: string
      voice?: string
      model?: string
      speed?: number
    }>()
    .action(async ({ input }) => {









      const config = configStore.get()



      if (!config.ttsEnabled) {
        throw new Error("Text-to-Speech is not enabled")
      }

      const providerId = input.providerId || config.ttsProviderId || "openai"

      // Preprocess text for TTS
      let processedText = input.text

      if (config.ttsPreprocessingEnabled !== false) {
        // Use LLM-based preprocessing if enabled, otherwise fall back to regex
        if (config.ttsUseLLMPreprocessing) {
          processedText = await preprocessTextForTTSWithLLM(input.text, config.ttsLLMPreprocessingProviderId)
        } else {
          // Use regex-based preprocessing
          const preprocessingOptions = {
            removeCodeBlocks: config.ttsRemoveCodeBlocks ?? true,
            removeUrls: config.ttsRemoveUrls ?? true,
            convertMarkdown: config.ttsConvertMarkdown ?? true,
          }
          processedText = preprocessTextForTTS(input.text, preprocessingOptions)
        }
      }

      // Validate processed text
      const validation = validateTTSText(processedText)
      if (!validation.isValid) {
        throw new Error(`TTS validation failed: ${validation.issues.join(", ")}`)
      }

      try {
        let audioBuffer: ArrayBuffer



        if (providerId === "openai") {
          audioBuffer = await generateOpenAITTS(processedText, input, config)
        } else if (providerId === "groq") {
          audioBuffer = await generateGroqTTS(processedText, input, config)
        } else if (providerId === "gemini") {
          audioBuffer = await generateGeminiTTS(processedText, input, config)
        } else if (providerId === "kitten") {
          const { synthesize } = await import('./kitten-tts')
          const voiceId = config.kittenVoiceId ?? 0 // Default to Voice 2 - Male
          const result = await synthesize(processedText, voiceId, input.speed)
          const wavBuffer = float32ToWav(result.samples, result.sampleRate)
          // Convert Buffer to ArrayBuffer
          audioBuffer = new Uint8Array(wavBuffer).buffer
        } else if (providerId === "supertonic") {
          const { synthesize } = await import('./supertonic-tts')
          const voice = config.supertonicVoice ?? "M1"
          const lang = config.supertonicLanguage ?? "en"
          const speed = input.speed ?? config.supertonicSpeed ?? 1.05
          const steps = config.supertonicSteps ?? 5
          const result = await synthesize(processedText, voice, lang, speed, steps)
          const wavBuffer = float32ToWav(result.samples, result.sampleRate)
          audioBuffer = new Uint8Array(wavBuffer).buffer
        } else {
          throw new Error(`Unsupported TTS provider: ${providerId}`)
        }



        return {
          audio: audioBuffer,
          processedText,
          provider: providerId,
        }
      } catch (error) {
        diagnosticsService.logError("tts", "TTS generation failed", error)
        throw error
      }
    }),

  // Models Management
  fetchAvailableModels: t.procedure
    .input<{ providerId: string }>()
    .action(async ({ input }) => {
      const { fetchAvailableModels } = await import("./models-service")
      return fetchAvailableModels(input.providerId)
    }),

  // Fetch models for a specific preset (base URL + API key)
  fetchModelsForPreset: t.procedure
    .input<{ baseUrl: string; apiKey: string }>()
    .action(async ({ input }) => {
      const { fetchModelsForPreset } = await import("./models-service")
      return fetchModelsForPreset(input.baseUrl, input.apiKey)
    }),

  // Get enhanced model info from models.dev
  getModelInfo: t.procedure
    .input<{ modelId: string; providerId?: string }>()
    .action(async ({ input }) => {
      // If providerId is given, use specific provider lookup
      if (input.providerId) {
        const model = getModelFromModelsDevByProviderId(input.modelId, input.providerId)
        return model || null
      }
      // Otherwise, search across ALL providers using fuzzy matching
      const matchResult = findBestModelMatch(input.modelId)
      return matchResult?.model || null
    }),

  // Get all models.dev data
  getModelsDevData: t.procedure.action(async () => {
    return await fetchModelsDevData()
  }),

  // Force refresh models.dev cache
  refreshModelsData: t.procedure.action(async () => {
    await refreshModelsDevCache()
    return { success: true }
  }),

  // Conversation Management
  getConversationHistory: t.procedure.action(async () => {
    logApp("[tipc] getConversationHistory called")
    const result = await conversationService.getConversationHistory()
    return result
  }),

  loadConversation: t.procedure
    .input<{ conversationId: string }>()
    .action(async ({ input }) => {
      return conversationService.loadConversation(input.conversationId)
    }),

  saveConversation: t.procedure
    .input<{ conversation: Conversation }>()
    .action(async ({ input }) => {
      await conversationService.saveConversation(input.conversation)
    }),

  createConversation: t.procedure
    .input<{ firstMessage: string; role?: "user" | "assistant" }>()
    .action(async ({ input }) => {
      return conversationService.createConversation(
        input.firstMessage,
        input.role,
      )
    }),

  addMessageToConversation: t.procedure
    .input<{
      conversationId: string
      content: string
      role: "user" | "assistant" | "tool"
      toolCalls?: Array<{ name: string; arguments: any }>
      toolResults?: Array<{ success: boolean; content: string; error?: string }>
    }>()
    .action(async ({ input }) => {
      return conversationService.addMessageToConversation(
        input.conversationId,
        input.content,
        input.role,
        input.toolCalls,
        input.toolResults,
      )
    }),

  deleteConversation: t.procedure
    .input<{ conversationId: string }>()
    .action(async ({ input }) => {
      await conversationService.deleteConversation(input.conversationId)
    }),

  deleteAllConversations: t.procedure.action(async () => {
    await conversationService.deleteAllConversations()
  }),

  openConversationsFolder: t.procedure.action(async () => {
    await shell.openPath(conversationsFolder)
  }),

  // Panel resize endpoints
  getPanelSize: t.procedure.action(async () => {
    const win = WINDOWS.get("panel")
    if (!win) {
      throw new Error("Panel window not found")
    }
    const [width, height] = win.getSize()
    return { width, height }
  }),

  updatePanelSize: t.procedure
    .input<{ width: number; height: number }>()
    .action(async ({ input }) => {
      const win = WINDOWS.get("panel")
      if (!win) {
        throw new Error("Panel window not found")
      }

      // Apply minimum size constraints (use MIN_WAVEFORM_WIDTH to ensure visualizer bars aren't clipped)
      const minWidth = Math.max(200, MIN_WAVEFORM_WIDTH)
      const mode = getCurrentPanelMode()
      const minHeight =
        mode === "agent"
          ? PROGRESS_MIN_HEIGHT
          : mode === "textInput"
            ? TEXT_INPUT_MIN_HEIGHT
            : WAVEFORM_MIN_HEIGHT
      const finalWidth = Math.max(minWidth, input.width)
      const finalHeight = Math.max(minHeight, input.height)

      // Update size constraints to allow resizing
      win.setMinimumSize(minWidth, minHeight)
      win.setMaximumSize(finalWidth + 1000, finalHeight + 1000) // Allow growth

      // Set the actual size
      // Mark manual resize to avoid immediate mode re-apply fighting user
      markManualResize()
      win.setSize(finalWidth, finalHeight, true) // animate = true
      return { width: finalWidth, height: finalHeight }
    }),

  savePanelCustomSize: t.procedure
    .input<{ width: number; height: number }>()
    .action(async ({ input }) => {
      const minWidth = Math.max(200, MIN_WAVEFORM_WIDTH)
      const width = Math.max(minWidth, input.width)
      const height = Math.max(WAVEFORM_MIN_HEIGHT, input.height)

      const config = configStore.get()
      const updatedConfig = {
        ...config,
        panelCustomSize: { width, height }
      }
      configStore.save(updatedConfig)
      return updatedConfig.panelCustomSize
    }),

  // Save panel size with mode-specific persistence
  savePanelModeSize: t.procedure
    .input<{ mode: "normal" | "agent" | "textInput"; width: number; height: number }>()
    .action(async ({ input }) => {
      const minWidth = Math.max(200, MIN_WAVEFORM_WIDTH)
      const minHeight =
        input.mode === "agent"
          ? PROGRESS_MIN_HEIGHT
          : input.mode === "textInput"
            ? TEXT_INPUT_MIN_HEIGHT
            : WAVEFORM_MIN_HEIGHT
      const width = Math.max(minWidth, input.width)
      const height = Math.max(minHeight, input.height)

      const config = configStore.get()
      const updatedConfig = { ...config }

      if (input.mode === "agent") {
        updatedConfig.panelProgressSize = { width, height }
      } else {
        updatedConfig.panelCustomSize = { width, height }
      }

      configStore.save(updatedConfig)
      return { mode: input.mode, size: { width, height } }
    }),

  // Get current panel mode (from centralized window state)
  getPanelMode: t.procedure.action(async () => {
    return getCurrentPanelMode()
  }),

  initializePanelSize: t.procedure.action(async () => {
    const win = WINDOWS.get("panel")
    if (!win) {
      throw new Error("Panel window not found")
    }

    const config = configStore.get()
    if (config.panelCustomSize) {
      // Apply saved custom size (use MIN_WAVEFORM_WIDTH to ensure visualizer bars aren't clipped)
      const { width, height } = config.panelCustomSize
      const minWidth = Math.max(200, MIN_WAVEFORM_WIDTH)
      const finalWidth = Math.max(minWidth, width)
      const finalHeight = Math.max(WAVEFORM_MIN_HEIGHT, height)

      win.setMinimumSize(minWidth, WAVEFORM_MIN_HEIGHT)
      win.setSize(finalWidth, finalHeight, false) // no animation on init
      return { width: finalWidth, height: finalHeight }
    }

    // Return current size if no custom size saved
    const [width, height] = win.getSize()
    return { width, height }
  }),

  // Profile Management
  getProfiles: t.procedure.action(async () => {
    return agentProfileService.getProfilesLegacy()
  }),

  getProfile: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
        return agentProfileService.getProfileLegacy(input.id)
    }),

  getCurrentProfile: t.procedure.action(async () => {
    return agentProfileService.getCurrentProfileLegacy()
  }),

  // Get the default system prompt for restore functionality
  getDefaultSystemPrompt: t.procedure.action(async () => {
    const { DEFAULT_SYSTEM_PROMPT } = await import("./system-prompts")
    return DEFAULT_SYSTEM_PROMPT
  }),

  createProfile: t.procedure
    .input<{ name: string; guidelines: string; systemPrompt?: string }>()
    .action(async ({ input }) => {
        const profile = agentProfileService.createUserProfile(input.name, input.guidelines, input.systemPrompt)
        return agentProfileService.getProfileLegacy(profile.id)
    }),

  updateProfile: t.procedure
    .input<{ id: string; name?: string; guidelines?: string; systemPrompt?: string }>()
    .action(async ({ input }) => {
        const updates: Partial<import("@shared/types").AgentProfile> = {}
      if (input.name !== undefined) { updates.name = input.name; updates.displayName = input.name }
      if (input.guidelines !== undefined) updates.guidelines = input.guidelines
      if (input.systemPrompt !== undefined) updates.systemPrompt = input.systemPrompt
      agentProfileService.update(input.id, updates)

      // If the updated profile is the current profile, sync guidelines to live config
      const currentProfile = agentProfileService.getCurrentProfile()
      if (currentProfile && currentProfile.id === input.id && input.guidelines !== undefined) {
        const config = configStore.get()
        configStore.save({
          ...config,
          mcpToolsSystemPrompt: input.guidelines,
        })
      }

      return agentProfileService.getProfileLegacy(input.id)
    }),

  deleteProfile: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
        return agentProfileService.delete(input.id)
    }),

  setCurrentProfile: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
        const profile = agentProfileService.setCurrentProfileStrict(input.id)

      // Update the config with the profile's guidelines, system prompt, and model config
      const config = configStore.get()
      const updatedConfig = {
        ...config,
        mcpToolsSystemPrompt: profile.guidelines || "",
        mcpCurrentProfileId: profile.id,
        // Apply custom system prompt if it exists, otherwise clear it to use default
        mcpCustomSystemPrompt: profile.systemPrompt || "",
        // Apply model config if it exists
        // Agent/MCP Tools settings
        ...(profile.modelConfig?.mcpToolsProviderId && {
          mcpToolsProviderId: profile.modelConfig.mcpToolsProviderId,
        }),
        ...(profile.modelConfig?.mcpToolsOpenaiModel && {
          mcpToolsOpenaiModel: profile.modelConfig.mcpToolsOpenaiModel,
        }),
        ...(profile.modelConfig?.mcpToolsGroqModel && {
          mcpToolsGroqModel: profile.modelConfig.mcpToolsGroqModel,
        }),
        ...(profile.modelConfig?.mcpToolsGeminiModel && {
          mcpToolsGeminiModel: profile.modelConfig.mcpToolsGeminiModel,
        }),
        ...(profile.modelConfig?.currentModelPresetId && {
          currentModelPresetId: profile.modelConfig.currentModelPresetId,
        }),
        // STT Provider settings
        ...(profile.modelConfig?.sttProviderId && {
          sttProviderId: profile.modelConfig.sttProviderId,
        }),
        // Transcript Post-Processing settings
        ...(profile.modelConfig?.transcriptPostProcessingProviderId && {
          transcriptPostProcessingProviderId: profile.modelConfig.transcriptPostProcessingProviderId,
        }),
        ...(profile.modelConfig?.transcriptPostProcessingOpenaiModel && {
          transcriptPostProcessingOpenaiModel: profile.modelConfig.transcriptPostProcessingOpenaiModel,
        }),
        ...(profile.modelConfig?.transcriptPostProcessingGroqModel && {
          transcriptPostProcessingGroqModel: profile.modelConfig.transcriptPostProcessingGroqModel,
        }),
        ...(profile.modelConfig?.transcriptPostProcessingGeminiModel && {
          transcriptPostProcessingGeminiModel: profile.modelConfig.transcriptPostProcessingGeminiModel,
        }),
        // TTS Provider settings
        ...(profile.modelConfig?.ttsProviderId && {
          ttsProviderId: profile.modelConfig.ttsProviderId,
        }),
      }
      configStore.save(updatedConfig)

      // Apply the profile's MCP server configuration
      // If the profile has no toolConfig, we pass empty arrays to reset to default (all enabled)
      const mcpServerConfig = toolConfigToMcpServerConfig(profile.toolConfig)
      mcpService.applyProfileMcpConfig(
        mcpServerConfig?.disabledServers ?? [],
        mcpServerConfig?.disabledTools ?? [],
        mcpServerConfig?.allServersDisabledByDefault ?? false,
        mcpServerConfig?.enabledServers ?? []
      )

      return agentProfileService.getProfileLegacy(profile.id)
    }),

  exportProfile: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
        return agentProfileService.exportProfile(input.id)
    }),

  importProfile: t.procedure
    .input<{ profileJson: string }>()
    .action(async ({ input }) => {
        return agentProfileService.importProfile(input.profileJson)
    }),

  // Save current MCP server state to a profile
  saveCurrentMcpStateToProfile: t.procedure
    .input<{ profileId: string }>()
    .action(async ({ input }) => {

      const currentState = mcpService.getCurrentMcpConfigState()
      return agentProfileService.saveCurrentMcpStateToProfile(
        input.profileId,
        currentState.disabledServers,
        currentState.disabledTools,
        currentState.enabledServers
      )
    }),

  // Update profile MCP server configuration
  updateProfileMcpConfig: t.procedure
    .input<{ profileId: string; disabledServers?: string[]; disabledTools?: string[]; enabledServers?: string[] }>()
    .action(async ({ input }) => {
        return agentProfileService.updateProfileMcpConfig(input.profileId, {
        disabledServers: input.disabledServers,
        disabledTools: input.disabledTools,
        enabledServers: input.enabledServers,
      })
    }),

  // Save current model state to a profile
  saveCurrentModelStateToProfile: t.procedure
    .input<{ profileId: string }>()
    .action(async ({ input }) => {
        const config = configStore.get()
      return agentProfileService.saveCurrentModelStateToProfile(input.profileId, {
        // Agent/MCP Tools settings
        mcpToolsProviderId: config.mcpToolsProviderId,
        mcpToolsOpenaiModel: config.mcpToolsOpenaiModel,
        mcpToolsGroqModel: config.mcpToolsGroqModel,
        mcpToolsGeminiModel: config.mcpToolsGeminiModel,
        currentModelPresetId: config.currentModelPresetId,
        // STT Provider settings
        sttProviderId: config.sttProviderId,
        // Transcript Post-Processing settings
        transcriptPostProcessingProviderId: config.transcriptPostProcessingProviderId,
        transcriptPostProcessingOpenaiModel: config.transcriptPostProcessingOpenaiModel,
        transcriptPostProcessingGroqModel: config.transcriptPostProcessingGroqModel,
        transcriptPostProcessingGeminiModel: config.transcriptPostProcessingGeminiModel,
        // TTS Provider settings
        ttsProviderId: config.ttsProviderId,
      })
    }),

  // Update profile model configuration
  updateProfileModelConfig: t.procedure
    .input<{
      profileId: string
      // Agent/MCP Tools settings
      mcpToolsProviderId?: "openai" | "groq" | "gemini"
      mcpToolsOpenaiModel?: string
      mcpToolsGroqModel?: string
      mcpToolsGeminiModel?: string
      currentModelPresetId?: string
      // STT Provider settings
      sttProviderId?: "openai" | "groq" | "parakeet"
      // Transcript Post-Processing settings
      transcriptPostProcessingProviderId?: "openai" | "groq" | "gemini"
      transcriptPostProcessingOpenaiModel?: string
      transcriptPostProcessingGroqModel?: string
      transcriptPostProcessingGeminiModel?: string
      // TTS Provider settings
      ttsProviderId?: "openai" | "groq" | "gemini" | "kitten" | "supertonic"
    }>()
    .action(async ({ input }) => {
        return agentProfileService.updateProfileModelConfig(input.profileId, {
        // Agent/MCP Tools settings
        mcpToolsProviderId: input.mcpToolsProviderId,
        mcpToolsOpenaiModel: input.mcpToolsOpenaiModel,
        mcpToolsGroqModel: input.mcpToolsGroqModel,
        mcpToolsGeminiModel: input.mcpToolsGeminiModel,
        currentModelPresetId: input.currentModelPresetId,
        // STT Provider settings
        sttProviderId: input.sttProviderId,
        // Transcript Post-Processing settings
        transcriptPostProcessingProviderId: input.transcriptPostProcessingProviderId,
        transcriptPostProcessingOpenaiModel: input.transcriptPostProcessingOpenaiModel,
        transcriptPostProcessingGroqModel: input.transcriptPostProcessingGroqModel,
        transcriptPostProcessingGeminiModel: input.transcriptPostProcessingGeminiModel,
        // TTS Provider settings
        ttsProviderId: input.ttsProviderId,
      })
    }),

  saveProfileFile: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
        const profileJson = agentProfileService.exportProfile(input.id)

      const result = await dialog.showSaveDialog({
        title: "Export Profile",
        defaultPath: "profile.json",
        filters: [
          { name: "JSON Files", extensions: ["json"] },
          { name: "All Files", extensions: ["*"] },
        ],
      })

      if (result.canceled || !result.filePath) {
        return false
      }

      try {
        fs.writeFileSync(result.filePath, profileJson)
        return true
      } catch (error) {
        throw new Error(
          `Failed to save profile: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }),

  loadProfileFile: t.procedure.action(async () => {
    const result = await dialog.showOpenDialog({
      title: "Import Profile",
      filters: [
        { name: "JSON Files", extensions: ["json"] },
        { name: "All Files", extensions: ["*"] },
      ],
      properties: ["openFile"],
    })

    if (result.canceled || !result.filePaths.length) {
      return null
    }

    try {
      const profileJson = fs.readFileSync(result.filePaths[0], "utf8")
        return agentProfileService.importProfile(profileJson)
    } catch (error) {
      throw new Error(
        `Failed to import profile: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }),

  // Cloudflare Tunnel handlers
  checkCloudflaredInstalled: t.procedure.action(async () => {
    const { checkCloudflaredInstalled } = await import("./cloudflare-tunnel")
    return checkCloudflaredInstalled()
  }),

  startCloudflareTunnel: t.procedure.action(async () => {
    const { startCloudflareTunnel } = await import("./cloudflare-tunnel")
    return startCloudflareTunnel()
  }),

  startNamedCloudflareTunnel: t.procedure
    .input<{
      tunnelId: string
      hostname: string
      credentialsPath?: string
    }>()
    .action(async ({ input }) => {
      const { startNamedCloudflareTunnel } = await import("./cloudflare-tunnel")
      return startNamedCloudflareTunnel(input)
    }),

  stopCloudflareTunnel: t.procedure.action(async () => {
    const { stopCloudflareTunnel } = await import("./cloudflare-tunnel")
    return stopCloudflareTunnel()
  }),

  getCloudflareTunnelStatus: t.procedure.action(async () => {
    const { getCloudflareTunnelStatus } = await import("./cloudflare-tunnel")
    return getCloudflareTunnelStatus()
  }),

  listCloudflareTunnels: t.procedure.action(async () => {
    const { listCloudflareTunnels } = await import("./cloudflare-tunnel")
    return listCloudflareTunnels()
  }),

  checkCloudflaredLoggedIn: t.procedure.action(async () => {
    const { checkCloudflaredLoggedIn } = await import("./cloudflare-tunnel")
    return checkCloudflaredLoggedIn()
  }),

  // Remote Server QR Code handler
  printRemoteServerQRCode: t.procedure.action(async () => {
    return printQRCodeToTerminal()
  }),

  // MCP Elicitation handlers (Protocol 2025-11-25)
  resolveElicitation: t.procedure
    .input<{
      requestId: string
      action: "accept" | "decline" | "cancel"
      content?: Record<string, string | number | boolean | string[]>
    }>()
    .action(async ({ input }) => {
      const { resolveElicitation } = await import("./mcp-elicitation")
      return resolveElicitation(input.requestId, {
        action: input.action,
        content: input.content,
      })
    }),

  // MCP Sampling handlers (Protocol 2025-11-25)
  resolveSampling: t.procedure
    .input<{
      requestId: string
      approved: boolean
    }>()
    .action(async ({ input }) => {
      const { resolveSampling } = await import("./mcp-sampling")
      return resolveSampling(input.requestId, input.approved)
    }),

  // Message Queue endpoints
  getMessageQueue: t.procedure
    .input<{ conversationId: string }>()
    .action(async ({ input }) => {
          return messageQueueService.getQueue(input.conversationId)
    }),

  getAllMessageQueues: t.procedure.action(async () => {
      const queues = messageQueueService.getAllQueues()
      // Include isPaused state for each queue
      return queues.map(q => ({
        ...q,
        isPaused: messageQueueService.isQueuePaused(q.conversationId),
      }))
  }),

  removeFromMessageQueue: t.procedure
    .input<{ conversationId: string; messageId: string }>()
    .action(async ({ input }) => {
          return messageQueueService.removeFromQueue(input.conversationId, input.messageId)
    }),

  clearMessageQueue: t.procedure
    .input<{ conversationId: string }>()
    .action(async ({ input }) => {
          return messageQueueService.clearQueue(input.conversationId)
    }),

  reorderMessageQueue: t.procedure
    .input<{ conversationId: string; messageIds: string[] }>()
    .action(async ({ input }) => {
          return messageQueueService.reorderQueue(input.conversationId, input.messageIds)
    }),

  updateQueuedMessageText: t.procedure
    .input<{ conversationId: string; messageId: string; text: string }>()
    .action(async ({ input }) => {
    
      // Check if this was a failed message before updating
      const queue = messageQueueService.getQueue(input.conversationId)
      const message = queue.find((m) => m.id === input.messageId)
      const wasFailed = message?.status === "failed"

      const success = messageQueueService.updateMessageText(input.conversationId, input.messageId, input.text)
      if (!success) return false

      // If this was a failed message that's now reset to pending,
      // check if conversation is idle and trigger queue processing
      if (wasFailed) {
              const activeSessionId = agentSessionTracker.findSessionByConversationId(input.conversationId)
        if (activeSessionId) {
          const session = agentSessionTracker.getSession(activeSessionId)
          if (session && session.status === "active") {
            // Session is active, queue will be processed when it completes
            return true
          }
        }

        // Conversation is idle, trigger queue processing
        processQueuedMessages(input.conversationId).catch((err) => {
          logLLM("[updateQueuedMessageText] Error processing queued messages:", err)
        })
      }

      return true
    }),

  retryQueuedMessage: t.procedure
    .input<{ conversationId: string; messageId: string }>()
    .action(async ({ input }) => {
        
      // Use resetToPending to reset failed message status without modifying text
      // This works even for addedToHistory messages since we're not changing the text
      const success = messageQueueService.resetToPending(input.conversationId, input.messageId)
      if (!success) return false

      // Check if conversation is idle (no active session)
      const activeSessionId = agentSessionTracker.findSessionByConversationId(input.conversationId)
      if (activeSessionId) {
        const session = agentSessionTracker.getSession(activeSessionId)
        if (session && session.status === "active") {
          // Session is active, queue will be processed when it completes
          return true
        }
      }

      // Conversation is idle, trigger queue processing
      processQueuedMessages(input.conversationId).catch((err) => {
        logLLM("[retryQueuedMessage] Error processing queued messages:", err)
      })

      return true
    }),

  isMessageQueuePaused: t.procedure
    .input<{ conversationId: string }>()
    .action(async ({ input }) => {
          return messageQueueService.isQueuePaused(input.conversationId)
    }),

  resumeMessageQueue: t.procedure
    .input<{ conversationId: string }>()
    .action(async ({ input }) => {
        
      // Resume the queue
      messageQueueService.resumeQueue(input.conversationId)

      // Check if conversation is idle (no active session) and trigger queue processing
      const activeSessionId = agentSessionTracker.findSessionByConversationId(input.conversationId)
      if (activeSessionId) {
        const session = agentSessionTracker.getSession(activeSessionId)
        if (session && session.status === "active") {
          // Session is active, queue will be processed when it completes
          return true
        }
      }

      // Conversation is idle, trigger queue processing
      processQueuedMessages(input.conversationId).catch((err) => {
        logLLM("[resumeMessageQueue] Error processing queued messages:", err)
      })

      return true
    }),

  // ACP Agent Configuration handlers
  getAcpAgents: t.procedure.action(async () => {
    const config = configStore.get()
    const externalAgents = config.acpAgents || []
    // Include internal agent in the list, but filter out any persisted 'internal' entries
    // from externalAgents to avoid duplicates (can happen after toggling enabled state)
    const { getInternalAgentConfig } = await import('./acp/acp-router-tools')
    const internalAgent = getInternalAgentConfig()
    // Merge any persisted enabled state from config into the internal agent
    const persistedInternalAgent = externalAgents.find(a => a.name === 'internal')
    if (persistedInternalAgent && typeof persistedInternalAgent.enabled === 'boolean') {
      internalAgent.enabled = persistedInternalAgent.enabled
    }
    const filteredExternalAgents = externalAgents.filter(a => a.name !== 'internal')
    return [internalAgent, ...filteredExternalAgents]
  }),

  saveAcpAgent: t.procedure
    .input<{ agent: ACPAgentConfig }>()
    .action(async ({ input }) => {
      // Block saving agent with reserved name "internal" to avoid config conflicts
      // The internal agent is a built-in and should not be persisted as an external agent
      if (input.agent.name === 'internal') {
        return { success: false, error: 'Cannot save agent with reserved name "internal"' }
      }

      const config = configStore.get()
      const agents = config.acpAgents || []

      // Check if agent with this name already exists
      const existingIndex = agents.findIndex(a => a.name === input.agent.name)

      if (existingIndex >= 0) {
        // Update existing agent
        agents[existingIndex] = input.agent
      } else {
        // Add new agent
        agents.push(input.agent)
      }

      configStore.save({ ...config, acpAgents: agents })
      return { success: true }
    }),

  deleteAcpAgent: t.procedure
    .input<{ agentName: string }>()
    .action(async ({ input }) => {
      const config = configStore.get()
      const agents = config.acpAgents || []

      const filteredAgents = agents.filter(a => a.name !== input.agentName)

      configStore.save({ ...config, acpAgents: filteredAgents })
      return { success: true }
    }),

  toggleAcpAgentEnabled: t.procedure
    .input<{ agentName: string; enabled: boolean }>()
    .action(async ({ input }) => {
      const config = configStore.get()
      const agents = config.acpAgents || []

      const agentIndex = agents.findIndex(a => a.name === input.agentName)
      if (agentIndex >= 0) {
        agents[agentIndex] = { ...agents[agentIndex], enabled: input.enabled }
      } else {
        // Agent not in config (e.g., built-in 'internal' agent) - add an entry to persist enabled state
        // We include displayName to satisfy the ACPAgentConfig contract and avoid undefined issues
        agents.push({
          name: input.agentName,
          displayName: input.agentName === 'internal' ? 'SpeakMCP Internal' : input.agentName,
          enabled: input.enabled,
          isInternal: input.agentName === 'internal',
          connection: { type: 'internal' as const }
        } as import('../shared/types').ACPAgentConfig)
      }

      configStore.save({ ...config, acpAgents: agents })

      // When disabling an agent, automatically stop it if it's running
      if (!input.enabled) {
        const agentStatus = acpService.getAgentStatus(input.agentName)
        if (agentStatus && (agentStatus.status === "ready" || agentStatus.status === "starting")) {
          try {
            await acpService.stopAgent(input.agentName)
          } catch (error) {
            // Log but don't fail the toggle operation
            logApp(`[ACP] Failed to auto-stop agent ${input.agentName} on disable:`, error)
          }
        }
      }

      return { success: true }
    }),

  // ACP Agent Runtime handlers
  getAcpAgentStatuses: t.procedure.action(async () => {
    return acpService.getAgents()
  }),

  spawnAcpAgent: t.procedure
    .input<{ agentName: string }>()
    .action(async ({ input }) => {
      try {
        await acpService.spawnAgent(input.agentName)
        return { success: true }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }),

  stopAcpAgent: t.procedure
    .input<{ agentName: string }>()
    .action(async ({ input }) => {
      try {
        await acpService.stopAgent(input.agentName)
        return { success: true }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }),

  runAcpTask: t.procedure
    .input<{ request: ACPRunRequest }>()
    .action(async ({ input }) => {
      return acpService.runTask(input.request)
    }),

  // Get all subagent delegations with conversations for a session
  getSubagentDelegations: t.procedure
    .input<{ sessionId: string }>()
    .action(async ({ input }) => {
      const { getAllDelegationsForSession } = await import("./acp/acp-router-tools")
      return getAllDelegationsForSession(input.sessionId)
    }),

  // Get details of a specific subagent delegation
  getSubagentDelegationDetails: t.procedure
    .input<{ runId: string }>()
    .action(async ({ input }) => {
      const { getDelegatedRunDetails } = await import("./acp/acp-router-tools")
      return getDelegatedRunDetails(input.runId)
    }),

  // ============================================================================
  // Agent Profile Handlers (Unified Profile + ACP Agent)
  // ============================================================================

  getAgentProfiles: t.procedure.action(async () => {
    return agentProfileService.getAll()
  }),

  getAgentProfile: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
      return agentProfileService.getById(input.id)
    }),

  getAgentProfileByName: t.procedure
    .input<{ name: string }>()
    .action(async ({ input }) => {
      return agentProfileService.getByName(input.name)
    }),

  createAgentProfile: t.procedure
    .input<{
      profile: {
        name: string
        displayName: string
        description?: string
        systemPrompt?: string
        guidelines?: string

        properties?: Record<string, string>
        modelConfig?: import("@shared/types").ProfileModelConfig
        toolConfig?: import("@shared/types").AgentProfileToolConfig
        skillsConfig?: import("@shared/types").ProfileSkillsConfig
        connection: import("@shared/types").AgentProfileConnection
        isStateful?: boolean
        enabled: boolean
        isUserProfile?: boolean
        isAgentTarget?: boolean
        isDefault?: boolean
        autoSpawn?: boolean
      }
    }>()
    .action(async ({ input }) => {
      return agentProfileService.create(input.profile)
    }),

  updateAgentProfile: t.procedure
    .input<{
      id: string
      updates: Partial<import("@shared/types").AgentProfile>
    }>()
    .action(async ({ input }) => {
      return agentProfileService.update(input.id, input.updates)
    }),

  deleteAgentProfile: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
      return agentProfileService.delete(input.id)
    }),

  getUserProfiles: t.procedure.action(async () => {
    return agentProfileService.getUserProfiles()
  }),

  getAgentTargets: t.procedure.action(async () => {
    return agentProfileService.getAgentTargets()
  }),

  getEnabledAgentTargets: t.procedure.action(async () => {
    return agentProfileService.getEnabledAgentTargets()
  }),

  getCurrentAgentProfile: t.procedure.action(async () => {
    return agentProfileService.getCurrentProfile()
  }),

  setCurrentAgentProfile: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
      agentProfileService.setCurrentProfile(input.id)
      return { success: true }
    }),

  getAgentProfilesByRole: t.procedure
    .input<{ role: import("@shared/types").AgentProfileRole }>()
    .action(async ({ input }) => {
      return agentProfileService.getByRole(input.role)
    }),

  getExternalAgents: t.procedure.action(async () => {
    return agentProfileService.getExternalAgents()
  }),

  getAgentProfileConversation: t.procedure
    .input<{ profileId: string }>()
    .action(async ({ input }) => {
      return agentProfileService.getConversation(input.profileId)
    }),

  setAgentProfileConversation: t.procedure
    .input<{
      profileId: string
      messages: import("@shared/types").ConversationMessage[]
    }>()
    .action(async ({ input }) => {
      agentProfileService.setConversation(input.profileId, input.messages)
      return { success: true }
    }),

  clearAgentProfileConversation: t.procedure
    .input<{ profileId: string }>()
    .action(async ({ input }) => {
      agentProfileService.clearConversation(input.profileId)
      return { success: true }
    }),

  reloadAgentProfiles: t.procedure.action(async () => {
    agentProfileService.reload()
    return { success: true }
  }),

  // Agent Skills Management
  getSkills: t.procedure.action(async () => {
    const { skillsService } = await import("./skills-service")
    return skillsService.getSkills()
  }),

  getEnabledSkills: t.procedure.action(async () => {
    const { skillsService } = await import("./skills-service")
    return skillsService.getEnabledSkills()
  }),

  getSkill: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
      const { skillsService } = await import("./skills-service")
      return skillsService.getSkill(input.id)
    }),

  createSkill: t.procedure
    .input<{ name: string; description: string; instructions: string }>()
    .action(async ({ input }) => {
      const { skillsService } = await import("./skills-service")
      const skill = skillsService.createSkill(input.name, input.description, input.instructions)
      // Auto-enable the new skill for the current profile so it's immediately usable
      agentProfileService.enableSkillForCurrentProfile(skill.id)
      return skill
    }),

  updateSkill: t.procedure
    .input<{ id: string; name?: string; description?: string; instructions?: string; enabled?: boolean }>()
    .action(async ({ input }) => {
      const { skillsService } = await import("./skills-service")
      const { id, ...updates } = input
      return skillsService.updateSkill(id, updates)
    }),

  deleteSkill: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
      const { skillsService } = await import("./skills-service")
      return skillsService.deleteSkill(input.id)
    }),

  toggleSkill: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
      const { skillsService } = await import("./skills-service")
      return skillsService.toggleSkill(input.id)
    }),

  importSkillFromMarkdown: t.procedure
    .input<{ content: string }>()
    .action(async ({ input }) => {
      const { skillsService } = await import("./skills-service")
      const skill = skillsService.importSkillFromMarkdown(input.content)
      // Auto-enable the imported skill for the current profile so it's immediately usable
      agentProfileService.enableSkillForCurrentProfile(skill.id)
      return skill
    }),

  exportSkillToMarkdown: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
      const { skillsService } = await import("./skills-service")
      return skillsService.exportSkillToMarkdown(input.id)
    }),

  // Import a single skill - can be a .md file or a folder containing SKILL.md
  importSkillFile: t.procedure.action(async () => {
    const { skillsService } = await import("./skills-service")
    const result = await dialog.showOpenDialog({
      title: "Import Skill",
      filters: [
        { name: "Skill Files", extensions: ["md"] },
        { name: "All Files", extensions: ["*"] },
      ],
      properties: ["openFile", "showHiddenFiles"],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const skill = skillsService.importSkillFromFile(result.filePaths[0])
    // Auto-enable the imported skill for the current profile so it's immediately usable
    agentProfileService.enableSkillForCurrentProfile(skill.id)
    return skill
  }),

  // Import a skill from a folder containing SKILL.md
  importSkillFolder: t.procedure.action(async () => {
    const { skillsService } = await import("./skills-service")
    const result = await dialog.showOpenDialog({
      title: "Import Skill Folder",
      message: "Select a folder containing SKILL.md",
      properties: ["openDirectory", "showHiddenFiles"],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const skill = skillsService.importSkillFromFolder(result.filePaths[0])
    // Auto-enable the imported skill for the current profile so it's immediately usable
    agentProfileService.enableSkillForCurrentProfile(skill.id)
    return skill
  }),

  // Bulk import all skill folders from a parent directory
  importSkillsFromParentFolder: t.procedure.action(async () => {
    const { skillsService } = await import("./skills-service")
    const result = await dialog.showOpenDialog({
      title: "Import Skills from Folder",
      message: "Select a folder containing multiple skill folders (each with SKILL.md)",
      properties: ["openDirectory", "showHiddenFiles"],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const importResult = skillsService.importSkillsFromParentFolder(result.filePaths[0])
    // Auto-enable all imported skills for the current profile so they're immediately usable
    for (const skill of importResult.imported) {
      agentProfileService.enableSkillForCurrentProfile(skill.id)
    }
    return importResult
  }),

  saveSkillFile: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
      const { skillsService } = await import("./skills-service")
      const skill = skillsService.getSkill(input.id)
      if (!skill) {
        throw new Error(`Skill with id ${input.id} not found`)
      }

      const result = await dialog.showSaveDialog({
        title: "Export Skill",
        defaultPath: `${skill.name.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.md`,
        filters: [
          { name: "Markdown Files", extensions: ["md"] },
        ],
      })

      if (result.canceled || !result.filePath) {
        return false
      }

      const content = skillsService.exportSkillToMarkdown(input.id)
      fs.writeFileSync(result.filePath, content)
      return true
    }),

  openSkillsFolder: t.procedure.action(async () => {
    const { globalAgentsFolder, resolveWorkspaceAgentsFolder } = await import("./config")
    const { getAgentsLayerPaths } = await import("./agents-files/modular-config")
    const { getAgentsSkillsDir } = await import("./agents-files/skills")

    // Prefer workspace .agents/skills if available, else global .agents/skills
    const workspaceAgentsFolder = resolveWorkspaceAgentsFolder()
    const layer = workspaceAgentsFolder
      ? getAgentsLayerPaths(workspaceAgentsFolder)
      : getAgentsLayerPaths(globalAgentsFolder)
    const skillsDir = getAgentsSkillsDir(layer)

    fs.mkdirSync(skillsDir, { recursive: true })
    await shell.openPath(skillsDir)
  }),

  scanSkillsFolder: t.procedure.action(async () => {
    const { skillsService } = await import("./skills-service")
    const importedSkills = skillsService.scanSkillsFolder()
    // Auto-enable all newly imported skills for the current profile so they're immediately usable
    for (const skill of importedSkills) {
      agentProfileService.enableSkillForCurrentProfile(skill.id)
    }
    return importedSkills
  }),

  // Import skill(s) from a GitHub repository
  importSkillFromGitHub: t.procedure
    .input<{ repoIdentifier: string }>()
    .action(async ({ input }) => {
      const { skillsService } = await import("./skills-service")
      const result = await skillsService.importSkillFromGitHub(input.repoIdentifier)
      // Auto-enable all imported skills for the current profile so they're immediately usable
      for (const skill of result.imported) {
        agentProfileService.enableSkillForCurrentProfile(skill.id)
      }
      return result
    }),

  getEnabledSkillsInstructions: t.procedure.action(async () => {
    const { skillsService } = await import("./skills-service")
    return skillsService.getEnabledSkillsInstructions()
  }),

  // Per-profile skill management
  getProfileSkillsConfig: t.procedure
    .input<{ profileId: string }>()
    .action(async ({ input }) => {
      const profile = agentProfileService.getById(input.profileId)
      return profile?.skillsConfig ?? { enabledSkillIds: [], allSkillsDisabledByDefault: true }
    }),

  updateProfileSkillsConfig: t.procedure
    .input<{ profileId: string; enabledSkillIds?: string[]; allSkillsDisabledByDefault?: boolean }>()
    .action(async ({ input }) => {
      const { profileId, ...config } = input
      return agentProfileService.updateProfileSkillsConfig(profileId, config)
    }),

  toggleProfileSkill: t.procedure
    .input<{ profileId: string; skillId: string }>()
    .action(async ({ input }) => {
      return agentProfileService.toggleProfileSkill(input.profileId, input.skillId)
    }),

  isSkillEnabledForProfile: t.procedure
    .input<{ profileId: string; skillId: string }>()
    .action(async ({ input }) => {
      return agentProfileService.isSkillEnabledForProfile(input.profileId, input.skillId)
    }),

  getEnabledSkillIdsForProfile: t.procedure
    .input<{ profileId: string }>()
    .action(async ({ input }) => {
      return agentProfileService.getEnabledSkillIdsForProfile(input.profileId)
    }),

  // Get enabled skills instructions for a specific profile
  getEnabledSkillsInstructionsForProfile: t.procedure
    .input<{ profileId: string }>()
    .action(async ({ input }) => {
      const { skillsService } = await import("./skills-service")
      const enabledSkillIds = agentProfileService.getEnabledSkillIdsForProfile(input.profileId)
      return skillsService.getEnabledSkillsInstructionsForProfile(enabledSkillIds)
    }),

  // Memory service handlers
  // Get all memories - optionally filtered by profile
  getAllMemories: t.procedure
    .input<{ profileId?: string }>()
    .action(async ({ input }) => {
      const profileId = input?.profileId
      if (profileId) {
        return memoryService.getMemoriesByProfile(profileId)
      }
      return memoryService.getAllMemories()
    }),

  // Get memories for the current profile (convenience method)
  getMemoriesForCurrentProfile: t.procedure.action(async () => {
    const currentProfile = agentProfileService.getCurrentProfile()
    if (currentProfile) {
      return memoryService.getMemoriesByProfile(currentProfile.id)
    }
    return memoryService.getAllMemories()
  }),

  getMemory: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
      return memoryService.getMemory(input.id)
    }),

  saveMemoryFromSummary: t.procedure
    .input<{
      summary: import("../shared/types").AgentStepSummary
      title?: string
      userNotes?: string
      tags?: string[]
      conversationTitle?: string
      conversationId?: string
      profileId?: string
    }>()
    .action(async ({ input }) => {
      // Use provided profileId, or fall back to current profile
      const profileId = input.profileId ?? agentProfileService.getCurrentProfile()?.id
      const memory = memoryService.createMemoryFromSummary(
        input.summary,
        input.title,
        input.userNotes,
        input.tags,
        input.conversationTitle,
        input.conversationId,
        profileId,
      )
      if (!memory) {
        return { success: true, memory: null, reason: "no_durable_content" as const }
      }
      const success = await memoryService.saveMemory(memory)
      return { success, memory: success ? memory : null }
    }),

  updateMemory: t.procedure
    .input<{
      id: string
      updates: Partial<Omit<import("../shared/types").AgentMemory, "id" | "createdAt">>
    }>()
    .action(async ({ input }) => {
      return memoryService.updateMemory(input.id, input.updates)
    }),

  deleteMemory: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
      return memoryService.deleteMemory(input.id)
    }),

  deleteMultipleMemories: t.procedure
    .input<{ ids: string[] }>()
    .action(async ({ input }) => {
      const profileId = agentProfileService.getCurrentProfile()?.id
      if (!profileId) {
        throw new Error("No current profile selected")
      }
      const result = await memoryService.deleteMultipleMemories(input.ids, profileId)
      if (result.error) {
        throw new Error(result.error)
      }
      return result.deletedCount
    }),

  deleteAllMemories: t.procedure
    .action(async () => {
      const profileId = agentProfileService.getCurrentProfile()?.id
      if (!profileId) {
        throw new Error("No current profile selected")
      }
      const result = await memoryService.deleteAllMemories(profileId)
      if (result.error) {
        throw new Error(result.error)
      }
      return result.deletedCount
    }),

  searchMemories: t.procedure
    .input<{ query: string; profileId?: string }>()
    .action(async ({ input }) => {
      // Use provided profileId, or fall back to current profile
      const profileId = input.profileId ?? agentProfileService.getCurrentProfile()?.id
      return memoryService.searchMemories(input.query, profileId)
    }),

  // Summarization service handlers
  getSessionSummaries: t.procedure
    .input<{ sessionId: string }>()
    .action(async ({ input }) => {
      return summarizationService.getSummaries(input.sessionId)
    }),

  getImportantSummaries: t.procedure
    .input<{ sessionId: string }>()
    .action(async ({ input }) => {
      return summarizationService.getImportantSummaries(input.sessionId)
    }),

  // Agent Loops handlers
  getLoopStatuses: t.procedure.action(async () => {
    return loopService.getLoopStatuses()
  }),

  startLoop: t.procedure
    .input<{ loopId: string }>()
    .action(async ({ input }) => {
      return { success: loopService.startLoop(input.loopId) }
    }),

  stopLoop: t.procedure
    .input<{ loopId: string }>()
    .action(async ({ input }) => {
      return { success: loopService.stopLoop(input.loopId) }
    }),

  triggerLoop: t.procedure
    .input<{ loopId: string }>()
    .action(async ({ input }) => {
      return { success: await loopService.triggerLoop(input.loopId) }
    }),

  startAllLoops: t.procedure.action(async () => {
    loopService.startAllLoops()
    return { success: true }
  }),

  stopAllLoops: t.procedure.action(async () => {
    loopService.stopAllLoops()
    return { success: true }
  }),
}

// TTS Provider Implementation Functions

async function generateOpenAITTS(
  text: string,
  input: { voice?: string; model?: string; speed?: number },
  config: Config
): Promise<ArrayBuffer> {
  const model = input.model || config.openaiTtsModel || "tts-1"
  const voice = input.voice || config.openaiTtsVoice || "alloy"
  const speed = input.speed || config.openaiTtsSpeed || 1.0
  const responseFormat = config.openaiTtsResponseFormat || "mp3"

  const baseUrl = config.openaiBaseUrl || "https://api.openai.com/v1"
  const apiKey = config.openaiApiKey



  if (!apiKey) {
    throw new Error("OpenAI API key is required for TTS")
  }

  const requestBody = {
    model,
    input: text,
    voice,
    speed,
    response_format: responseFormat,
  }



  const response = await fetch(`${baseUrl}/audio/speech`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  })



  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI TTS API error: ${response.statusText} - ${errorText}`)
  }

  const audioBuffer = await response.arrayBuffer()

  return audioBuffer
}

async function generateGroqTTS(
  text: string,
  input: { voice?: string; model?: string },
  config: Config
): Promise<ArrayBuffer> {
  const model = input.model || config.groqTtsModel || "canopylabs/orpheus-v1-english"
  // Choose default voice based on model - Arabic model should use Arabic voice
  const defaultVoice = model === "canopylabs/orpheus-arabic-saudi" ? "fahad" : "troy"
  const voice = input.voice || config.groqTtsVoice || defaultVoice

  const baseUrl = config.groqBaseUrl || "https://api.groq.com/openai/v1"
  const apiKey = config.groqApiKey



  if (!apiKey) {
    throw new Error("Groq API key is required for TTS")
  }

  const requestBody = {
    model,
    input: text,
    voice,
    response_format: "wav",
  }



  const response = await fetch(`${baseUrl}/audio/speech`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  })



  if (!response.ok) {
    const errorText = await response.text()

    // Check for specific error cases and provide helpful messages
    if (errorText.includes("requires terms acceptance")) {
      // The model parameter determines which terms page to show
      const modelParam = model === "canopylabs/orpheus-arabic-saudi"
        ? "canopylabs%2Forpheus-arabic-saudi"
        : "canopylabs%2Forpheus-v1-english"
      throw new Error(`Groq TTS model requires terms acceptance. Please visit https://console.groq.com/playground?model=${modelParam} and accept the terms when prompted, then try again.`)
    }

    throw new Error(`Groq TTS API error: ${response.statusText} - ${errorText}`)
  }

  const audioBuffer = await response.arrayBuffer()

  return audioBuffer
}

async function generateGeminiTTS(
  text: string,
  input: { voice?: string; model?: string },
  config: Config
): Promise<ArrayBuffer> {
  const model = input.model || config.geminiTtsModel || "gemini-2.5-flash-preview-tts"
  const voice = input.voice || config.geminiTtsVoice || "Kore"

  const baseUrl = config.geminiBaseUrl || "https://generativelanguage.googleapis.com"
  const apiKey = config.geminiApiKey

  if (!apiKey) {
    throw new Error("Gemini API key is required for TTS")
  }

  const requestBody = {
    contents: [{
      parts: [{ text }]
    }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: voice
          }
        }
      }
    }
  }

  const url = `${baseUrl}/v1beta/models/${model}:generateContent?key=${apiKey}`



  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  })



  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Gemini TTS API error: ${response.statusText} - ${errorText}`)
  }

  const result = await response.json()



  const audioData = result.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data

  if (!audioData) {
    throw new Error("No audio data received from Gemini TTS API")
  }

  // Convert base64 to ArrayBuffer
  const binaryString = atob(audioData)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }



  return bytes.buffer
}

export type Router = typeof router
