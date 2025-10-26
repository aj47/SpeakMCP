import fs from "fs"
import { getRendererHandlers, tipc } from "@egoist/tipc/main"
import {
  showPanelWindow,
  showMainWindow,
  WINDOWS,
  resizePanelForAgentMode,
  resizePanelToNormal,
  closeAgentModeAndHidePanelWindow,
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
} from "../shared/types"
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
import { state, agentProcessManager } from "./state"


import { startRemoteServer, stopRemoteServer, restartRemoteServer } from "./remote-server"

// Unified agent mode processing function
async function processWithAgentMode(
  text: string,
  conversationId?: string,
): Promise<string> {
  const config = configStore.get()

  // Set agent mode state
  state.isAgentModeActive = true
  state.shouldStopAgent = false
  state.agentIterationCount = 0

  try {
    if (!config.mcpToolsEnabled) {
      throw new Error("MCP tools are not enabled")
    }

    // Initialize MCP service if not already done
    await mcpService.initialize()

    // Register any existing MCP server processes with the agent process manager
    // This handles the case where servers were already initialized before agent mode was activated
    mcpService.registerExistingProcessesWithAgentManager()

    // Get available tools
    const availableTools = mcpService.getAvailableTools()

    if (config.mcpAgentModeEnabled) {
      // Use agent mode for iterative tool calling
      const executeToolCall = async (toolCall: any): Promise<MCPToolResult> => {
        return await mcpService.executeToolCall(toolCall)
      }

      // Load previous conversation history if continuing a conversation
      let previousConversationHistory:
        | Array<{
            role: "user" | "assistant" | "tool"
            content: string
            toolCalls?: any[]
            toolResults?: any[]
          }>
        | undefined

      if (conversationId) {
        const conversation =
          await conversationService.loadConversation(conversationId)

        if (conversation && conversation.messages.length > 0) {
          // Convert conversation messages to the format expected by agent mode
          // Exclude the last message since it's the current user input that will be added
          const messagesToConvert = conversation.messages.slice(0, -1)
          previousConversationHistory = messagesToConvert.map((msg) => ({
            role: msg.role,
            content: msg.content,
            toolCalls: msg.toolCalls,
            toolResults: msg.toolResults,
          }))
        }
      }

      const agentResult = await processTranscriptWithAgentMode(
        text,
        availableTools,
        executeToolCall,
        config.mcpMaxIterations ?? 10, // Use configured max iterations or default to 10
        previousConversationHistory,
        conversationId, // Pass conversation ID for progress updates
      )

      return agentResult.content
    } else {
      // Use single-shot tool calling
      const result = await processTranscriptWithTools(text, availableTools)

      if (result.toolCalls && result.toolCalls.length > 0) {
        // Execute tool calls and get results
        const toolResults: MCPToolResult[] = []

        for (const toolCall of result.toolCalls) {
          try {
            const toolResult = await mcpService.executeToolCall(toolCall)
            toolResults.push(toolResult)
          } catch (error) {
            toolResults.push({
              content: [
                {
                  type: "text",
                  text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
                },
              ],
              isError: true,
            })
          }
        }

        // Combine tool results into final response
        const toolResultTexts = toolResults
          .map((result) => result.content.map((item) => item.text).join("\n"))
          .join("\n\n")

        return result.content
          ? `${result.content}\n\n${toolResultTexts}`
          : toolResultTexts
      } else {
        return result.content || text
      }
    }
  } finally {
    // Clean up agent state
    state.isAgentModeActive = false
    state.shouldStopAgent = false
    state.agentIterationCount = 0
  }
}
import { diagnosticsService } from "./diagnostics"
import { updateTrayIcon } from "./tray"
import { isAccessibilityGranted } from "./utils"
import { writeText, writeTextWithFocusRestore } from "./keyboard"
import { preprocessTextForTTS, validateTTSText } from "./tts-preprocessing"


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

    panel?.hide()
  }),

  resizePanelForAgentMode: t.procedure.action(async () => {
    resizePanelForAgentMode()
  }),

  resizePanelToNormal: t.procedure.action(async () => {
    resizePanelToNormal()
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
    const { emergencyStopAgentMode } = await import("./window")
    await emergencyStopAgentMode()

    return { success: true, message: "Agent mode emergency stopped" }
  }),

  clearAgentProgress: t.procedure.action(async () => {
    const win = WINDOWS.get("panel")
    if (win) {
      getRendererHandlers<RendererHandlers>(win.webContents).clearAgentProgress.send()
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
    }>()
    .action(async ({ input }) => {
      const config = configStore.get()

      if (!config.mcpToolsEnabled) {
        // Fall back to regular text input processing
        return router.createTextInput({ text: input.text })
      }

      // Create or get conversation ID
      let conversationId = input.conversationId
      if (!conversationId) {
        const conversation = await conversationService.createConversation(
          input.text,
          "user",
        )
        conversationId = conversation.id
      } else {
        // Add user message to existing conversation
        await conversationService.addMessageToConversation(
          conversationId,
          input.text,
          "user",
        )
      }

      // Use unified agent mode processing
      const finalResponse = await processWithAgentMode(
        input.text,
        conversationId,
      )

      // Save to history
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
      if (config.mcpAutoPasteEnabled && state.focusedAppBeforeRecording) {
        setTimeout(async () => {
          try {
            await writeText(finalResponse)
          } catch (error) {
            // Ignore paste errors
          }
        }, config.mcpAutoPasteDelay || 1000)
      }

      // Return the conversation ID so frontend can use it
      return { conversationId }
    }),

  createMcpRecording: t.procedure
    .input<{
      recording: ArrayBuffer
      duration: number
      conversationId?: string
    }>()
    .action(async ({ input }) => {
      fs.mkdirSync(recordingsFolder, { recursive: true })

      const config = configStore.get()
      let transcript: string

      // Initialize MCP service if not already done
      await mcpService.initialize()

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

      // Use unified agent mode processing
      const finalResponse = await processWithAgentMode(
        transcript,
        conversationId,
      )


      // Save to history
      const history = getRecordingHistory()
      const item: RecordingHistoryItem = {
        id: Date.now().toString(),
        createdAt: Date.now(),
        duration: input.duration,
        transcript: finalResponse,
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

      // Agent mode result is displayed in GUI - no clipboard or pasting logic needed

      // Return the conversation ID so frontend can use it for subsequent requests
      return { conversationId }
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

  saveConfig: t.procedure
    .input<{ config: Config }>()
    .action(async ({ input }) => {
      const prev = configStore.get()
      const next = input.config
      const merged = { ...(prev as any), ...(next as any) } as Config

      // Persist config
      configStore.save(next)

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

      // Basic validation
      if (!mcpConfig.mcpServers || typeof mcpConfig.mcpServers !== "object") {
        throw new Error("Invalid MCP config: missing or invalid mcpServers")
      }

      // Validate each server config
      for (const [serverName, serverConfig] of Object.entries(
        mcpConfig.mcpServers,
      )) {
        if (!serverConfig.command || !Array.isArray(serverConfig.args)) {
          throw new Error(
            `Invalid server config for "${serverName}": missing command or args`,
          )
        }
      }

      return mcpConfig
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

        // Basic validation - same as file upload
        if (!mcpConfig.mcpServers || typeof mcpConfig.mcpServers !== "object") {
          throw new Error("Invalid MCP config: missing or invalid mcpServers")
        }

        // Validate each server config
        for (const [serverName, serverConfig] of Object.entries(
          mcpConfig.mcpServers,
        )) {
          if (!serverConfig.command || !Array.isArray(serverConfig.args)) {
            throw new Error(
              `Invalid server config for "${serverName}": missing command or args`,
            )
          }
        }

        return mcpConfig
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
        if (
          !input.config.mcpServers ||
          typeof input.config.mcpServers !== "object"
        ) {
          return { valid: false, error: "Missing or invalid mcpServers" }
        }

        for (const [serverName, serverConfig] of Object.entries(
          input.config.mcpServers,
        )) {
          if (!serverConfig.command) {
            return {
              valid: false,
              error: `Server "${serverName}": missing command`,
            }
          }
          if (!Array.isArray(serverConfig.args)) {
            return {
              valid: false,
              error: `Server "${serverName}": args must be an array`,
            }
          }
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
      const preprocessingOptions = {
        removeCodeBlocks: config.ttsRemoveCodeBlocks ?? true,
        removeUrls: config.ttsRemoveUrls ?? true,
        convertMarkdown: config.ttsConvertMarkdown ?? true,
      }

      const processedText = config.ttsPreprocessingEnabled !== false
        ? preprocessTextForTTS(input.text, preprocessingOptions)
        : input.text



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

  // Conversation Management
  getConversationHistory: t.procedure.action(async () => {
    return conversationService.getConversationHistory()
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

      // Apply minimum size constraints
      const minWidth = 200
      const minHeight = 100
      const finalWidth = Math.max(minWidth, input.width)
      const finalHeight = Math.max(minHeight, input.height)

      // Update size constraints to allow resizing
      win.setMinimumSize(minWidth, minHeight)
      win.setMaximumSize(finalWidth + 1000, finalHeight + 1000) // Allow growth

      // Set the actual size
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

  initializePanelSize: t.procedure.action(async () => {
    const win = WINDOWS.get("panel")
    if (!win) {
      throw new Error("Panel window not found")
    }

    const config = configStore.get()
    if (config.panelCustomSize) {
      // Apply saved custom size
      const { width, height } = config.panelCustomSize
      const finalWidth = Math.max(200, width)
      const finalHeight = Math.max(100, height)

      win.setMinimumSize(200, 100)
      win.setSize(finalWidth, finalHeight, false) // no animation on init
      return { width: finalWidth, height: finalHeight }
    }

    // Return current size if no custom size saved
    const [width, height] = win.getSize()
    return { width, height }
  }),

  // Profile Management
  getProfiles: t.procedure.action(async () => {
    const { profileService } = await import("./profile-service")
    return profileService.getProfiles()
  }),

  getProfile: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
      const { profileService } = await import("./profile-service")
      return profileService.getProfile(input.id)
    }),

  getCurrentProfile: t.procedure.action(async () => {
    const { profileService } = await import("./profile-service")
    return profileService.getCurrentProfile()
  }),

  createProfile: t.procedure
    .input<{ name: string; guidelines: string }>()
    .action(async ({ input }) => {
      const { profileService } = await import("./profile-service")
      return profileService.createProfile(input.name, input.guidelines)
    }),

  updateProfile: t.procedure
    .input<{ id: string; name?: string; guidelines?: string }>()
    .action(async ({ input }) => {
      const { profileService } = await import("./profile-service")
      const updates: any = {}
      if (input.name !== undefined) updates.name = input.name
      if (input.guidelines !== undefined) updates.guidelines = input.guidelines
      return profileService.updateProfile(input.id, updates)
    }),

  deleteProfile: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
      const { profileService } = await import("./profile-service")
      return profileService.deleteProfile(input.id)
    }),

  setCurrentProfile: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
      const { profileService } = await import("./profile-service")
      const profile = profileService.setCurrentProfile(input.id)

      // Update the config with the profile's guidelines
      const config = configStore.get()
      const updatedConfig = {
        ...config,
        mcpToolsSystemPrompt: profile.guidelines,
        mcpCurrentProfileId: profile.id,
      }
      configStore.save(updatedConfig)

      return profile
    }),

  exportProfile: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
      const { profileService } = await import("./profile-service")
      return profileService.exportProfile(input.id)
    }),

  importProfile: t.procedure
    .input<{ profileJson: string }>()
    .action(async ({ input }) => {
      const { profileService } = await import("./profile-service")
      return profileService.importProfile(input.profileJson)
    }),

  saveProfileFile: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
      const { profileService } = await import("./profile-service")
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
      const { profileService } = await import("./profile-service")
      return profileService.importProfile(profileJson)
    } catch (error) {
      throw new Error(
        `Failed to import profile: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
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
  const model = input.model || config.groqTtsModel || "playai-tts"
  const voice = input.voice || config.groqTtsVoice || "Fritz-PlayAI"

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
      throw new Error("Groq TTS model requires terms acceptance. Please visit https://console.groq.com/playground?model=playai-tts to accept the terms for the PlayAI TTS model.")
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
