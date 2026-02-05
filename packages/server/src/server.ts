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
import { state, agentSessionStateManager, toolApprovalManager, messageQueueManager } from './services/state'
import { fetchAvailableModels } from './services/models-service'
import { executeBuiltinTool, isBuiltinTool, builtinTools } from './services/builtin-tools'
import { processTranscriptWithAgentMode, type ConversationHistoryEntry } from './services/llm'
import { memoryService } from './services/memory-service'
import { skillsService } from './services/skills-service'
import {
  getPendingElicitations, resolveElicitation,
  getPendingSamplingRequests, resolveSampling,
} from './services/mcp-service'
import { acpService, type ACPAgentConfig } from './services/acp-service'
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

  // Get available tools from MCP service (already includes builtin tools with proper prefix)
  const allTools = mcpService.getAvailableTools()

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
  if (options.apiKey || !cfg.remoteServerApiKey) {
    // Always save when explicitly provided (e.g. embedded mode), or when no key exists yet
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

        // Track previously emitted content length for delta calculation
        let lastEmittedLength = 0
        const streamId = `chatcmpl-${Date.now()}`

        // Helper to emit OpenAI-compatible streaming chunks
        const emitOpenAIChunk = (content: string, isComplete: boolean = false) => {
          const chunk = {
            id: streamId,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: resolveActiveModelId(configStore.get() as Record<string, unknown>),
            choices: [{
              index: 0,
              delta: isComplete ? {} : { content },
              finish_reason: isComplete ? "stop" : null,
            }],
          }
          writeSSE(chunk)
        }

        const onProgress = (update: AgentProgressUpdate) => {
          // Always emit custom progress event for mobile app compatibility
          writeSSE({ type: "progress", data: update })

          // Also emit OpenAI-compatible delta chunks for CLI compatibility
          if (update.streamingContent?.text) {
            const fullText = update.streamingContent.text
            if (fullText.length > lastEmittedLength) {
              // Emit only the delta (new content since last emit)
              const delta = fullText.slice(lastEmittedLength)
              emitOpenAIChunk(delta)
              lastEmittedLength = fullText.length
            }
          }
        }

        try {
          const result = await runAgent({ prompt, conversationId, onProgress })
          const model = resolveActiveModelId(configStore.get() as Record<string, unknown>)

          // Emit final OpenAI chunk with finish_reason
          emitOpenAIChunk("", true)

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

  // Models per provider endpoint
  fastify.get("/v1/models/:providerId", async (req, reply) => {
    try {
      const params = req.params as { providerId: string }
      const providerId = params.providerId

      const validProviders = ["openai", "groq", "gemini"]
      if (!validProviders.includes(providerId)) {
        return reply.code(400).send({ error: `Invalid provider: ${providerId}. Valid providers: ${validProviders.join(", ")}` })
      }

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
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", `Failed to fetch models for provider`, err)
      return reply.code(500).send({ error: err?.message || "Failed to fetch models" })
    }
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
      // Mask API keys: show only last 4 chars
      const maskKey = (key: unknown): string => {
        if (!key || typeof key !== "string" || key.length === 0) return ""
        return key.length <= 4 ? "****" : `****${key.slice(-4)}`
      }

      return reply.send({
        mcpToolsProviderId: cfg.mcpToolsProviderId || "openai",
        mcpToolsOpenaiModel: cfg.mcpToolsOpenaiModel,
        mcpToolsGroqModel: cfg.mcpToolsGroqModel,
        mcpToolsGeminiModel: cfg.mcpToolsGeminiModel,
        transcriptPostProcessingEnabled: cfg.transcriptPostProcessingEnabled ?? true,
        mcpRequireApprovalBeforeToolCall: cfg.mcpRequireApprovalBeforeToolCall ?? false,
        ttsEnabled: cfg.ttsEnabled ?? true,
        mcpMaxIterations: cfg.mcpMaxIterations ?? 10,
        openaiApiKey: maskKey(cfg.openaiApiKey),
        groqApiKey: maskKey(cfg.groqApiKey),
        geminiApiKey: maskKey(cfg.geminiApiKey),
        currentModelPresetId: cfg.currentModelPresetId || "builtin-openai",
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
      if (typeof body.transcriptPostProcessingEnabled === "boolean") {
        updates.transcriptPostProcessingEnabled = body.transcriptPostProcessingEnabled
      }
      // API keys - only update if non-empty and not a masked value
      if (typeof body.openaiApiKey === "string" && body.openaiApiKey.length > 0 && !body.openaiApiKey.startsWith("****")) {
        updates.openaiApiKey = body.openaiApiKey
      }
      if (typeof body.groqApiKey === "string" && body.groqApiKey.length > 0 && !body.groqApiKey.startsWith("****")) {
        updates.groqApiKey = body.groqApiKey
      }
      if (typeof body.geminiApiKey === "string" && body.geminiApiKey.length > 0 && !body.geminiApiKey.startsWith("****")) {
        updates.geminiApiKey = body.geminiApiKey
      }
      // Model preset selection
      if (typeof body.currentModelPresetId === "string" && body.currentModelPresetId.length > 0) {
        updates.currentModelPresetId = body.currentModelPresetId
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


  // Delete conversation
  fastify.delete("/v1/conversations/:id", async (req, reply) => {
    try {
      const params = req.params as { id: string }
      const conversationId = params.id

      if (!conversationId || typeof conversationId !== "string") {
        return reply.code(400).send({ error: "Missing or invalid conversation ID" })
      }

      if (conversationId.includes("..") || conversationId.includes("/") || conversationId.includes("\\")) {
        return reply.code(400).send({ error: "Invalid conversation ID: path traversal characters not allowed" })
      }

      await conversationService.deleteConversation(conversationId)
      return reply.send({ success: true })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to delete conversation", err)
      return reply.code(500).send({ error: err?.message || "Failed to delete conversation" })
    }
  })

  // Update conversation (rename)
  fastify.put("/v1/conversations/:id", async (req, reply) => {
    try {
      const params = req.params as { id: string }
      const conversationId = params.id

      if (!conversationId || typeof conversationId !== "string") {
        return reply.code(400).send({ error: "Missing or invalid conversation ID" })
      }

      if (conversationId.includes("..") || conversationId.includes("/") || conversationId.includes("\\")) {
        return reply.code(400).send({ error: "Invalid conversation ID: path traversal characters not allowed" })
      }

      const body = req.body as { title?: string }
      const conversation = await conversationService.loadConversation(conversationId)
      if (!conversation) {
        return reply.code(404).send({ error: "Conversation not found" })
      }

      if (body.title && typeof body.title === "string") {
        conversation.title = body.title
      }
      conversation.updatedAt = Date.now()

      await conversationService.saveConversation(conversation)
      return reply.send({
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to update conversation", err)
      return reply.code(500).send({ error: err?.message || "Failed to update conversation" })
    }
  })

  // Tool approval response
  fastify.post("/v1/tool-approval", async (req, reply) => {
    try {
      const body = req.body as { approvalId?: string; approved?: boolean }

      if (!body.approvalId || typeof body.approvalId !== "string") {
        return reply.code(400).send({ error: "Missing or invalid approvalId" })
      }
      if (typeof body.approved !== "boolean") {
        return reply.code(400).send({ error: "Missing or invalid 'approved' boolean" })
      }

      const found = toolApprovalManager.respondToApproval(body.approvalId, body.approved)
      if (!found) {
        return reply.code(404).send({ error: "Approval not found or already resolved" })
      }
      return reply.send({ success: true })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Tool approval error", err)
      return reply.code(500).send({ error: err?.message || "Tool approval failed" })
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

  // Profile CRUD endpoints
  fastify.post("/v1/profiles", async (req, reply) => {
    try {
      const body = req.body as { name?: string; guidelines?: string; systemPrompt?: string }
      if (!body.name || typeof body.name !== "string") {
        return reply.code(400).send({ error: "Missing or invalid 'name'" })
      }
      const profile = profileService.createProfile(body.name, body.guidelines || "", body.systemPrompt)
      return reply.code(201).send({ success: true, profile })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to create profile", err)
      return reply.code(500).send({ error: err?.message || "Failed to create profile" })
    }
  })

  fastify.patch("/v1/profiles/:id", async (req, reply) => {
    try {
      const params = req.params as { id: string }
      const body = req.body as { name?: string; guidelines?: string; systemPrompt?: string }
      const profile = profileService.updateProfile(params.id, body)
      return reply.send({ success: true, profile })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to update profile", err)
      return reply.code(500).send({ error: err?.message || "Failed to update profile" })
    }
  })

  fastify.delete("/v1/profiles/:id", async (req, reply) => {
    try {
      const params = req.params as { id: string }
      const success = profileService.deleteProfile(params.id)
      if (!success) {
        return reply.code(404).send({ error: "Profile not found or cannot be deleted" })
      }
      return reply.send({ success: true })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to delete profile", err)
      return reply.code(500).send({ error: err?.message || "Failed to delete profile" })
    }
  })

  // Profile export/import
  fastify.get("/v1/profiles/:id/export", async (req, reply) => {
    try {
      const params = req.params as { id: string }
      const exportJson = profileService.exportProfile(params.id)
      return reply.send({ profile: JSON.parse(exportJson) })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to export profile", err)
      return reply.code(500).send({ error: err?.message || "Failed to export profile" })
    }
  })

  fastify.post("/v1/profiles/import", async (req, reply) => {
    try {
      const body = req.body as { profile?: unknown }
      if (!body.profile) {
        return reply.code(400).send({ error: "Missing 'profile' in request body" })
      }
      const profileJson = typeof body.profile === "string" ? body.profile : JSON.stringify(body.profile)
      const profile = profileService.importProfile(profileJson)
      return reply.code(201).send({ success: true, profile })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to import profile", err)
      return reply.code(500).send({ error: err?.message || "Failed to import profile" })
    }
  })

  // Diagnostics endpoints
  fastify.get("/v1/diagnostics/report", async (_req, reply) => {
    try {
      const report = await diagnosticsService.generateDiagnosticReport()
      return reply.send(report)
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to generate diagnostic report", err)
      return reply.code(500).send({ error: err?.message || "Failed to generate diagnostic report" })
    }
  })

  fastify.get("/v1/diagnostics/health", async (_req, reply) => {
    try {
      const health = await diagnosticsService.performHealthCheck()
      return reply.send(health)
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to perform health check", err)
      return reply.code(500).send({ error: err?.message || "Failed to perform health check" })
    }
  })

  fastify.get("/v1/diagnostics/errors", async (req, reply) => {
    try {
      const query = req.query as { count?: string }
      const count = query.count ? parseInt(query.count, 10) : 10
      const errors = diagnosticsService.getRecentErrors(count)
      return reply.send({ errors })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to get recent errors", err)
      return reply.code(500).send({ error: err?.message || "Failed to get recent errors" })
    }
  })

  fastify.post("/v1/diagnostics/errors/clear", async (_req, reply) => {
    try {
      diagnosticsService.clearErrorLog()
      return reply.send({ success: true })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to clear errors", err)
      return reply.code(500).send({ error: err?.message || "Failed to clear errors" })
    }
  })

  // ── MCP Server Management endpoints (G-17) ──
  fastify.post("/v1/mcp/servers/:name/restart", async (req, reply) => {
    try {
      const { name } = req.params as { name: string }
      const result = await mcpService.restartServer(name)
      if (!result.success) {
        return reply.code(result.error?.includes("not found") ? 404 : 500).send(result)
      }
      return reply.send(result)
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to restart MCP server", err)
      return reply.code(500).send({ success: false, error: err?.message || "Failed to restart server" })
    }
  })

  fastify.post("/v1/mcp/servers/:name/stop", async (req, reply) => {
    try {
      const { name } = req.params as { name: string }
      const result = await mcpService.stopMcpServer(name)
      if (!result.success) {
        return reply.code(500).send(result)
      }
      return reply.send(result)
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to stop MCP server", err)
      return reply.code(500).send({ success: false, error: err?.message || "Failed to stop server" })
    }
  })

  fastify.get("/v1/mcp/servers/:name/logs", async (req, reply) => {
    try {
      const { name } = req.params as { name: string }
      const logs = mcpService.getServerLogs(name)
      return reply.send({ server: name, logs })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to get server logs", err)
      return reply.code(500).send({ error: err?.message || "Failed to get server logs" })
    }
  })

  fastify.post("/v1/mcp/servers/:name/logs/clear", async (req, reply) => {
    try {
      const { name } = req.params as { name: string }
      mcpService.clearServerLogs(name)
      return reply.send({ success: true, server: name })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to clear server logs", err)
      return reply.code(500).send({ error: err?.message || "Failed to clear server logs" })
    }
  })

  fastify.post("/v1/mcp/servers/:name/test", async (req, reply) => {
    try {
      const { name } = req.params as { name: string }
      const cfg = configStore.get() as Record<string, unknown>
      const mcpConfig = (cfg.mcpConfig || { mcpServers: {} }) as { mcpServers: Record<string, unknown> }
      const serverConfig = mcpConfig.mcpServers?.[name]
      if (!serverConfig) {
        return reply.code(404).send({ success: false, error: `Server '${name}' not found in configuration` })
      }
      const result = await mcpService.testServerConnection(name, serverConfig as any)
      return reply.send(result)
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to test MCP server", err)
      return reply.code(500).send({ success: false, toolCount: 0, error: err?.message || "Failed to test server" })
    }
  })

  // ── Model Preset endpoints (G-08) ──
  fastify.get("/v1/model-presets", async (_req, reply) => {
    try {
      const cfg = configStore.get() as Record<string, unknown>
      const customPresets = (cfg.modelPresets || []) as Array<Record<string, unknown>>
      const currentPresetId = (cfg.currentModelPresetId as string) || "builtin-openai"

      // Built-in presets
      const builtInPresets = [
        { id: "builtin-openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", apiKey: "", isBuiltIn: true },
        { id: "builtin-openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", apiKey: "", isBuiltIn: true },
        { id: "builtin-together", name: "Together AI", baseUrl: "https://api.together.xyz/v1", apiKey: "", isBuiltIn: true },
        { id: "builtin-cerebras", name: "Cerebras", baseUrl: "https://api.cerebras.ai/v1", apiKey: "", isBuiltIn: true },
        { id: "builtin-zhipu", name: "Zhipu GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", apiKey: "", isBuiltIn: true },
      ]

      return reply.send({
        presets: [...builtInPresets, ...customPresets],
        currentPresetId,
      })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to get model presets", err)
      return reply.code(500).send({ error: err?.message || "Failed to get model presets" })
    }
  })

  fastify.post("/v1/model-presets", async (req, reply) => {
    try {
      const body = req.body as Record<string, unknown>
      if (!body.name || typeof body.name !== "string") {
        return reply.code(400).send({ error: "Missing or invalid 'name'" })
      }
      if (!body.baseUrl || typeof body.baseUrl !== "string") {
        return reply.code(400).send({ error: "Missing or invalid 'baseUrl'" })
      }

      const cfg = configStore.get() as Record<string, unknown>
      const presets = ((cfg.modelPresets || []) as Array<Record<string, unknown>>).slice()
      const now = Date.now()
      const newPreset = {
        id: `custom-${now}`,
        name: body.name,
        baseUrl: body.baseUrl,
        apiKey: (body.apiKey as string) || "",
        isBuiltIn: false,
        createdAt: now,
        updatedAt: now,
        mcpToolsModel: body.mcpToolsModel || undefined,
        transcriptProcessingModel: body.transcriptProcessingModel || undefined,
        summarizationModel: body.summarizationModel || undefined,
      }
      presets.push(newPreset)
      configStore.save({ ...cfg, modelPresets: presets })
      return reply.send({ success: true, preset: newPreset })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to create model preset", err)
      return reply.code(500).send({ error: err?.message || "Failed to create model preset" })
    }
  })

  fastify.patch("/v1/model-presets/:id", async (req, reply) => {
    try {
      const { id } = req.params as { id: string }
      const body = req.body as Record<string, unknown>
      const cfg = configStore.get() as Record<string, unknown>
      const presets = ((cfg.modelPresets || []) as Array<Record<string, unknown>>).slice()
      const idx = presets.findIndex((p) => p.id === id)
      if (idx === -1) {
        return reply.code(404).send({ error: `Preset '${id}' not found` })
      }
      const existing = presets[idx]
      if (existing.isBuiltIn) {
        return reply.code(400).send({ error: "Cannot modify built-in presets" })
      }
      const updated = { ...existing, ...body, id: existing.id, isBuiltIn: false, updatedAt: Date.now() }
      presets[idx] = updated
      configStore.save({ ...cfg, modelPresets: presets })
      return reply.send({ success: true, preset: updated })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to update model preset", err)
      return reply.code(500).send({ error: err?.message || "Failed to update model preset" })
    }
  })

  fastify.delete("/v1/model-presets/:id", async (req, reply) => {
    try {
      const { id } = req.params as { id: string }
      if (id.startsWith("builtin-")) {
        return reply.code(400).send({ error: "Cannot delete built-in presets" })
      }
      const cfg = configStore.get() as Record<string, unknown>
      const presets = ((cfg.modelPresets || []) as Array<Record<string, unknown>>).slice()
      const idx = presets.findIndex((p) => p.id === id)
      if (idx === -1) {
        return reply.code(404).send({ error: `Preset '${id}' not found` })
      }
      presets.splice(idx, 1)
      // If the deleted preset was active, reset to default
      const updates: Record<string, unknown> = { modelPresets: presets }
      if (cfg.currentModelPresetId === id) {
        updates.currentModelPresetId = "builtin-openai"
      }
      configStore.save({ ...cfg, ...updates })
      return reply.send({ success: true })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to delete model preset", err)
      return reply.code(500).send({ error: err?.message || "Failed to delete model preset" })
    }
  })

  // ── Memory endpoints (G-12) ──

  fastify.get("/v1/memories", async (_req, reply) => {
    try {
      const memories = memoryService.getAllMemories()
      return reply.send({ memories })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to get memories", err)
      return reply.code(500).send({ error: err?.message || "Failed to get memories" })
    }
  })

  fastify.get("/v1/memories/search", async (req, reply) => {
    try {
      const { q } = req.query as { q?: string }
      if (!q || typeof q !== "string") {
        return reply.code(400).send({ error: "Missing 'q' query parameter" })
      }
      const memories = memoryService.searchMemories(q)
      return reply.send({ memories })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to search memories", err)
      return reply.code(500).send({ error: err?.message || "Failed to search memories" })
    }
  })

  fastify.post("/v1/memories", async (req, reply) => {
    try {
      const body = req.body as Record<string, unknown>
      const title = body.title as string
      const content = body.content as string
      if (!title || !content) {
        return reply.code(400).send({ error: "Missing required fields: title, content" })
      }
      const now = Date.now()
      const memory = {
        id: memoryService.generateId(),
        title,
        content,
        category: (body.category as string) || undefined,
        tags: Array.isArray(body.tags) ? (body.tags as string[]) : [],
        importance: (body.importance as string) || "medium",
        createdAt: now,
        updatedAt: now,
        profileId: (body.profileId as string) || undefined,
        sessionId: (body.sessionId as string) || undefined,
        conversationId: (body.conversationId as string) || undefined,
        conversationTitle: (body.conversationTitle as string) || undefined,
        keyFindings: Array.isArray(body.keyFindings) ? (body.keyFindings as string[]) : [],
        userNotes: (body.userNotes as string) || undefined,
      }
      const success = memoryService.saveMemory(memory as import('./types').AgentMemory)
      if (!success) {
        return reply.code(500).send({ error: "Failed to save memory" })
      }
      return reply.code(201).send({ success: true, memory })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to create memory", err)
      return reply.code(500).send({ error: err?.message || "Failed to create memory" })
    }
  })

  fastify.patch("/v1/memories/:id", async (req, reply) => {
    try {
      const { id } = req.params as { id: string }
      const updates = req.body as Record<string, unknown>
      const updated = memoryService.updateMemory(id, updates as Partial<import('./types').AgentMemory>)
      if (!updated) {
        return reply.code(404).send({ error: "Memory not found" })
      }
      return reply.send({ success: true, memory: updated })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to update memory", err)
      return reply.code(500).send({ error: err?.message || "Failed to update memory" })
    }
  })

  fastify.delete("/v1/memories/:id", async (req, reply) => {
    try {
      const { id } = req.params as { id: string }
      const success = memoryService.deleteMemory(id)
      if (!success) {
        return reply.code(404).send({ error: "Memory not found" })
      }
      return reply.send({ success: true })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to delete memory", err)
      return reply.code(500).send({ error: err?.message || "Failed to delete memory" })
    }
  })

  // ── Skills endpoints (G-13) ──

  fastify.get("/v1/skills", async (_req, reply) => {
    try {
      const skills = skillsService.getSkills()
      return reply.send({ skills })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to get skills", err)
      return reply.code(500).send({ error: err?.message || "Failed to get skills" })
    }
  })

  fastify.post("/v1/skills", async (req, reply) => {
    try {
      const body = req.body as Record<string, unknown>
      const name = body.name as string
      const description = body.description as string
      const instructions = body.instructions as string
      if (!name || !description || !instructions) {
        return reply.code(400).send({ error: "Missing required fields: name, description, instructions" })
      }
      const skill = skillsService.createSkill(name, description, instructions, {
        source: (body.source as 'local' | 'imported') || undefined,
        filePath: (body.filePath as string) || undefined,
      })
      return reply.code(201).send({ success: true, skill })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to create skill", err)
      return reply.code(500).send({ error: err?.message || "Failed to create skill" })
    }
  })

  fastify.patch("/v1/skills/:id", async (req, reply) => {
    try {
      const { id } = req.params as { id: string }
      const updates = req.body as Record<string, unknown>
      const skill = skillsService.updateSkill(id, updates as Partial<import('./types').AgentSkill>)
      return reply.send({ success: true, skill })
    } catch (error: unknown) {
      const err = error as Error
      if (err?.message?.includes("not found")) {
        return reply.code(404).send({ error: err.message })
      }
      diagnosticsService.logError("server", "Failed to update skill", err)
      return reply.code(500).send({ error: err?.message || "Failed to update skill" })
    }
  })

  fastify.delete("/v1/skills/:id", async (req, reply) => {
    try {
      const { id } = req.params as { id: string }
      const success = skillsService.deleteSkill(id)
      if (!success) {
        return reply.code(404).send({ error: "Skill not found" })
      }
      return reply.send({ success: true })
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "Failed to delete skill", err)
      return reply.code(500).send({ error: err?.message || "Failed to delete skill" })
    }
  })

  fastify.post("/v1/skills/:id/toggle", async (req, reply) => {
    try {
      const { id } = req.params as { id: string }
      const skill = skillsService.toggleSkill(id)
      return reply.send({ success: true, skill })
    } catch (error: unknown) {
      const err = error as Error
      if (err?.message?.includes("not found")) {
        return reply.code(404).send({ error: err.message })
      }
      diagnosticsService.logError("server", "Failed to toggle skill", err)
      return reply.code(500).send({ error: err?.message || "Failed to toggle skill" })
    }
  })


  // ====================================================================
  // G-22: OAuth Flow endpoints
  // ====================================================================

  // Initiate OAuth flow for an MCP server
  fastify.post("/v1/oauth/initiate", async (req, reply) => {
    try {
      const body = req.body as Record<string, unknown>
      const serverName = body.serverName as string
      if (!serverName) return reply.code(400).send({ error: "Missing serverName" })
      const result = await mcpService.initiateOAuthFlow(serverName)
      return reply.send(result)
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "OAuth initiate failed", err)
      return reply.code(500).send({ error: err?.message || "OAuth initiate failed" })
    }
  })

  // Handle OAuth callback (code exchange)
  fastify.post("/v1/oauth/callback", async (req, reply) => {
    try {
      const body = req.body as Record<string, unknown>
      const serverName = body.serverName as string
      const code = body.code as string
      const oauthState = body.state as string
      if (!serverName || !code || !oauthState) {
        return reply.code(400).send({ error: "Missing serverName, code, or state" })
      }
      const result = await mcpService.handleOAuthCallback(serverName, code, oauthState)
      return reply.send(result)
    } catch (error: unknown) {
      const err = error as Error
      diagnosticsService.logError("server", "OAuth callback failed", err)
      return reply.code(500).send({ error: err?.message || "OAuth callback failed" })
    }
  })

  // ====================================================================
  // G-23: MCP Protocol Extensions — Elicitation endpoints
  // ====================================================================

  fastify.get("/v1/elicitation/pending", async (_req, reply) => {
    return reply.send({ pending: getPendingElicitations() })
  })

  fastify.post("/v1/elicitation/:requestId/resolve", async (req, reply) => {
    try {
      const { requestId } = req.params as { requestId: string }
      const body = req.body as { action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }
      if (!body.action) return reply.code(400).send({ error: "Missing action" })
      const resolved = resolveElicitation(requestId, body)
      return reply.send({ success: resolved })
    } catch (error: unknown) {
      const err = error as Error
      return reply.code(500).send({ error: err?.message || "Failed to resolve elicitation" })
    }
  })

  // ====================================================================
  // G-23: MCP Protocol Extensions — Sampling endpoints
  // ====================================================================

  fastify.get("/v1/sampling/pending", async (_req, reply) => {
    return reply.send({ pending: getPendingSamplingRequests() })
  })

  fastify.post("/v1/sampling/:requestId/resolve", async (req, reply) => {
    try {
      const { requestId } = req.params as { requestId: string }
      const body = req.body as { approved: boolean }
      if (typeof body.approved !== 'boolean') return reply.code(400).send({ error: "Missing approved boolean" })
      const resolved = await resolveSampling(requestId, body.approved)
      return reply.send({ success: resolved })
    } catch (error: unknown) {
      const err = error as Error
      return reply.code(500).send({ error: err?.message || "Failed to resolve sampling" })
    }
  })

  // ====================================================================
  // G-18: Message Queue endpoints
  // ====================================================================

  fastify.get("/v1/queue", async (_req, reply) => {
    return reply.send({ messages: messageQueueManager.getQueue() })
  })

  fastify.post("/v1/queue", async (req, reply) => {
    try {
      const body = req.body as { content: string; conversationId?: string }
      if (!body.content) return reply.code(400).send({ error: "Missing content" })
      const msg = messageQueueManager.enqueue(body.content, body.conversationId)
      return reply.send({ success: true, message: msg })
    } catch (error: unknown) {
      const err = error as Error
      return reply.code(500).send({ error: err?.message || "Failed to enqueue message" })
    }
  })

  fastify.delete("/v1/queue/:id", async (req, reply) => {
    const { id } = req.params as { id: string }
    const removed = messageQueueManager.remove(id)
    return reply.send({ success: removed })
  })

  fastify.post("/v1/queue/dequeue", async (_req, reply) => {
    const msg = messageQueueManager.dequeue()
    return reply.send({ message: msg || null })
  })

  fastify.post("/v1/queue/clear", async (_req, reply) => {
    messageQueueManager.clear()
    return reply.send({ success: true })
  })

  // ====================================================================
  // G-24: Agent Session endpoints
  // ====================================================================

  fastify.get("/v1/agent-sessions", async (_req, reply) => {
    const sessions: Array<{
      sessionId: string
      shouldStop: boolean
      iterationCount: number
    }> = []
    for (const [, session] of state.agentSessions) {
      sessions.push({
        sessionId: session.sessionId,
        shouldStop: session.shouldStop,
        iterationCount: session.iterationCount,
      })
    }
    return reply.send({ sessions, activeCount: agentSessionStateManager.getActiveSessionCount() })
  })

  fastify.get("/v1/agent-sessions/:sessionId", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string }
    const session = agentSessionStateManager.getSession(sessionId)
    if (!session) return reply.code(404).send({ error: "Session not found" })
    return reply.send({
      sessionId: session.sessionId,
      shouldStop: session.shouldStop,
      iterationCount: session.iterationCount,
    })
  })

  fastify.post("/v1/agent-sessions/:sessionId/stop", async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string }
    agentSessionStateManager.stopSession(sessionId)
    return reply.send({ success: true })
  })

  fastify.post("/v1/agent-sessions/stop-all", async (_req, reply) => {
    agentSessionStateManager.stopAllSessions()
    return reply.send({ success: true })
  })


  // ====================================================================
  // G-19: ACP Agent Delegation endpoints
  // ====================================================================

  // List all ACP agents with status
  fastify.get("/v1/acp/agents", async (_req, reply) => {
    return reply.send({ agents: acpService.getAgents() })
  })

  // Get single agent status
  fastify.get("/v1/acp/agents/:agentName", async (req, reply) => {
    const { agentName } = req.params as { agentName: string }
    const status = acpService.getAgentStatus(agentName)
    if (!status) return reply.code(404).send({ error: "Agent not found" })
    return reply.send(status)
  })

  // Add a new ACP agent config
  fastify.post("/v1/acp/agents", async (req, reply) => {
    try {
      const body = req.body as ACPAgentConfig
      if (!body.name || !body.displayName || !body.connection) {
        return reply.code(400).send({ error: "Missing required fields: name, displayName, connection" })
      }
      acpService.addAgent(body)
      return reply.send({ success: true })
    } catch (error: unknown) {
      const err = error as Error
      return reply.code(400).send({ error: err?.message || "Failed to add agent" })
    }
  })

  // Update an ACP agent config
  fastify.patch("/v1/acp/agents/:agentName", async (req, reply) => {
    try {
      const { agentName } = req.params as { agentName: string }
      const body = req.body as Partial<ACPAgentConfig>
      acpService.updateAgent(agentName, body)
      return reply.send({ success: true })
    } catch (error: unknown) {
      const err = error as Error
      return reply.code(400).send({ error: err?.message || "Failed to update agent" })
    }
  })

  // Remove an ACP agent
  fastify.post("/v1/acp/agents/:agentName/remove", async (req, reply) => {
    try {
      const { agentName } = req.params as { agentName: string }
      await acpService.removeAgent(agentName)
      return reply.send({ success: true })
    } catch (error: unknown) {
      const err = error as Error
      return reply.code(500).send({ error: err?.message || "Failed to remove agent" })
    }
  })

  // Spawn an ACP agent
  fastify.post("/v1/acp/agents/:agentName/spawn", async (req, reply) => {
    try {
      const { agentName } = req.params as { agentName: string }
      await acpService.spawnAgent(agentName)
      return reply.send({ success: true })
    } catch (error: unknown) {
      const err = error as Error
      return reply.code(500).send({ error: err?.message || "Failed to spawn agent" })
    }
  })

  // Stop an ACP agent
  fastify.post("/v1/acp/agents/:agentName/stop", async (req, reply) => {
    try {
      const { agentName } = req.params as { agentName: string }
      await acpService.stopAgent(agentName)
      return reply.send({ success: true })
    } catch (error: unknown) {
      const err = error as Error
      return reply.code(500).send({ error: err?.message || "Failed to stop agent" })
    }
  })

  // Stop all ACP agents
  fastify.post("/v1/acp/agents/stop-all", async (_req, reply) => {
    await acpService.stopAllAgents()
    return reply.send({ success: true })
  })

  // Run a task on an ACP agent
  fastify.post("/v1/acp/agents/:agentName/run", async (req, reply) => {
    try {
      const { agentName } = req.params as { agentName: string }
      const body = req.body as { input: string }
      if (!body.input) return reply.code(400).send({ error: "Missing input" })
      const result = await acpService.runTask(agentName, body.input)
      return reply.send(result)
    } catch (error: unknown) {
      const err = error as Error
      return reply.code(500).send({ error: err?.message || "Failed to run task" })
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