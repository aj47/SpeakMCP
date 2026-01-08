/**
 * ACP Service - Manages ACP (Agent Client Protocol) agents
 * 
 * Supports two connection types:
 * - stdio: Spawns a local process and communicates via JSON-RPC over stdin/stdout
 * - remote: Connects to an HTTP endpoint (future implementation)
 * 
 * Both Auggie and Claude Code ACP use stdio-based JSON-RPC.
 */

import { spawn, ChildProcess } from "child_process"
import { EventEmitter } from "events"
import { readFile, writeFile, mkdir, realpath } from "fs/promises"
import { dirname } from "path"
import { configStore } from "./config"
import { ACPAgentConfig } from "../shared/types"
import { toolApprovalManager } from "./state"
import { emitAgentProgress } from "./emit-agent-progress"
import { logACP } from "./debug"
import { getSpeakMcpSessionForAcpSession } from "./acp-session-state"

// JSON-RPC types
interface JsonRpcRequest {
  jsonrpc: "2.0"
  id: number | string
  method: string
  params?: unknown
}

interface JsonRpcResponse {
  jsonrpc: "2.0"
  id: number | string | null
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

interface JsonRpcNotification {
  jsonrpc: "2.0"
  method: string
  params?: unknown
}

// ACP Agent status
export type ACPAgentStatus = "stopped" | "starting" | "ready" | "error"

// ACP Agent instance (running agent)
export interface ACPAgentInstance {
  config: ACPAgentConfig
  status: ACPAgentStatus
  process?: ChildProcess
  error?: string
  // For stdio communication
  pendingRequests: Map<number | string, {
    resolve: (result: unknown) => void
    reject: (error: Error) => void
  }>
  nextRequestId: number
  buffer: string
  // ACP protocol state
  initialized?: boolean
  sessionId?: string
  // Agent capabilities from initialize response
  agentCapabilities?: {
    loadSession?: boolean
  }
  agentInfo?: {
    name: string
    title: string
    version: string
  }
  sessionInfo?: {
    models?: {
      availableModels: Array<{ modelId: string; name: string; description?: string }>
      currentModelId: string
    }
    modes?: {
      availableModes: Array<{ id: string; name: string; description?: string }>
      currentModeId: string
    }
  }
}

// ACP Run request
export interface ACPRunRequest {
  agentName: string
  input: string | { messages: Array<{ role: string; content: string }> }
  context?: string
  mode?: "sync" | "async" | "stream"
}

// ACP Run response
export interface ACPRunResponse {
  success: boolean
  result?: string
  error?: string
}

// Content block from ACP session/update notifications
export interface ACPContentBlock {
  type: "text" | "tool_use" | "tool_result" | "image" | "resource"
  text?: string
  name?: string  // for tool_use
  input?: unknown  // for tool_use
  result?: unknown  // for tool_result
  mimeType?: string  // for image/resource
  data?: string  // for image (base64)
}

// Session output tracking
export interface ACPSessionOutput {
  sessionId: string
  agentName: string
  contentBlocks: ACPContentBlock[]
  isComplete: boolean
  stopReason?: string
}

// ACP Tool Call Status (per protocol spec)
export type ACPToolCallStatus = 
  | "pending"        // Tool call hasn't started running yet
  | "running"        // Tool is currently executing
  | "completed"      // Tool completed successfully
  | "failed"         // Tool failed with an error

// ACP Tool Call Update (from session/update or request_permission)
export interface ACPToolCallUpdate {
  toolCallId: string
  title: string
  status?: ACPToolCallStatus
  content?: ACPToolCallContent[]
  rawInput?: unknown
  rawOutput?: unknown
}

// ACP Tool Call Content (shows tool execution details)
export interface ACPToolCallContent {
  type: "diff" | "terminal" | "text" | "location"
  // For diff type
  path?: string
  patch?: string
  // For terminal type
  terminalId?: string
  // For text type
  text?: string
  // For location type
  line?: number
  column?: number
}

// ACP Permission Option (presented to user)
export interface ACPPermissionOption {
  optionId: string
  name: string
  kind: "allow_once" | "allow_always" | "deny"
}

// ACP Request Permission Request (from agent to client)
export interface ACPRequestPermissionRequest {
  sessionId: string
  toolCall: ACPToolCallUpdate
  options: ACPPermissionOption[]
}

// ACP Request Permission Response (from client to agent)
// Per ACP spec, outcome is an object with "outcome" string field and optional "optionId"
export interface ACPRequestPermissionResponse {
  outcome:
    | { outcome: "selected"; optionId: string }
    | { outcome: "cancelled" }
}

// ACP fs/read_text_file Request
export interface ACPReadTextFileRequest {
  sessionId: string
  path: string
  line?: number
  limit?: number
}

// ACP fs/write_text_file Request
export interface ACPWriteTextFileRequest {
  sessionId: string
  path: string
  content: string
}

class ACPService extends EventEmitter {
  private agents: Map<string, ACPAgentInstance> = new Map()
  // Track session outputs for visibility (keyed by sessionId or unique fallback)
  private sessionOutputs: Map<string, ACPSessionOutput> = new Map()
  // Counter for generating unique fallback session IDs when sessionId is not provided
  private fallbackSessionCounter = 0

  constructor() {
    super()
    // Listen to our own notifications to process them
    this.on("notification", this.handleAgentNotification.bind(this))
  }

  /**
   * Handle notifications from ACP agents (session/update, etc.)
   */
  private handleAgentNotification(event: { agentName: string; method: string; params: unknown }): void {
    const { agentName, method, params } = event

    if (method === "session/update") {
      this.handleSessionUpdate(agentName, params as {
        sessionId?: string
        content?: ACPContentBlock[]
        stopReason?: string
        isComplete?: boolean
      })
    } else if (method === "$/log" || method === "notifications/log") {
      // Log message from agent
      const logParams = params as { level?: string; message?: string; data?: unknown }
      const level = logParams?.level || "info"
      const message = logParams?.message || JSON.stringify(logParams)

      // Emit for UI consumption
      this.emit("agentLog", { agentName, level, message, data: logParams?.data })
    }
  }

