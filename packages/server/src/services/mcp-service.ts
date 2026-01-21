/**
 * MCP Service - Model Context Protocol client management
 * Ported from apps/desktop/src/main/mcp-service.ts for standalone server
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import {
  CreateMessageRequestSchema,
  ElicitRequestSchema,
  ElicitationCompleteNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js"
import type {
  CreateMessageRequest,
  CreateMessageResult,
  ElicitRequest,
  ElicitResult,
  ClientCapabilities,
} from "@modelcontextprotocol/sdk/types.js"
import { configStore, getDataDir, ensureDir, getOAuthStoragePath } from '../config'
import { state, agentProcessManager } from './state'
import { diagnosticsService } from './diagnostics'
import type {
  MCPConfig,
  MCPServerConfig,
  MCPTransportType,
  MCPTool,
  MCPToolCall,
  MCPToolResult,
  LLMToolCallResponse,
  ServerLogEntry,
  ProfilesData,
  ProfileMcpServerConfig,
  OAuthConfig,
  OAuthServerMetadata,
  OAuthClientMetadata,
  OAuthTokens,
} from '../types'
import { spawn } from "child_process"
import { promisify } from "util"
import { access, constants, readFileSync, existsSync, mkdirSync } from "fs"
import path from "path"
import os from "os"
import crypto from "crypto"

// ============================================================================
// DEBUG UTILITIES
// ============================================================================

function isDebugTools(): boolean {
  const config = configStore.get() as Record<string, unknown>
  return config.debugTools === true || process.env.DEBUG_TOOLS === 'true'
}

function logTools(...args: unknown[]): void {
  if (!isDebugTools()) return
  const ts = new Date().toISOString()
  console.log(`[${ts}] [DEBUG][TOOLS]`, ...args)
}

function logMCP(direction: "REQUEST" | "RESPONSE", serverName: string, data: unknown): void {
  const config = configStore.get() as Record<string, unknown>
  const isDebugMCP = config.debugMCP === true || process.env.DEBUG_MCP === 'true'
  if (!isDebugMCP) return
  const prefix = direction === "REQUEST" ? "→" : "←"
  const formatted = typeof data === "object" && data !== null
    ? JSON.stringify(data, null, 2)
    : String(data)
  const ts = new Date().toISOString()
  console.log(`[${ts}] [MCP] ${prefix} [${serverName}]\n${formatted}`)
}

// ============================================================================
// MCP UTILITY FUNCTIONS (ported from shared/mcp-utils.ts)
// ============================================================================

export function inferTransportType(config: MCPServerConfig): MCPTransportType {
  if (config.transport) return config.transport
  if (!config.url) return "stdio"
  const lower = config.url.toLowerCase()
  if (lower.startsWith("ws://") || lower.startsWith("wss://")) return "websocket"
  return "streamableHttp"
}

export function normalizeMcpServerConfig(config: MCPServerConfig): {
  normalized: MCPServerConfig
  changed: boolean
} {
  const inferredTransport = inferTransportType(config)
  const changed = config.transport !== inferredTransport
  if (!changed) return { normalized: config, changed: false }
  return { normalized: { ...config, transport: inferredTransport }, changed: true }
}

export function normalizeMcpConfig(mcpConfig: MCPConfig): {
  normalized: MCPConfig
  changed: boolean
} {
  let changed = false

  const normalizedServers = Object.fromEntries(
    Object.entries(mcpConfig.mcpServers || {}).map(([name, serverConfig]) => {
      const { normalized, changed: serverChanged } = normalizeMcpServerConfig(serverConfig)
      if (serverChanged) changed = true
      return [name, normalized]
    }),
  ) as MCPConfig["mcpServers"]

  return {
    normalized: {
      ...mcpConfig,
      mcpServers: normalizedServers,
    },
    changed,
  }
}

// ============================================================================
// CONSTANTS
// ============================================================================

const accessAsync = promisify(access)

// Re-export types for convenience
export type { MCPTool, MCPToolCall, MCPToolResult, LLMToolCallResponse }

// ============================================================================
// OAUTH CLIENT (simplified for server - no Electron shell)
// ============================================================================

export interface OAuthAuthorizationRequest {
  authorizationUrl: string
  codeVerifier: string
  state: string
}

export interface OAuthTokenRequest {
  code: string
  codeVerifier: string
  state: string
}

export class OAuthClient {
  private config: OAuthConfig
  private baseUrl: string

  constructor(baseUrl: string, config: OAuthConfig = {}) {
    this.baseUrl = baseUrl
    this.config = {
      scope: "user",
      useDiscovery: true,
      useDynamicRegistration: true,
      ...config,
    }
  }

  async discoverServerMetadata(): Promise<OAuthServerMetadata> {
    if (this.config.serverMetadata) {
      return this.config.serverMetadata
    }

    const url = new URL(this.baseUrl)
    const metadataUrl = `${url.protocol}//${url.host}/.well-known/oauth-authorization-server`

    try {
      const response = await fetch(metadataUrl, {
        headers: {
          'Accept': 'application/json',
          'MCP-Protocol-Version': '2025-03-26',
        },
      })

      if (!response.ok) {
        throw new Error(`Failed to discover server metadata: ${response.status} ${response.statusText}`)
      }

      const metadata = await response.json() as OAuthServerMetadata

      if (!metadata.authorization_endpoint || !metadata.token_endpoint) {
        throw new Error('Invalid server metadata: missing required endpoints')
      }

      this.config.serverMetadata = metadata
      return metadata
    } catch (error) {
      const fallbackMetadata: OAuthServerMetadata = {
        issuer: `${url.protocol}//${url.host}`,
        authorization_endpoint: `${url.protocol}//${url.host}/authorize`,
        token_endpoint: `${url.protocol}//${url.host}/token`,
        registration_endpoint: `${url.protocol}//${url.host}/register`,
        scopes_supported: ['user'],
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
        code_challenge_methods_supported: ['S256'],
      }

      this.config.serverMetadata = fallbackMetadata
      return fallbackMetadata
    }
  }

  getRedirectUri(): string {
    if (this.config.redirectUri) {
      return this.config.redirectUri
    }
    // For standalone server, use localhost callback
    return 'http://127.0.0.1:3210/oauth/callback'
  }

  async registerClient(): Promise<{ clientId: string; clientSecret?: string }> {
    if (this.config.clientId) {
      return {
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
      }
    }

    const metadata = await this.discoverServerMetadata()

    if (!metadata.registration_endpoint) {
      throw new Error('Dynamic client registration not supported by server')
    }

    const redirectUri = this.getRedirectUri()

    const clientMetadata: OAuthClientMetadata = {
      client_name: 'SpeakMCP',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: this.config.scope || 'user',
      token_endpoint_auth_method: 'none',
    }

    const response = await fetch(metadata.registration_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'MCP-Protocol-Version': '2025-03-26',
      },
      body: JSON.stringify(clientMetadata),
    })

    if (!response.ok) {
      throw new Error(`Failed to register client: ${response.status} ${response.statusText}`)
    }

    const result = await response.json() as { client_id: string; client_secret?: string }

    this.config.clientId = result.client_id
    this.config.clientSecret = result.client_secret

    return {
      clientId: result.client_id,
      clientSecret: result.client_secret,
    }
  }

  generateCodeVerifier(): string {
    return crypto.randomBytes(32).toString('base64url')
  }

  generateCodeChallenge(verifier: string): string {
    return crypto.createHash('sha256').update(verifier).digest('base64url')
  }

  generateState(): string {
    return crypto.randomBytes(16).toString('hex')
  }

  async getAuthorizationRequest(): Promise<OAuthAuthorizationRequest> {
    const metadata = await this.discoverServerMetadata()
    const { clientId } = await this.registerClient()

    const codeVerifier = this.generateCodeVerifier()
    const codeChallenge = this.generateCodeChallenge(codeVerifier)
    const state = this.generateState()
    const redirectUri = this.getRedirectUri()

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: this.config.scope || 'user',
      state: state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })

    const authorizationUrl = `${metadata.authorization_endpoint}?${params.toString()}`

    return {
      authorizationUrl,
      codeVerifier,
      state,
    }
  }

  async exchangeCodeForTokens(request: OAuthTokenRequest): Promise<OAuthTokens> {
    const metadata = await this.discoverServerMetadata()
    const { clientId, clientSecret } = await this.registerClient()
    const redirectUri = this.getRedirectUri()

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code: request.code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: request.codeVerifier,
    })

    if (clientSecret) {
      params.set('client_secret', clientSecret)
    }

    const response = await fetch(metadata.token_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'MCP-Protocol-Version': '2025-03-26',
      },
      body: params.toString(),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to exchange code for tokens: ${response.status} ${errorText}`)
    }

    const tokens = await response.json() as OAuthTokens

    if (tokens.expires_in) {
      tokens.expires_at = Date.now() + tokens.expires_in * 1000
    }

    this.config.tokens = tokens
    return tokens
  }

  getTokens(): OAuthTokens | undefined {
    return this.config.tokens
  }

  setTokens(tokens: OAuthTokens): void {
    this.config.tokens = tokens
  }

  isTokenExpired(): boolean {
    const tokens = this.config.tokens
    if (!tokens || !tokens.expires_at) return true
    // Consider token expired 5 minutes before actual expiry
    return Date.now() > tokens.expires_at - 5 * 60 * 1000
  }

  async refreshTokens(): Promise<OAuthTokens | null> {
    const tokens = this.config.tokens
    if (!tokens?.refresh_token) return null

    const metadata = await this.discoverServerMetadata()
    const { clientId, clientSecret } = await this.registerClient()

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: clientId,
    })

    if (clientSecret) {
      params.set('client_secret', clientSecret)
    }

    const response = await fetch(metadata.token_endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'MCP-Protocol-Version': '2025-03-26',
      },
      body: params.toString(),
    })

    if (!response.ok) {
      return null
    }

    const newTokens = await response.json() as OAuthTokens

    if (newTokens.expires_in) {
      newTokens.expires_at = Date.now() + newTokens.expires_in * 1000
    }

    // Preserve refresh token if not returned
    if (!newTokens.refresh_token && tokens.refresh_token) {
      newTokens.refresh_token = tokens.refresh_token
    }

    this.config.tokens = newTokens
    return newTokens
  }

  getConfig(): OAuthConfig {
    return this.config
  }
}

// ============================================================================
// OAUTH STORAGE (simplified for server)
// ============================================================================

class OAuthStorage {
  private storagePath: string

  constructor() {
    this.storagePath = getOAuthStoragePath()
  }

  private ensureStorageDir(): void {
    const dir = path.dirname(this.storagePath)
    ensureDir(dir)
  }

  private loadStorage(): Record<string, OAuthConfig> {
    try {
      if (existsSync(this.storagePath)) {
        return JSON.parse(readFileSync(this.storagePath, 'utf8'))
      }
    } catch (error) {
      // Ignore errors, return empty storage
    }
    return {}
  }

  private saveStorage(storage: Record<string, OAuthConfig>): void {
    this.ensureStorageDir()
    const fs = require('fs')
    fs.writeFileSync(this.storagePath, JSON.stringify(storage, null, 2))
  }

  getServerOAuth(serverName: string): OAuthConfig | undefined {
    const storage = this.loadStorage()
    return storage[serverName]
  }

  saveServerOAuth(serverName: string, config: OAuthConfig): void {
    const storage = this.loadStorage()
    storage[serverName] = config
    this.saveStorage(storage)
  }

  deleteServerOAuth(serverName: string): void {
    const storage = this.loadStorage()
    delete storage[serverName]
    this.saveStorage(storage)
  }

  getAllServers(): string[] {
    const storage = this.loadStorage()
    return Object.keys(storage)
  }
}

export const oauthStorage = new OAuthStorage()

// ============================================================================
// ELICITATION STUBS (to be implemented later)
// ============================================================================

// Elicitation is not fully supported in standalone server mode yet
// These are placeholder implementations

interface ElicitationRequest {
  mode: 'form' | 'url'
  serverName: string
  message?: string
  requestedSchema?: unknown
  url?: string
  elicitationId?: string
  requestId: string
}

async function requestElicitation(request: ElicitationRequest): Promise<ElicitResult> {
  console.log(`[MCP] Elicitation request from ${request.serverName}: ${request.message || 'no message'}`)
  console.log(`[MCP] Elicitation mode: ${request.mode}`)

  // In server mode, we can't show UI dialogs, so we reject elicitation requests
  // A future implementation could use webhooks or WebSocket to forward to a UI client
  return {
    action: 'decline',
    content: {},
  } as ElicitResult
}

function handleElicitationComplete(elicitationId: string): void {
  console.log(`[MCP] Elicitation complete: ${elicitationId}`)
}

function cancelAllElicitations(serverName?: string): void {
  if (serverName) {
    console.log(`[MCP] Cancelling elicitations for server: ${serverName}`)
  } else {
    console.log(`[MCP] Cancelling all elicitations`)
  }
}

// ============================================================================
// SAMPLING STUBS (to be implemented later)
// ============================================================================

interface SamplingRequest {
  serverName: string
  requestId: string
  messages: unknown[]
  systemPrompt?: string
  maxTokens?: number
  temperature?: number
  modelPreferences?: unknown
}

interface SamplingResult {
  approved: boolean
  content?: { type: string; text: string }
  model?: string
  stopReason?: string
}

async function requestSampling(request: SamplingRequest): Promise<SamplingResult> {
  console.log(`[MCP] Sampling request from ${request.serverName}: ${request.messages?.length || 0} messages`)

  // In server mode, sampling requires LLM integration
  // This is a placeholder that rejects requests
  return {
    approved: false,
  }
}

function cancelAllSamplingRequests(serverName?: string): void {
  if (serverName) {
    console.log(`[MCP] Cancelling sampling requests for server: ${serverName}`)
  } else {
    console.log(`[MCP] Cancelling all sampling requests`)
  }
}

// ============================================================================
// BUILTIN TOOLS - re-exported from builtin-tools.ts
// ============================================================================

import {
  builtinTools,
  BUILTIN_SERVER_NAME,
  isBuiltinTool,
  executeBuiltinTool,
  getBuiltinToolNames,
} from './builtin-tools'

export {
  builtinTools,
  BUILTIN_SERVER_NAME,
  isBuiltinTool,
  executeBuiltinTool,
  getBuiltinToolNames,
}

// ============================================================================
// MCP SERVICE CLASS
// ============================================================================

export class MCPService {
  private clients: Map<string, Client> = new Map()
  private transports: Map<
    string,
    | StdioClientTransport
    | WebSocketClientTransport
    | StreamableHTTPClientTransport
  > = new Map()
  private oauthClients: Map<string, OAuthClient> = new Map()
  private availableTools: MCPTool[] = []
  private disabledTools: Set<string> = new Set()
  private isInitializing = false
  private initializationPromise: Promise<void> | null = null
  private initializationProgress: {
    current: number
    total: number
    currentServer?: string
  } = { current: 0, total: 0 }

  private serverLogs: Map<string, ServerLogEntry[]> = new Map()
  private readonly MAX_LOG_ENTRIES = 1000

  private runtimeDisabledServers: Set<string> = new Set()
  private initializedServers: Set<string> = new Set()
  private hasBeenInitialized = false

  private activeResources = new Map<
    string,
    {
      serverId: string
      resourceId: string
      resourceType: string
      lastUsed: number
    }
  >()

  private sessionCleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.sessionCleanupInterval = setInterval(
      () => {
        this.cleanupInactiveResources()
      },
      5 * 60 * 1000,
    )

    try {
      const config = configStore.get() as Record<string, unknown>
      const persistedServers = config?.mcpRuntimeDisabledServers
      if (Array.isArray(persistedServers)) {
        for (const serverName of persistedServers) {
          this.runtimeDisabledServers.add(serverName)
        }
      }

      const persistedTools = config?.mcpDisabledTools
      if (Array.isArray(persistedTools)) {
        for (const toolName of persistedTools) {
          this.disabledTools.add(toolName)
        }
      }

      // Check if current profile has allServersDisabledByDefault enabled
      const profilesPath = path.join(getDataDir(), "profiles.json")
      if (existsSync(profilesPath)) {
        const profilesData = JSON.parse(readFileSync(profilesPath, "utf8")) as ProfilesData
        const currentProfile = profilesData.profiles?.find(
          (p) => p.id === profilesData.currentProfileId
        )
        const mcpServerConfig = currentProfile?.mcpServerConfig
        if (mcpServerConfig?.allServersDisabledByDefault) {
          // Get all configured MCP server names
          const mcpConfig = config?.mcpConfig as MCPConfig | undefined
          const allServerNames = Object.keys(mcpConfig?.mcpServers || {})
          const enabledServers = new Set(mcpServerConfig.enabledServers || [])

          // Derive runtimeDisabledServers directly from enabledServers
          this.runtimeDisabledServers.clear()
          for (const serverName of allServerNames) {
            if (!enabledServers.has(serverName)) {
              this.runtimeDisabledServers.add(serverName)
            }
          }

          // Persist the derived runtimeDisabledServers to configStore
          try {
            configStore.save({
              ...config,
              mcpRuntimeDisabledServers: Array.from(this.runtimeDisabledServers),
            })
          } catch (persistError) {
            // Ignore persistence errors
          }
        }
      }
    } catch (e) {
      // Ignore initialization errors from config loading
    }
  }

  /**
   * Get the client capabilities to declare during initialization.
   */
  private getClientCapabilities(): ClientCapabilities {
    return {
      elicitation: {},
      sampling: {},
      roots: {
        listChanged: true,
      },
    }
  }

  /**
   * Set up request handlers for a connected client.
   */
  private setupClientRequestHandlers(client: Client, serverName: string): void {
    // Handle elicitation requests from server
    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      diagnosticsService.logInfo(
        "mcp-service",
        `Received elicitation request from ${serverName}: ${request.params?.message || "no message"}`
      )

      const params = request.params
      const requestId = `elicit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

      if (params.mode === "url") {
        const result = await requestElicitation({
          mode: "url",
          serverName,
          message: params.message,
          url: params.url,
          elicitationId: params.elicitationId,
          requestId,
        })
        return result as ElicitResult
      } else {
        const result = await requestElicitation({
          mode: "form",
          serverName,
          message: params.message,
          requestedSchema: params.requestedSchema as unknown,
          requestId,
        })
        return result as ElicitResult
      }
    })

    // Handle sampling requests from server
    client.setRequestHandler(CreateMessageRequestSchema, async (request) => {
      diagnosticsService.logInfo(
        "mcp-service",
        `Received sampling request from ${serverName}: ${request.params?.messages?.length || 0} messages`
      )

      const params = request.params
      const requestId = `sample_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

      const result = await requestSampling({
        serverName,
        requestId,
        messages: params.messages as unknown[],
        systemPrompt: params.systemPrompt,
        maxTokens: params.maxTokens,
        temperature: params.temperature,
        modelPreferences: params.modelPreferences as unknown,
      })

      if (!result.approved) {
        throw new Error("Sampling request was declined by user")
      }

      return {
        role: "assistant",
        content: result.content || { type: "text", text: "" },
        model: result.model || "unknown",
        stopReason: result.stopReason,
      } as CreateMessageResult
    })

    // Handle elicitation complete notifications
    client.setNotificationHandler(ElicitationCompleteNotificationSchema, (notification) => {
      const elicitationId = notification.params?.elicitationId
      if (elicitationId) {
        diagnosticsService.logInfo(
          "mcp-service",
          `Received elicitation complete notification from ${serverName}: ${elicitationId}`
        )
        handleElicitationComplete(elicitationId)
      }
    })
  }

  trackResource(
    serverId: string,
    resourceId: string,
    resourceType: string = "session",
  ): void {
    const key = `${serverId}:${resourceType}:${resourceId}`
    this.activeResources.set(key, {
      serverId,
      resourceId,
      resourceType,
      lastUsed: Date.now(),
    })
  }

  updateResourceActivity(
    serverId: string,
    resourceId: string,
    resourceType: string = "session",
  ): void {
    const key = `${serverId}:${resourceType}:${resourceId}`
    const resource = this.activeResources.get(key)
    if (resource) {
      resource.lastUsed = Date.now()
    }
  }

  private cleanupInactiveResources(): void {
    const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000
    let cleanedCount = 0

    for (const [key, resource] of this.activeResources) {
      if (resource.lastUsed < thirtyMinutesAgo) {
        this.activeResources.delete(key)
        cleanedCount++
      }
    }
  }

  getTrackedResources(): Array<{
    serverId: string
    resourceId: string
    resourceType: string
    lastUsed: number
  }> {
    return Array.from(this.activeResources.values())
  }

  private trackResourceFromResult(
    serverName: string,
    result: MCPToolResult,
  ): void {
    if (!result.isError && result.content[0]?.text) {
      const text = result.content[0].text

      const resourcePatterns = [
        {
          pattern: /(?:Session|session)\s+(?:ID|id):\s*([a-f0-9-]+)/i,
          type: "session",
        },
        {
          pattern: /(?:Connection|connection)\s+(?:ID|id):\s*([a-f0-9-]+)/i,
          type: "connection",
        },
        { pattern: /(?:Handle|handle):\s*([a-f0-9-]+)/i, type: "handle" },
      ]

      for (const { pattern, type } of resourcePatterns) {
        const match = text.match(pattern)
        if (match && match[1]) {
          this.trackResource(serverName, match[1], type)
          break
        }
      }
    }
  }

  private addLogEntry(serverName: string, message: string): void {
    const logs = this.serverLogs.get(serverName) || []
    logs.push({
      timestamp: Date.now(),
      message: message.trim(),
    })

    // Trim logs if they exceed max entries
    if (logs.length > this.MAX_LOG_ENTRIES) {
      logs.splice(0, logs.length - this.MAX_LOG_ENTRIES)
    }

    this.serverLogs.set(serverName, logs)
  }

  getServerLogs(serverName: string): ServerLogEntry[] {
    return this.serverLogs.get(serverName) || []
  }

  clearServerLogs(serverName: string): void {
    this.serverLogs.set(serverName, [])
  }

  async initialize(): Promise<void> {
    // If initialization is already in progress, return the existing promise
    if (this.initializationPromise) {
      return this.initializationPromise
    }

    // Create and store the initialization promise
    this.initializationPromise = (async () => {
      try {
        this.isInitializing = true
        this.initializationProgress = { current: 0, total: 0 }

        const baseConfig = configStore.get() as Record<string, unknown>
        const rawMcpConfig = (baseConfig.mcpConfig || { mcpServers: {} }) as MCPConfig

        const { normalized: normalizedMcpConfig, changed: mcpConfigChanged } = normalizeMcpConfig(rawMcpConfig)

        if (mcpConfigChanged) {
          configStore.save({ ...baseConfig, mcpConfig: normalizedMcpConfig })
        }

        const mcpConfig = normalizedMcpConfig

        if (isDebugTools()) {
          logTools("MCP Service initialization starting")
        }

        if (
          !mcpConfig ||
          !mcpConfig.mcpServers ||
          Object.keys(mcpConfig.mcpServers).length === 0
        ) {
          if (isDebugTools()) {
            logTools("MCP Service initialization complete - no servers configured")
          }
          this.availableTools = []
          this.isInitializing = false
          this.hasBeenInitialized = true
          return
        }

        const serversToInitialize = Object.entries(mcpConfig.mcpServers).filter(
          ([serverName, serverConfig]) => {
            if ((serverConfig as MCPServerConfig).disabled) {
              if (isDebugTools()) {
                logTools(`Skipping server ${serverName} - disabled in config`)
              }
              return false
            }

            if (this.runtimeDisabledServers.has(serverName)) {
              if (isDebugTools()) {
                logTools(`Skipping server ${serverName} - runtime disabled by user`)
              }
              return false
            }

            if (!this.hasBeenInitialized) {
              return true
            }

            const alreadyInitialized = this.initializedServers.has(serverName)
            if (isDebugTools() && alreadyInitialized) {
              logTools(`Skipping server ${serverName} - already initialized`)
            }
            return !alreadyInitialized
          },
        )

        if (isDebugTools()) {
          logTools(`Found ${serversToInitialize.length} servers to initialize`,
            serversToInitialize.map(([name]) => name))
        }

        this.initializationProgress.total = serversToInitialize.length

        // Initialize servers
        for (const [serverName, serverConfig] of serversToInitialize) {
          this.initializationProgress.currentServer = serverName

          if (isDebugTools()) {
            logTools(`Starting initialization of server: ${serverName}`)
          }

          try {
            await this.initializeServer(serverName, serverConfig as MCPServerConfig)
            this.initializedServers.add(serverName)
            if (isDebugTools()) {
              logTools(`Successfully initialized server: ${serverName}`)
            }
          } catch (error) {
            if (isDebugTools()) {
              logTools(`Failed to initialize server: ${serverName}`, error)
            }
          }

          this.initializationProgress.current++
        }

        this.isInitializing = false
        this.hasBeenInitialized = true

        if (isDebugTools()) {
          logTools(`MCP Service initialization complete. Total tools available: ${this.availableTools.length}`)
        }
      } finally {
        this.initializationPromise = null
      }
    })()

    return this.initializationPromise
  }

  /**
   * Resolve a command path to find the executable
   */
  private async resolveCommandPath(command: string): Promise<string> {
    // If it's already an absolute path, check if it exists
    if (path.isAbsolute(command)) {
      try {
        await accessAsync(command, constants.X_OK)
        return command
      } catch {
        // Fall through to check without execute permission
        try {
          await accessAsync(command, constants.F_OK)
          return command
        } catch {
          throw new Error(`Command not found: ${command}`)
        }
      }
    }

    // For relative paths or commands, return as-is and let the shell resolve
    return command
  }

  /**
   * Prepare environment variables for a server process
   */
  private async prepareEnvironment(
    serverName: string,
    env?: Record<string, string>
  ): Promise<Record<string, string>> {
    // Start with current process environment
    const environment: Record<string, string> = { ...process.env as Record<string, string> }

    // Add server-specific environment variables
    if (env) {
      Object.assign(environment, env)
    }

    return environment
  }

  private async createTransport(
    serverName: string,
    serverConfig: MCPServerConfig,
  ): Promise<
    | StdioClientTransport
    | WebSocketClientTransport
    | StreamableHTTPClientTransport
  > {
    const transportType = inferTransportType(serverConfig)

    switch (transportType) {
      case "stdio":
        if (!serverConfig.command) {
          throw new Error("Command is required for stdio transport")
        }
        const resolvedCommand = await this.resolveCommandPath(serverConfig.command)
        const environment = await this.prepareEnvironment(serverName, serverConfig.env)
        const args = serverConfig.args || []

        const transport = new StdioClientTransport({
          command: resolvedCommand,
          args,
          env: environment,
          stderr: "pipe",
        })

        return transport

      case "websocket":
        if (!serverConfig.url) {
          throw new Error("URL is required for websocket transport")
        }
        return new WebSocketClientTransport(new URL(serverConfig.url))

      case "streamableHttp":
        if (!serverConfig.url) {
          throw new Error("URL is required for streamableHttp transport")
        }
        return await this.createStreamableHttpTransport(serverName, serverConfig)

      default:
        throw new Error(`Unsupported transport type: ${transportType}`)
    }
  }

  private async createStreamableHttpTransport(
    serverName: string,
    serverConfig: MCPServerConfig
  ): Promise<StreamableHTTPClientTransport> {
    const url = new URL(serverConfig.url!)
    const headers: Record<string, string> = { ...serverConfig.headers }

    // Check if we have OAuth tokens for this server
    const storedOAuth = oauthStorage.getServerOAuth(serverName)
    if (storedOAuth?.tokens?.access_token) {
      headers['Authorization'] = `Bearer ${storedOAuth.tokens.access_token}`
    }

    return new StreamableHTTPClientTransport(url, {
      requestInit: {
        headers,
      },
    })
  }

  private async initializeServer(
    serverName: string,
    serverConfig: MCPServerConfig,
    options: { allowAutoOAuth?: boolean } = {},
  ): Promise<void> {
    diagnosticsService.logInfo(
      "mcp-service",
      `Initializing server: ${serverName}`,
    )

    if (isDebugTools()) {
      logTools(`Initializing server: ${serverName}`, {
        transport: inferTransportType(serverConfig),
        command: serverConfig.command,
        args: serverConfig.args,
        env: Object.keys(serverConfig.env || {}),
      })
    }

    // Remove any existing tools from this server to prevent duplicates
    this.availableTools = this.availableTools.filter(
      (tool) => !tool.name.startsWith(`${serverName}:`),
    )

    try {
      const transportType = inferTransportType(serverConfig)

      // Initialize log storage for this server
      this.serverLogs.set(serverName, [])

      // Create appropriate transport based on configuration
      let transport = await this.createTransport(serverName, serverConfig)

      // For stdio transport, capture logs from the transport's stderr
      if (transportType === "stdio" && transport instanceof StdioClientTransport) {
        const stderrStream = transport.stderr

        if (stderrStream) {
          stderrStream.on('data', (data: Buffer) => {
            const message = data.toString()
            this.addLogEntry(serverName, message)
            if (isDebugTools()) {
              logTools(`[${serverName}] ${message}`)
            }
          })
        }
      }

      let client: Client | null = null
      const connectTimeout = serverConfig.timeout || 10000

      try {
        client = new Client(
          {
            name: "speakmcp-mcp-client",
            version: "1.0.0",
          },
          {
            capabilities: this.getClientCapabilities(),
          },
        )

        // Set up request handlers for elicitation and sampling
        this.setupClientRequestHandlers(client, serverName)

        // Connect to the server with timeout
        const connectPromise = client.connect(transport)
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(
            () => reject(new Error(`Connection timeout after ${connectTimeout}ms`)),
            connectTimeout,
          )
        })

        await Promise.race([connectPromise, timeoutPromise])
      } catch (error) {
        // Check if this is a 401 Unauthorized error for streamableHttp transport
        if (serverConfig.transport === "streamableHttp" &&
            error instanceof Error &&
            (error.message.includes("HTTP 401") || error.message.includes("invalid_token"))) {

          if (options.allowAutoOAuth) {
            diagnosticsService.logInfo("mcp-service", `Server ${serverName} requires OAuth authentication, initiating flow`)

            // Clean up the failed client
            if (client) {
              try {
                await client.close()
              } catch (closeError) {
                // Ignore close errors
              }
            }

            // For server mode, we can't do automatic OAuth flow with dialog prompts
            // Instead, log the requirement and let it fail
            console.log(`[OAuth] Server ${serverName} requires OAuth authentication.`)
            console.log(`[OAuth] Please configure OAuth tokens manually or use the web UI.`)
            throw new Error(`Server requires OAuth authentication. Please configure OAuth settings manually.`)
          } else {
            diagnosticsService.logInfo("mcp-service", `Server ${serverName} requires OAuth authentication - user must manually authenticate`)

            if (client) {
              try {
                await client.close()
              } catch (closeError) {
                // Ignore close errors
              }
            }

            throw new Error(`Server requires OAuth authentication. Please configure OAuth settings and authenticate manually.`)
          }
        } else {
          throw error
        }
      }

      // Store the client and transport
      this.clients.set(serverName, client!)
      this.transports.set(serverName, transport)

      // Get available tools from the server
      const toolsResult = await client!.listTools()

      if (isDebugTools()) {
        logTools(`Server ${serverName} connected successfully`, {
          toolCount: toolsResult.tools.length,
          tools: toolsResult.tools.map(t => ({ name: t.name, description: t.description }))
        })
      }

      // Add tools to our registry with server prefix
      for (const tool of toolsResult.tools) {
        this.availableTools.push({
          name: `${serverName}:${tool.name}`,
          description: tool.description || `Tool from ${serverName} server`,
          inputSchema: tool.inputSchema,
        })
      }
    } catch (error) {
      diagnosticsService.logError(
        "mcp-service",
        `Failed to initialize server ${serverName}`,
        error,
      )

      if (isDebugTools()) {
        logTools(`Server initialization failed: ${serverName}`, {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        })
      }

      // Clean up any partial initialization
      this.cleanupServer(serverName)

      throw error
    }
  }

  private cleanupServer(serverName: string): void {
    const transport = this.transports.get(serverName)

    this.transports.delete(serverName)
    this.clients.delete(serverName)
    this.initializedServers.delete(serverName)

    cancelAllElicitations(serverName)
    cancelAllSamplingRequests(serverName)

    if (transport) {
      try {
        transport.close()
      } catch (error) {
        // Ignore cleanup errors
      }
    }

    this.serverLogs.delete(serverName)

    this.availableTools = this.availableTools.filter(
      (tool) => !tool.name.startsWith(`${serverName}:`),
    )
  }

  /**
   * Get all available tools (includes builtin tools)
   */
  getAvailableTools(): MCPTool[] {
    // Filter out disabled tools
    const mcpTools = this.availableTools.filter(
      (tool) => !this.disabledTools.has(tool.name)
    )

    // Add builtin tools that are not disabled
    const enabledBuiltinTools = builtinTools.filter(
      (tool) => !this.disabledTools.has(`${BUILTIN_SERVER_NAME}:${tool.name}`)
    ).map(tool => ({
      ...tool,
      name: `${BUILTIN_SERVER_NAME}:${tool.name}`,
    }))

    return [...mcpTools, ...enabledBuiltinTools]
  }

  /**
   * Get all tools including disabled ones
   */
  getAllTools(): MCPTool[] {
    const builtinWithPrefix = builtinTools.map(tool => ({
      ...tool,
      name: `${BUILTIN_SERVER_NAME}:${tool.name}`,
    }))
    return [...this.availableTools, ...builtinWithPrefix]
  }

  /**
   * Check if a tool is disabled
   */
  isToolDisabled(toolName: string): boolean {
    return this.disabledTools.has(toolName)
  }

  /**
   * Set tool enabled/disabled state
   */
  setToolEnabled(toolName: string, enabled: boolean): void {
    if (enabled) {
      this.disabledTools.delete(toolName)
    } else {
      this.disabledTools.add(toolName)
    }

    // Persist to config
    try {
      const config = configStore.get() as Record<string, unknown>
      configStore.save({
        ...config,
        mcpDisabledTools: Array.from(this.disabledTools),
      })
    } catch (e) {
      // Ignore persistence errors
    }
  }

  /**
   * Set runtime enabled/disabled state for a server
   */
  setServerRuntimeEnabled(serverName: string, enabled: boolean): boolean {
    const config = configStore.get() as Record<string, unknown>
    const mcpConfig = config.mcpConfig as MCPConfig | undefined

    if (!mcpConfig?.mcpServers?.[serverName]) {
      return false
    }

    if (enabled) {
      this.runtimeDisabledServers.delete(serverName)
    } else {
      this.runtimeDisabledServers.add(serverName)
    }

    try {
      configStore.save({
        ...config,
        mcpRuntimeDisabledServers: Array.from(this.runtimeDisabledServers),
      })
    } catch (e) {
      // Ignore persistence errors
    }

    return true
  }

  /**
   * Check if a server is runtime enabled
   */
  isServerRuntimeEnabled(serverName: string): boolean {
    return !this.runtimeDisabledServers.has(serverName)
  }

  /**
   * Check if a server is available
   */
  isServerAvailable(serverName: string): boolean {
    const config = configStore.get() as Record<string, unknown>
    const mcpConfig = config.mcpConfig as MCPConfig | undefined
    const serverConfig = mcpConfig?.mcpServers?.[serverName]

    if (!serverConfig || serverConfig.disabled) {
      return false
    }

    return !this.runtimeDisabledServers.has(serverName)
  }

  /**
   * Check if a server is connected
   */
  isServerConnected(serverName: string): boolean {
    return this.clients.has(serverName)
  }

  /**
   * Get initialization progress
   */
  getInitializationProgress(): { current: number; total: number; currentServer?: string } {
    return { ...this.initializationProgress }
  }

  /**
   * Check if service is initializing
   */
  isServiceInitializing(): boolean {
    return this.isInitializing
  }

  /**
   * Check if service has been initialized
   */
  hasInitialized(): boolean {
    return this.hasBeenInitialized
  }

  /**
   * Get the list of connected server names
   */
  getConnectedServers(): string[] {
    return Array.from(this.clients.keys())
  }

  /**
   * Shutdown all connections
   */
  async shutdown(): Promise<void> {
    if (this.sessionCleanupInterval) {
      clearInterval(this.sessionCleanupInterval)
      this.sessionCleanupInterval = null
    }

    for (const serverName of this.clients.keys()) {
      this.cleanupServer(serverName)
    }

    this.clients.clear()
    this.transports.clear()
    this.oauthClients.clear()
    this.availableTools = []
    this.initializedServers.clear()
    this.hasBeenInitialized = false
  }

  /**
   * Execute a tool call
   */
  async executeToolCall(toolName: string, args: unknown): Promise<MCPToolResult> {
    // Check if it's a builtin tool
    if (isBuiltinTool(toolName)) {
      return executeBuiltinTool(toolName, args as Record<string, unknown>)
    }

    // Parse server name and tool name
    const colonIndex = toolName.indexOf(':')
    if (colonIndex === -1) {
      return {
        content: [{ type: 'text', text: `Invalid tool name format: ${toolName}` }],
        isError: true,
      }
    }

    const serverName = toolName.substring(0, colonIndex)
    const actualToolName = toolName.substring(colonIndex + 1)

    // Get the client for this server
    const client = this.clients.get(serverName)
    if (!client) {
      return {
        content: [{ type: 'text', text: `Server not connected: ${serverName}` }],
        isError: true,
      }
    }

    logMCP('REQUEST', serverName, { tool: actualToolName, arguments: args })

    try {
      const result = await client.callTool({
        name: actualToolName,
        arguments: args as Record<string, unknown>,
      })

      logMCP('RESPONSE', serverName, result)

      // Convert result to MCPToolResult format
      const content = Array.isArray(result.content)
        ? result.content.map((item: unknown) => {
            if (typeof item === 'object' && item !== null && 'type' in item) {
              const typedItem = item as { type: string; text?: string }
              if (typedItem.type === 'text' && typeof typedItem.text === 'string') {
                return { type: 'text' as const, text: typedItem.text }
              }
            }
            return { type: 'text' as const, text: JSON.stringify(item) }
          })
        : [{ type: 'text' as const, text: String(result.content) }]

      const toolResult: MCPToolResult = {
        content,
        isError: result.isError === true,
      }

      // Track any resources created by this tool
      this.trackResourceFromResult(serverName, toolResult)

      return toolResult
    } catch (error) {
      logMCP('RESPONSE', serverName, { error: error instanceof Error ? error.message : String(error) })

      return {
        content: [{ type: 'text', text: `Tool execution error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      }
    }
  }

  /**
   * Get server status for all configured servers
   */
  getServerStatus(): Record<string, { connected: boolean; toolCount: number }> {
    const status: Record<string, { connected: boolean; toolCount: number }> = {}

    const config = configStore.get() as Record<string, unknown>
    const mcpConfig = (config.mcpConfig || { mcpServers: {} }) as MCPConfig

    for (const serverName of Object.keys(mcpConfig.mcpServers || {})) {
      const isConnected = this.clients.has(serverName)
      const toolCount = this.availableTools.filter(t => t.name.startsWith(`${serverName}:`)).length

      status[serverName] = {
        connected: isConnected,
        toolCount,
      }
    }

    return status
  }

  /**
   * Test connection to a server
   */
  async testServerConnection(
    serverName: string,
    serverConfig: MCPServerConfig
  ): Promise<{ success: boolean; toolCount: number; error?: string }> {
    try {
      // If already connected, return success
      if (this.clients.has(serverName)) {
        const toolCount = this.availableTools.filter(t => t.name.startsWith(`${serverName}:`)).length
        return { success: true, toolCount }
      }

      // Try to initialize the server
      await this.initializeServer(serverName, serverConfig)
      const toolCount = this.availableTools.filter(t => t.name.startsWith(`${serverName}:`)).length
      return { success: true, toolCount }
    } catch (error) {
      return {
        success: false,
        toolCount: 0,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Apply profile MCP configuration
   */
  applyProfileMcpConfig(
    disabledServers: string[],
    disabledTools: string[],
    allServersDisabledByDefault: boolean,
    enabledServers: string[]
  ): void {
    const config = configStore.get() as Record<string, unknown>
    const mcpConfig = (config.mcpConfig || { mcpServers: {} }) as MCPConfig
    const allServerNames = Object.keys(mcpConfig.mcpServers || {})

    // Calculate runtime disabled servers
    if (allServersDisabledByDefault) {
      // All servers disabled except those in enabledServers
      const enabledSet = new Set(enabledServers)
      this.runtimeDisabledServers.clear()
      for (const serverName of allServerNames) {
        if (!enabledSet.has(serverName)) {
          this.runtimeDisabledServers.add(serverName)
        }
      }
    } else {
      // Only specific servers disabled
      this.runtimeDisabledServers = new Set(disabledServers)
    }

    // Update disabled tools
    this.disabledTools = new Set(disabledTools)

    // Persist to config
    try {
      configStore.save({
        ...config,
        mcpRuntimeDisabledServers: Array.from(this.runtimeDisabledServers),
        mcpDisabledTools: Array.from(this.disabledTools),
      })
    } catch (e) {
      // Ignore persistence errors
    }

    if (isDebugTools()) {
      logTools('Applied profile MCP config', {
        disabledServers: Array.from(this.runtimeDisabledServers),
        disabledTools: Array.from(this.disabledTools),
      })
    }
  }
}

// Singleton instance
export const mcpService = new MCPService()

// Export for WhatsApp toggle (stub in server mode)
export async function handleWhatsAppToggle(previousValue: boolean, newValue: boolean): Promise<void> {
  if (previousValue === newValue) return
  console.log(`[MCP] WhatsApp toggle: ${previousValue} -> ${newValue}`)
  // In server mode, WhatsApp integration is not supported
}

