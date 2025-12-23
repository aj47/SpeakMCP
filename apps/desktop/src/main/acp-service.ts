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
import { configStore } from "./config"
import { ACPAgentConfig } from "../shared/types"
import { logApp } from "./debug"

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

class ACPService extends EventEmitter {
  private agents: Map<string, ACPAgentInstance> = new Map()
  // Track session outputs for visibility
  private sessionOutputs: Map<string, ACPSessionOutput> = new Map()

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

    logApp(`[ACP:${agentName}] Received notification: ${method}`)

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
      logApp(`[ACP:${agentName}:${level}] ${message}`)

      // Emit for UI consumption
      this.emit("agentLog", { agentName, level, message, data: logParams?.data })
    }
  }

  /**
   * Handle session/update notifications - agent's streaming output
   */
  private handleSessionUpdate(agentName: string, params: {
    sessionId?: string
    content?: ACPContentBlock[]
    stopReason?: string
    isComplete?: boolean
  }): void {
    const instance = this.agents.get(agentName)
    const sessionId = params.sessionId || instance?.sessionId || "unknown"

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

    // Append new content blocks
    if (params.content && Array.isArray(params.content)) {
      for (const block of params.content) {
        output.contentBlocks.push(block)

        // Log text content for visibility
        if (block.type === "text" && block.text) {
          // Truncate long text for logging
          const displayText = block.text.length > 500
            ? block.text.substring(0, 500) + "..."
            : block.text
          logApp(`[ACP:${agentName}:output] ${displayText}`)
        } else if (block.type === "tool_use" && block.name) {
          logApp(`[ACP:${agentName}:tool] Using tool: ${block.name}`)
        } else if (block.type === "tool_result") {
          logApp(`[ACP:${agentName}:tool] Tool result received`)
        }
      }
    }

    // Update completion status
    if (params.isComplete) {
      output.isComplete = true
      output.stopReason = params.stopReason
      logApp(`[ACP:${agentName}] Session ${sessionId} complete. Stop reason: ${params.stopReason}`)
    }

    // Emit event for real-time UI updates
    this.emit("sessionUpdate", {
      agentName,
      sessionId,
      content: params.content,
      isComplete: params.isComplete,
      stopReason: params.stopReason,
      totalBlocks: output.contentBlocks.length,
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

    logApp(`[ACP] Initializing with ${acpAgents.length} configured agents`)

    for (const agentConfig of acpAgents) {
      if (agentConfig.enabled !== false && agentConfig.autoSpawn) {
        try {
          await this.spawnAgent(agentConfig.name)
        } catch (error) {
          logApp(`[ACP] Failed to auto-spawn agent ${agentConfig.name}: ${error}`)
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

    // Check if already running
    const existing = this.agents.get(agentName)
    if (existing && existing.status === "ready") {
      logApp(`[ACP] Agent ${agentName} is already running`)
      return
    }

    if (agentConfig.connection.type !== "stdio") {
      throw new Error(`Connection type ${agentConfig.connection.type} not yet supported`)
    }

    const { command, args = [], env = {} } = agentConfig.connection

    if (!command) {
      throw new Error(`No command specified for agent ${agentName}`)
    }

    logApp(`[ACP] Spawning agent ${agentName}: ${command} ${args.join(" ")}`)

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

      // Spawn the process
      const proc = spawn(command, args, {
        env: processEnv,
        stdio: ["pipe", "pipe", "pipe"],
        shell: process.platform === "win32",
      })

      instance.process = proc

      // Handle stdout (JSON-RPC responses)
      proc.stdout?.on("data", (data: Buffer) => {
        this.handleStdoutData(agentName, data)
      })

      // Handle stderr (logs)
      proc.stderr?.on("data", (data: Buffer) => {
        const message = data.toString()
        logApp(`[ACP:${agentName}:stderr] ${message}`)
      })

      // Handle process exit
      proc.on("exit", (code, signal) => {
        logApp(`[ACP] Agent ${agentName} exited with code ${code}, signal ${signal}`)
        instance.status = "stopped"
        instance.process = undefined

        // Reject any pending requests
        for (const [id, { reject }] of instance.pendingRequests) {
          reject(new Error(`Agent process exited unexpectedly`))
        }
        instance.pendingRequests.clear()

        this.emit("agentStatusChanged", { agentName, status: "stopped" })
      })

      // Handle process error
      proc.on("error", (error) => {
        logApp(`[ACP] Agent ${agentName} process error: ${error.message}`)
        instance.status = "error"
        instance.error = error.message
        this.emit("agentStatusChanged", { agentName, status: "error", error: error.message })
      })

      // Wait a moment for the process to start, then mark as ready
      await new Promise(resolve => setTimeout(resolve, 500))

      if (instance.status === "starting") {
        instance.status = "ready"
        this.emit("agentStatusChanged", { agentName, status: "ready" })
        logApp(`[ACP] Agent ${agentName} is ready`)
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
   * Stop an ACP agent process
   */
  async stopAgent(agentName: string): Promise<void> {
    const instance = this.agents.get(agentName)
    if (!instance || !instance.process) {
      return
    }

    logApp(`[ACP] Stopping agent ${agentName}`)

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
    } catch (error) {
      logApp(`[ACP] Error stopping agent ${agentName}: ${error}`)
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

    return new Promise((resolve, reject) => {
      instance.pendingRequests.set(id, { resolve, reject })

      const message = JSON.stringify(request) + "\n"
      instance.process?.stdin?.write(message, (error) => {
        if (error) {
          instance.pendingRequests.delete(id)
          reject(error)
        }
      })

      // Timeout after 5 minutes
      setTimeout(() => {
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

    for (const line of lines) {
      if (!line.trim()) continue

      try {
        const message = JSON.parse(line) as JsonRpcResponse | JsonRpcNotification

        if ("id" in message && message.id !== null) {
          // This is a response
          const pending = instance.pendingRequests.get(message.id)
          if (pending) {
            instance.pendingRequests.delete(message.id)
            if (message.error) {
              pending.reject(new Error(message.error.message))
            } else {
              pending.resolve(message.result)
            }
          }
        } else if ("method" in message) {
          // This is a notification
          this.emit("notification", { agentName, method: message.method, params: message.params })
        }
      } catch (error) {
        logApp(`[ACP:${agentName}] Failed to parse message: ${line}`)
      }
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

    logApp(`[ACP:${agentName}] Sending initialize request`)

    try {
      const result = await this.sendRequest(agentName, "initialize", {
        protocolVersion: 1,
        clientCapabilities: {
          fs: {
            readTextFile: true,
            writeTextFile: true,
          },
          terminal: true,
        },
        clientInfo: {
          name: "speakmcp",
          title: "SpeakMCP",
          version: "1.0.0",
        },
      }) as { protocolVersion?: number; agentCapabilities?: unknown }

      logApp(`[ACP:${agentName}] Initialized with protocol version ${result?.protocolVersion}`)
      instance.initialized = true
    } catch (error) {
      logApp(`[ACP:${agentName}] Initialize failed: ${error}`)
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

    // Reuse existing session if available
    if (instance.sessionId) {
      return instance.sessionId
    }

    logApp(`[ACP:${agentName}] Creating new session`)

    try {
      // Use session/new per ACP spec (not session/create)
      const result = await this.sendRequest(agentName, "session/new", {
        cwd: process.cwd(),
        mcpServers: [],
      }) as { sessionId?: string }

      const sessionId = result?.sessionId
      if (sessionId) {
        instance.sessionId = sessionId
        logApp(`[ACP:${agentName}] Session created: ${sessionId}`)
      }
      return sessionId
    } catch (error) {
      logApp(`[ACP:${agentName}] Session creation failed: ${error}`)
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

      logApp(`[ACP:${agentName}] Sending session/prompt`)
      const promptResult = await this.sendRequest(agentName, "session/prompt", promptParams) as {
        stopReason?: string
        error?: { message?: string }
        content?: ACPContentBlock[]
      }

      if (promptResult?.error) {
        return {
          success: false,
          error: promptResult.error.message || JSON.stringify(promptResult.error),
        }
      }

      // Collect text output from the response (if returned directly)
      let resultText = ""
      if (promptResult?.content && Array.isArray(promptResult.content)) {
        for (const block of promptResult.content) {
          if (block.type === "text" && block.text) {
            resultText += block.text + "\n"
          }
        }
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

      logApp(`[ACP:${agentName}] Task result: ${resultMessage.substring(0, 200)}...`)

      return {
        success: true,
        result: resultMessage,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)

      // Check if this is a "Method not found" error - agent might use different protocol
      if (errorMessage.includes("Method not found")) {
        logApp(`[ACP:${agentName}] Standard ACP methods not supported, this agent may use a different protocol`)
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
    logApp(`[ACP] Shutting down all agents`)
    const stopPromises = Array.from(this.agents.keys()).map(name => this.stopAgent(name))
    await Promise.allSettled(stopPromises)
  }
}

export const acpService = new ACPService()

