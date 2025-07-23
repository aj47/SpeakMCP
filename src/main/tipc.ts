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
import { Config, RecordingHistoryItem, MCPConfig, MCPServerConfig } from "../shared/types"
import { RendererHandlers } from "./renderer-handlers"
import { postProcessTranscript, processTranscriptWithTools, processTranscriptWithAgentMode } from "./llm"
import { mcpService, MCPToolResult } from "./mcp-service"
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

  createMcpRecording: t.procedure
    .input<{
      recording: ArrayBuffer
      duration: number
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

      // Process transcript with MCP tools
      const availableTools = mcpService.getAvailableTools()

      let finalResponse = ""

      // Check if agent mode is enabled
      if (config.mcpAgentModeEnabled) {
        console.log("[MCP-AGENT] 🤖 Agent mode enabled, using agent processing...")

        const agentResponse = await processTranscriptWithAgentMode(
          transcript,
          availableTools,
          (toolCall) => mcpService.executeToolCall(toolCall),
          10 // max iterations
        )

        finalResponse = agentResponse.content
        console.log(`[MCP-AGENT] ✅ Agent processing completed in ${agentResponse.totalIterations} iterations`)
        console.log(`[MCP-AGENT] Final response length: ${finalResponse.length}`)
        console.log(`[MCP-AGENT] Final response preview: "${finalResponse.substring(0, 100)}..."`)
        console.log(`[MCP-AGENT] Conversation history length: ${agentResponse.conversationHistory.length} entries`)
        console.log(`[MCP-AGENT] Final response will be displayed in GUI`)
      } else {
        const llmResponse = await processTranscriptWithTools(transcript, availableTools)

        // Execute tool calls if any
        if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
          const toolResults: MCPToolResult[] = []

          for (const toolCall of llmResponse.toolCalls) {
            const result = await mcpService.executeToolCall(toolCall)
            toolResults.push(result)
          }

          // Combine tool results into final response
          const toolResultTexts = toolResults.map(result =>
            result.content.map(c => c.text).join('\n')
          ).join('\n\n')

          finalResponse = llmResponse.content
            ? `${llmResponse.content}\n\n${toolResultTexts}`
            : toolResultTexts
        } else {
          finalResponse = llmResponse.content || transcript
        }
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

      // Note: Panel hiding is handled by the frontend progress component
      // to ensure proper timing with the progress visualization
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
}

export type Router = typeof router
