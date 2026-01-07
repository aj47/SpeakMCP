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
  MIN_WAVEFORM_WIDTH,
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
async function processQueuedMessages(conversationId: string): Promise<void> {

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
      const success = toolApprovalManager.respondToApproval(input.approvalId, input.approved)
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

  createRecording: t.procedure
    .input<{
      recording: ArrayBuffer
      duration: number
    }>()
    .action(async ({ input }) => {
      fs.mkdirSync(recordingsFolder, { recursive: true })

      const config = configStore.get()
      let transcript: string

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
      try {
        const prevWhatsappEnabled = !!(prev as any)?.whatsappEnabled
        const nextWhatsappEnabled = !!(merged as any)?.whatsappEnabled
        const WHATSAPP_SERVER_NAME = "whatsapp"

        if (prevWhatsappEnabled !== nextWhatsappEnabled) {
          const currentMcpConfig = merged.mcpConfig || { mcpServers: {} }
          const hasWhatsappServer = !!currentMcpConfig.mcpServers?.[WHATSAPP_SERVER_NAME]

          if (nextWhatsappEnabled) {
            // WhatsApp is being enabled
            const { mcpService } = await import("./mcp-service")
            if (!hasWhatsappServer) {
              // Auto-add WhatsApp MCP server when enabled
              // Determine the path to the WhatsApp MCP server
              // In development: use the monorepo packages path
              // In production: the package should be bundled with the app
              let whatsappServerPath: string
              if (process.env.NODE_ENV === "development" || process.env.ELECTRON_RENDERER_URL) {
                // Development: use path relative to the monorepo root
                whatsappServerPath = path.resolve(app.getAppPath(), "../../packages/mcp-whatsapp/dist/index.js")
              } else {
                // Production: use path relative to app resources
                // The WhatsApp MCP package should be bundled in extraResources
                whatsappServerPath = path.join(process.resourcesPath || app.getAppPath(), "mcp-whatsapp/dist/index.js")
              }

              const updatedMcpConfig: MCPConfig = {
                ...currentMcpConfig,
                mcpServers: {
                  ...currentMcpConfig.mcpServers,
                  [WHATSAPP_SERVER_NAME]: {
                    command: "node",
                    args: [whatsappServerPath],
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
          const remoteServerSettingsChanged = (merged as any)?.whatsappAutoReply && (
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
    }),

  recordEvent: t.procedure
    .input<{ type: "start" | "end" }>()
    .action(async ({ input }) => {
      if (input.type === "start") {
        state.isRecording = true
      } else {
        state.isRecording = false
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

  // MCP Registry
  fetchMcpRegistryServers: t.procedure
    .input<{ search?: string; forceRefresh?: boolean }>()
    .action(async ({ input }) => {
      const { fetchRegistryServers } = await import("./mcp-registry")
      return fetchRegistryServers(input)
    }),

  clearMcpRegistryCache: t.procedure.action(async () => {
    const { clearRegistryCache } = await import("./mcp-registry")
    clearRegistryCache()
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
      const minHeight = WAVEFORM_MIN_HEIGHT
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
      const config = configStore.get()
      const updatedConfig = {
        ...config,
        panelCustomSize: { width: input.width, height: input.height }
      }
      configStore.save(updatedConfig)
      return updatedConfig.panelCustomSize
    }),

  // Save panel size (unified across all modes)
  savePanelModeSize: t.procedure
    .input<{ mode: "normal" | "agent" | "textInput"; width: number; height: number }>()
    .action(async ({ input }) => {
      const config = configStore.get()
      const updatedConfig = { ...config }

      // Save to unified panelCustomSize regardless of mode
      updatedConfig.panelCustomSize = { width: input.width, height: input.height }

      configStore.save(updatedConfig)
      return { mode: input.mode, size: { width: input.width, height: input.height } }
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
    return profileService.getProfiles()
  }),

  getProfile: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
        return profileService.getProfile(input.id)
    }),

  getCurrentProfile: t.procedure.action(async () => {
    return profileService.getCurrentProfile()
  }),

  // Get the default system prompt for restore functionality
  getDefaultSystemPrompt: t.procedure.action(async () => {
    const { DEFAULT_SYSTEM_PROMPT } = await import("./system-prompts")
    return DEFAULT_SYSTEM_PROMPT
  }),

  createProfile: t.procedure
    .input<{ name: string; guidelines: string; systemPrompt?: string }>()
    .action(async ({ input }) => {
        return profileService.createProfile(input.name, input.guidelines, input.systemPrompt)
    }),

  updateProfile: t.procedure
    .input<{ id: string; name?: string; guidelines?: string; systemPrompt?: string }>()
    .action(async ({ input }) => {
        const updates: any = {}
      if (input.name !== undefined) updates.name = input.name
      if (input.guidelines !== undefined) updates.guidelines = input.guidelines
      if (input.systemPrompt !== undefined) updates.systemPrompt = input.systemPrompt
      const updatedProfile = profileService.updateProfile(input.id, updates)

      // If the updated profile is the current profile, sync guidelines to live config
      const currentProfile = profileService.getCurrentProfile()
      if (currentProfile && currentProfile.id === input.id && input.guidelines !== undefined) {
        const config = configStore.get()
        configStore.save({
          ...config,
          mcpToolsSystemPrompt: input.guidelines,
        })
      }

      return updatedProfile
    }),

  deleteProfile: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
        return profileService.deleteProfile(input.id)
    }),

  setCurrentProfile: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
        const profile = profileService.setCurrentProfile(input.id)

      // Update the config with the profile's guidelines, system prompt, and model config
      const config = configStore.get()
      const updatedConfig = {
        ...config,
        mcpToolsSystemPrompt: profile.guidelines,
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
      // If the profile has no mcpServerConfig, we pass empty arrays to reset to default (all enabled)
      mcpService.applyProfileMcpConfig(
        profile.mcpServerConfig?.disabledServers ?? [],
        profile.mcpServerConfig?.disabledTools ?? [],
        profile.mcpServerConfig?.allServersDisabledByDefault ?? false,
        profile.mcpServerConfig?.enabledServers ?? []
      )

      return profile
    }),

  exportProfile: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
        return profileService.exportProfile(input.id)
    }),

  importProfile: t.procedure
    .input<{ profileJson: string }>()
    .action(async ({ input }) => {
        return profileService.importProfile(input.profileJson)
    }),

  // Save current MCP server state to a profile
  saveCurrentMcpStateToProfile: t.procedure
    .input<{ profileId: string }>()
    .action(async ({ input }) => {
  
      const currentState = mcpService.getCurrentMcpConfigState()
      return profileService.saveCurrentMcpStateToProfile(
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
        return profileService.updateProfileMcpConfig(input.profileId, {
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
      return profileService.saveCurrentModelStateToProfile(input.profileId, {
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
      sttProviderId?: "openai" | "groq"
      // Transcript Post-Processing settings
      transcriptPostProcessingProviderId?: "openai" | "groq" | "gemini"
      transcriptPostProcessingOpenaiModel?: string
      transcriptPostProcessingGroqModel?: string
      transcriptPostProcessingGeminiModel?: string
      // TTS Provider settings
      ttsProviderId?: "openai" | "groq" | "gemini"
    }>()
    .action(async ({ input }) => {
        return profileService.updateProfileModelConfig(input.profileId, {
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
        const profileJson = profileService.exportProfile(input.id)

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
        return profileService.importProfile(profileJson)
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

  stopCloudflareTunnel: t.procedure.action(async () => {
    const { stopCloudflareTunnel } = await import("./cloudflare-tunnel")
    return stopCloudflareTunnel()
  }),

  getCloudflareTunnelStatus: t.procedure.action(async () => {
    const { getCloudflareTunnelStatus } = await import("./cloudflare-tunnel")
    return getCloudflareTunnelStatus()
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
      throw new Error("Groq TTS model requires terms acceptance. Please visit https://console.groq.com/playground to accept the terms for the Orpheus TTS model.")
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
