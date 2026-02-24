import Fastify, { FastifyInstance } from "fastify"
import cors from "@fastify/cors"
import crypto from "crypto"
import fs from "fs"
import os from "os"
import path from "path"
import QRCode from "qrcode"
import { configStore, recordingsFolder } from "./config"
import { diagnosticsService } from "./diagnostics"
import { mcpService, MCPToolResult, handleWhatsAppToggle } from "./mcp-service"
import { processTranscriptWithAgentMode } from "./llm"
import { state, agentProcessManager, agentSessionStateManager } from "./state"
import { conversationService } from "./conversation-service"
import { AgentProgressUpdate, SessionProfileSnapshot } from "../shared/types"
import { agentSessionTracker } from "./agent-session-tracker"
import { emergencyStopAll } from "./emergency-stop"
import { sendMessageNotification, isPushEnabled, clearBadgeCount } from "./push-notification-service"
import { skillsService } from "./skills-service"
import { memoryService } from "./memory-service"
import { agentProfileService, createSessionSnapshotFromProfile, toolConfigToMcpServerConfig } from "./agent-profile-service"
import { getRendererHandlers } from "@egoist/tipc/main"
import { WINDOWS } from "./window"
import type { RendererHandlers } from "./renderer-handlers"

let server: FastifyInstance | null = null
let lastError: string | undefined

// Track webContents IDs that already have a pending did-finish-load notification queued,
// to avoid registering multiple once-listeners if notifyConversationHistoryChanged() is
// called several times while a window is still loading.
const pendingNotificationWebContentsIds = new Set<number>()

/**
 * Notify all renderer windows that conversation history has changed.
 * Used after remote server creates or modifies conversations (e.g. from mobile).
 * Defers the notification if the window's renderer is still loading to avoid dropped events.
 * Uses pendingNotificationWebContentsIds to deduplicate deferred listeners.
 */
function notifyConversationHistoryChanged(): void {
  const notifiedWebContentsIds = new Set<number>()
  for (const windowId of ["main", "panel"] as const) {
    const win = WINDOWS.get(windowId)
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
      continue
    }
    if (notifiedWebContentsIds.has(win.webContents.id)) {
      continue
    }

    notifiedWebContentsIds.add(win.webContents.id)
    const sendNotification = () => {
      pendingNotificationWebContentsIds.delete(win.webContents.id)
      try {
        getRendererHandlers<RendererHandlers>(win.webContents).conversationHistoryChanged?.send()
      } catch (err) {
        diagnosticsService.logWarning("remote-server", `Failed to notify ${windowId} window about conversation history changes: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    if (win.webContents.isLoading()) {
      // Only register a did-finish-load listener if one isn't already pending for this webContents,
      // to avoid listener buildup when called multiple times during window load.
      if (!pendingNotificationWebContentsIds.has(win.webContents.id)) {
        pendingNotificationWebContentsIds.add(win.webContents.id)
        win.webContents.once("did-finish-load", sendNotification)
        // If the window is destroyed before it finishes loading, clean up to prevent
        // the webContents ID from being permanently retained in the pending set.
        win.webContents.once("destroyed", () => {
          pendingNotificationWebContentsIds.delete(win.webContents.id)
        })
      }
    } else {
      sendNotification()
    }
  }
}

// Exact reserved names that collide with internal storage files.
// Checked against the exact (lowercased) ID — no extension stripping applied,
// so IDs like "index.v2" or "metadata.backup" are NOT rejected by this set.
const FILE_RESERVED_IDS = new Set(["index", "metadata"])

// Windows reserved device names (CON, NUL, COM1–COM9, LPT1–LPT9, etc.).
// Checked against both the exact lowercased ID and the stem before the first dot,
// because Windows treats "con.txt" and "nul." as reserved filenames too.
const WINDOWS_DEVICE_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com0",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt0",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
])

/**
 * Validate conversation IDs sent over remote HTTP endpoints.
 * Performs null-byte, path-traversal, character-allowlist, and reserved-name checks.
 * This is NOT equivalent to ConversationService.validateConversationId(), which also
 * sanitizes disallowed characters and performs a path.resolve containment check.
 */
function getConversationIdValidationError(conversationId: string): string | null {
  if (conversationId.includes("\0")) {
    return "Invalid conversation ID: null bytes not allowed"
  }
  if (conversationId.includes("..") || conversationId.includes("/") || conversationId.includes("\\")) {
    return "Invalid conversation ID: path traversal characters not allowed"
  }
  if (!/^[a-zA-Z0-9_\-@.]+$/.test(conversationId)) {
    return "Invalid conversation ID format"
  }
  // Normalize to lowercase for case-insensitive filesystem compatibility (Windows/macOS).
  const normalized = conversationId.toLowerCase()
  // Exact-match check for internal storage file collisions (e.g. index.json, metadata.json).
  // Extension stripping is NOT applied here so IDs like "index.v2" pass through.
  if (FILE_RESERVED_IDS.has(normalized)) {
    return "Invalid conversation ID: reserved name"
  }
  // For Windows device names, also strip the first extension (e.g. "con.txt" → "con")
  // because Windows treats device names with any extension as still reserved.
  const stem = normalized.includes(".") ? normalized.slice(0, normalized.indexOf(".")) : normalized
  if (WINDOWS_DEVICE_NAMES.has(normalized) || WINDOWS_DEVICE_NAMES.has(stem)) {
    return "Invalid conversation ID: reserved name"
  }
  return null
}

/**
 * Detects if we're running in a headless/terminal environment
 * This helps auto-print QR codes when no GUI is available
 */
function isHeadlessEnvironment(): boolean {
  // Linux without DISPLAY or WAYLAND_DISPLAY is headless
  if (process.platform === "linux") {
    const hasDisplay = process.env.DISPLAY || process.env.WAYLAND_DISPLAY
    if (!hasDisplay) {
      return true
    }
  }
  // Check for explicit terminal mode flag
  if (process.env.SPEAKMCP_TERMINAL_MODE === "1") {
    return true
  }
  return false
}

/**
 * Prints a QR code to the terminal for mobile app pairing
 * @param url The server URL (e.g., http://192.168.1.100:3210/v1)
 * @param apiKey The API key for authentication
 * @returns true if QR code was printed successfully, false on error
 */
async function printTerminalQRCode(url: string, apiKey: string): Promise<boolean> {
  const qrValue = `speakmcp://config?baseUrl=${encodeURIComponent(url)}&apiKey=${encodeURIComponent(apiKey)}`

  try {
    // Generate QR code as terminal-friendly ASCII art
    const qrString = await QRCode.toString(qrValue, {
      type: "terminal",
      small: true,
      errorCorrectionLevel: "M"
    })

    console.log("\n" + "=".repeat(60))
    console.log("📱 Mobile App Connection QR Code")
    console.log("=".repeat(60))
    console.log("\nScan this QR code with the SpeakMCP mobile app to connect:\n")
    console.log(qrString)
    console.log("Server URL:", url)
    console.log("API Key:", redact(apiKey))
    console.log("\n" + "=".repeat(60) + "\n")

    diagnosticsService.logInfo("remote-server", "Terminal QR code printed for mobile app pairing")
    return true
  } catch (err) {
    console.error("[Remote Server] Failed to generate terminal QR code:", err)
    diagnosticsService.logError("remote-server", "Failed to generate terminal QR code", err)
    return false
  }
}

function redact(value?: string) {
  if (!value) return ""
  if (value.length <= 8) return "***"
  return `${value.slice(0, 4)}...${value.slice(-4)}`
}

/**
 * Gets a connectable IP address for the QR code URL
 * When bind is 0.0.0.0, we find the actual LAN IP that a mobile device can connect to.
 * When bind is 127.0.0.1 or localhost, the server is bound to loopback only and cannot
 * accept connections from mobile devices - we warn and return the original address.
 */
function getConnectableIp(bind: string): string {
  // If bound to loopback, warn that mobile devices cannot connect
  if (bind === "127.0.0.1" || bind === "localhost") {
    console.warn(
      `[Remote Server] Warning: Server is bound to ${bind} (loopback only). ` +
      `Mobile devices on the same network cannot connect. ` +
      `Change bind address to 0.0.0.0 or your LAN IP for mobile access.`
    )
    return bind
  }

  // If already a specific IP (not wildcard), use it
  if (bind !== "0.0.0.0") {
    return bind
  }

  // Find first non-internal IPv4 address
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    const addrs = interfaces[name]
    if (!addrs) continue
    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address
      }
    }
  }

  // Fallback to the original bind address with a warning
  console.warn(
    `[Remote Server] Warning: Could not find LAN IP. QR code will use ${bind} which may not be reachable from mobile devices.`
  )
  return bind
}

function resolveActiveModelId(cfg: any): string {
  const provider = cfg.mcpToolsProviderId || "openai"
  if (provider === "openai") return cfg.mcpToolsOpenaiModel || "openai"
  if (provider === "groq") return cfg.mcpToolsGroqModel || "groq"
  if (provider === "gemini") return cfg.mcpToolsGeminiModel || "gemini"
  return String(provider)
}

