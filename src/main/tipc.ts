import fs from "fs"
import { getRendererHandlers, tipc } from "@egoist/tipc/main"
import { showPanelWindow, WINDOWS } from "./window"
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
import { configStore, recordingsFolder } from "./config"
import { Config, RecordingHistoryItem, MCPConfig, MCPServerConfig, AuthState, User } from "../shared/types"

// Helper function to set auth token (to avoid circular reference)
async function setAuthTokenHelper(token: string): Promise<{ success: boolean; user: User }> {
  try {
    const isDevelopment = process.env.NODE_ENV === 'development' || !app.isPackaged
    const baseUrl = isDevelopment
      ? "http://localhost:8787"
      : "https://api.speakmcp.com"

    const response = await fetch(`${baseUrl}/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      throw new Error("Invalid token")
    }

    const user: User = await response.json()

    // Save to config
    const config = configStore.get()
    configStore.save({
      ...config,
      authToken: token,
      user,
    })

    return { success: true, user }
  } catch (error) {
    throw new Error("Failed to authenticate: " + (error as Error).message)
  }
}
import { RendererHandlers } from "./renderer-handlers"
import { postProcessTranscript, processTranscriptWithTools } from "./llm"
import { mcpService, MCPToolResult } from "./mcp-service"
import { state } from "./state"
import { updateTrayIcon } from "./tray"
import { isAccessibilityGranted } from "./utils"
import { writeText } from "./keyboard"


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


  // Authentication methods
  getAuthState: t.procedure.action(async () => {
    const config = configStore.get()
    return {
      user: config.user || null,
      token: config.authToken || null,
    } as AuthState
  }),

  initiateLogin: t.procedure.action(async () => {
    return new Promise((resolve, reject) => {
      const http = require('http')
      const { URL } = require('url')

      // Create a temporary HTTP server to receive the OAuth callback
      const server = http.createServer((req: any, res: any) => {
        const url = new URL(req.url, `http://localhost`)

        if (url.pathname === '/auth/callback') {
          const token = url.searchParams.get('token')
          const error = url.searchParams.get('error')

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html' })
            res.end(`
              <html>
                <body>
                  <h1>Authentication Failed</h1>
                  <p>Error: ${error}</p>
                  <p>You can close this window.</p>
                </body>
              </html>
            `)
            server.close()
            reject(new Error(`Authentication failed: ${error}`))
            return
          }

          if (token) {
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end(`
              <html>
                <body>
                  <h1>Authentication Successful!</h1>
                  <p>You can close this window and return to SpeakMCP.</p>
                  <script>
                    // Auto-close after 2 seconds
                    setTimeout(() => window.close(), 2000)
                  </script>
                </body>
              </html>
            `)

            // Save the token using helper function
            setAuthTokenHelper(token).then(() => {
              server.close()
              resolve({ success: true })
            }).catch((error) => {
              server.close()
              reject(error)
            })
          } else {
            res.writeHead(400, { 'Content-Type': 'text/html' })
            res.end(`
              <html>
                <body>
                  <h1>Authentication Failed</h1>
                  <p>No token received</p>
                  <p>You can close this window.</p>
                </body>
              </html>
            `)
            server.close()
            reject(new Error('No token received'))
          }
        } else {
          res.writeHead(404)
          res.end('Not found')
        }
      })

      const startOAuthFlow = (port: number) => {
        // Use local development URL in development, production URL in production
        const isDevelopment = process.env.NODE_ENV === 'development' || !app.isPackaged
        const baseUrl = isDevelopment
          ? "http://localhost:8787"
          : "https://api.speakmcp.com"

        // Create OAuth URL with our local callback
        const callbackUrl = `http://localhost:${port}/auth/callback`
        const authUrl = `${baseUrl}/auth/google?callback=${encodeURIComponent(callbackUrl)}`

        console.log(`Starting OAuth flow with callback: ${callbackUrl}`)

        // Open in user's default browser
        shell.openExternal(authUrl)

        // Set a timeout to close the server if no response
        setTimeout(() => {
          if (server.listening) {
            server.close()
            reject(new Error('Authentication timeout - no response received'))
          }
        }, 300000) // 5 minutes timeout
      }

      // Start server on a fixed port for OAuth callback
      const OAUTH_CALLBACK_PORT = 8789
      server.listen(OAUTH_CALLBACK_PORT, 'localhost', () => {
        const address = server.address()
        const port = address?.port

        if (!port) {
          reject(new Error('Failed to start local server'))
          return
        }

        startOAuthFlow(port)
      })

      server.on('error', (error: any) => {
        if (error.code === 'EADDRINUSE') {
          // Port is in use, try a few alternative ports
          const altPorts = [8789, 8790, 8791, 8792]
          let portIndex = 0

          const tryNextPort = () => {
            if (portIndex >= altPorts.length) {
              reject(new Error('All OAuth callback ports are in use. Please close other applications and try again.'))
              return
            }

            const nextPort = altPorts[portIndex++]
            server.listen(nextPort, 'localhost', () => {
              const address = server.address()
              const port = address?.port

              if (!port) {
                reject(new Error('Failed to start local server'))
                return
              }

              startOAuthFlow(port)
            })
          }

          tryNextPort()
        } else {
          reject(new Error(`Server error: ${error.message}`))
        }
      })
    })
  }),

  setAuthToken: t.procedure
    .input<{ token: string }>()
    .action(async ({ input }) => {
      return setAuthTokenHelper(input.token)
    }),

  logout: t.procedure.action(async () => {
    const config = configStore.get()
    configStore.save({
      ...config,
      authToken: undefined,
      user: undefined,
    })
    return { success: true }
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
        try {
          await writeText(transcript)
        } catch (error) {
          console.error(`Failed to write text:`, error)
          // Don't throw here, just log the error so the recording still gets saved
        }
      }
    }),

  createMcpRecording: t.procedure
    .input<{
      recording: ArrayBuffer
      duration: number
    }>()
    .action(async ({ input }) => {
      console.log(`[MCP-DEBUG] 🎬 Starting MCP recording processing, duration: ${input.duration}ms, audio size: ${input.recording.byteLength} bytes`)

      fs.mkdirSync(recordingsFolder, { recursive: true })

      const config = configStore.get()
      let transcript: string

      // Initialize MCP service if not already done
      console.log("[MCP-DEBUG] Initializing MCP service...")
      await mcpService.initialize()

      // First, transcribe the audio using the same logic as regular recording
      console.log(`[MCP-DEBUG] 🎤 Starting transcription using provider: ${config.sttProviderId}`)

      if (config.sttProviderId === "lightning-whisper-mlx") {
        try {
          console.log("[MCP-DEBUG] Using Lightning Whisper MLX for transcription")
          const result = await transcribeWithLightningWhisper(input.recording, {
            model: config.lightningWhisperMlxModel || "distil-medium.en",
            batchSize: config.lightningWhisperMlxBatchSize || 12,
            quant: config.lightningWhisperMlxQuant || null,
          })

          if (!result.success) {
            throw new Error(result.error || "Lightning Whisper MLX transcription failed")
          }

          transcript = result.text || ""
          console.log(`[MCP-DEBUG] ✅ Lightning Whisper transcription successful: "${transcript}"`)
        } catch (error) {
          console.error("[MCP-DEBUG] ❌ Lightning Whisper MLX failed, falling back to OpenAI:", error)

          // Fallback to OpenAI if lightning-whisper-mlx fails
          const form = new FormData()
          form.append(
            "file",
            new File([input.recording], "recording.webm", { type: "audio/webm" }),
          )
          form.append("model", "whisper-1")
          form.append("response_format", "json")

          const openaiBaseUrl = config.openaiBaseUrl || "https://api.openai.com/v1"

          const transcriptResponse = await fetch(
            `${openaiBaseUrl}/audio/transcriptions`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${config.openaiApiKey}`,
              },
              body: form,
            },
          )

          if (!transcriptResponse.ok) {
            const message = `Fallback transcription failed: ${transcriptResponse.statusText} ${(await transcriptResponse.text()).slice(0, 300)}`
            throw new Error(message)
          }

          const json: { text: string } = await transcriptResponse.json()
          transcript = json.text
          console.log(`[MCP-DEBUG] ✅ Fallback OpenAI transcription successful: "${transcript}"`)
        }
      } else {
        // Use OpenAI or Groq for transcription
        console.log(`[MCP-DEBUG] Using ${config.sttProviderId} for transcription`)
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
        console.log(`[MCP-DEBUG] ✅ ${config.sttProviderId} transcription successful: "${transcript}"`)
      }

      // Process transcript with MCP tools
      console.log("[MCP-DEBUG] 🔧 Getting available tools and processing with LLM...")
      const availableTools = mcpService.getAvailableTools()
      console.log(`[MCP-DEBUG] Available tools for processing: ${availableTools.map(t => t.name).join(', ')}`)

      const llmResponse = await processTranscriptWithTools(transcript, availableTools)
      console.log("[MCP-DEBUG] 📝 LLM processing completed:")
      console.log(`[MCP-DEBUG] - Has content: ${!!llmResponse.content}`)
      console.log(`[MCP-DEBUG] - Has toolCalls: ${!!llmResponse.toolCalls}`)
      console.log(`[MCP-DEBUG] - Number of toolCalls: ${llmResponse.toolCalls?.length || 0}`)
      if (llmResponse.toolCalls) {
        console.log(`[MCP-DEBUG] - Tool names: ${llmResponse.toolCalls.map(tc => tc.name).join(', ')}`)
      }

      let finalResponse = ""

      // Execute tool calls if any
      if (llmResponse.toolCalls && llmResponse.toolCalls.length > 0) {
        console.log(`[MCP-DEBUG] 🔧 Executing ${llmResponse.toolCalls.length} tool calls:`,
          llmResponse.toolCalls.map(tc => tc.name))

        const toolResults: MCPToolResult[] = []

        for (const toolCall of llmResponse.toolCalls) {
          console.log(`[MCP-DEBUG] Executing tool: ${toolCall.name}`)
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

        console.log(`[MCP-DEBUG] ✅ Tool execution completed, final response length: ${finalResponse.length}`)
        console.log(`[MCP-DEBUG] Final response preview: "${finalResponse.substring(0, 100)}..."`)
      } else {
        console.log("[MCP-DEBUG] No tool calls needed, using LLM response or original transcript")
        finalResponse = llmResponse.content || transcript
        console.log(`[MCP-DEBUG] Using ${llmResponse.content ? 'LLM content' : 'original transcript'} as final response`)
        console.log(`[MCP-DEBUG] Final response preview: "${finalResponse.substring(0, 100)}..."`)
      }

      // Save to history (optional - we might want to track MCP recordings separately)
      console.log("[MCP-DEBUG] 💾 Saving MCP recording to history...")
      const history = getRecordingHistory()
      const item: RecordingHistoryItem = {
        id: Date.now().toString(),
        createdAt: Date.now(),
        duration: input.duration,
        transcript: finalResponse,
      }
      history.push(item)
      saveRecordingsHitory(history)

      console.log(`[MCP-DEBUG] Saving audio file: ${item.id}.webm`)
      fs.writeFileSync(
        path.join(recordingsFolder, `${item.id}.webm`),
        Buffer.from(input.recording),
      )

      console.log("[MCP-DEBUG] Refreshing UI and hiding panel...")
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

      console.log("[MCP-DEBUG] ✅ MCP recording processing completed successfully!")

      // Copy final response to clipboard and paste
      clipboard.writeText(finalResponse)
      if (isAccessibilityGranted()) {
        try {
          await writeText(finalResponse)
        } catch (error) {
          console.error(`Failed to write text:`, error)
        }
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
      throw new Error(`Failed to load MCP config: ${error.message}`)
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
        throw new Error(`Failed to save MCP config: ${error.message}`)
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
        return { valid: false, error: error.message }
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
