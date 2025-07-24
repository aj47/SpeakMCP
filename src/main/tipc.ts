import fs from "fs"
import { getRendererHandlers, tipc } from "@egoist/tipc/main"
import { showPanelWindow, WINDOWS, resizePanelForAgentMode, resizePanelToNormal } from "./window"
import {
  app,
  clipboard,
  Menu,
  shell,
  systemPreferences,
  dialog,
} from "electron"
import path from "path"
import { configStore, recordingsFolder } from "./config"
import { Config, RecordingHistoryItem, MCPConfig, MCPServerConfig, Conversation, ConversationHistoryItem } from "../shared/types"
import { conversationService } from "./conversation-service"
import { RendererHandlers } from "./renderer-handlers"
import { postProcessTranscript, processTranscriptWithTools, processTranscriptWithAgentMode } from "./llm"
import { mcpService, MCPToolResult } from "./mcp-service"

// Unified agent mode processing function
async function processWithAgentMode(
  text: string,
  conversationId?: string
): Promise<string> {
  const config = configStore.get()

  console.log(`[UNIFIED-AGENT-DEBUG] 🚀 processWithAgentMode called`)
  console.log(`[UNIFIED-AGENT-DEBUG] 📝 Text: "${text.substring(0, 100)}..."`)
  console.log(`[UNIFIED-AGENT-DEBUG] 🆔 ConversationId: ${conversationId || 'undefined'}`)

  if (!config.mcpToolsEnabled) {
    throw new Error("MCP tools are not enabled")
  }

  // Initialize MCP service if not already done
  await mcpService.initialize()

  // Get available tools
  const availableTools = mcpService.getAvailableTools()

  if (config.mcpAgentModeEnabled) {
    // Use agent mode for iterative tool calling
    const executeToolCall = async (toolCall: any): Promise<MCPToolResult> => {
      return await mcpService.executeToolCall(toolCall)
    }

    // Load previous conversation history if continuing a conversation
    let previousConversationHistory: Array<{
      role: "user" | "assistant" | "tool"
      content: string
      toolCalls?: any[]
      toolResults?: any[]
    }> | undefined

    console.log(`[UNIFIED-AGENT-DEBUG] 🔍 Checking conversation context...`)
    if (conversationId) {
      console.log(`[UNIFIED-AGENT-DEBUG] 📂 Loading conversation: ${conversationId}`)
      const conversation = await conversationService.loadConversation(conversationId)
      console.log(`[UNIFIED-AGENT-DEBUG] 📋 Loaded conversation:`, conversation ? `${conversation.messages.length} messages` : 'null')

      if (conversation && conversation.messages.length > 0) {
        // Convert conversation messages to the format expected by agent mode
        // Exclude the last message since it's the current user input that will be added
        const messagesToConvert = conversation.messages.slice(0, -1)
        previousConversationHistory = messagesToConvert.map(msg => ({
          role: msg.role,
          content: msg.content,
          toolCalls: msg.toolCalls,
          toolResults: msg.toolResults
        }))

        console.log(`[UNIFIED-AGENT-DEBUG] ✅ Converted ${previousConversationHistory.length} messages for agent mode`)
        console.log(`[MCP-AGENT] 📚 Loaded ${previousConversationHistory.length} previous messages from conversation ${conversationId}`)
      } else {
        console.log(`[UNIFIED-AGENT-DEBUG] ❌ No conversation found or empty conversation`)
      }
    } else {
      console.log(`[UNIFIED-AGENT-DEBUG] ❌ No conversationId provided - starting fresh conversation`)
    }

    const agentResult = await processTranscriptWithAgentMode(
      text,
      availableTools,
      executeToolCall,
      10, // maxIterations
      previousConversationHistory
    )

    console.log(`[MCP-AGENT] ✅ Agent processing completed in ${agentResult.totalIterations} iterations`)
    console.log(`[MCP-AGENT] Final response length: ${agentResult.content.length}`)
    console.log(`[MCP-AGENT] Final response preview: "${agentResult.content.substring(0, 100)}..."`)
    console.log(`[MCP-AGENT] Conversation history length: ${agentResult.conversationHistory.length} entries`)

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
          console.error(`Tool call failed for ${toolCall.name}:`, error)
          toolResults.push({
            content: [{
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
            }],
            isError: true
          })
        }
      }

      // Combine tool results into final response
      const toolResultTexts = toolResults.map(result =>
        result.content.map(item => item.text).join('\n')
      ).join('\n\n')

      return result.content
        ? `${result.content}\n\n${toolResultTexts}`
        : toolResultTexts
    } else {
      return result.content || text
    }
  }
}
import { diagnosticsService } from "./diagnostics"
import { state } from "./state"
import { updateTrayIcon } from "./tray"
import { isAccessibilityGranted } from "./utils"
import { writeText, writeTextWithFocusRestore } from "./keyboard"


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
    console.log("[MCP-AGENT-DEBUG] 📞 TIPC call: resizePanelForAgentMode")
    resizePanelForAgentMode()
  }),

  resizePanelToNormal: t.procedure.action(async () => {
    console.log("[MCP-AGENT-DEBUG] 📞 TIPC call: resizePanelToNormal")
    resizePanelToNormal()
  }),

  debugPanelState: t.procedure.action(async () => {
    const panel = WINDOWS.get("panel")
    const state = {
      exists: !!panel,
      isVisible: panel?.isVisible() || false,
      isDestroyed: panel?.isDestroyed() || false,
      bounds: panel?.getBounds() || null,
      isAlwaysOnTop: panel?.isAlwaysOnTop() || false
    }
    return state
  }),

  showContextMenu: t.procedure
    .input<{ x: number; y: number; selectedText?: string }>()
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

  displayError: t.procedure
    .input<{ title?: string; message: string }>()
    .action(async ({ input }) => {
      dialog.showErrorBox(input.title || "Error", input.message)
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
            console.log(`[FOCUS] 📝 Pasting regular transcript with focus restoration`)
            await writeTextWithFocusRestore(transcript)
          } catch (error) {
            console.error(`Failed to write text:`, error)
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
          console.error("Text post-processing failed:", error)
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
        console.log(`[TEXT-INPUT] 📋 Auto-pasting text to: ${state.focusedAppBeforeRecording}`)

        setTimeout(async () => {
          try {
            await writeText(processedText)
            console.log(`[TEXT-INPUT] ✅ Successfully pasted text`)
          } catch (error) {
            console.error(`[TEXT-INPUT] ❌ Failed to paste text:`, error)
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

      // Use unified agent mode processing
      const finalResponse = await processWithAgentMode(input.text, input.conversationId)

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
        console.log(`[MCP-TEXT-INPUT] 📋 Auto-pasting result to: ${state.focusedAppBeforeRecording}`)

        setTimeout(async () => {
          try {
            await writeText(finalResponse)
            console.log(`[MCP-TEXT-INPUT] ✅ Successfully pasted result`)
          } catch (error) {
            console.error(`[MCP-TEXT-INPUT] ❌ Failed to paste result:`, error)
          }
        }, config.mcpAutoPasteDelay || 1000)
      }
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
        console.log(`[MCP-CONVERSATION-DEBUG] 🆕 Creating new conversation for voice input`)
        conversation = await conversationService.createConversation(transcript, "user")
        conversationId = conversation.id
        console.log(`[MCP-CONVERSATION-DEBUG] ✅ Created conversation: ${conversationId}`)
      } else {
        // Load existing conversation and add user message
        console.log(`[MCP-CONVERSATION-DEBUG] 📂 Loading existing conversation: ${conversationId}`)
        conversation = await conversationService.loadConversation(conversationId)
        if (conversation) {
          await conversationService.addMessageToConversation(conversationId, transcript, "user")
          console.log(`[MCP-CONVERSATION-DEBUG] ✅ Added user message to conversation`)
        } else {
          console.log(`[MCP-CONVERSATION-DEBUG] ❌ Conversation not found, creating new one`)
          conversation = await conversationService.createConversation(transcript, "user")
          conversationId = conversation.id
        }
      }

      // Use unified agent mode processing
      console.log("[MCP-AGENT] 🤖 Agent mode enabled, using agent processing...")
      console.log(`[MCP-RECORDING-DEBUG] 📝 Transcript: "${transcript.substring(0, 100)}..."`)
      console.log(`[MCP-RECORDING-DEBUG] 🆔 ConversationId from input: ${input.conversationId || 'undefined'}`)
      console.log(`[MCP-RECORDING-DEBUG] 🆔 Using conversationId: ${conversationId}`)
      const finalResponse = await processWithAgentMode(transcript, conversationId)
      console.log(`[MCP-AGENT] Final response will be displayed in GUI`)

      // Add assistant response to conversation
      if (conversationId) {
        await conversationService.addMessageToConversation(conversationId, finalResponse, "assistant")
        console.log(`[MCP-CONVERSATION-DEBUG] ✅ Added assistant response to conversation`)
      }

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
      console.log(`[MCP-AGENT] ✅ Agent processing completed, result displayed in GUI`)
      console.log(`[MCP-AGENT] 📋 Result will remain visible until user presses ESC to close`)

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
      configStore.save(input.config)
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
    console.log("[TEXT-INPUT-DEBUG] 🔄 Text input state cleared")
  }),

  // MCP Config File Operations
  loadMcpConfigFile: t.procedure.action(async () => {
    const result = await dialog.showOpenDialog({
      title: "Load MCP Configuration",
      filters: [
        { name: "JSON Files", extensions: ["json"] },
        { name: "All Files", extensions: ["*"] }
      ],
      properties: ["openFile"]
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
      for (const [serverName, serverConfig] of Object.entries(mcpConfig.mcpServers)) {
        if (!serverConfig.command || !Array.isArray(serverConfig.args)) {
          throw new Error(`Invalid server config for "${serverName}": missing command or args`)
        }
      }

      return mcpConfig
    } catch (error) {
      throw new Error(`Failed to load MCP config: ${error instanceof Error ? error.message : String(error)}`)
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
          { name: "All Files", extensions: ["*"] }
        ]
      })

      if (result.canceled || !result.filePath) {
        return false
      }

      try {
        fs.writeFileSync(result.filePath, JSON.stringify(input.config, null, 2))
        return true
      } catch (error) {
        throw new Error(`Failed to save MCP config: ${error instanceof Error ? error.message : String(error)}`)
      }
    }),

  validateMcpConfig: t.procedure
    .input<{ config: MCPConfig }>()
    .action(async ({ input }) => {
      try {
        if (!input.config.mcpServers || typeof input.config.mcpServers !== "object") {
          return { valid: false, error: "Missing or invalid mcpServers" }
        }

        for (const [serverName, serverConfig] of Object.entries(input.config.mcpServers)) {
          if (!serverConfig.command) {
            return { valid: false, error: `Server "${serverName}": missing command` }
          }
          if (!Array.isArray(serverConfig.args)) {
            return { valid: false, error: `Server "${serverName}": args must be an array` }
          }
          if (serverConfig.env && typeof serverConfig.env !== "object") {
            return { valid: false, error: `Server "${serverName}": env must be an object` }
          }
          if (serverConfig.timeout && typeof serverConfig.timeout !== "number") {
            return { valid: false, error: `Server "${serverName}": timeout must be a number` }
          }
          if (serverConfig.disabled && typeof serverConfig.disabled !== "boolean") {
            return { valid: false, error: `Server "${serverName}": disabled must be a boolean` }
          }
        }

        return { valid: true }
      } catch (error) {
        return { valid: false, error: error instanceof Error ? error.message : String(error) }
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

  getMcpDisabledTools: t.procedure.action(async () => {
    return mcpService.getDisabledTools()
  }),

  // Diagnostics endpoints
  getDiagnosticReport: t.procedure.action(async () => {
    try {
      return await diagnosticsService.generateDiagnosticReport()
    } catch (error) {
      diagnosticsService.logError('tipc', 'Failed to generate diagnostic report', error)
      throw error
    }
  }),

  saveDiagnosticReport: t.procedure
    .input<{ filePath?: string }>()
    .action(async ({ input }) => {
      try {
        const savedPath = await diagnosticsService.saveDiagnosticReport(input.filePath)
        return { success: true, filePath: savedPath }
      } catch (error) {
        diagnosticsService.logError('tipc', 'Failed to save diagnostic report', error)
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    }),

  performHealthCheck: t.procedure.action(async () => {
    try {
      return await diagnosticsService.performHealthCheck()
    } catch (error) {
      diagnosticsService.logError('tipc', 'Failed to perform health check', error)
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
      return mcpService.testServerConnection(input.serverName, input.serverConfig)
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
      return conversationService.createConversation(input.firstMessage, input.role)
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
        input.toolResults
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
}

export type Router = typeof router
