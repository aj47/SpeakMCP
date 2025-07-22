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

// Global variable to track active authentication server
let activeAuthServer: any = null

// Helper function to set auth token (to avoid circular reference)
async function setAuthTokenHelper(token: string): Promise<{ success: boolean; user: User }> {
  try {
    const isDevelopment = process.env.NODE_ENV === 'development' || !app.isPackaged
    const baseUrl = isDevelopment
      ? "http://localhost:8787"  // Auth worker port
      : "https://speakmcp-auth.techfren.workers.dev"

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
import { postProcessTranscript } from "./llm"
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
    // Cancel any existing authentication flow
    if (activeAuthServer && activeAuthServer.listening) {
      activeAuthServer.close()
      activeAuthServer = null
    }

    return new Promise((resolve, reject) => {
      const http = require('http')
      const { URL } = require('url')
      let authTimeout: NodeJS.Timeout | null = null

      // Create a temporary HTTP server to receive the OAuth callback
      const server = http.createServer((req: any, res: any) => {
        const url = new URL(req.url, `http://localhost`)

        if (url.pathname === '/auth/callback') {
          const token = url.searchParams.get('token')
          const error = url.searchParams.get('error')

          // Clear the timeout since we got a response
          if (authTimeout) {
            clearTimeout(authTimeout)
            authTimeout = null
          }

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html' })
            res.end(`
              <!DOCTYPE html>
              <html lang="en">
                <head>
                  <meta charset="UTF-8">
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                  <title>SpeakMCP - Authentication Failed</title>
                  <style>
                    * {
                      margin: 0;
                      padding: 0;
                      box-sizing: border-box;
                    }

                    body {
                      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
                      min-height: 100vh;
                      display: flex;
                      align-items: center;
                      justify-content: center;
                      color: white;
                      animation: fadeIn 0.6s ease-out;
                    }

                    .container {
                      text-align: center;
                      padding: 3rem 2rem;
                      background: rgba(255, 255, 255, 0.1);
                      backdrop-filter: blur(10px);
                      border-radius: 20px;
                      border: 1px solid rgba(255, 255, 255, 0.2);
                      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
                      max-width: 400px;
                      width: 100%;
                      animation: slideUp 0.8s ease-out;
                    }

                    .error-icon {
                      font-size: 4rem;
                      margin-bottom: 1.5rem;
                      animation: shake 0.8s ease-out;
                    }

                    h1 {
                      font-size: 2rem;
                      font-weight: 600;
                      margin-bottom: 1rem;
                      letter-spacing: -0.02em;
                    }

                    .brand {
                      color: #fca5a5;
                      font-weight: 700;
                    }

                    p {
                      font-size: 1.1rem;
                      opacity: 0.9;
                      line-height: 1.6;
                      margin-bottom: 1rem;
                    }

                    .error-details {
                      background: rgba(0, 0, 0, 0.2);
                      padding: 1rem;
                      border-radius: 10px;
                      font-family: monospace;
                      font-size: 0.9rem;
                      margin-bottom: 1rem;
                      word-break: break-word;
                    }

                    @keyframes fadeIn {
                      from { opacity: 0; }
                      to { opacity: 1; }
                    }

                    @keyframes slideUp {
                      from {
                        opacity: 0;
                        transform: translateY(30px);
                      }
                      to {
                        opacity: 1;
                        transform: translateY(0);
                      }
                    }

                    @keyframes shake {
                      0%, 100% { transform: translateX(0); }
                      10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
                      20%, 40%, 60%, 80% { transform: translateX(5px); }
                    }

                    @media (max-width: 480px) {
                      .container {
                        margin: 1rem;
                        padding: 2rem 1.5rem;
                      }

                      h1 {
                        font-size: 1.5rem;
                      }

                      .error-icon {
                        font-size: 3rem;
                      }
                    }
                  </style>
                </head>
                <body>
                  <div class="container">
                    <div class="error-icon">❌</div>
                    <h1><span class="brand">SpeakMCP</span> Authentication Failed</h1>
                    <p>We encountered an issue during authentication:</p>
                    <div class="error-details">${error}</div>
                    <p>Please close this window and try again.</p>
                  </div>
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
              <!DOCTYPE html>
              <html lang="en">
                <head>
                  <meta charset="UTF-8">
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                  <title>SpeakMCP - Authentication Successful</title>
                  <style>
                    * {
                      margin: 0;
                      padding: 0;
                      box-sizing: border-box;
                    }

                    body {
                      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                      min-height: 100vh;
                      display: flex;
                      align-items: center;
                      justify-content: center;
                      color: white;
                      animation: fadeIn 0.6s ease-out;
                    }

                    .container {
                      text-align: center;
                      padding: 3rem 2rem;
                      background: rgba(255, 255, 255, 0.1);
                      backdrop-filter: blur(10px);
                      border-radius: 20px;
                      border: 1px solid rgba(255, 255, 255, 0.2);
                      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
                      max-width: 400px;
                      width: 100%;
                      animation: slideUp 0.8s ease-out;
                    }

                    .success-icon {
                      font-size: 4rem;
                      margin-bottom: 1.5rem;
                      animation: bounce 1s ease-out;
                    }

                    .microphone-icon {
                      font-size: 2rem;
                      margin-bottom: 1rem;
                      opacity: 0.8;
                      animation: pulse 2s infinite;
                    }

                    h1 {
                      font-size: 2rem;
                      font-weight: 600;
                      margin-bottom: 1rem;
                      letter-spacing: -0.02em;
                    }

                    .brand {
                      color: #60a5fa;
                      font-weight: 700;
                    }

                    p {
                      font-size: 1.1rem;
                      opacity: 0.9;
                      line-height: 1.6;
                      margin-bottom: 2rem;
                    }

                    .auto-close {
                      font-size: 0.9rem;
                      opacity: 0.7;
                      font-style: italic;
                    }

                    @keyframes fadeIn {
                      from { opacity: 0; }
                      to { opacity: 1; }
                    }

                    @keyframes slideUp {
                      from {
                        opacity: 0;
                        transform: translateY(30px);
                      }
                      to {
                        opacity: 1;
                        transform: translateY(0);
                      }
                    }

                    @keyframes bounce {
                      0%, 20%, 53%, 80%, 100% {
                        transform: translate3d(0, 0, 0);
                      }
                      40%, 43% {
                        transform: translate3d(0, -15px, 0);
                      }
                      70% {
                        transform: translate3d(0, -7px, 0);
                      }
                      90% {
                        transform: translate3d(0, -2px, 0);
                      }
                    }

                    @keyframes pulse {
                      0%, 100% {
                        transform: scale(1);
                        opacity: 0.8;
                      }
                      50% {
                        transform: scale(1.1);
                        opacity: 1;
                      }
                    }

                    @media (max-width: 480px) {
                      .container {
                        margin: 1rem;
                        padding: 2rem 1.5rem;
                      }

                      h1 {
                        font-size: 1.5rem;
                      }

                      .success-icon {
                        font-size: 3rem;
                      }
                    }
                  </style>
                </head>
                <body>
                  <div class="container">
                    <div class="microphone-icon">🎤</div>
                    <div class="success-icon">✅</div>
                    <h1>Welcome to <span class="brand">SpeakMCP</span>!</h1>
                    <p>Authentication successful! You can now close this window and start using voice-to-text with AI-powered transcription.</p>
                    <p class="auto-close">This window will close automatically in 5 seconds...</p>
                  </div>
                  <script>
                    // Auto-close after 5 seconds with countdown
                    let countdown = 5;
                    const autoCloseElement = document.querySelector('.auto-close');

                    const updateCountdown = () => {
                      if (countdown > 0) {
                        autoCloseElement.textContent = \`This window will close automatically in \${countdown} second\${countdown !== 1 ? 's' : ''}...\`;
                        countdown--;
                        setTimeout(updateCountdown, 1000);
                      } else {
                        // Try multiple methods to close the window
                        try {
                          // Method 1: Standard window.close()
                          window.close();
                        } catch (e) {
                          console.log('Standard window.close() failed:', e);
                        }

                        // Method 2: Try to close via opener
                        try {
                          if (window.opener) {
                            window.opener.focus();
                            window.close();
                          }
                        } catch (e) {
                          console.log('Opener close failed:', e);
                        }

                        // Method 3: Fallback - show manual close message
                        setTimeout(() => {
                          autoCloseElement.innerHTML = 'Please close this window manually. <br><small>You can now return to SpeakMCP.</small>';
                          autoCloseElement.style.color = '#ffd700';
                          autoCloseElement.style.fontWeight = 'bold';
                        }, 1000);
                      }
                    };

                    setTimeout(updateCountdown, 1000);
                  </script>
                </body>
              </html>
            `)

            // Save the token using helper function
            setAuthTokenHelper(token).then(() => {
              server.close()
              activeAuthServer = null
              resolve({ success: true })
            }).catch((error) => {
              server.close()
              activeAuthServer = null
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
            activeAuthServer = null
            reject(new Error('No token received'))
          }
        } else if (url.pathname === '/auth/cancel') {
          // Handle explicit cancellation
          if (authTimeout) {
            clearTimeout(authTimeout)
            authTimeout = null
          }

          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(`
            <html>
              <body>
                <h1>Authentication Cancelled</h1>
                <p>You can close this window.</p>
              </body>
            </html>
          `)
          server.close()
          activeAuthServer = null
          reject(new Error('Authentication was cancelled by user'))
        } else {
          res.writeHead(404)
          res.end('Not found')
        }
      })

      // Track the server globally
      activeAuthServer = server

      const startOAuthFlow = (port: number) => {
        // Use local development URL in development, production URL in production
        const isDevelopment = process.env.NODE_ENV === 'development' || !app.isPackaged
        const baseUrl = isDevelopment
          ? "http://localhost:8787"
          : "https://speakmcp-auth.techfren.workers.dev"

        // Create OAuth URL with our local callback
        const callbackUrl = `http://localhost:${port}/auth/callback`
        const authUrl = `${baseUrl}/auth/google?callback=${encodeURIComponent(callbackUrl)}`

        console.log(`Starting OAuth flow with callback: ${callbackUrl}`)

        // Open in user's default browser
        shell.openExternal(authUrl)

        // Set a shorter timeout with better error message
        authTimeout = setTimeout(() => {
          if (server.listening) {
            server.close()
            activeAuthServer = null
            reject(new Error('Authentication failed - browser was closed or no response received. Please try again.'))
          }
        }, 60000) // Reduced to 1 minute timeout
      }

      // Start server on a fixed port for OAuth callback
      const OAUTH_CALLBACK_PORT = 8789
      server.listen(OAUTH_CALLBACK_PORT, 'localhost', () => {
        const address = server.address()
        const port = address?.port

        if (!port) {
          activeAuthServer = null
          reject(new Error('Failed to start local server'))
          return
        }

        startOAuthFlow(port)
      })

      server.on('error', (error: any) => {
        activeAuthServer = null
        if (authTimeout) {
          clearTimeout(authTimeout)
          authTimeout = null
        }

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

              activeAuthServer = server
              startOAuthFlow(port)
            })
          }

          tryNextPort()
        } else {
          reject(new Error(`Server error: ${error instanceof Error ? error.message : String(error)}`))
        }
      })
    })
  }),

  cancelLogin: t.procedure.action(async () => {
    if (activeAuthServer && activeAuthServer.listening) {
      activeAuthServer.close()
      activeAuthServer = null
      return { success: true, message: 'Authentication cancelled' }
    }
    return { success: false, message: 'No active authentication to cancel' }
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

      // Use proxy server for transcription
        if (!config.authToken) {
          throw new Error("Authentication required. Please sign in to use SpeakMCP.")
        }

        const form = new FormData()
        form.append(
          "file",
          new File([input.recording], "recording.webm", { type: "audio/webm" }),
        )
        form.append("model", "whisper-large-v3") // Default to Groq model via proxy
        form.append("response_format", "json")

        // Add prompt parameter if provided
        if (config.groqSttPrompt?.trim()) {
          form.append("prompt", config.groqSttPrompt.trim())
        }

        const isDevelopment = process.env.NODE_ENV === 'development' || !app.isPackaged
        const baseUrl = isDevelopment
          ? "http://localhost:8788"  // Proxy worker port
          : "https://speakmcp-proxy.techfren.workers.dev"

        const transcriptResponse = await fetch(
          `${baseUrl}/openai/v1/audio/transcriptions`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.authToken}`,
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


}

export type Router = typeof router