function toOpenAIChatResponse(content: string, model: string) {
  return {
    id: `chatcmpl-${Date.now().toString(36)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
  }
}

function normalizeContent(content: any): string | null {
  if (!content) return null
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    const parts = content
      .map((p) => {
        if (typeof p === "string") return p
        if (p && typeof p === "object") {
          if (typeof p.text === "string") return p.text
          if (typeof p.content === "string") return p.content
        }
        return ""
      })
      .filter(Boolean)
    return parts.length ? parts.join(" ") : null
  }
  if (typeof content === "object" && content !== null) {
    if (typeof (content as any).text === "string") return (content as any).text
  }
  return null
}

function extractUserPrompt(body: any): string | null {
  try {
    if (!body || typeof body !== "object") return null

    if (Array.isArray(body.messages)) {
      for (let i = body.messages.length - 1; i >= 0; i--) {
        const msg = body.messages[i]
        const role = String(msg?.role || "").toLowerCase()
        if (role === "user") {
          const c = normalizeContent(msg?.content)
          if (c && c.trim()) return c.trim()
        }
      }
    }

    const prompt = normalizeContent(body.prompt)
    if (prompt && prompt.trim()) return prompt.trim()

    const input = normalizeContent(body.input)
    if (input && input.trim()) return input.trim()

    return null
  } catch {
    return null
  }
}

interface RunAgentOptions {
  prompt: string
  conversationId?: string
  onProgress?: (update: AgentProgressUpdate) => void
}

function formatConversationHistoryForApi(
  history: Array<{
    role: "user" | "assistant" | "tool"
    content: string
    toolCalls?: any[]
    toolResults?: any[]
    timestamp?: number
  }>
): Array<{
  role: "user" | "assistant" | "tool"
  content: string
  toolCalls?: Array<{ name: string; arguments: any }>
  toolResults?: Array<{ success: boolean; content: string; error?: string }>
  timestamp?: number
}> {
  return history.map((entry) => ({
    role: entry.role,
    content: entry.content,
    toolCalls: entry.toolCalls?.map((tc: any) => ({
      name: tc.name,
      arguments: tc.arguments,
    })),
    toolResults: entry.toolResults?.map((tr: any) => {
      const contentText = Array.isArray(tr.content)
        ? tr.content.map((c: any) => c.text || c).join("\n")
        : String(tr.content || "")
      const isError = tr.isError ?? (tr.success === false)
      return {
        success: !isError,
        content: contentText,
        error: isError ? contentText : undefined,
      }
    }),
    timestamp: entry.timestamp,
  }))
}

async function runAgent(options: RunAgentOptions): Promise<{
  content: string
  conversationId: string
  conversationHistory: Array<{
    role: "user" | "assistant" | "tool"
    content: string
    toolCalls?: Array<{ name: string; arguments: any }>
    toolResults?: Array<{ success: boolean; content: string; error?: string }>
    timestamp?: number
  }>
}> {
  const { prompt, conversationId: inputConversationId, onProgress } = options
  const cfg = configStore.get()

  // Set agent mode state for process management - ensure clean state
  state.isAgentModeActive = true
  state.shouldStopAgent = false
  state.agentIterationCount = 0

  // Load previous conversation history if conversationId is provided
  let previousConversationHistory: Array<{
    role: "user" | "assistant" | "tool"
    content: string
    toolCalls?: any[]
    toolResults?: any[]
  }> | undefined
  let conversationId = inputConversationId

  // Create or continue conversation - matching tipc.ts createMcpTextInput logic
  if (conversationId) {
    // Add user message to existing conversation BEFORE processing
    const updatedConversation = await conversationService.addMessageToConversation(
      conversationId,
      prompt,
      "user"
    )

    if (updatedConversation) {
      // Load conversation history excluding the message we just added (the current user input)
      // This matches tipc.ts processWithAgentMode behavior
      const messagesToConvert = updatedConversation.messages.slice(0, -1)



      diagnosticsService.logInfo("remote-server", `Continuing conversation ${conversationId} with ${messagesToConvert.length} previous messages`)

      previousConversationHistory = messagesToConvert.map((msg) => ({
        role: msg.role,
        content: msg.content,
        toolCalls: msg.toolCalls,
        // Preserve timestamp for correct ordering in UI (matching tipc.ts)
        timestamp: msg.timestamp,
        // Convert toolResults from stored format to MCPToolResult format (matching tipc.ts)
        toolResults: msg.toolResults?.map((tr) => ({
          content: [
            {
              type: "text" as const,
              text: tr.success ? tr.content : (tr.error || tr.content),
            },
          ],
          isError: !tr.success,
        })),
      }))
    } else {
      // Conversation not found - create it with the provided ID to maintain session continuity
      diagnosticsService.logInfo("remote-server", `Conversation ${conversationId} not found, creating with provided ID`)
      const newConversation = await conversationService.createConversationWithId(conversationId, prompt, "user")
      // Update conversationId to use the actual persisted ID (which may be sanitized)
      // This ensures session lookup and later operations use the correct ID
      conversationId = newConversation.id
      // Mark that we've just created the conversation so we don't try to add another message below
      previousConversationHistory = []
      diagnosticsService.logInfo("remote-server", `Created new conversation with ID ${newConversation.id}`)
    }
  }

  // Create a new conversation if none exists (only when no conversationId was provided at all)
  if (!conversationId) {
    const newConversation = await conversationService.createConversationWithId(
      conversationService.generateConversationIdPublic(),
      prompt,
      "user"
    )
    conversationId = newConversation.id
    diagnosticsService.logInfo("remote-server", `Created new conversation ${conversationId}`)
  }

  // Try to find and revive an existing session for this conversation (matching tipc.ts)
  // Note: We use `conversationId` (which may be newly created) instead of `inputConversationId`
  // to ensure we find sessions for both existing and newly created conversations.
  // This fixes a bug where inputConversationId pointed to a non-existent conversation,
  // causing session lookup to fail and creating duplicate sessions.
  // Start snoozed unless remoteServerAutoShowPanel is enabled (affects both new and revived sessions)
  const startSnoozed = !cfg.remoteServerAutoShowPanel
  let existingSessionId: string | undefined
  if (conversationId) {
    const foundSessionId = agentSessionTracker.findSessionByConversationId(conversationId)
    if (foundSessionId) {
      // Check if session is already active - if so, preserve its current snooze state
      // This prevents unexpectedly hiding the progress UI for a session the user is watching
      const existingSession = agentSessionTracker.getSession(foundSessionId)
      const isAlreadyActive = existingSession && existingSession.status === "active"
      const snoozeForRevive = isAlreadyActive ? existingSession.isSnoozed ?? false : startSnoozed
      const revived = agentSessionTracker.reviveSession(foundSessionId, snoozeForRevive)
      if (revived) {
        existingSessionId = foundSessionId
        diagnosticsService.logInfo("remote-server", `Revived existing session ${existingSessionId}`)
      }
    }
  }

  // Determine profile snapshot for session isolation
  // If reusing an existing session, use its stored snapshot to maintain isolation
  // Only capture a new snapshot when creating a new session
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

  // Start or reuse agent session
  const conversationTitle = prompt.length > 50 ? prompt.substring(0, 50) + "..." : prompt
  const sessionId = existingSessionId || agentSessionTracker.startSession(conversationId, conversationTitle, startSnoozed, profileSnapshot)

  try {
    await mcpService.initialize()

    mcpService.registerExistingProcessesWithAgentManager()

    // Get available tools filtered by profile snapshot if available (for session isolation)
    // This ensures revived sessions use the same tool list they started with
    const availableTools = profileSnapshot?.mcpServerConfig
      ? mcpService.getAvailableToolsForProfile(profileSnapshot.mcpServerConfig)
      : mcpService.getAvailableTools()

    const executeToolCall = async (toolCall: any, onProgress?: (message: string) => void): Promise<MCPToolResult> => {
      // Pass sessionId for ACP router tools progress, and profileSnapshot.mcpServerConfig for session-aware server availability
      return await mcpService.executeToolCall(toolCall, onProgress, false, sessionId, profileSnapshot?.mcpServerConfig)
    }

    const agentResult = await processTranscriptWithAgentMode(
      prompt,
      availableTools,
      executeToolCall,
      cfg.mcpMaxIterations ?? 10,
      previousConversationHistory,
      conversationId,
      sessionId, // Pass session ID for progress routing
      onProgress, // Pass progress callback for SSE streaming
      profileSnapshot, // Pass profile snapshot for session isolation
    )

    // Mark session as completed
    agentSessionTracker.completeSession(sessionId, "Agent completed successfully")

    // Format conversation history for API response (convert MCPToolResult to ToolResult format)
    const formattedHistory = formatConversationHistoryForApi(agentResult.conversationHistory)

    // Notify renderer that conversation history has changed (for sidebar refresh)
    notifyConversationHistoryChanged()

    return { content: agentResult.content, conversationId, conversationHistory: formattedHistory }
  } catch (error) {
    // Mark session as errored
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    agentSessionTracker.errorSession(sessionId, errorMessage)

    // Conversation was already created/updated before agent execution started.
    // Refresh renderer history even on failure so UI reflects the latest persisted state.
    notifyConversationHistoryChanged()

    throw error
  } finally {
    // Clean up agent state to ensure next session starts fresh
    state.isAgentModeActive = false
    state.shouldStopAgent = false
    state.agentIterationCount = 0
  }
}

function recordHistory(transcript: string) {
  try {
    fs.mkdirSync(recordingsFolder, { recursive: true })
    const historyPath = path.join(recordingsFolder, "history.json")
    let history: Array<{ id: string; createdAt: number; duration: number; transcript: string }>
    try {
      history = JSON.parse(fs.readFileSync(historyPath, "utf8"))
    } catch {
      history = []
    }

    const item = {
      id: Date.now().toString(),
      createdAt: Date.now(),
      duration: 0,
      transcript,
    }
    history.push(item)
    fs.writeFileSync(historyPath, JSON.stringify(history))
  } catch (e) {
    diagnosticsService.logWarning(
      "remote-server",
      "Failed to record history item",
      e,
    )
  }
}

/**
 * Starts the remote server, forcing it to be enabled regardless of config.
 * Used by --qr mode to ensure the server starts even if remoteServerEnabled is false.
 * Also skips the auto-print of QR codes since --qr mode handles that separately.
 */
export async function startRemoteServerForced() {
  return startRemoteServerInternal({ forceEnabled: true, skipAutoPrintQR: true })
}

export async function startRemoteServer() {
  return startRemoteServerInternal({ forceEnabled: false, skipAutoPrintQR: false })
}

interface StartRemoteServerOptions {
  forceEnabled?: boolean
  skipAutoPrintQR?: boolean
}

async function startRemoteServerInternal(options: StartRemoteServerOptions = {}) {
  const { forceEnabled = false, skipAutoPrintQR = false } = options
  const cfg = configStore.get()
  if (!forceEnabled && !cfg.remoteServerEnabled) {
    diagnosticsService.logInfo(
      "remote-server",
      "Remote server not enabled in config; skipping start",
    )
    return { running: false }
  }

  if (!cfg.remoteServerApiKey) {
    // Generate API key on first enable
    const key = crypto.randomBytes(32).toString("hex")
    configStore.save({ ...cfg, remoteServerApiKey: key })
  }

  if (server) {
    diagnosticsService.logInfo(
      "remote-server",
      "Remote server already running; restarting",
    )
    await stopRemoteServer()
  }

  lastError = undefined
  const logLevel = cfg.remoteServerLogLevel || "info"
  const bind = cfg.remoteServerBindAddress || "127.0.0.1"
  const port = cfg.remoteServerPort || 3210

  const fastify = Fastify({ logger: { level: logLevel } })

  // Configure CORS
  const corsOrigins = cfg.remoteServerCorsOrigins || ["*"]
  await fastify.register(cors, {
    // When origin is ["*"] or includes "*", use true to reflect the request origin
    // This is needed because credentials: true doesn't work with literal "*"
    origin: corsOrigins.includes("*") ? true : corsOrigins,
    methods: ["GET", "POST", "PUT", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    maxAge: 86400, // Cache preflight for 24 hours
    preflight: true, // Enable preflight pass-through
    strictPreflight: false, // Don't be strict about preflight requests
  })

  // Auth hook (skip for OPTIONS preflight requests)
  fastify.addHook("onRequest", async (req, reply) => {
    // Skip auth for OPTIONS requests (CORS preflight)
    if (req.method === "OPTIONS") {
      return
    }

    const auth = (req.headers["authorization"] || "").toString()
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : ""
    const current = configStore.get()
    if (!token || token !== current.remoteServerApiKey) {
      reply.code(401).send({ error: "Unauthorized" })
      return
    }
  })

  // Routes
  fastify.post("/v1/chat/completions", async (req, reply) => {
    try {
      const body = req.body as any
      const prompt = extractUserPrompt(body)
      if (!prompt) {
        return reply.code(400).send({ error: "Missing user prompt" })
      }

      // Extract conversationId from request body (custom extension to OpenAI API)
      // Use undefined for absent/non-string values; treat empty string as absent
      const rawConversationId = typeof body.conversation_id === "string" ? body.conversation_id : undefined
      const conversationId = rawConversationId !== "" ? rawConversationId : undefined
      if (conversationId) {
        const conversationIdError = getConversationIdValidationError(conversationId)
        if (conversationIdError) {
          return reply.code(400).send({ error: conversationIdError })
        }
      }
      // Check if client wants SSE streaming
      const isStreaming = body.stream === true

      console.log("[remote-server] Chat request:", { conversationId: conversationId || "new", promptLength: prompt.length, streaming: isStreaming })
      diagnosticsService.logInfo("remote-server", `Handling completion request${conversationId ? ` for conversation ${conversationId}` : ""}${isStreaming ? " (streaming)" : ""}`)

      if (isStreaming) {
        // SSE streaming mode
        // Get the request origin for CORS
        const requestOrigin = req.headers.origin || "*"
        reply.raw.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "Access-Control-Allow-Origin": requestOrigin,
          "Access-Control-Allow-Credentials": "true",
        })

        // Helper to write SSE events
        const writeSSE = (data: object) => {
          reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
        }

        // Create progress callback that emits SSE events
        const onProgress = (update: AgentProgressUpdate) => {
          writeSSE({ type: "progress", data: update })
        }

        try {
          const result = await runAgent({ prompt, conversationId, onProgress })

          // Record as if user submitted a text input
          recordHistory(result.content)

          const model = resolveActiveModelId(configStore.get())

          // Send final "done" event with full response data
          writeSSE({
            type: "done",
            data: {
              content: result.content,
              conversation_id: result.conversationId,
              conversation_history: result.conversationHistory,
              model,
            },
          })

          // Send push notification by default if tokens are registered
          // Client can set send_push_notification: false to explicitly disable
          const shouldSendPush = body.send_push_notification !== false && isPushEnabled()
          if (shouldSendPush) {
            const conversationTitle = prompt.length > 30 ? prompt.substring(0, 30) + "..." : prompt
            // Fire and forget - don't block the response
            sendMessageNotification(result.conversationId, conversationTitle, result.content).catch((err) => {
              diagnosticsService.logWarning("remote-server", "Failed to send push notification", err)
            })
          }
        } catch (error: any) {
          // Send error event
          writeSSE({
            type: "error",
            data: { message: error?.message || "Internal Server Error" },
          })
        } finally {
          reply.raw.end()
        }

        // Return reply to indicate we've handled the response
        return reply
      }

      // Non-streaming mode (existing behavior)
      const result = await runAgent({ prompt, conversationId })

      // Record as if user submitted a text input
      recordHistory(result.content)

      const model = resolveActiveModelId(configStore.get())
      // Return standard OpenAI response with conversation_id as custom field
      const response = toOpenAIChatResponse(result.content, model)

      console.log("[remote-server] Chat response:", { conversationId: result.conversationId, responseLength: result.content.length })

      // Send push notification by default if tokens are registered
      // Client can set send_push_notification: false to explicitly disable
      const shouldSendPush = body.send_push_notification !== false && isPushEnabled()
      if (shouldSendPush) {
        const conversationTitle = prompt.length > 30 ? prompt.substring(0, 30) + "..." : prompt
        // Fire and forget - don't block the response
        sendMessageNotification(result.conversationId, conversationTitle, result.content).catch((err) => {
          diagnosticsService.logWarning("remote-server", "Failed to send push notification", err)
        })
      }

      return reply.send({
        ...response,
        conversation_id: result.conversationId, // Include conversation_id for client to use in follow-ups
        conversation_history: result.conversationHistory, // Include full conversation history with tool calls/results
      })
    } catch (error: any) {
      diagnosticsService.logError("remote-server", "Handler error", error)
      return reply.code(500).send({ error: "Internal Server Error" })
    }
  })

  fastify.get("/v1/models", async (_req, reply) => {
    const model = resolveActiveModelId(configStore.get())
    return reply.send({
      object: "list",
      data: [{ id: model, object: "model", owned_by: "system" }],
    })
  })

  // GET /v1/models/:providerId - Fetch available models for a provider
  fastify.get("/v1/models/:providerId", async (req, reply) => {
    try {
      const params = req.params as { providerId: string }
      const providerId = params.providerId

      const validProviders = ["openai", "groq", "gemini"]
      if (!validProviders.includes(providerId)) {
        return reply.code(400).send({ error: `Invalid provider: ${providerId}. Valid providers: ${validProviders.join(", ")}` })
      }

      const { fetchAvailableModels } = await import("./models-service")
      const models = await fetchAvailableModels(providerId)

      return reply.send({
        providerId,
        models: models.map(m => ({
          id: m.id,
          name: m.name,
          description: m.description,
          context_length: m.context_length,
        })),
      })
    } catch (error: any) {
      diagnosticsService.logError("remote-server", "Failed to fetch models", error)
      return reply.code(500).send({ error: error?.message || "Failed to fetch models" })
    }
  })

  // ============================================
  // Settings Management Endpoints (for mobile app)
  // ============================================

  // GET /v1/profiles - List all profiles
  fastify.get("/v1/profiles", async (_req, reply) => {
    try {
      const profiles = agentProfileService.getUserProfiles()
      const currentProfile = agentProfileService.getCurrentProfile()
      return reply.send({
        profiles: profiles.map(p => ({
          id: p.id,
          name: p.displayName,
          isDefault: p.isDefault,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        })),
        currentProfileId: currentProfile?.id,
      })
    } catch (error: any) {
      diagnosticsService.logError("remote-server", "Failed to get profiles", error)
      return reply.code(500).send({ error: "Failed to get profiles" })
    }
  })

  // GET /v1/profiles/current - Get current profile details
  fastify.get("/v1/profiles/current", async (_req, reply) => {
    try {
      const profile = agentProfileService.getCurrentProfile()
      if (!profile) {
        return reply.code(404).send({ error: "No current profile set" })
      }
      return reply.send({
        id: profile.id,
        name: profile.displayName,
        isDefault: profile.isDefault,
        guidelines: profile.guidelines || "",
        systemPrompt: profile.systemPrompt,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      })
    } catch (error: any) {
      diagnosticsService.logError("remote-server", "Failed to get current profile", error)
      return reply.code(500).send({ error: "Failed to get current profile" })
    }
  })

  // POST /v1/profiles/current - Set current profile
  fastify.post("/v1/profiles/current", async (req, reply) => {
    try {
      const body = req.body as any
      const profileId = body?.profileId
      if (!profileId || typeof profileId !== "string") {
        return reply.code(400).send({ error: "Missing or invalid profileId" })
      }
      const profile = agentProfileService.setCurrentProfileStrict(profileId)
      // Apply the profile's MCP configuration
      const mcpServerConfig = toolConfigToMcpServerConfig(profile.toolConfig)
      mcpService.applyProfileMcpConfig(
        mcpServerConfig?.disabledServers,
        mcpServerConfig?.disabledTools,
        mcpServerConfig?.allServersDisabledByDefault,
        mcpServerConfig?.enabledServers,
        mcpServerConfig?.enabledBuiltinTools,
      )
      diagnosticsService.logInfo("remote-server", `Switched to profile: ${profile.displayName}`)
      return reply.send({
        success: true,
        profile: {
          id: profile.id,
          name: profile.name,
          isDefault: profile.isDefault,
        },
      })
    } catch (error: any) {
      diagnosticsService.logError("remote-server", "Failed to set current profile", error)
      // Return 404 if profile was not found, otherwise 500
      const isNotFound = error?.message?.includes("not found")
      return reply.code(isNotFound ? 404 : 500).send({ error: error?.message || "Failed to set current profile" })
    }
  })

  // GET /v1/profiles/:id/export - Export a profile as JSON
  fastify.get("/v1/profiles/:id/export", async (req, reply) => {
    try {
      const params = req.params as { id: string }
      const profileJson = agentProfileService.exportProfile(params.id)
      return reply.send({ profileJson })
    } catch (error: any) {
      diagnosticsService.logError("remote-server", "Failed to export profile", error)
      const isNotFound = error?.message?.includes("not found")
      return reply.code(isNotFound ? 404 : 500).send({ error: error?.message || "Failed to export profile" })
    }
  })

  // POST /v1/profiles/import - Import a profile from JSON
  fastify.post("/v1/profiles/import", async (req, reply) => {
    try {
      const body = req.body as any
      const profileJson = body?.profileJson
      if (!profileJson || typeof profileJson !== "string") {
        return reply.code(400).send({ error: "Missing or invalid profileJson" })
      }
      const profile = agentProfileService.importProfile(profileJson)
      diagnosticsService.logInfo("remote-server", `Imported profile: ${profile.displayName}`)
      return reply.send({
        success: true,
        profile: {
          id: profile.id,
          name: profile.displayName,
          isDefault: profile.isDefault,
        },
      })
    } catch (error: any) {
      diagnosticsService.logError("remote-server", "Failed to import profile", error)
      // Return 400 for JSON/validation errors, 500 for server errors
      const errorMessage = (error?.message ?? "").toLowerCase()
      const isValidationError = error instanceof SyntaxError ||
        errorMessage.includes("json") ||
        errorMessage.includes("invalid") ||
        errorMessage.includes("missing")
      return reply.code(isValidationError ? 400 : 500).send({ error: error?.message || "Failed to import profile" })
    }
  })

  // GET /v1/mcp/servers - List MCP servers with status
  fastify.get("/v1/mcp/servers", async (_req, reply) => {
    try {
      const serverStatus = mcpService.getServerStatus()
      const servers = Object.entries(serverStatus)
        // Filter out the built-in speakmcp-settings pseudo-server as it's not user-toggleable
        .filter(([name]) => name !== "speakmcp-settings")
        .map(([name, status]) => ({
          name,
          connected: status.connected,
          toolCount: status.toolCount,
          enabled: status.runtimeEnabled && !status.configDisabled,
          runtimeEnabled: status.runtimeEnabled,
          configDisabled: status.configDisabled,
          error: status.error,
        }))
      return reply.send({ servers })
    } catch (error: any) {
      diagnosticsService.logError("remote-server", "Failed to get MCP servers", error)
      return reply.code(500).send({ error: "Failed to get MCP servers" })
    }
  })

  // POST /v1/mcp/servers/:name/toggle - Toggle MCP server enabled/disabled
  fastify.post("/v1/mcp/servers/:name/toggle", async (req, reply) => {
    try {
      const params = req.params as { name: string }
      const body = req.body as any
      const serverName = params.name
      const enabled = body?.enabled

      if (typeof enabled !== "boolean") {
        return reply.code(400).send({ error: "Missing or invalid 'enabled' boolean" })
      }

      const success = mcpService.setServerRuntimeEnabled(serverName, enabled)
      if (!success) {
        return reply.code(404).send({ error: `Server '${serverName}' not found` })
      }

      diagnosticsService.logInfo("remote-server", `Toggled MCP server ${serverName} to ${enabled ? "enabled" : "disabled"}`)
      return reply.send({
        success: true,
        server: serverName,
        enabled,
      })
    } catch (error: any) {
      diagnosticsService.logError("remote-server", "Failed to toggle MCP server", error)
      return reply.code(500).send({ error: error?.message || "Failed to toggle MCP server" })
    }
  })

  // GET /v1/settings - Get relevant settings for mobile app
  fastify.get("/v1/settings", async (_req, reply) => {
    try {
      const cfg = configStore.get()
      const { getBuiltInModelPresets, DEFAULT_MODEL_PRESET_ID } = await import("../shared/index")
      const builtInPresets = getBuiltInModelPresets()
      const savedPresets = cfg.modelPresets || []

      // Merge built-in presets with any saved overrides (e.g., edited baseUrl/name)
      // and include custom (non-built-in) presets
      const builtInIds = new Set(builtInPresets.map(p => p.id))
      const mergedPresets = builtInPresets.map(builtIn => {
        const savedOverride = savedPresets.find(p => p.id === builtIn.id)
        if (savedOverride) {
          // Apply saved overrides to built-in preset
          return { ...builtIn, ...savedOverride }
        }
        return builtIn
      })
      // Filter custom presets by excluding any IDs that match built-in presets
      // This prevents duplicates from older entries where isBuiltIn was unset
      const customPresets = savedPresets.filter(p => !builtInIds.has(p.id))

      return reply.send({
        // Model settings
        mcpToolsProviderId: cfg.mcpToolsProviderId || "openai",
        mcpToolsOpenaiModel: cfg.mcpToolsOpenaiModel,
        mcpToolsGroqModel: cfg.mcpToolsGroqModel,
        mcpToolsGeminiModel: cfg.mcpToolsGeminiModel,
        // OpenAI compatible preset settings
        currentModelPresetId: cfg.currentModelPresetId || DEFAULT_MODEL_PRESET_ID,
        availablePresets: [...mergedPresets, ...customPresets].map(p => ({
          id: p.id,
          name: p.name,
          baseUrl: p.baseUrl,
          isBuiltIn: p.isBuiltIn ?? false,
        })),
        // Feature toggles
        transcriptPostProcessingEnabled: cfg.transcriptPostProcessingEnabled ?? true,
        mcpRequireApprovalBeforeToolCall: cfg.mcpRequireApprovalBeforeToolCall ?? false,
        ttsEnabled: cfg.ttsEnabled ?? true,
        whatsappEnabled: cfg.whatsappEnabled ?? false,
        // Agent settings
        mcpMaxIterations: cfg.mcpMaxIterations ?? 10,
        // Streamer Mode
        streamerModeEnabled: cfg.streamerModeEnabled ?? false,
        // Speech-to-Text
        sttLanguage: cfg.sttLanguage ?? "",
        transcriptionPreviewEnabled: cfg.transcriptionPreviewEnabled ?? true,
        transcriptPostProcessingPrompt: cfg.transcriptPostProcessingPrompt ?? "",
        // Text-to-Speech
        ttsAutoPlay: cfg.ttsAutoPlay ?? true,
        ttsPreprocessingEnabled: cfg.ttsPreprocessingEnabled ?? true,
        ttsRemoveCodeBlocks: cfg.ttsRemoveCodeBlocks ?? true,
        ttsRemoveUrls: cfg.ttsRemoveUrls ?? true,
        ttsConvertMarkdown: cfg.ttsConvertMarkdown ?? true,
        ttsUseLLMPreprocessing: cfg.ttsUseLLMPreprocessing ?? false,
        // Agent settings (extended)
        mainAgentMode: cfg.mainAgentMode ?? "api",
        mcpMessageQueueEnabled: cfg.mcpMessageQueueEnabled ?? true,
        mcpVerifyCompletionEnabled: cfg.mcpVerifyCompletionEnabled ?? true,
        mcpFinalSummaryEnabled: cfg.mcpFinalSummaryEnabled ?? false,
        dualModelEnabled: cfg.dualModelEnabled ?? false,
        mcpUnlimitedIterations: cfg.mcpUnlimitedIterations ?? false,
        // Tool Execution
        mcpContextReductionEnabled: cfg.mcpContextReductionEnabled ?? true,
        mcpToolResponseProcessingEnabled: cfg.mcpToolResponseProcessingEnabled ?? true,
        mcpParallelToolExecution: cfg.mcpParallelToolExecution ?? true,
        // WhatsApp (extended)
        whatsappAllowFrom: cfg.whatsappAllowFrom ?? [],
        whatsappAutoReply: cfg.whatsappAutoReply ?? false,
        whatsappLogMessages: cfg.whatsappLogMessages ?? false,
        // Langfuse
        langfuseEnabled: cfg.langfuseEnabled ?? false,
        langfusePublicKey: cfg.langfusePublicKey ?? "",
        langfuseSecretKey: cfg.langfuseSecretKey ? "••••••••" : "",
        langfuseBaseUrl: cfg.langfuseBaseUrl ?? "",
      })
    } catch (error: any) {
      diagnosticsService.logError("remote-server", "Failed to get settings", error)
      return reply.code(500).send({ error: "Failed to get settings" })
    }
  })

  // PATCH /v1/settings - Update settings
  fastify.patch("/v1/settings", async (req, reply) => {
    try {
      const body = req.body as any
      const cfg = configStore.get()
      const updates: Partial<typeof cfg> = {}

      // Only allow updating specific settings
      if (typeof body.transcriptPostProcessingEnabled === "boolean") {
        updates.transcriptPostProcessingEnabled = body.transcriptPostProcessingEnabled
      }
      if (typeof body.mcpRequireApprovalBeforeToolCall === "boolean") {
        updates.mcpRequireApprovalBeforeToolCall = body.mcpRequireApprovalBeforeToolCall
      }
      if (typeof body.ttsEnabled === "boolean") {
        updates.ttsEnabled = body.ttsEnabled
      }
      if (typeof body.whatsappEnabled === "boolean") {
        updates.whatsappEnabled = body.whatsappEnabled
      }
      if (typeof body.mcpMaxIterations === "number" && body.mcpMaxIterations >= 1 && body.mcpMaxIterations <= 100) {
        // Coerce to integer to avoid surprising iteration counts with floats
        updates.mcpMaxIterations = Math.floor(body.mcpMaxIterations)
      }
      // Model settings
      const validProviders = ["openai", "groq", "gemini"]
      if (typeof body.mcpToolsProviderId === "string" && validProviders.includes(body.mcpToolsProviderId)) {
        updates.mcpToolsProviderId = body.mcpToolsProviderId as "openai" | "groq" | "gemini"
      }
      if (typeof body.mcpToolsOpenaiModel === "string") {
        updates.mcpToolsOpenaiModel = body.mcpToolsOpenaiModel
      }
      if (typeof body.mcpToolsGroqModel === "string") {
        updates.mcpToolsGroqModel = body.mcpToolsGroqModel
      }
      if (typeof body.mcpToolsGeminiModel === "string") {
        updates.mcpToolsGeminiModel = body.mcpToolsGeminiModel
      }
      // OpenAI compatible preset - validate against known preset IDs
      if (typeof body.currentModelPresetId === "string") {
        const { getBuiltInModelPresets } = await import("../shared/index")
        const builtInPresets = getBuiltInModelPresets()
        const savedPresets = cfg.modelPresets || []
        const builtInIds = new Set(builtInPresets.map(p => p.id))
        const allValidIds = new Set([...builtInIds, ...savedPresets.filter(p => !builtInIds.has(p.id)).map(p => p.id)])

        if (allValidIds.has(body.currentModelPresetId)) {
          updates.currentModelPresetId = body.currentModelPresetId
        }
        // If preset ID is invalid, silently ignore to avoid breaking client
      }
      // Streamer Mode
      if (typeof body.streamerModeEnabled === "boolean") {
        updates.streamerModeEnabled = body.streamerModeEnabled
      }
      // Speech-to-Text
      if (typeof body.sttLanguage === "string") {
        updates.sttLanguage = body.sttLanguage
      }
      if (typeof body.transcriptionPreviewEnabled === "boolean") {
        updates.transcriptionPreviewEnabled = body.transcriptionPreviewEnabled
      }
      if (typeof body.transcriptPostProcessingPrompt === "string") {
        updates.transcriptPostProcessingPrompt = body.transcriptPostProcessingPrompt
      }
      // Text-to-Speech
      if (typeof body.ttsAutoPlay === "boolean") {
        updates.ttsAutoPlay = body.ttsAutoPlay
      }
      if (typeof body.ttsPreprocessingEnabled === "boolean") {
        updates.ttsPreprocessingEnabled = body.ttsPreprocessingEnabled
      }
      if (typeof body.ttsRemoveCodeBlocks === "boolean") {
        updates.ttsRemoveCodeBlocks = body.ttsRemoveCodeBlocks
      }
      if (typeof body.ttsRemoveUrls === "boolean") {
        updates.ttsRemoveUrls = body.ttsRemoveUrls
      }
      if (typeof body.ttsConvertMarkdown === "boolean") {
        updates.ttsConvertMarkdown = body.ttsConvertMarkdown
      }
      if (typeof body.ttsUseLLMPreprocessing === "boolean") {
        updates.ttsUseLLMPreprocessing = body.ttsUseLLMPreprocessing
      }
      // Agent settings
      const validAgentModes = ["api", "acp"]
      if (typeof body.mainAgentMode === "string" && validAgentModes.includes(body.mainAgentMode)) {
        updates.mainAgentMode = body.mainAgentMode as "api" | "acp"
      }
      if (typeof body.mcpMessageQueueEnabled === "boolean") {
        updates.mcpMessageQueueEnabled = body.mcpMessageQueueEnabled
      }
      if (typeof body.mcpVerifyCompletionEnabled === "boolean") {
        updates.mcpVerifyCompletionEnabled = body.mcpVerifyCompletionEnabled
      }
      if (typeof body.mcpFinalSummaryEnabled === "boolean") {
        updates.mcpFinalSummaryEnabled = body.mcpFinalSummaryEnabled
      }

      if (typeof body.dualModelEnabled === "boolean") {
        updates.dualModelEnabled = body.dualModelEnabled
      }

      if (typeof body.mcpUnlimitedIterations === "boolean") {
        updates.mcpUnlimitedIterations = body.mcpUnlimitedIterations
      }
      // Tool Execution
      if (typeof body.mcpContextReductionEnabled === "boolean") {
        updates.mcpContextReductionEnabled = body.mcpContextReductionEnabled
      }
      if (typeof body.mcpToolResponseProcessingEnabled === "boolean") {
        updates.mcpToolResponseProcessingEnabled = body.mcpToolResponseProcessingEnabled
      }
      if (typeof body.mcpParallelToolExecution === "boolean") {
        updates.mcpParallelToolExecution = body.mcpParallelToolExecution
      }
      // WhatsApp (extended)
      if (Array.isArray(body.whatsappAllowFrom)) {
        updates.whatsappAllowFrom = body.whatsappAllowFrom.filter((n: unknown) => typeof n === "string")
      }
      if (typeof body.whatsappAutoReply === "boolean") {
        updates.whatsappAutoReply = body.whatsappAutoReply
      }
      if (typeof body.whatsappLogMessages === "boolean") {
        updates.whatsappLogMessages = body.whatsappLogMessages
      }
      // Langfuse
      if (typeof body.langfuseEnabled === "boolean") {
        updates.langfuseEnabled = body.langfuseEnabled
      }
      if (typeof body.langfusePublicKey === "string") {
        updates.langfusePublicKey = body.langfusePublicKey
      }
      if (typeof body.langfuseSecretKey === "string" && body.langfuseSecretKey !== "••••••••") {
        updates.langfuseSecretKey = body.langfuseSecretKey
      }
      if (typeof body.langfuseBaseUrl === "string") {
        updates.langfuseBaseUrl = body.langfuseBaseUrl
      }

      if (Object.keys(updates).length === 0) {
        return reply.code(400).send({ error: "No valid settings to update" })
      }

      configStore.save({ ...cfg, ...updates })
      diagnosticsService.logInfo("remote-server", `Updated settings: ${Object.keys(updates).join(", ")}`)

      // Trigger WhatsApp MCP server lifecycle if whatsappEnabled changed
      if (updates.whatsappEnabled !== undefined) {
        try {
          const prevEnabled = cfg.whatsappEnabled ?? false
          await handleWhatsAppToggle(prevEnabled, updates.whatsappEnabled)
        } catch (_e) {
          // lifecycle is best-effort
        }
      }

      return reply.send({
        success: true,
        updated: Object.keys(updates),
      })
    } catch (error: any) {
      diagnosticsService.logError("remote-server", "Failed to update settings", error)
      return reply.code(500).send({ error: error?.message || "Failed to update settings" })
    }
  })

  // ============================================
  // Conversation Recovery Endpoints (for mobile app)
  // ============================================

  // GET /v1/conversations/:id - Fetch conversation state for recovery
  fastify.get("/v1/conversations/:id", async (req, reply) => {
    try {
      const params = req.params as { id: string }
      const conversationId = params.id

      if (!conversationId || typeof conversationId !== "string") {
        return reply.code(400).send({ error: "Missing or invalid conversation ID" })
      }

      // Validate conversation ID format to prevent path traversal attacks
      const conversationIdError = getConversationIdValidationError(conversationId)
      if (conversationIdError) {
        return reply.code(400).send({ error: conversationIdError })
      }

      const conversation = await conversationService.loadConversation(conversationId)

      if (!conversation) {
        return reply.code(404).send({ error: "Conversation not found" })
      }

      diagnosticsService.logInfo("remote-server", `Fetched conversation ${conversationId} for recovery`)

      return reply.send({
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messages: conversation.messages.map(msg => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
          toolCalls: msg.toolCalls,
          toolResults: msg.toolResults,
        })),
        metadata: conversation.metadata,
      })
    } catch (error: any) {
      diagnosticsService.logError("remote-server", "Failed to fetch conversation", error)
      return reply.code(500).send({ error: error?.message || "Failed to fetch conversation" })
    }
  })

  // ============================================
  // Push Notification Endpoints (for mobile app)
  // ============================================

  // POST /v1/push/register - Register a push notification token
  fastify.post("/v1/push/register", async (req, reply) => {
    try {
      const body = req.body as { token?: string; type?: string; platform?: string; deviceId?: string }

      if (!body.token || typeof body.token !== "string") {
        return reply.code(400).send({ error: "Missing or invalid token" })
      }

      if (!body.platform || !["ios", "android"].includes(body.platform)) {
        return reply.code(400).send({ error: "Invalid platform. Must be 'ios' or 'android'" })
      }

      const cfg = configStore.get()
      const existingTokens = cfg.pushNotificationTokens || []

      // Check if token already exists
      const existingIndex = existingTokens.findIndex(t => t.token === body.token)
      const newToken = {
        token: body.token,
        type: "expo" as const,
        platform: body.platform as "ios" | "android",
        registeredAt: Date.now(),
        deviceId: body.deviceId,
      }

      let updatedTokens: typeof existingTokens
      if (existingIndex >= 0) {
        // Update existing token
        updatedTokens = [...existingTokens]
        updatedTokens[existingIndex] = newToken
        diagnosticsService.logInfo("remote-server", `Updated push notification token for ${body.platform}`)
      } else {
        // Add new token
        updatedTokens = [...existingTokens, newToken]
        diagnosticsService.logInfo("remote-server", `Registered new push notification token for ${body.platform}`)
      }

      configStore.save({ ...cfg, pushNotificationTokens: updatedTokens })

      return reply.send({
        success: true,
        message: existingIndex >= 0 ? "Token updated" : "Token registered",
        tokenCount: updatedTokens.length,
      })
    } catch (error: any) {
      diagnosticsService.logError("remote-server", "Failed to register push token", error)
      return reply.code(500).send({ error: error?.message || "Failed to register push token" })
    }
  })

  // POST /v1/push/unregister - Unregister a push notification token
  fastify.post("/v1/push/unregister", async (req, reply) => {
    try {
      const body = req.body as { token?: string }

      if (!body.token || typeof body.token !== "string") {
        return reply.code(400).send({ error: "Missing or invalid token" })
      }

      const cfg = configStore.get()
      const existingTokens = cfg.pushNotificationTokens || []

      const filteredTokens = existingTokens.filter(t => t.token !== body.token)
      const removed = existingTokens.length > filteredTokens.length

      if (removed) {
        configStore.save({ ...cfg, pushNotificationTokens: filteredTokens })
        diagnosticsService.logInfo("remote-server", "Unregistered push notification token")
      }

      return reply.send({
        success: true,
        message: removed ? "Token unregistered" : "Token not found",
        tokenCount: filteredTokens.length,
      })
    } catch (error: any) {
      diagnosticsService.logError("remote-server", "Failed to unregister push token", error)
      return reply.code(500).send({ error: error?.message || "Failed to unregister push token" })
    }
  })

  // GET /v1/push/status - Get push notification status
  fastify.get("/v1/push/status", async (_req, reply) => {
    try {
      const cfg = configStore.get()
      const tokens = cfg.pushNotificationTokens || []

      return reply.send({
        enabled: tokens.length > 0,
        tokenCount: tokens.length,
        platforms: [...new Set(tokens.map(t => t.platform))],
      })
    } catch (error: any) {
      diagnosticsService.logError("remote-server", "Failed to get push status", error)
      return reply.code(500).send({ error: error?.message || "Failed to get push status" })
    }
  })

  // POST /v1/push/clear-badge - Clear badge count for a token (called when mobile app opens)
  fastify.post("/v1/push/clear-badge", async (req, reply) => {
    try {
      const body = req.body as { token?: string }

      if (!body.token || typeof body.token !== "string") {
        return reply.code(400).send({ error: "Missing or invalid token" })
      }

      clearBadgeCount(body.token)

      return reply.send({ success: true })
    } catch (error: any) {
      diagnosticsService.logError("remote-server", "Failed to clear badge count", error)
      return reply.code(500).send({ error: error?.message || "Failed to clear badge count" })
    }
  })

  // Helper function to validate message objects
  const validateMessages = (messages: Array<{ role: string; content: unknown }>): string | null => {
    const validRoles = ["user", "assistant", "tool"]
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      if (msg === null || msg === undefined || typeof msg !== "object") {
        return `Invalid message ${i}: expected an object`
      }
      if (!msg.role || !validRoles.includes(msg.role)) {
        return `Invalid role in message ${i}: expected one of ${validRoles.join(", ")}`
      }
      if (typeof msg.content !== "string") {
        return `Invalid content in message ${i}: expected string`
      }
    }
    return null
  }

  // GET /v1/conversations - List all conversations
  fastify.get("/v1/conversations", async (_req, reply) => {
    try {
      const conversations = await conversationService.getConversationHistory()
      diagnosticsService.logInfo("remote-server", `Listed ${conversations.length} conversations`)
      return reply.send({ conversations })
    } catch (error: any) {
      diagnosticsService.logError("remote-server", "Failed to list conversations", error)
      return reply.code(500).send({ error: error?.message || "Failed to list conversations" })
    }
  })

  // POST /v1/conversations - Create a new conversation from mobile data
  fastify.post("/v1/conversations", async (req, reply) => {
    try {
      // Validate request body is a valid object
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        return reply.code(400).send({ error: "Request body must be a JSON object" })
      }

      const body = req.body as {
        title?: string
        messages: Array<{
          role: "user" | "assistant" | "tool"
          content: string
          timestamp?: number
          toolCalls?: Array<{ name: string; arguments: any }>
          toolResults?: Array<{ success: boolean; content: string; error?: string }>
        }>
        createdAt?: number
        updatedAt?: number
      }

      if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
        return reply.code(400).send({ error: "Missing or invalid messages array" })
      }

      // Validate each message object
      const validationError = validateMessages(body.messages)
      if (validationError) {
        return reply.code(400).send({ error: validationError })
      }

      const conversationId = conversationService.generateConversationIdPublic()
      const now = Date.now()

      // Generate title from first message if not provided
      const firstMessageContent = body.messages[0]?.content || ""
      const title = body.title || (firstMessageContent.length > 50
        ? `${firstMessageContent.slice(0, 50)}...`
        : firstMessageContent || "New Conversation")

      // Convert input messages to ConversationMessage format with IDs
      const messages = body.messages.map((msg, index) => ({
        id: `msg_${now}_${index}_${Math.random().toString(36).substr(2, 9)}`,
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp ?? now,
        toolCalls: msg.toolCalls,
        toolResults: msg.toolResults,
      }))

      const conversation = {
        id: conversationId,
        title,
        createdAt: body.createdAt ?? now,
        updatedAt: body.updatedAt ?? now,
        messages,
      }

      await conversationService.saveConversation(conversation, true)
      diagnosticsService.logInfo("remote-server", `Created conversation ${conversationId} with ${messages.length} messages`)

      // Notify renderer that conversation history has changed (for sidebar refresh)
      notifyConversationHistoryChanged()

      return reply.code(201).send({
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messages: conversation.messages.map(msg => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
          toolCalls: msg.toolCalls,
          toolResults: msg.toolResults,
        })),
      })
    } catch (error: any) {
      diagnosticsService.logError("remote-server", "Failed to create conversation", error)
      return reply.code(500).send({ error: error?.message || "Failed to create conversation" })
    }
  })

  // PUT /v1/conversations/:id - Update an existing conversation
  fastify.put("/v1/conversations/:id", async (req, reply) => {
    try {
      const params = req.params as { id: string }
      const conversationId = params.id

      if (!conversationId || typeof conversationId !== "string") {
        return reply.code(400).send({ error: "Missing or invalid conversation ID" })
      }

      // Validate conversation ID format to prevent path traversal attacks
      const conversationIdError = getConversationIdValidationError(conversationId)
      if (conversationIdError) {
        return reply.code(400).send({ error: conversationIdError })
      }

      // Validate request body is a valid object
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        return reply.code(400).send({ error: "Request body must be a JSON object" })
      }

      const body = req.body as {
        title?: string
        messages?: Array<{
          role: "user" | "assistant" | "tool"
          content: string
          timestamp?: number
          toolCalls?: Array<{ name: string; arguments: any }>
          toolResults?: Array<{ success: boolean; content: string; error?: string }>
        }>
        updatedAt?: number
      }

      const now = Date.now()
      let conversation = await conversationService.loadConversation(conversationId)

      if (!conversation) {
        // Create new conversation with the provided ID
        if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
          return reply.code(400).send({ error: "Conversation not found and no messages provided to create it" })
        }

        // Validate each message object
        const validationError = validateMessages(body.messages)
        if (validationError) {
          return reply.code(400).send({ error: validationError })
        }

        const firstMessageContent = body.messages[0]?.content || ""
        const title = body.title || (firstMessageContent.length > 50
          ? `${firstMessageContent.slice(0, 50)}...`
          : firstMessageContent || "New Conversation")

        const messages = body.messages.map((msg, index) => ({
          id: `msg_${now}_${index}_${Math.random().toString(36).substr(2, 9)}`,
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp ?? now,
          toolCalls: msg.toolCalls,
          toolResults: msg.toolResults,
        }))

        conversation = {
          id: conversationId,
          title,
          createdAt: now,
          updatedAt: body.updatedAt ?? now,
          messages,
        }

        await conversationService.saveConversation(conversation, true)
        diagnosticsService.logInfo("remote-server", `Created conversation ${conversationId} via PUT with ${messages.length} messages`)
      } else {
        // Update existing conversation
        if (body.title !== undefined) {
          conversation.title = body.title
        }

        if (body.messages !== undefined && !Array.isArray(body.messages)) {
          return reply.code(400).send({ error: "messages field must be an array" })
        }

        if (body.messages && Array.isArray(body.messages)) {
          // Validate each message object
          const validationError = validateMessages(body.messages)
          if (validationError) {
            return reply.code(400).send({ error: validationError })
          }

          conversation.messages = body.messages.map((msg, index) => ({
            id: `msg_${now}_${index}_${Math.random().toString(36).substr(2, 9)}`,
            role: msg.role,
            content: msg.content,
            timestamp: msg.timestamp ?? now,
            toolCalls: msg.toolCalls,
            toolResults: msg.toolResults,
          }))
        }

        conversation.updatedAt = body.updatedAt ?? now

        await conversationService.saveConversation(conversation, true)
        diagnosticsService.logInfo("remote-server", `Updated conversation ${conversationId}`)
      }

      // Notify renderer that conversation history has changed (for sidebar refresh)
      notifyConversationHistoryChanged()

      return reply.send({
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messages: conversation.messages.map(msg => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
          toolCalls: msg.toolCalls,
          toolResults: msg.toolResults,
        })),
      })
    } catch (error: any) {
      diagnosticsService.logError("remote-server", "Failed to update conversation", error)
      return reply.code(500).send({ error: error?.message || "Failed to update conversation" })
    }
  })

  // Kill switch endpoint - emergency stop all agent sessions
  fastify.post("/v1/emergency-stop", async (_req, reply) => {
    console.log("[KILLSWITCH] /v1/emergency-stop endpoint called")
    try {
      console.log("[KILLSWITCH] Loading emergency-stop module...")
      diagnosticsService.logInfo("remote-server", "Emergency stop triggered via API")

      console.log("[KILLSWITCH] Calling emergencyStopAll()...")
      const { before, after } = await emergencyStopAll()

      console.log(`[KILLSWITCH] Emergency stop completed. Killed ${before} processes. Remaining: ${after}`)
      diagnosticsService.logInfo(
        "remote-server",
        `Emergency stop completed. Killed ${before} processes. Remaining: ${after}`,
      )

      return reply.send({
        success: true,
        message: "Emergency stop executed",
        processesKilled: before,
        processesRemaining: after,
      })
    } catch (error: any) {
      console.error("[KILLSWITCH] Error during emergency stop:", error)
      diagnosticsService.logError("remote-server", "Emergency stop error", error)
      return reply.code(500).send({
        success: false,
        error: error?.message || "Emergency stop failed",
      })
    }
  })

  // MCP Protocol Endpoints - Expose SpeakMCP builtin tools to external agents
  // These endpoints implement a simplified MCP-over-HTTP protocol

  // POST /mcp/tools/list - List all available builtin tools
  fastify.post("/mcp/tools/list", async (_req, reply) => {
    try {
      const { isBuiltinTool } = await import("./builtin-tools")

      // Convert to MCP format
      const tools = mcpService
        .getAvailableTools()
        .filter((tool) => isBuiltinTool(tool.name))
        .map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }))

      return reply.send({
        tools,
      })
    } catch (error: any) {
      diagnosticsService.logError("remote-server", "MCP tools/list error", error)
      return reply.code(500).send({ error: error?.message || "Failed to list tools" })
    }
  })

  // POST /mcp/tools/call - Execute a builtin tool
  fastify.post("/mcp/tools/call", async (req, reply) => {
    try {
      const body = req.body as any
      const { name, arguments: args } = body

      if (!name || typeof name !== "string") {
        return reply.code(400).send({ error: "Missing or invalid 'name' parameter" })
      }

      const { isBuiltinTool } = await import("./builtin-tools")

      // Validate that this is a builtin tool
      if (!isBuiltinTool(name)) {
        return reply.code(400).send({ error: `Unknown builtin tool: ${name}` })
      }

      // Execute the tool (go through MCPService so allowlist/disabled checks are enforced)
      const result = await mcpService.executeToolCall({ name, arguments: args || {} } as any, undefined, false)

      if (!result) {
        return reply.code(500).send({ error: "Tool execution returned null" })
      }

      // Return in MCP format
      return reply.send({
        content: result.content,
        isError: result.isError,
      })
    } catch (error: any) {
      diagnosticsService.logError("remote-server", "MCP tools/call error", error)
      return reply.code(500).send({
        content: [{ type: "text", text: error?.message || "Tool execution failed" }],
        isError: true,
      })
    }
  })

  // ============================================
  // Skills Management Endpoints (for mobile app)
  // ============================================

  // GET /v1/skills - List all skills
  fastify.get("/v1/skills", async (_req, reply) => {
    try {
      const skills = skillsService.getSkills()
      const currentProfile = agentProfileService.getCurrentProfile()
      const enabledSkillIds = currentProfile?.skillsConfig?.enabledSkillIds || []

      return reply.send({
        skills: skills.map(s => ({
          id: s.id,
          name: s.name,
          description: s.description,
          enabledForProfile: enabledSkillIds.includes(s.id),
          source: s.source,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })),
        currentProfileId: currentProfile?.id,
      })
    } catch (error: any) {
      diagnosticsService.logError("remote-server", "Failed to get skills", error)
      return reply.code(500).send({ error: "Failed to get skills" })
    }
  })

  // POST /v1/skills/:id/toggle-profile - Toggle skill for current profile
  fastify.post("/v1/skills/:id/toggle-profile", async (req, reply) => {
    try {
      const params = req.params as { id: string }

      // Validate the skill exists
      const skills = skillsService.getSkills()
      const skillExists = skills.some(s => s.id === params.id)
      if (!skillExists) {
        return reply.code(404).send({ error: "Skill not found" })
      }

      const currentProfile = agentProfileService.getCurrentProfile()
      if (!currentProfile) {
        return reply.code(400).send({ error: "No current profile set" })
      }

      const updatedProfile = agentProfileService.toggleProfileSkill(currentProfile.id, params.id)
      const newEnabledSkillIds = updatedProfile?.skillsConfig?.enabledSkillIds || []

      return reply.send({
        success: true,
        skillId: params.id,
        enabledForProfile: newEnabledSkillIds.includes(params.id),
      })
    } catch (error: any) {
      diagnosticsService.logError("remote-server", "Failed to toggle skill", error)
      return reply.code(500).send({ error: error?.message || "Failed to toggle skill" })
    }
  })

  // ============================================
  // Memories Management Endpoints (for mobile app)
  // ============================================

  // GET /v1/memories - List all memories
  fastify.get("/v1/memories", async (req, reply) => {
    try {
      const memories = await memoryService.getAllMemories()

      return reply.send({
        memories: memories.map(m => ({
          id: m.id,
          title: m.title,
          content: m.content,
          tags: m.tags,
          importance: m.importance,
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
        })),
      })
    } catch (error: any) {
      diagnosticsService.logError("remote-server", "Failed to get memories", error)
      return reply.code(500).send({ error: "Failed to get memories" })
    }
  })

  // DELETE /v1/memories/:id - Delete a memory
  fastify.delete("/v1/memories/:id", async (req, reply) => {
    try {
      const params = req.params as { id: string }

      // Check if memory exists before attempting deletion
      const memory = await memoryService.getMemory(params.id)
      if (!memory) {
        return reply.code(404).send({ error: "Memory not found" })
      }

      const success = await memoryService.deleteMemory(params.id)
      if (!success) {
        return reply.code(500).send({ error: "Failed to persist memory deletion" })
      }

      return reply.send({ success: true, id: params.id })
    } catch (error: any) {
      diagnosticsService.logError("remote-server", "Failed to delete memory", error)
      return reply.code(500).send({ error: error?.message || "Failed to delete memory" })
    }
  })

  // ============================================
  // Agent Management Endpoints (for mobile app)
  // ============================================

  // GET /v1/agent-profiles - List all agent profiles (supports ?role=user-profile|delegation-target|external-agent filter)
  fastify.get("/v1/agent-profiles", async (req, reply) => {
    try {
      const query = req.query as { role?: string }
      let profiles = agentProfileService.getAll()

      // Filter by role if specified
      if (query.role) {
        profiles = profiles.filter(p => {
          const role = p.role || (p.isUserProfile ? "user-profile" : p.isAgentTarget ? "delegation-target" : "delegation-target")
          return role === query.role
        })
      }

      return reply.send({
        profiles: profiles.map(p => ({
          id: p.id,
          name: p.name,
          displayName: p.displayName,
          description: p.description,
          enabled: p.enabled,
          isBuiltIn: p.isBuiltIn,
          isUserProfile: p.isUserProfile,
          isAgentTarget: p.isAgentTarget,
          isDefault: p.isDefault,
          role: p.role,
          connectionType: p.connection.type,
          autoSpawn: p.autoSpawn,
          guidelines: p.guidelines,
          systemPrompt: p.systemPrompt,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        })),
      })
    } catch (error: any) {
      diagnosticsService.logError("remote-server", "Failed to get agent profiles", error)
      return reply.code(500).send({ error: "Failed to get agent profiles" })
    }
  })

  // POST /v1/agent-profiles/:id/toggle - Toggle agent profile enabled state
  fastify.post("/v1/agent-profiles/:id/toggle", async (req, reply) => {
    try {
      const params = req.params as { id: string }
      const profile = agentProfileService.getById(params.id)

      if (!profile) {
        return reply.code(404).send({ error: "Agent profile not found" })
      }

      const updated = agentProfileService.update(params.id, {
        enabled: !profile.enabled,
      })

      return reply.send({
        success: true,
        id: params.id,
        enabled: updated?.enabled ?? !profile.enabled,
      })
    } catch (error: any) {
      diagnosticsService.logError("remote-server", "Failed to toggle agent profile", error)
      return reply.code(500).send({ error: error?.message || "Failed to toggle agent profile" })
    }
  })

  // ============================================
  // Repeat Tasks Management Endpoints (for mobile app)
  // ============================================

  // GET /v1/loops - List all repeat tasks
  fastify.get("/v1/loops", async (_req, reply) => {
    try {
      const cfg = configStore.get()
      const loops = cfg.loops || []
      const profiles = agentProfileService.getUserProfiles()

      // Get repeat task runtime statuses if available
      let statuses: Array<{ id: string; isRunning: boolean; nextRunAt?: number; lastRunAt?: number }> = []
      try {
        const { loopService } = await import("./loop-service")
        statuses = loopService.getLoopStatuses()
      } catch {
        // Repeat task service might not be initialized
      }

      const statusById = new Map(statuses.map(s => [s.id, s]))

      return reply.send({
        loops: loops.map(l => {
          const status = statusById.get(l.id)
          const profile = l.profileId ? profiles.find(p => p.id === l.profileId) : undefined
          return {
            id: l.id,
            name: l.name,
            prompt: l.prompt,
            intervalMinutes: l.intervalMinutes,
            enabled: l.enabled,
            profileId: l.profileId,
            profileName: profile?.displayName,
            runOnStartup: l.runOnStartup,
            lastRunAt: status?.lastRunAt ?? l.lastRunAt,
            isRunning: status?.isRunning ?? false,
            nextRunAt: status?.nextRunAt,
          }
        }),
      })
    } catch (error: any) {
      diagnosticsService.logError("remote-server", "Failed to get repeat tasks", error)
      return reply.code(500).send({ error: "Failed to get repeat tasks" })
    }
  })

  // POST /v1/loops/:id/toggle - Toggle repeat task enabled state
  fastify.post("/v1/loops/:id/toggle", async (req, reply) => {
    try {
      const params = req.params as { id: string }
      const cfg = configStore.get()
      const loops = cfg.loops || []
      const loopIndex = loops.findIndex(l => l.id === params.id)

      if (loopIndex === -1) {
        return reply.code(404).send({ error: "Repeat task not found" })
      }

      const updatedLoops = [...loops]
      updatedLoops[loopIndex] = {
        ...updatedLoops[loopIndex],
        enabled: !updatedLoops[loopIndex].enabled,
      }

      configStore.save({ ...cfg, loops: updatedLoops })

      // Start or stop the loop scheduling to match the new enabled state
      try {
        const { loopService } = await import("./loop-service")
        const newEnabled = updatedLoops[loopIndex].enabled
        if (newEnabled) {
          loopService.startLoop(params.id)
        } else {
          loopService.stopLoop(params.id)
        }
      } catch {
        // Repeat task service might not be initialized
      }

      return reply.send({
        success: true,
        id: params.id,
        enabled: updatedLoops[loopIndex].enabled,
      })
    } catch (error: any) {
      diagnosticsService.logError("remote-server", "Failed to toggle repeat task", error)
      return reply.code(500).send({ error: error?.message || "Failed to toggle repeat task" })
    }
  })

  // POST /v1/loops/:id/run - Run a repeat task immediately
  fastify.post("/v1/loops/:id/run", async (req, reply) => {
    try {
      const params = req.params as { id: string }

      // First check if the repeat task exists in config
      const cfg = configStore.get()
      const loops = cfg.loops || []
      const loopExists = loops.some(l => l.id === params.id)
      if (!loopExists) {
        return reply.code(404).send({ error: "Repeat task not found" })
      }

      const { loopService } = await import("./loop-service")
      const triggered = await loopService.triggerLoop(params.id)

      if (!triggered) {
        return reply.code(409).send({ error: "Task is already running" })
      }

      return reply.send({ success: true, id: params.id })
    } catch (error: any) {
      diagnosticsService.logError("remote-server", "Failed to run repeat task", error)
      return reply.code(500).send({ error: error?.message || "Failed to run repeat task" })
    }
  })

  try {
    await fastify.listen({ port, host: bind })
    diagnosticsService.logInfo(
      "remote-server",
      `Remote server listening at http://${bind}:${port}/v1`,
    )
    server = fastify

    // Print QR code to terminal for mobile app pairing
    // Auto-print in headless environments, or when explicitly requested
    // Skip if caller handles QR printing separately (e.g., --qr mode)
    // Suppress when streamer mode is enabled to prevent credential leakage
    if (!skipAutoPrintQR) {
      const currentCfg = configStore.get()
      if (currentCfg.remoteServerApiKey && !currentCfg.streamerModeEnabled) {
        // Use connectable IP for QR code (not 0.0.0.0 or 127.0.0.1)
        const connectableIp = getConnectableIp(bind)
        const serverUrl = `http://${connectableIp}:${port}/v1`

        // In headless environments, always print the QR code
        // Otherwise, print if terminal QR is explicitly enabled
        if (isHeadlessEnvironment() || currentCfg.remoteServerTerminalQrEnabled) {
          await printTerminalQRCode(serverUrl, currentCfg.remoteServerApiKey)
        }
      }
    }

    return { running: true, bind, port }
  } catch (err: any) {
    lastError = err?.message || String(err)
    diagnosticsService.logError("remote-server", "Failed to start server", err)
    server = null
    return { running: false, error: lastError }
  }
}