  /**
   * Handle session/update notifications - agent's streaming output and tool call updates
   */
  private handleSessionUpdate(agentName: string, params: {
    sessionId?: string
    content?: ACPContentBlock[] | ACPContentBlock
    stopReason?: string
    isComplete?: boolean
    // Tool call updates per ACP spec
    toolCall?: ACPToolCallUpdate
    // ACP agents may nest content inside an "update" object
    update?: {
      sessionUpdate?: string
      content?: ACPContentBlock | ACPContentBlock[]
      stopReason?: string
      toolCall?: ACPToolCallUpdate
    }
    // Claude Code metadata (Task 2.3) - updated to match actual structure from Claude Code agent
    _meta?: {
      claudeCode?: {
        toolName?: string
        toolResponse?: {
          status?: string
          agentId?: string
          totalDurationMs?: number
          totalTokens?: number
          totalToolUseCount?: number
          usage?: {
            input_tokens?: number
            cache_creation_input_tokens?: number
            cache_read_input_tokens?: number
            output_tokens?: number
          }
        }
      }
    }
  }): void {
    const instance = this.agents.get(agentName)
    // Generate a unique fallback session ID per agent to avoid mixing output from different agents/runs
    // when sessionId is not provided by the notification
    const sessionId = params.sessionId || instance?.sessionId || `${agentName}_fallback_${++this.fallbackSessionCounter}`

    // Get or create session output tracking
    let output = this.sessionOutputs.get(sessionId)
    if (!output) {
      output = {
        sessionId,
        agentName,
        contentBlocks: [],
        isComplete: false,
      }
      this.sessionOutputs.set(sessionId, output)
    }

    // Extract content from various possible locations in the params
    // ACP agents may structure content differently:
    // 1. params.content (array or single block)
    // 2. params.update.content (nested inside update object)
    let contentBlocks: ACPContentBlock[] = []

    // Check for content at top level
    if (params.content) {
      if (Array.isArray(params.content)) {
        contentBlocks = params.content
      } else if (typeof params.content === "object") {
        contentBlocks = [params.content]
      }
    }

    // Check for content nested in update object (Augment ACP format)
    if (params.update?.content) {
      if (Array.isArray(params.update.content)) {
        contentBlocks = [...contentBlocks, ...params.update.content]
      } else if (typeof params.update.content === "object") {
        contentBlocks = [...contentBlocks, params.update.content]
      }
    }

    // Append new content blocks
    if (contentBlocks.length > 0) {
      for (const block of contentBlocks) {
        output.contentBlocks.push(block)

      }
    }

    // Check for stop reason in update object as well
    const stopReason = params.stopReason || params.update?.stopReason

    // Update completion status
    if (params.isComplete) {
      output.isComplete = true
      output.stopReason = stopReason
    }

    // Handle tool call updates from the notification
    const toolCallUpdate = params.toolCall || params.update?.toolCall
    if (toolCallUpdate) {
      this.emit("toolCallUpdate", {
        agentName,
        sessionId,
        toolCall: toolCallUpdate,
        awaitingPermission: false,
      })
    }

    // Extract Claude Code tool response metadata (Task 2.3)
    const toolResponseStats = params._meta?.claudeCode?.toolResponse

    // Emit event for real-time UI updates
    this.emit("sessionUpdate", {
      agentName,
      sessionId,
      content: contentBlocks.length > 0 ? contentBlocks : undefined,
      toolCall: toolCallUpdate,
      isComplete: params.isComplete,
      stopReason,
      totalBlocks: output.contentBlocks.length,
      // Include tool response stats if present (Task 2.3)
      toolResponseStats,
    })
  }

  /**
   * Get the accumulated output for a session
   */
  getSessionOutput(sessionId: string): ACPSessionOutput | undefined {
    return this.sessionOutputs.get(sessionId)
  }

  /**
   * Get all session outputs for an agent
   */
  getAgentSessionOutputs(agentName: string): ACPSessionOutput[] {
    const outputs: ACPSessionOutput[] = []
    for (const output of this.sessionOutputs.values()) {
      if (output.agentName === agentName) {
        outputs.push(output)
      }
    }
    return outputs
  }

  /**
   * Clear session output tracking (e.g., when session is closed)
   */
  clearSessionOutput(sessionId: string): void {
    this.sessionOutputs.delete(sessionId)
  }

  /**
   * Initialize ACP service - loads agents from config and auto-spawns if needed
   */
  async initialize(): Promise<void> {
    const config = configStore.get()
    const acpAgents = config.acpAgents || []

    for (const agentConfig of acpAgents) {
      if (agentConfig.enabled !== false && agentConfig.autoSpawn) {
        try {
          await this.spawnAgent(agentConfig.name)
        } catch {
          // Silently ignore auto-spawn failures
        }
      }
    }
  }

  /**
   * Get all configured agents with their current status
   */
  getAgents(): Array<{ config: ACPAgentConfig; status: ACPAgentStatus; error?: string }> {
    const config = configStore.get()
    const acpAgents = config.acpAgents || []

    return acpAgents.map(agentConfig => {
      const instance = this.agents.get(agentConfig.name)
      return {
        config: agentConfig,
        status: instance?.status || "stopped",
        error: instance?.error,
      }
    })
  }

  /**
   * Get a specific agent's status
   */
  getAgentStatus(agentName: string): { status: ACPAgentStatus; error?: string } | null {
    const instance = this.agents.get(agentName)
    if (!instance) {
      return { status: "stopped" }
    }
    return { status: instance.status, error: instance.error }
  }

  /**
   * Get the current session ID for an agent (if any)
   */
  getAgentSessionId(agentName: string): string | undefined {
    const instance = this.agents.get(agentName)
    return instance?.sessionId
  }

  /**
   * Get a specific agent instance (Task 5.2)
   * Provides access to agent info, session info, and other instance data.
   */
  getAgentInstance(agentName: string): ACPAgentInstance | undefined {
    return this.agents.get(agentName)
  }

