import Fastify, { FastifyInstance } from "fastify"
import cors from "@fastify/cors"
import crypto from "crypto"
import fs from "fs"
import path from "path"
import { configStore, recordingsFolder } from "./config"
import { diagnosticsService } from "./diagnostics"
import { mcpService, MCPToolResult } from "./mcp-service"
import { processTranscriptWithAgentMode } from "./llm"
import { state, agentProcessManager } from "./state"
import { conversationService } from "./conversation-service"

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
  // OpenAI content parts array style
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

    // Prefer last user message
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

    // Fallback: prompt or input
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
}

async function runAgent(options: RunAgentOptions): Promise<{ content: string; conversationId: string }> {
  const { prompt, conversationId: inputConversationId } = options
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

      // Debug: Log the conversation history order
      console.log("[remote-server] ====== CONVERSATION HISTORY ======")
      console.log("[remote-server] Total messages in conversation:", updatedConversation.messages.length)
      console.log("[remote-server] Messages to use as history (excluding current):", messagesToConvert.length)
      messagesToConvert.forEach((msg, i) => {
        console.log(`[remote-server] History[${i}]: ${msg.role} - "${msg.content.substring(0, 50)}..."`)
      })
      console.log("[remote-server] Current user message (will be added by LLM):", prompt.substring(0, 50))

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
  const { agentSessionTracker } = await import("./agent-session-tracker")
  let existingSessionId: string | undefined
  if (inputConversationId) {
    const foundSessionId = agentSessionTracker.findSessionByConversationId(inputConversationId)
    if (foundSessionId) {
      const revived = agentSessionTracker.reviveSession(foundSessionId)
      if (revived) {
        existingSessionId = foundSessionId
        diagnosticsService.logInfo("remote-server", `Revived existing session ${existingSessionId}`)
      }
    }
  }

  // Start or reuse agent session
  const conversationTitle = prompt.length > 50 ? prompt.substring(0, 50) + "..." : prompt
  const sessionId = existingSessionId || agentSessionTracker.startSession(conversationId, conversationTitle)

  try {
    await mcpService.initialize()
    mcpService.registerExistingProcessesWithAgentManager()

    const availableTools = mcpService.getAvailableTools()
    const executeToolCall = async (toolCall: any, onProgress?: (message: string) => void): Promise<MCPToolResult> => {
      return await mcpService.executeToolCall(toolCall, onProgress)
    }

    const agentResult = await processTranscriptWithAgentMode(
      prompt,
      availableTools,
      executeToolCall,
      cfg.mcpMaxIterations ?? 10,
      previousConversationHistory,
      conversationId,
      sessionId, // Pass session ID for progress routing
    )

    // Mark session as completed
    agentSessionTracker.completeSession(sessionId, "Agent completed successfully")

    return { content: agentResult.content, conversationId }
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
    origin: corsOrigins,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    maxAge: 86400, // Cache preflight for 24 hours
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

      // Debug logging
      console.log("[remote-server] ====== CHAT REQUEST ======")
      console.log("[remote-server] Received conversation_id:", conversationId || "NONE (new conversation)")
      console.log("[remote-server] Prompt:", prompt.substring(0, 100))
      diagnosticsService.logInfo("remote-server", `Handling completion request${conversationId ? ` for conversation ${conversationId}` : ""}`)

      const result = await runAgent({ prompt, conversationId })

      // Record as if user submitted a text input
      recordHistory(result.content)

      const model = resolveActiveModelId(configStore.get())
      // Return standard OpenAI response with conversation_id as custom field
      const response = toOpenAIChatResponse(result.content, model)

      // Debug logging
      console.log("[remote-server] ====== CHAT RESPONSE ======")
      console.log("[remote-server] Returning conversation_id:", result.conversationId)
      console.log("[remote-server] Response length:", result.content.length)

      return reply.send({
        ...response,
        conversation_id: result.conversationId, // Include conversation_id for client to use in follow-ups
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

  // Kill switch endpoint - emergency stop all agent sessions
  fastify.post("/v1/emergency-stop", async (_req, reply) => {
    console.log("[KILLSWITCH] /v1/emergency-stop endpoint called")
    try {
      console.log("[KILLSWITCH] Loading emergency-stop module...")
      diagnosticsService.logInfo("remote-server", "Emergency stop triggered via API")

      const { emergencyStopAll } = await import("./emergency-stop")
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