export async function stopRemoteServer() {
  if (server) {
    try {
      await server.close()
      diagnosticsService.logInfo("remote-server", "Remote server stopped")
    } catch (err) {
      diagnosticsService.logError("remote-server", "Error stopping server", err)
    } finally {
      server = null
    }
  }
}

export async function restartRemoteServer() {
  await stopRemoteServer()
  return startRemoteServer()
}

export function getRemoteServerStatus() {
  const cfg = configStore.get()
  const bind = cfg.remoteServerBindAddress || "127.0.0.1"
  const port = cfg.remoteServerPort || 3210
  const running = !!server
  const url = running ? `http://${bind}:${port}/v1` : undefined
  return { running, url, bind, port, lastError }
}

/**
 * Prints the QR code to the terminal for mobile app pairing
 * Can be called manually when the user wants to see the QR code
 * @param urlOverride Optional URL to use instead of the local server URL (e.g., Cloudflare tunnel URL)
 * @returns true if QR code was printed successfully, false if server is not running, no API key, streamer mode enabled, or QR generation failed
 */
export async function printQRCodeToTerminal(urlOverride?: string): Promise<boolean> {
  const cfg = configStore.get()
  if (!server || !cfg.remoteServerApiKey) {
    console.log("[Remote Server] Cannot print QR code: server not running or no API key configured")
    return false
  }

  // Suppress QR output when streamer mode is enabled to prevent credential leakage
  if (cfg.streamerModeEnabled) {
    console.log("[Remote Server] Cannot print QR code: streamer mode is enabled")
    return false
  }

  let serverUrl: string
  if (urlOverride) {
    // Use the override URL (e.g., Cloudflare tunnel URL)
    // Ensure it ends with /v1
    serverUrl = urlOverride.endsWith("/v1") ? urlOverride : `${urlOverride}/v1`
  } else {
    const bind = cfg.remoteServerBindAddress || "127.0.0.1"
    const port = cfg.remoteServerPort || 3210
    // Use connectable IP for QR code (not 0.0.0.0 or 127.0.0.1)
    const connectableIp = getConnectableIp(bind)
    serverUrl = `http://${connectableIp}:${port}/v1`
  }

  // Return the actual result from printTerminalQRCode to indicate success/failure
  return await printTerminalQRCode(serverUrl, cfg.remoteServerApiKey)
}