  /**
   * Spawn an ACP agent process
   */
  async spawnAgent(agentName: string): Promise<void> {
    const config = configStore.get()
    const agentConfig = config.acpAgents?.find(a => a.name === agentName)

    if (!agentConfig) {
      throw new Error(`Agent ${agentName} not found in configuration`)
    }

    if (agentConfig.enabled === false) {
      throw new Error(`Agent ${agentName} is disabled`)
    }

    // Check if already running or starting - treat both 'ready' and 'starting' as "already spawning"
    // This prevents spawning duplicate processes when a second call arrives while a spawn is in progress
    const existing = this.agents.get(agentName)
    if (existing) {
      if (existing.status === "ready") {
        return
      }
      if (existing.status === "starting") {
        // Wait for the existing spawn to complete (poll until ready or error)
        await this.waitForAgentReady(agentName)
        // Check final status after waiting - throw if agent failed or stopped
        const finalInstance = this.agents.get(agentName)
        if (finalInstance?.status === "error") {
          throw new Error(finalInstance.error || `Agent ${agentName} failed to start`)
        }
        if (finalInstance?.status === "stopped" || !finalInstance) {
          throw new Error(`Agent ${agentName} stopped unexpectedly during startup`)
        }
        return
      }
    }

    if (agentConfig.connection.type !== "stdio") {
      throw new Error(`Connection type ${agentConfig.connection.type} not yet supported`)
    }

    const { command, args = [], env = {}, cwd } = agentConfig.connection

    if (!command) {
      throw new Error(`No command specified for agent ${agentName}`)
    }

    // Create agent instance
    const instance: ACPAgentInstance = {
      config: agentConfig,
      status: "starting",
      pendingRequests: new Map(),
      nextRequestId: 1,
      buffer: "",
    }

    this.agents.set(agentName, instance)
    this.emit("agentStatusChanged", { agentName, status: "starting" })

    try {
      // Merge environment variables
      const processEnv = { ...process.env, ...env }

      // Spawn the process with optional working directory
      const proc = spawn(command, args, {
        env: processEnv,
        stdio: ["pipe", "pipe", "pipe"],
        shell: process.platform === "win32",
        ...(cwd && { cwd }),
      })

      instance.process = proc

      // Handle stdout (JSON-RPC responses)
      proc.stdout?.on("data", (data: Buffer) => {
        this.handleStdoutData(agentName, data)
      })

      // Handle stderr (logs)
      proc.stderr?.on("data", (data: Buffer) => {
        // stderr is captured but not logged to reduce noise
        void data
      })

      // Handle process exit
      proc.on("exit", (code, signal) => {
        // Distinguish between clean shutdown and abnormal exit
        // Exit code 0 or SIGTERM signal indicates clean shutdown
        const isCleanShutdown = code === 0 || signal === "SIGTERM"
        
        if (isCleanShutdown) {
          instance.status = "stopped"
        } else {
          // Abnormal exit - preserve error state for diagnostics
          instance.status = "error"
          instance.error = instance.error || `Process exited with code ${code}${signal ? `, signal ${signal}` : ''}`
        }
        
        instance.process = undefined

        // Reject any pending requests
        for (const [id, { reject }] of instance.pendingRequests) {
          reject(new Error(`Agent process exited unexpectedly`))
        }
        instance.pendingRequests.clear()

        this.emit("agentStatusChanged", { 
          agentName, 
          status: instance.status, 
          error: instance.error 
        })
      })

      // Handle process error
      proc.on("error", (error) => {
        instance.status = "error"
        instance.error = error.message
        this.emit("agentStatusChanged", { agentName, status: "error", error: error.message })
      })

      // Wait a moment for the process to start, then mark as ready
      await new Promise(resolve => setTimeout(resolve, 500))

      if (instance.status === "starting") {
        instance.status = "ready"
        this.emit("agentStatusChanged", { agentName, status: "ready" })
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      instance.status = "error"
      instance.error = errorMessage
      this.emit("agentStatusChanged", { agentName, status: "error", error: errorMessage })
      throw error
    }
  }

  /**
   * Wait for an agent to transition from 'starting' to 'ready' or 'error'.
   * Used to prevent spawning duplicate processes when multiple spawn requests arrive.
   * Throws an error if the timeout is reached while agent is still starting.
   */
  private async waitForAgentReady(agentName: string, timeoutMs = 30000): Promise<void> {
    const startTime = Date.now()
    const pollIntervalMs = 200

    while (Date.now() - startTime < timeoutMs) {
      const instance = this.agents.get(agentName)
      if (!instance || instance.status === "ready" || instance.status === "error" || instance.status === "stopped") {
        return
      }
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
    }

    // Timeout reached - update agent status and throw error
    const instance = this.agents.get(agentName)
    if (instance && instance.status === "starting") {
      const errorMessage = `Timeout waiting for agent ${agentName} to become ready after ${timeoutMs}ms`
      instance.status = "error"
      instance.error = errorMessage
      this.emit("agentStatusChanged", { agentName, status: "error", error: errorMessage })
      throw new Error(errorMessage)
    }
  }

  /**
   * Stop an ACP agent process
   */
  async stopAgent(agentName: string): Promise<void> {
    const instance = this.agents.get(agentName)
    if (!instance || !instance.process) {
      return
    }

    // Reject any pending requests
    for (const [id, { reject }] of instance.pendingRequests) {
      reject(new Error(`Agent stopped`))
    }
    instance.pendingRequests.clear()

    // Kill the process
    try {
      instance.process.kill("SIGTERM")

      // Wait for graceful shutdown
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (instance.process && !instance.process.killed) {
            instance.process.kill("SIGKILL")
          }
          resolve()
        }, 5000)

        instance.process?.on("exit", () => {
          clearTimeout(timeout)
          resolve()
        })
      })
    } catch {
      // Silently ignore errors during shutdown
    }

    instance.status = "stopped"
    instance.process = undefined
    this.emit("agentStatusChanged", { agentName, status: "stopped" })
  }

  /**
   * Send a JSON-RPC request to an agent
   */
  private async sendRequest(agentName: string, method: string, params?: unknown): Promise<unknown> {
    const instance = this.agents.get(agentName)
    if (!instance || !instance.process || instance.status !== "ready") {
      throw new Error(`Agent ${agentName} is not ready`)
    }

    const id = instance.nextRequestId++
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    }

    // Log the complete request (not individual chunks)
    logACP("REQUEST", agentName, method, params)

    return new Promise((resolve, reject) => {
      // Timeout handle so we can clear it when response arrives
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined

      const cleanup = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle)
          timeoutHandle = undefined
        }
      }

      instance.pendingRequests.set(id, {
        resolve: (result: unknown) => {
          cleanup()
          resolve(result)
        },
        reject: (error: Error) => {
          cleanup()
          reject(error)
        }
      })

      const message = JSON.stringify(request) + "\n"
      instance.process?.stdin?.write(message, (error) => {
        if (error) {
          cleanup()
          instance.pendingRequests.delete(id)
          reject(error)
        }
      })

      // Timeout after 5 minutes
      timeoutHandle = setTimeout(() => {
        if (instance.pendingRequests.has(id)) {
          instance.pendingRequests.delete(id)
          reject(new Error(`Request timeout for method ${method}`))
        }
      }, 300000)
    })
  }

  /**
   * Handle stdout data from an agent process
   */
  private handleStdoutData(agentName: string, data: Buffer): void {
    const instance = this.agents.get(agentName)
    if (!instance) return

    instance.buffer += data.toString()

    // Try to parse complete JSON-RPC messages (newline-delimited)
    const lines = instance.buffer.split("\n")
    instance.buffer = lines.pop() || "" // Keep incomplete line in buffer

    for (let line of lines) {
      // Handle Windows CRLF line endings - strip trailing \r before parsing
      line = line.replace(/\r$/, '')
      if (!line.trim()) continue

      try {
        const message = JSON.parse(line) as JsonRpcRequest | JsonRpcResponse | JsonRpcNotification

        if ("id" in message && message.id !== null && "method" in message) {
          // This is a REQUEST from the agent to us (the client)
          // We need to handle it and send a response back
          logACP("REQUEST", agentName, `← ${(message as JsonRpcRequest).method}`, (message as JsonRpcRequest).params)
          this.handleAgentRequest(agentName, message as JsonRpcRequest)
        } else if ("id" in message && message.id !== null) {
          // This is a RESPONSE to one of our requests
          const pending = instance.pendingRequests.get(message.id)
          if (pending) {
            instance.pendingRequests.delete(message.id)
            const response = message as JsonRpcResponse
            // Log the complete response (not individual chunks)
            logACP("RESPONSE", agentName, `id:${message.id}`, response.error || response.result)
            if (response.error) {
              pending.reject(new Error(response.error.message))
            } else {
              pending.resolve(response.result)
            }
          }
        } else if ("method" in message) {
          // This is a notification (no id means no response expected)
          // Only log non-chunk notifications to avoid spam
          const notification = message as JsonRpcNotification
          const params = notification.params as Record<string, unknown> | undefined
          const update = params?.update as Record<string, unknown> | undefined
          const isChunk = notification.method === "session/update" && update?.sessionUpdate === "agent_message_chunk"
          if (!isChunk) {
            logACP("NOTIFICATION", agentName, `← ${notification.method}`, notification.params)
          }
          this.emit("notification", { agentName, method: notification.method, params: notification.params })
        }
      } catch {
        // Silently ignore unparseable messages
      }
    }
  }

  /**
   * Handle incoming requests from ACP agents (reverse direction).
   * Per ACP spec, agents can send requests to clients for:
   * - session/request_permission: Request user approval for tool calls
   * - fs/read_text_file: Read file contents
   * - fs/write_text_file: Write file contents
   * - terminal/*: Terminal operations (future)
   */
  private async handleAgentRequest(agentName: string, request: JsonRpcRequest): Promise<void> {
    const { id, method, params } = request

    console.log(`[ACP handleAgentRequest] method=${method}, id=${id} (type: ${typeof id})`)

    try {
      let result: unknown

      switch (method) {
        case "session/request_permission":
          result = await this.handleRequestPermission(agentName, params as ACPRequestPermissionRequest)
          break

        case "fs/read_text_file":
          result = await this.handleReadTextFile(agentName, params as ACPReadTextFileRequest)
          break

        case "fs/write_text_file":
          result = await this.handleWriteTextFile(agentName, params as ACPWriteTextFileRequest)
          break

        default:
          // Unknown method - send error response
          this.sendResponse(agentName, id, undefined, {
            code: -32601,
            message: `Method not found: ${method}`,
          })
          return
      }

      // Send success response
      this.sendResponse(agentName, id, result)
    } catch (error) {
      // Send error response
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.sendResponse(agentName, id, undefined, {
        code: -32000,
        message: errorMessage,
      })
    }
  }

  /**
   * Send a JSON-RPC response to an agent
   */
  private sendResponse(
    agentName: string,
    id: number | string,
    result?: unknown,
    error?: { code: number; message: string; data?: unknown }
  ): void {
    const instance = this.agents.get(agentName)
    if (!instance?.process?.stdin) {
      console.log(`[ACP sendResponse] No process/stdin for agent=${agentName}, id=${id}`)
      return
    }

    const response: JsonRpcResponse = {
      jsonrpc: "2.0",
      id,
      ...(error ? { error } : { result: result ?? {} }),
    }

    console.log(`[ACP sendResponse] Sending response to ${agentName}, id=${id}:`, JSON.stringify(response, null, 2))

    const message = JSON.stringify(response) + "\n"
    instance.process.stdin.write(message, (err) => {
      if (err) {
        console.log(`[ACP sendResponse] Write error for ${agentName}, id=${id}:`, err)
      } else {
        console.log(`[ACP sendResponse] Successfully wrote response to ${agentName}, id=${id}`)
      }
    })
  }

  /**
   * Send a JSON-RPC notification to an agent (no response expected)
   */
  private sendNotification(agentName: string, method: string, params?: unknown): void {
    const instance = this.agents.get(agentName)
    if (!instance?.process?.stdin) {
      return
    }

    const notification: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      params,
    }

    // Log outgoing notification
    logACP("NOTIFICATION", agentName, method, params)

    const message = JSON.stringify(notification) + "\n"
    instance.process.stdin.write(message, (err) => {
      // Silently ignore write failures
      void err
    })
  }

  /**
   * Handle session/request_permission - Request user approval for tool calls
   * Per ACP spec, this is sent by agents before executing sensitive operations.
   */
  private async handleRequestPermission(
    agentName: string,
    params: ACPRequestPermissionRequest
  ): Promise<ACPRequestPermissionResponse> {
    const { sessionId: acpSessionId, toolCall, options } = params

    // Map ACP session ID to SpeakMCP session ID for UI routing
    // The ACP agent uses its own session IDs, but SpeakMCP's UI tracks progress
    // using its own session IDs from agentSessionTracker
    const speakMcpSessionId = getSpeakMcpSessionForAcpSession(acpSessionId) || acpSessionId
    logACP("PERMISSION", agentName, `Mapping ACP session ${acpSessionId} → SpeakMCP session ${speakMcpSessionId}`)

    // Emit tool call status update for UI visibility
    this.emit("toolCallUpdate", {
      agentName,
      sessionId: speakMcpSessionId,
      toolCall: {
        ...toolCall,
        status: "pending" as ACPToolCallStatus,
      },
      awaitingPermission: true,
    })

    // Use the existing tool approval manager to request approval
    // This integrates with SpeakMCP's existing UI approval flow
    const { approvalId, promise } = toolApprovalManager.requestApproval(
      speakMcpSessionId,
      toolCall.title,
      toolCall.rawInput
    )

    // Emit progress update to show pending approval in UI
    await emitAgentProgress({
      sessionId: speakMcpSessionId,
      currentIteration: 0,
      maxIterations: 1,
      steps: [
        {
          id: `acp-tool-${toolCall.toolCallId}`,
          type: "tool_approval",
          title: `ACP Agent: ${agentName}`,
          description: toolCall.title,
          status: "awaiting_approval",
          timestamp: Date.now(),
          approvalRequest: {
            approvalId,
            toolName: toolCall.title,
            arguments: toolCall.rawInput,
          },
        },
      ],
      isComplete: false,
      pendingToolApproval: {
        approvalId,
        toolName: toolCall.title,
        arguments: toolCall.rawInput,
      },
    })

    // Wait for user response
    console.log(`[ACP Tool Approval] Waiting for user response for approvalId=${approvalId}, speakMcpSessionId=${speakMcpSessionId}`)
    console.log(`[ACP Tool Approval] pendingToolApprovals before wait:`, toolApprovalManager.getPendingApprovalCount())
    const approved = await promise
    console.log(`[ACP Tool Approval] User responded: approved=${approved} for approvalId=${approvalId}`)
    console.log(`[ACP Tool Approval] pendingToolApprovals after response:`, toolApprovalManager.getPendingApprovalCount())

    // Emit status update
    this.emit("toolCallUpdate", {
      agentName,
      sessionId: speakMcpSessionId,
      toolCall: {
        ...toolCall,
        status: approved ? "running" : "failed",
      },
      awaitingPermission: false,
    })

    // Clear the pending approval from the UI by explicitly setting pendingToolApproval to undefined
    await emitAgentProgress({
      sessionId: speakMcpSessionId,
      currentIteration: 0,
      maxIterations: 1,
      steps: [
        {
          id: `acp-tool-${toolCall.toolCallId}`,
          type: "tool_approval",
          title: `ACP Agent: ${agentName}`,
          description: toolCall.title,
          status: approved ? "completed" : "error",
          timestamp: Date.now(),
        },
      ],
      isComplete: false,
      pendingToolApproval: undefined, // Explicitly clear to sync state across all windows
    })

    if (approved) {
      // Find the "allow_once" or first allow option
      const allowOption = options.find(o => o.kind === "allow_once") || options.find(o => o.kind !== "deny")
      if (allowOption) {
        return {
          outcome: { outcome: "selected", optionId: allowOption.optionId },
        }
      }
    }

    // User denied or cancelled - find deny option or use cancelled
    const denyOption = options.find(o => o.kind === "deny")
    if (denyOption) {
      return {
        outcome: { outcome: "selected", optionId: denyOption.optionId },
      }
    }

    // No deny option available, return cancelled
    return {
      outcome: { outcome: "cancelled" },
    }
  }

  /**
   * Check if a path is in a sensitive location that should be blocked.
   * This provides a basic security boundary for file operations.
   */
  private isSensitivePath(filePath: string): boolean {
    // Normalize separators to forward slash for consistent matching on all platforms
    const normalizedPath = filePath.toLowerCase().replace(/\\/g, '/')
    
    // Blocklist of sensitive paths that should not be accessed
    // All patterns use forward slash since we normalized the path above
    const sensitivePatterns = [
      // SSH keys and config
      '/.ssh/',
      // GPG keys
      '/.gnupg/',
      // AWS credentials
      '/.aws/credentials',
      // Environment files with secrets
      '/.env',
      // Keychain/credential stores
      '/keychain/',
      '/keychains/',
      // System password files
      '/etc/passwd',
      '/etc/shadow',
      // Private keys (these are suffix patterns, not path patterns)
      '.pem',
      '_rsa',
      '_dsa',
      '_ecdsa',
      '_ed25519',
    ]
    
    return sensitivePatterns.some(pattern => normalizedPath.includes(pattern))
  }

  /**
   * Resolve the real path of a file, following symlinks.
   * Returns null if the path doesn't exist or can't be resolved.
   */
  private async resolveRealPath(filePath: string): Promise<string | null> {
    try {
      return await realpath(filePath)
    } catch {
      // File doesn't exist or can't be resolved - return null
      // Callers should fall back to filePath for the actual operation
      return null
    }
  }

  /**
   * Handle fs/read_text_file - Read file contents for agent
   * Per ACP spec, only available if client advertises fs.readTextFile capability.
   * 
   * Security: Requires user approval when mcpRequireApprovalBeforeToolCall is enabled,
   * in addition to the blocklist check for sensitive paths.
   */
  private async handleReadTextFile(
    agentName: string,
    params: ACPReadTextFileRequest
  ): Promise<{ content: string }> {
    const { sessionId: acpSessionId, path: filePath, line, limit } = params

    // Map ACP session ID to SpeakMCP session ID for UI routing
    const speakMcpSessionId = getSpeakMcpSessionForAcpSession(acpSessionId) || acpSessionId

    try {
      // Security check: Ensure path is absolute
      // Allow both forward slash (Unix and Windows C:/) and backslash (Windows C:\) patterns
      if (!filePath.startsWith("/") && !filePath.match(/^[a-zA-Z]:[/\\]/)) {
        throw new Error("Path must be absolute")
      }

      // Resolve symlinks to check the real path for security
      // This prevents bypassing blocklist via symlinks to sensitive locations
      const resolvedPath = await this.resolveRealPath(filePath)
      const pathToCheck = resolvedPath || filePath

      // Security check: Block access to sensitive paths (check both original and resolved)
      if (this.isSensitivePath(filePath) || this.isSensitivePath(pathToCheck)) {
        throw new Error("Access denied: Cannot read files in sensitive locations (SSH keys, credentials, etc.)")
      }

      // Security check: Require user approval if enabled in config
      const config = configStore.get()
      if (config.mcpRequireApprovalBeforeToolCall) {
        const { approvalId, promise } = toolApprovalManager.requestApproval(
          speakMcpSessionId,
          `fs/read_text_file`,
          { path: filePath, line, limit }
        )

        // Emit progress update to show pending approval in UI
        await emitAgentProgress({
          sessionId: speakMcpSessionId,
          currentIteration: 0,
          maxIterations: 1,
          steps: [
            {
              id: `acp-file-read-${Date.now()}`,
              type: "tool_approval",
              title: `ACP Agent: ${agentName}`,
              description: `Read file: ${filePath}`,
              status: "awaiting_approval",
              timestamp: Date.now(),
              approvalRequest: {
                approvalId,
                toolName: "fs/read_text_file",
                arguments: { path: filePath, line, limit },
              },
            },
          ],
          isComplete: false,
          pendingToolApproval: {
            approvalId,
            toolName: "fs/read_text_file",
            arguments: { path: filePath, line, limit },
          },
        })

        // Wait for user response
        const approved = await promise

        // Clear the pending approval from the UI by explicitly setting pendingToolApproval to undefined
        await emitAgentProgress({
          sessionId: speakMcpSessionId,
          currentIteration: 0,
          maxIterations: 1,
          steps: [
            {
              id: `acp-file-read-${Date.now()}`,
              type: "tool_approval",
              title: `ACP Agent: ${agentName}`,
              description: `Read file: ${filePath}`,
              status: approved ? "completed" : "error",
              timestamp: Date.now(),
            },
          ],
          isComplete: false,
          pendingToolApproval: undefined, // Explicitly clear to sync state across all windows
        })

        if (!approved) {
          throw new Error("User denied file read operation")
        }
      }

      // Use resolved path for actual read to prevent TOCTOU attacks via symlink swapping
      const effectivePath = resolvedPath || filePath
      const content = await readFile(effectivePath, "utf-8")

      // Handle line offset and limit if specified
      if (line !== undefined || limit !== undefined) {
        const lines = content.split("\n")
        // Validate and normalize line/limit to prevent unexpected behavior
        const effectiveLine = Math.max(1, line ?? 1) // Line is 1-based, minimum 1
        const effectiveLimit = limit !== undefined ? Math.max(0, limit) : undefined
        const startLine = effectiveLine - 1 // Convert to 0-based
        const endLine = effectiveLimit !== undefined ? startLine + effectiveLimit : lines.length
        return {
          content: lines.slice(startLine, endLine).join("\n"),
        }
      }

      return { content }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to read file: ${errorMessage}`)
    }
  }

  /**
   * Handle fs/write_text_file - Write file contents for agent
   * Per ACP spec, only available if client advertises fs.writeTextFile capability.
   * 
   * Security: Requires user approval when mcpRequireApprovalBeforeToolCall is enabled,
   * in addition to the blocklist check for sensitive paths.
   */
  private async handleWriteTextFile(
    agentName: string,
    params: ACPWriteTextFileRequest
  ): Promise<Record<string, never>> {
    const { sessionId: acpSessionId, path: filePath, content } = params

    // Map ACP session ID to SpeakMCP session ID for UI routing
    const speakMcpSessionId = getSpeakMcpSessionForAcpSession(acpSessionId) || acpSessionId

    try {
      // Security check: Ensure path is absolute
      // Allow both forward slash (Unix and Windows C:/) and backslash (Windows C:\) patterns
      if (!filePath.startsWith("/") && !filePath.match(/^[a-zA-Z]:[/\\]/)) {
        throw new Error("Path must be absolute")
      }

      // Resolve symlinks to check the real path for security
      // We check both the file itself (if it exists and is a symlink) and the parent directory
      // This prevents bypassing blocklist via symlinks to sensitive locations

      // First, try to resolve the file path itself (handles existing symlinks)
      const resolvedFilePath = await this.resolveRealPath(filePath)

      // Also resolve the parent directory for the case where file doesn't exist yet
      const resolvedDirPath = await this.resolveRealPath(dirname(filePath))
      const constructedPath = resolvedDirPath ? `${resolvedDirPath}/${filePath.split(/[/\\]/).pop()}` : filePath

      // Security check: Block writes to sensitive paths
      // Check: original path, resolved file path (if symlink exists), and constructed path from resolved directory
      if (this.isSensitivePath(filePath) ||
          (resolvedFilePath && this.isSensitivePath(resolvedFilePath)) ||
          this.isSensitivePath(constructedPath)) {
        throw new Error("Access denied: Cannot write files in sensitive locations (SSH keys, credentials, etc.)")
      }

      // Security check: Require user approval if enabled in config
      const config = configStore.get()
      if (config.mcpRequireApprovalBeforeToolCall) {
        const { approvalId, promise } = toolApprovalManager.requestApproval(
          speakMcpSessionId,
          `fs/write_text_file`,
          { path: filePath, contentLength: content.length }
        )

        // Emit progress update to show pending approval in UI
        await emitAgentProgress({
          sessionId: speakMcpSessionId,
          currentIteration: 0,
          maxIterations: 1,
          steps: [
            {
              id: `acp-file-write-${Date.now()}`,
              type: "tool_approval",
              title: `ACP Agent: ${agentName}`,
              description: `Write file: ${filePath} (${content.length} bytes)`,
              status: "awaiting_approval",
              timestamp: Date.now(),
              approvalRequest: {
                approvalId,
                toolName: "fs/write_text_file",
                arguments: { path: filePath, contentLength: content.length },
              },
            },
          ],
          isComplete: false,
          pendingToolApproval: {
            approvalId,
            toolName: "fs/write_text_file",
            arguments: { path: filePath, contentLength: content.length },
          },
        })

        // Wait for user response
        const approved = await promise

        // Clear the pending approval from the UI by explicitly setting pendingToolApproval to undefined
        await emitAgentProgress({
          sessionId: speakMcpSessionId,
          currentIteration: 0,
          maxIterations: 1,
          steps: [
            {
              id: `acp-file-write-${Date.now()}`,
              type: "tool_approval",
              title: `ACP Agent: ${agentName}`,
              description: `Write file: ${filePath} (${content.length} bytes)`,
              status: approved ? "completed" : "error",
              timestamp: Date.now(),
            },
          ],
          isComplete: false,
          pendingToolApproval: undefined, // Explicitly clear to sync state across all windows
        })

        if (!approved) {
          throw new Error("User denied file write operation")
        }
      }

      // Use resolved path for actual write to prevent TOCTOU attacks via symlink swapping
      // If file exists and is a symlink, resolvedFilePath will be the actual target
      // Otherwise fall back to original path for new files
      const effectivePath = resolvedFilePath || filePath

      // Ensure parent directory exists
      await mkdir(dirname(effectivePath), { recursive: true })

      await writeFile(effectivePath, content, "utf-8")
      return {}
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to write file: ${errorMessage}`)
    }
  }

  /**
   * Initialize an agent with the ACP protocol.
   * Per ACP spec, clients MUST send initialize before session/new.
   */
  private async initializeAgent(agentName: string): Promise<void> {
    const instance = this.agents.get(agentName)
    if (!instance || instance.initialized) {
      return
    }

    try {
      const result = await this.sendRequest(agentName, "initialize", {
        protocolVersion: 1,
        clientCapabilities: {
          fs: {
            readTextFile: true,
            writeTextFile: true,
          },
          // Note: terminal capability is not advertised since terminal/* methods are not yet implemented
          // in handleAgentRequest(). Enable this once terminal support is added.
          // terminal: true,
        },
        clientInfo: {
          name: "speakmcp",
          title: "SpeakMCP",
          version: "1.2.0",
        },
      }) as {
        protocolVersion?: number
        agentCapabilities?: { loadSession?: boolean }
        agentInfo?: { name?: string; title?: string; version?: string }
      }

      instance.initialized = true

      // Store agent capabilities from response
      if (result?.agentCapabilities) {
        instance.agentCapabilities = result.agentCapabilities as { loadSession?: boolean }
      }

      // Store agent info from response (Task 2.1)
      if (result?.agentInfo) {
        instance.agentInfo = {
          name: result.agentInfo.name || "",
          title: result.agentInfo.title || "",
          version: result.agentInfo.version || "",
        }
      }
    } catch {
      // Don't throw - some agents might not require initialization
    }
  }

  /**
   * Create a new ACP session for the agent.
   */
  private async createSession(agentName: string): Promise<string | undefined> {
    const instance = this.agents.get(agentName)
    if (!instance) {
      return undefined
    }

    // Reuse existing session if available, but clear previous output to avoid
    // mixing content from different runTask() calls
    if (instance.sessionId) {
      this.clearSessionOutput(instance.sessionId)
      return instance.sessionId
    }

    try {
      // Use session/new per ACP spec (not session/create)
      const result = await this.sendRequest(agentName, "session/new", {
        cwd: process.cwd(),
        mcpServers: [],
      }) as {
        sessionId?: string
        models?: {
          availableModels: Array<{ modelId: string; name: string; description?: string }>
          currentModelId: string
        }
        modes?: {
          availableModes: Array<{ id: string; name: string; description?: string }>
          currentModeId: string
        }
      }

      const sessionId = result?.sessionId
      if (sessionId) {
        instance.sessionId = sessionId
      }

      // Store models from session/new response (Task 2.2)
      if (result?.models) {
        instance.sessionInfo = {
          ...instance.sessionInfo,
          models: result.models,
        }
      }

      // Store modes from session/new response (Task 2.2)
      if (result?.modes) {
        instance.sessionInfo = {
          ...instance.sessionInfo,
          modes: result.modes,
        }
      }

      return sessionId
    } catch {
      return undefined
    }
  }

  /**
   * Run a task on an agent using the proper ACP protocol.
   * ACP protocol flow:
   * 1. initialize - Negotiate protocol version and capabilities
   * 2. session/new - Create a new session with cwd and MCP servers
   * 3. session/prompt - Send the user's prompt
   * 4. Receive session/update notifications for results
   */
  async runTask(request: ACPRunRequest): Promise<ACPRunResponse> {
    const { agentName, input, context } = request

    // Ensure agent is running
    let instance = this.agents.get(agentName)
    if (!instance || instance.status !== "ready") {
      // Try to spawn it
      try {
        await this.spawnAgent(agentName)
        instance = this.agents.get(agentName)
      } catch (error) {
        return {
          success: false,
          error: `Failed to start agent: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    }

    if (!instance || instance.status !== "ready") {
      return {
        success: false,
        error: `Agent ${agentName} is not ready`,
      }
    }

    try {
      // Step 1: Initialize if not already done
      if (!instance.initialized) {
        await this.initializeAgent(agentName)
      }

      // Step 2: Create session if needed
      const sessionId = await this.createSession(agentName)

      // Format the input text
      const inputText = typeof input === "string" ? input :
        input.messages?.map(m => m.content).join("\n") || JSON.stringify(input)

      // Combine context and input
      const promptText = context ? `Context: ${context}\n\nTask: ${inputText}` : inputText

      // Step 3: Send the prompt
      // Format prompt as content blocks per ACP spec
      const promptContent = [
        {
          type: "text",
          text: promptText,
        }
      ]

      const promptParams: { sessionId?: string; prompt: typeof promptContent } = {
        prompt: promptContent,
      }
      if (sessionId) {
        promptParams.sessionId = sessionId
      }

      const promptResult = await this.sendRequest(agentName, "session/prompt", promptParams) as {
        stopReason?: string
        error?: { message?: string }
        content?: ACPContentBlock[]
        message?: { content?: ACPContentBlock[] }  // Some agents wrap content in message
      }

      if (promptResult?.error) {
        return {
          success: false,
          error: promptResult.error.message || JSON.stringify(promptResult.error),
        }
      }

      // Collect text output from the response (if returned directly)
      let resultText = ""

      // Try different response formats - agents may structure content differently
      const contentBlocks = promptResult?.content
        || promptResult?.message?.content
        || (promptResult as Record<string, unknown>)?.messages?.[0]?.content
        || []

      if (Array.isArray(contentBlocks)) {
        for (const block of contentBlocks) {
          if (typeof block === "string") {
            resultText += block + "\n"
          } else if (block?.type === "text" && block?.text) {
            resultText += block.text + "\n"
          } else if (block?.text) {
            resultText += block.text + "\n"
          }
        }
      } else if (typeof contentBlocks === "string") {
        resultText = contentBlocks
      }

      // Also check for direct text field in response
      if (!resultText && (promptResult as Record<string, unknown>)?.text) {
        resultText = String((promptResult as Record<string, unknown>).text)
      }

      // Also check session output collected from notifications
      if (sessionId) {
        const sessionOutput = this.getSessionOutput(sessionId)
        if (sessionOutput) {
          for (const block of sessionOutput.contentBlocks) {
            if (block.type === "text" && block.text && !resultText.includes(block.text)) {
              resultText += block.text + "\n"
            }
          }
        }
      }

      // Check if we got a stop reason
      const stopReason = promptResult?.stopReason

      // Build a meaningful result message
      let resultMessage: string
      if (resultText.trim()) {
        resultMessage = resultText.trim()
      } else if (stopReason) {
        resultMessage = `Task completed with stop reason: ${stopReason}`
      } else {
        resultMessage = "Task sent to agent. Output will be logged as it arrives."
      }

      return {
        success: true,
        result: resultMessage,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Check if this is a "Method not found" error - agent might use different protocol
      if (errorMessage.includes("Method not found")) {
        return {
          success: false,
          error: `Agent "${agentName}" doesn't support standard ACP protocol. It may require a different integration method.`,
        }
      }

      return {
        success: false,
        error: errorMessage,
      }
    }
  }

  /**
   * Clean up all agents on shutdown
   */
  async shutdown(): Promise<void> {
    const stopPromises = Array.from(this.agents.keys()).map(name => this.stopAgent(name))
    await Promise.allSettled(stopPromises)
  }

  /**
   * Get or create a session for main agent use.
   * Unlike runTask(), this gives fine-grained control over session lifecycle.
   */
  async getOrCreateSession(agentName: string, forceNew?: boolean): Promise<string | undefined> {
    // Ensure agent is spawned and ready
    let instance = this.agents.get(agentName)
    if (!instance || instance.status !== "ready") {
      try {
        await this.spawnAgent(agentName)
        instance = this.agents.get(agentName)
      } catch {
        return undefined
      }
    }

    if (!instance || instance.status !== "ready") {
      return undefined
    }

    // Initialize if not already done
    if (!instance.initialized) {
      await this.initializeAgent(agentName)
    }

    // If forceNew, clear existing session
    if (forceNew && instance.sessionId) {
      this.clearSessionOutput(instance.sessionId)
      instance.sessionId = undefined
    }

    // Create or reuse session
    return await this.createSession(agentName)
  }

  /**
   * Send a prompt to an existing session and return when complete.
   * Emits 'sessionUpdate' events during execution for progress tracking.
   */
  async sendPrompt(
    agentName: string,
    sessionId: string,
    prompt: string
  ): Promise<{
    success: boolean
    response?: string
    stopReason?: string
    error?: string
  }> {
    const instance = this.agents.get(agentName)
    if (!instance || instance.status !== "ready") {
      return {
        success: false,
        error: `Agent ${agentName} is not ready`,
      }
    }

    // Clear any stale session output from previous prompts in this session
    // This ensures we only collect content blocks from the current prompt,
    // preventing old messages from being included in the response
    this.clearSessionOutput(sessionId)

    try {
      // Format prompt as content blocks per ACP spec
      const promptContent = [{ type: "text", text: prompt }]

      const result = await this.sendRequest(agentName, "session/prompt", {
        sessionId,
        prompt: promptContent,
      }) as {
        stopReason?: string
        error?: { message?: string }
        content?: ACPContentBlock[]
        message?: { content?: ACPContentBlock[] }
      }

      if (result?.error) {
        return {
          success: false,
          error: result.error.message || JSON.stringify(result.error),
        }
      }

      // Collect text output from the response
      let responseText = ""
      const contentBlocks = result?.content || result?.message?.content || []

      if (Array.isArray(contentBlocks)) {
        for (const block of contentBlocks) {
          if (typeof block === "string") {
            responseText += block + "\n"
          } else if (block?.type === "text" && block?.text) {
            responseText += block.text + "\n"
          }
        }
      }

      // Also check session output collected from notifications
      const sessionOutput = this.getSessionOutput(sessionId)
      if (sessionOutput) {
        for (const block of sessionOutput.contentBlocks) {
          if (block.type === "text" && block.text && !responseText.includes(block.text)) {
            responseText += block.text + "\n"
          }
        }
      }

      return {
        success: true,
        response: responseText.trim() || undefined,
        stopReason: result?.stopReason,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        error: errorMessage,
      }
    }
  }

  /**
   * Cancel an in-progress prompt.
   */
  async cancelPrompt(agentName: string, sessionId: string): Promise<void> {
    this.sendNotification(agentName, "session/cancel", { sessionId })
  }

  /**
   * Check if an agent supports session loading (for resuming sessions).
   */
  getAgentCapabilities(agentName: string): { loadSession?: boolean } | undefined {
    const instance = this.agents.get(agentName)
    return instance?.agentCapabilities
  }
}

export const acpService = new ACPService()

