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

class ACPService extends EventEmitter {
  private agents: Map<string, ACPAgentInstance> = new Map()

  constructor() {
    super()
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
   * Run a task on an agent (main ACP operation)
   */
  async runTask(request: ACPRunRequest): Promise<ACPRunResponse> {
    const { agentName, input, context, mode = "sync" } = request

    // Ensure agent is running
    const instance = this.agents.get(agentName)
    if (!instance || instance.status !== "ready") {
      // Try to spawn it
      try {
        await this.spawnAgent(agentName)
      } catch (error) {
        return {
          success: false,
          error: `Failed to start agent: ${error instanceof Error ? error.message : String(error)}`,
        }
      }
    }

    try {
      // Format input for ACP protocol
      const formattedInput = typeof input === "string"
        ? { messages: [{ role: "user", content: input }] }
        : input

      // Send the run request via JSON-RPC
      const result = await this.sendRequest(agentName, "run", {
        input: formattedInput,
        context,
        mode,
      })

      // Extract result
      const response = result as { output?: string; content?: string; result?: string }
      const output = response.output || response.content || response.result || JSON.stringify(result)

      return {
        success: true,
        result: output,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
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

