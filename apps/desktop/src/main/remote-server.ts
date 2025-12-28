import Fastify, { FastifyInstance } from "fastify"
import cors from "@fastify/cors"
import crypto from "crypto"
import fs from "fs"
import path from "path"
import { configStore, recordingsFolder } from "./config"
import { diagnosticsService } from "./diagnostics"
import { mcpService, MCPToolResult } from "./mcp-service"
import { processTranscriptWithAgentMode } from "./llm"
import { state, agentProcessManager, agentSessionStateManager } from "./state"
import { conversationService } from "./conversation-service"
import { AgentProgressUpdate, SessionProfileSnapshot } from "../shared/types"
import { agentSessionTracker } from "./agent-session-tracker"
import { emergencyStopAll } from "./emergency-stop"
import { profileService } from "./profile-service"

let server: FastifyInstance | null = null
let lastError: string | undefined

function redact(value?: string) {
  if (!value) return ""
  if (value.length <= 8) return "***"
  return `${value.slice(0, 4)}...${value.slice(-4)}`
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
      // Conversation not found, start fresh
      diagnosticsService.logInfo("remote-server", `Conversation ${conversationId} not found, starting fresh`)
      conversationId = undefined
    }
  }

  // Create a new conversation if none exists
  if (!conversationId) {
    const newConversation = await conversationService.createConversation(prompt, "user")
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
      // Pass profileSnapshot.mcpServerConfig for session-aware server availability checks
      return await mcpService.executeToolCall(toolCall, onProgress, false, profileSnapshot?.mcpServerConfig)
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

    return { content: agentResult.content, conversationId, conversationHistory: formattedHistory }
  } catch (error) {
    // Mark session as errored
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    agentSessionTracker.errorSession(sessionId, errorMessage)
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

export async function startRemoteServer() {
  const cfg = configStore.get()
  if (!cfg.remoteServerEnabled) {
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
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
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
      const conversationId = typeof body.conversation_id === "string" ? body.conversation_id : undefined
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
      const profiles = profileService.getProfiles()
      const currentProfile = profileService.getCurrentProfile()
      return reply.send({
        profiles: profiles.map(p => ({
          id: p.id,
          name: p.name,
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
      const profile = profileService.getCurrentProfile()
      if (!profile) {
        return reply.code(404).send({ error: "No current profile set" })
      }
      return reply.send({
        id: profile.id,
        name: profile.name,
        isDefault: profile.isDefault,
        guidelines: profile.guidelines,
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
      const profile = profileService.setCurrentProfile(profileId)
      // Apply the profile's MCP configuration
      mcpService.applyProfileMcpConfig(
        profile.mcpServerConfig?.disabledServers,
        profile.mcpServerConfig?.disabledTools,
        profile.mcpServerConfig?.allServersDisabledByDefault,
        profile.mcpServerConfig?.enabledServers
      )
      diagnosticsService.logInfo("remote-server", `Switched to profile: ${profile.name}`)
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
        // Agent settings
        mcpMaxIterations: cfg.mcpMaxIterations ?? 10,
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

      if (Object.keys(updates).length === 0) {
        return reply.code(400).send({ error: "No valid settings to update" })
      }

      configStore.save({ ...cfg, ...updates })
      diagnosticsService.logInfo("remote-server", `Updated settings: ${Object.keys(updates).join(", ")}`)

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

  try {
    await fastify.listen({ port, host: bind })
    diagnosticsService.logInfo(
      "remote-server",
      `Remote server listening at http://${bind}:${port}/v1`,
    )
    server = fastify
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

