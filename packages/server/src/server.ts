/**
 * SpeakMCP Standalone Server
 * HTTP API server with OpenAI-compatible endpoints
 */

import Fastify, { FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import crypto from 'crypto'

import { configStore } from './config'
import { diagnosticsService } from './services/diagnostics'
import { mcpService, handleWhatsAppToggle } from './services/mcp-service'
import { profileService } from './services/profile-service'
import { conversationService } from './services/conversation-service'
import { emergencyStopAll } from './services/emergency-stop'
import { state, agentSessionStateManager } from './services/state'
import { executeBuiltinTool, isBuiltinTool, builtinTools } from './services/builtin-tools'
import { processTranscriptWithAgentMode, type ConversationHistoryEntry } from './services/llm'
import type { AgentProgressUpdate, MCPToolResult } from './types'

let server: FastifyInstance | null = null
let lastError: string | undefined

// Server configuration interface
export interface ServerOptions {
  port?: number
  bind?: string
  apiKey?: string
  corsOrigins?: string[]
  logLevel?: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'
}

function redact(value?: string) {
  if (!value) return ""
  if (value.length <= 8) return "***"
  return `${value.slice(0, 4)}...${value.slice(-4)}`
}

function resolveActiveModelId(cfg: Record<string, unknown>): string {
  const provider = (cfg.mcpToolsProviderId as string) || "openai"
  if (provider === "openai") return (cfg.mcpToolsOpenaiModel as string) || "gpt-4o-mini"
  if (provider === "groq") return (cfg.mcpToolsGroqModel as string) || "llama-3.3-70b-versatile"
  if (provider === "gemini") return (cfg.mcpToolsGeminiModel as string) || "gemini-1.5-flash-002"
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

function normalizeContent(content: unknown): string | null {
  if (!content) return null
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    const parts = content
      .map((p) => {
        if (typeof p === "string") return p
        if (p && typeof p === "object") {
          if (typeof (p as Record<string, unknown>).text === "string") return (p as Record<string, unknown>).text as string
          if (typeof (p as Record<string, unknown>).content === "string") return (p as Record<string, unknown>).content as string
        }
        return ""
      })
      .filter(Boolean)
    return parts.length ? parts.join(" ") : null
  }
  if (typeof content === "object" && content !== null) {
    if (typeof (content as Record<string, unknown>).text === "string") return (content as Record<string, unknown>).text as string
  }
  return null
}

function extractUserPrompt(body: Record<string, unknown>): string | null {
  try {
    if (!body || typeof body !== "object") return null

    if (Array.isArray(body.messages)) {
      for (let i = body.messages.length - 1; i >= 0; i--) {
        const msg = body.messages[i] as Record<string, unknown>
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


// Agent execution using processTranscriptWithAgentMode
async function runAgent(options: {
  prompt: string
  conversationId?: string
  onProgress?: (update: AgentProgressUpdate) => void
}): Promise<{
  content: string
  conversationId: string
  conversationHistory: Array<{
    role: "user" | "assistant" | "tool"
    content: string
    toolCalls?: Array<{ name: string; arguments: unknown }>
    toolResults?: Array<{ success: boolean; content: string; error?: string }>
    timestamp?: number
  }>
}> {
  const { prompt, conversationId: inputConversationId, onProgress } = options
  const cfg = configStore.get() as Record<string, unknown>

  // Initialize MCP service
  await mcpService.initialize()

  // Get available tools from MCP service and merge with builtins
  const mcpTools = mcpService.getAvailableTools()
  const allTools = [...mcpTools, ...builtinTools]

  // Generate conversation ID if not provided
  const conversationId = inputConversationId || `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

  // Load existing conversation history if continuing
  let existingHistory: ConversationHistoryEntry[] = []
  if (inputConversationId) {
    try {
      const conversation = await conversationService.loadConversation(inputConversationId)
      if (conversation && conversation.messages) {
        existingHistory = conversation.messages.map((msg: { role: string; content: string; timestamp?: number; toolCalls?: unknown; toolResults?: unknown }) => ({
          role: msg.role as ConversationHistoryEntry["role"],
          content: msg.content,
          timestamp: msg.timestamp || Date.now(),
          toolCalls: msg.toolCalls as ConversationHistoryEntry["toolCalls"],
          toolResults: msg.toolResults as ConversationHistoryEntry["toolResults"],
        }))
      }
    } catch {
      // Conversation doesn't exist, start fresh
    }
  }

  // Tool execution handler
  const executeToolCall = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> => {
    try {
      // Check if it's a builtin tool
      if (isBuiltinTool(name)) {
        return await executeBuiltinTool(name, args)
      }

      // Execute via MCP service
      return await mcpService.executeToolCall(name, args)
    } catch (error) {
      return {
        content: [{ type: "text", text: `Tool execution error: ${(error as Error).message}` }],
        isError: true,
      }
    }
  }

  // Get user guidelines from profile
  const activeProfile = profileService.getCurrentProfile()
  const userGuidelines = activeProfile?.guidelines

  // Get custom system prompt if configured
  const customSystemPrompt = cfg.customSystemPrompt as string | undefined

  // Run the agent loop
  const result = await processTranscriptWithAgentMode({
    transcript: prompt,
    conversationHistory: existingHistory,
    availableTools: allTools,
    executeToolCall,
    onProgress,
    conversationId,
    userGuidelines,
    customSystemPrompt,
    maxIterations: (cfg.mcpMaxIterations as number) || 25,
  })

  // Save conversation to disk
  if (!inputConversationId) {
    // Create new conversation
    await conversationService.createConversationWithId(conversationId, prompt, "user")
  }

  // Save all messages from conversation history
  for (const entry of result.conversationHistory) {
    if (entry.role !== "user" || entry.content !== prompt) {
      await conversationService.addMessageToConversation(
        conversationId,
        entry.content,
        entry.role as "user" | "assistant" | "tool",
      )
    }
  }

  // Map conversation history to expected format
  const mappedHistory = result.conversationHistory.map(entry => ({
    role: entry.role as "user" | "assistant" | "tool",
    content: entry.content,
    toolCalls: entry.toolCalls?.map(tc => ({ name: tc.name, arguments: tc.arguments })),
    toolResults: entry.toolResults?.map(tr => ({
      success: !tr.isError,
      content: tr.content.map(c => c.text).join("\n"),
      error: tr.isError ? tr.content.map(c => c.text).join("\n") : undefined,
    })),
    timestamp: entry.timestamp,
  }))

  return {
    content: result.content,
    conversationId,
    conversationHistory: mappedHistory,
  }
}

// Helper function to validate message objects
function validateMessages(messages: Array<{ role: string; content: unknown }>): string | null {
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


/**
 * Start the HTTP server
 */
export async function startServer(options: ServerOptions = {}): Promise<{
  running: boolean
  bind?: string
  port?: number
  error?: string
}> {
  const cfg = configStore.get() as Record<string, unknown>

  // Generate API key if not provided
  const apiKey = options.apiKey || (cfg.remoteServerApiKey as string) || crypto.randomBytes(32).toString("hex")
  if (!cfg.remoteServerApiKey) {
    configStore.save({ ...cfg, remoteServerApiKey: apiKey })
  }

  if (server) {
    console.log("[server] Server already running, restarting...")
    await stopServer()
  }

  lastError = undefined
  const logLevel = options.logLevel || (cfg.remoteServerLogLevel as ServerOptions['logLevel']) || "info"
  const bind = options.bind || (cfg.remoteServerBindAddress as string) || "127.0.0.1"
  const port = options.port || (cfg.remoteServerPort as number) || 3210

  const fastify = Fastify({ logger: { level: logLevel } })

  // Configure CORS
  const corsOrigins = options.corsOrigins || (cfg.remoteServerCorsOrigins as string[]) || ["*"]
  await fastify.register(cors, {
    origin: corsOrigins.includes("*") ? true : corsOrigins,
    methods: ["GET", "POST", "PUT", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
    maxAge: 86400,
    preflight: true,
    strictPreflight: false,
  })

  // Auth hook
  fastify.addHook("onRequest", async (req, reply) => {
    if (req.method === "OPTIONS") return

    const auth = (req.headers["authorization"] || "").toString()
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : ""
    const current = configStore.get() as Record<string, unknown>
    if (!token || token !== current.remoteServerApiKey) {
      reply.code(401).send({ error: "Unauthorized" })
      return
    }
  })


  // Main chat endpoint
  fastify.post("/v1/chat/completions", async (req, reply) => {
    try {
      const body = req.body as Record<string, unknown>
      const prompt = extractUserPrompt(body)
      if (!prompt) {
        return reply.code(400).send({ error: "Missing user prompt" })
      }

      const conversationId = typeof body.conversation_id === "string" ? body.conversation_id : undefined
      const isStreaming = body.stream === true

      console.log("[server] Chat request:", { conversationId: conversationId || "new", promptLength: prompt.length, streaming: isStreaming })

      if (isStreaming) {
        const requestOrigin = req.headers.origin || "*"
        reply.raw.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "Access-Control-Allow-Origin": requestOrigin,
          "Access-Control-Allow-Credentials": "true",
        })

        const writeSSE = (data: object) => {
          reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
        }

        const onProgress = (update: AgentProgressUpdate) => {
          writeSSE({ type: "progress", data: update })
        }

        try {
          const result = await runAgent({ prompt, conversationId, onProgress })
          const model = resolveActiveModelId(configStore.get() as Record<string, unknown>)

          writeSSE({
            type: "done",
            data: {
              content: result.content,
              conversation_id: result.conversationId,
              conversation_history: result.conversationHistory,
              model,
            },
          })
        } catch (error: unknown) {
          const err = error as Error
          writeSSE({
            type: "error",
            data: { message: err?.message || "Internal Server Error" },
          })
        } finally {
          reply.raw.end()
        }

        return reply
      }

      // Non-streaming mode
      const result = await runAgent({ prompt, conversationId })
      const model = resolveActiveModelId(configStore.get() as Record<string, unknown>)
      const response = toOpenAIChatResponse(result.content, model)

      return reply.send({
        ...response,
        conversation_id: result.conversationId,
        conversation_history: result.conversationHistory,
      })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Handler error", err)
      return reply.code(500).send({ error: "Internal Server Error" })
    }
  })

  // Models endpoint
  fastify.get("/v1/models", async (_req, reply) => {
    const model = resolveActiveModelId(configStore.get() as Record<string, unknown>)
    return reply.send({
      object: "list",
      data: [{ id: model, object: "model", owned_by: "system" }],
    })
  })


  // Profiles endpoints
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
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to get profiles", err)
      return reply.code(500).send({ error: "Failed to get profiles" })
    }
  })

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
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to get current profile", err)
      return reply.code(500).send({ error: "Failed to get current profile" })
    }
  })

  fastify.post("/v1/profiles/current", async (req, reply) => {
    try {
      const body = req.body as Record<string, unknown>
      const profileId = body?.profileId
      if (!profileId || typeof profileId !== "string") {
        return reply.code(400).send({ error: "Missing or invalid profileId" })
      }
      const profile = profileService.setCurrentProfile(profileId)
      mcpService.applyProfileMcpConfig(
        profile.mcpServerConfig?.disabledServers || [],
        profile.mcpServerConfig?.disabledTools || [],
        profile.mcpServerConfig?.allServersDisabledByDefault || false,
        profile.mcpServerConfig?.enabledServers || []
      )
      return reply.send({
        success: true,
        profile: { id: profile.id, name: profile.name, isDefault: profile.isDefault },
      })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to set current profile", err)
      const isNotFound = err?.message?.includes("not found")
      return reply.code(isNotFound ? 404 : 500).send({ error: err?.message || "Failed to set current profile" })
    }
  })

  // MCP servers endpoints
  fastify.get("/v1/mcp/servers", async (_req, reply) => {
    try {
      const serverStatus = mcpService.getServerStatus()
      const servers = Object.entries(serverStatus)
        .filter(([name]) => name !== "speakmcp-settings")
        .map(([name, status]) => ({
          name,
          connected: status.connected,
          toolCount: status.toolCount,
        }))
      return reply.send({ servers })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to get MCP servers", err)
      return reply.code(500).send({ error: "Failed to get MCP servers" })
    }
  })

  fastify.post("/v1/mcp/servers/:name/toggle", async (req, reply) => {
    try {
      const params = req.params as { name: string }
      const body = req.body as Record<string, unknown>
      const serverName = params.name
      const enabled = body?.enabled

      if (typeof enabled !== "boolean") {
        return reply.code(400).send({ error: "Missing or invalid 'enabled' boolean" })
      }

      const success = mcpService.setServerRuntimeEnabled(serverName, enabled)
      if (!success) {
        return reply.code(404).send({ error: `Server '${serverName}' not found` })
      }

      return reply.send({ success: true, server: serverName, enabled })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to toggle MCP server", err)
      return reply.code(500).send({ error: err?.message || "Failed to toggle MCP server" })
    }
  })


  // Settings endpoints
  fastify.get("/v1/settings", async (_req, reply) => {
    try {
      const cfg = configStore.get() as Record<string, unknown>
      return reply.send({
        mcpToolsProviderId: cfg.mcpToolsProviderId || "openai",
        mcpToolsOpenaiModel: cfg.mcpToolsOpenaiModel,
        mcpToolsGroqModel: cfg.mcpToolsGroqModel,
        mcpToolsGeminiModel: cfg.mcpToolsGeminiModel,
        transcriptPostProcessingEnabled: cfg.transcriptPostProcessingEnabled ?? true,
        mcpRequireApprovalBeforeToolCall: cfg.mcpRequireApprovalBeforeToolCall ?? false,
        ttsEnabled: cfg.ttsEnabled ?? true,
        mcpMaxIterations: cfg.mcpMaxIterations ?? 10,
      })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to get settings", err)
      return reply.code(500).send({ error: "Failed to get settings" })
    }
  })

  fastify.patch("/v1/settings", async (req, reply) => {
    try {
      const body = req.body as Record<string, unknown>
      const cfg = configStore.get() as Record<string, unknown>
      const updates: Record<string, unknown> = {}

      if (typeof body.mcpRequireApprovalBeforeToolCall === "boolean") {
        updates.mcpRequireApprovalBeforeToolCall = body.mcpRequireApprovalBeforeToolCall
      }
      if (typeof body.ttsEnabled === "boolean") {
        updates.ttsEnabled = body.ttsEnabled
      }
      if (typeof body.mcpMaxIterations === "number" && body.mcpMaxIterations >= 1 && body.mcpMaxIterations <= 100) {
        updates.mcpMaxIterations = Math.floor(body.mcpMaxIterations)
      }
      const validProviders = ["openai", "groq", "gemini"]
      if (typeof body.mcpToolsProviderId === "string" && validProviders.includes(body.mcpToolsProviderId)) {
        updates.mcpToolsProviderId = body.mcpToolsProviderId
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

      if (Object.keys(updates).length === 0) {
        return reply.code(400).send({ error: "No valid settings to update" })
      }

      configStore.save({ ...cfg, ...updates })
      return reply.send({ success: true, updated: Object.keys(updates) })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to update settings", err)
      return reply.code(500).send({ error: err?.message || "Failed to update settings" })
    }
  })


  // Conversations endpoints
  fastify.get("/v1/conversations", async (_req, reply) => {
    try {
      const conversations = await conversationService.getConversationHistory()
      return reply.send({ conversations })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to list conversations", err)
      return reply.code(500).send({ error: err?.message || "Failed to list conversations" })
    }
  })

  fastify.get("/v1/conversations/:id", async (req, reply) => {
    try {
      const params = req.params as { id: string }
      const conversationId = params.id

      if (!conversationId || typeof conversationId !== "string") {
        return reply.code(400).send({ error: "Missing or invalid conversation ID" })
      }

      if (conversationId.includes("..") || conversationId.includes("/") || conversationId.includes("\\")) {
        return reply.code(400).send({ error: "Invalid conversation ID: path traversal characters not allowed" })
      }

      const conversation = await conversationService.loadConversation(conversationId)
      if (!conversation) {
        return reply.code(404).send({ error: "Conversation not found" })
      }

      return reply.send({
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        messages: conversation.messages,
      })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to fetch conversation", err)
      return reply.code(500).send({ error: err?.message || "Failed to fetch conversation" })
    }
  })

  fastify.post("/v1/conversations", async (req, reply) => {
    try {
      if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
        return reply.code(400).send({ error: "Request body must be a JSON object" })
      }

      const body = req.body as {
        title?: string
        messages: Array<{
          role: "user" | "assistant" | "tool"
          content: string
          timestamp?: number
        }>
      }

      if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
        return reply.code(400).send({ error: "Missing or invalid messages array" })
      }

      const validationError = validateMessages(body.messages)
      if (validationError) {
        return reply.code(400).send({ error: validationError })
      }

      const conversationId = conversationService.generateConversationIdPublic()
      const now = Date.now()
      const firstMessageContent = body.messages[0]?.content || ""
      const title = body.title || (firstMessageContent.length > 50
        ? `${firstMessageContent.slice(0, 50)}...`
        : firstMessageContent || "New Conversation")

      const messages = body.messages.map((msg, index) => ({
        id: `msg_${now}_${index}_${Math.random().toString(36).substr(2, 9)}`,
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp ?? now,
      }))

      const conversation = {
        id: conversationId,
        title,
        createdAt: now,
        updatedAt: now,
        messages,
      }

      await conversationService.saveConversation(conversation, true)
      return reply.code(201).send(conversation)
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to create conversation", err)
      return reply.code(500).send({ error: err?.message || "Failed to create conversation" })
    }
  })


  // Emergency stop endpoint
  fastify.post("/v1/emergency-stop", async (_req, reply) => {
    try {
      const { before, after } = await emergencyStopAll()
      return reply.send({
        success: true,
        message: "Emergency stop executed",
        processesKilled: before,
        processesRemaining: after,
      })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Emergency stop error", err)
      return reply.code(500).send({ success: false, error: err?.message || "Emergency stop failed" })
    }
  })

  // MCP builtin tools endpoints
  fastify.post("/mcp/tools/list", async (_req, reply) => {
    try {
      const tools = builtinTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }))
      return reply.send({ tools })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "MCP tools/list error", err)
      return reply.code(500).send({ error: err?.message || "Failed to list tools" })
    }
  })

  fastify.post("/mcp/tools/call", async (req, reply) => {
    try {
      const body = req.body as Record<string, unknown>
      const name = body.name as string
      const args = body.arguments as Record<string, unknown>

      if (!name || typeof name !== "string") {
        return reply.code(400).send({ error: "Missing or invalid 'name' parameter" })
      }

      if (!isBuiltinTool(name)) {
        return reply.code(400).send({ error: `Unknown builtin tool: ${name}` })
      }

      const result = await executeBuiltinTool(name, args || {})
      return reply.send({
        content: result.content,
        isError: result.isError,
      })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "MCP tools/call error", err)
      return reply.code(500).send({
        content: [{ type: "text", text: err?.message || "Tool execution failed" }],
        isError: true,
      })
    }
  })

  try {
    await fastify.listen({ port, host: bind })
    console.log(`[server] SpeakMCP server listening at http://${bind}:${port}/v1`)
    console.log(`[server] API Key: ${redact(apiKey)}`)
    server = fastify
    return { running: true, bind, port }
  } catch (err: unknown) {
    const error = err as Error
    lastError = error?.message || String(err)
    diagnosticsService.logError("server", "Failed to start server", error)
    server = null
    return { running: false, error: lastError }
  }
}


/**
 * Stop the HTTP server
 */
export async function stopServer(): Promise<void> {
  if (server) {
    try {
      await server.close()
      console.log("[server] Server stopped")
    } catch (err) {
      diagnosticsService.logError("server", "Error stopping server", err)
    } finally {
      server = null
    }
  }
}

/**
 * Restart the HTTP server
 */
export async function restartServer(options?: ServerOptions): Promise<{
  running: boolean
  bind?: string
  port?: number
  error?: string
}> {
  await stopServer()
  return startServer(options)
}

/**
 * Get server status
 */
export function getServerStatus(): {
  running: boolean
  url?: string
  bind?: string
  port?: number
  lastError?: string
} {
  const cfg = configStore.get() as Record<string, unknown>
  const bind = (cfg.remoteServerBindAddress as string) || "127.0.0.1"
  const port = (cfg.remoteServerPort as number) || 3210
  const running = !!server
  const url = running ? `http://${bind}:${port}/v1` : undefined
  return { running, url, bind, port, lastError }
}