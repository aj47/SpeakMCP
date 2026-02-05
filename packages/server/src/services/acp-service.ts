/**
 * ACP Service (simplified) - Manages ACP (Agent Client Protocol) agents
 * Supports stdio-based JSON-RPC communication with child processes
 */

import { spawn, ChildProcess } from 'child_process'
import { configStore } from '../config'

// ACP Agent config (matches desktop shared/types.ts ACPAgentConfig)
export interface ACPAgentConfig {
  name: string
  displayName: string
  description?: string
  autoSpawn?: boolean
  enabled?: boolean
  isInternal?: boolean
  connection: {
    type: 'stdio' | 'remote' | 'internal'
    command?: string
    args?: string[]
    env?: Record<string, string>
    cwd?: string
    url?: string
  }
}

export type ACPAgentStatus = 'stopped' | 'starting' | 'ready' | 'error'

interface ACPAgentInstance {
  config: ACPAgentConfig
  status: ACPAgentStatus
  process?: ChildProcess
  error?: string
  pendingRequests: Map<number, {
    resolve: (result: unknown) => void
    reject: (error: Error) => void
  }>
  nextRequestId: number
  buffer: string
  initialized?: boolean
  sessionId?: string
}

export interface ACPRunResponse {
  success: boolean
  result?: string
  error?: string
}

class ACPService {
  private agents: Map<string, ACPAgentInstance> = new Map()

  /** Get configured agents from config store */
  getConfiguredAgents(): ACPAgentConfig[] {
    const config = configStore.get() as Record<string, unknown>
    return (config.acpAgents || []) as ACPAgentConfig[]
  }

  /** Get all agents with runtime status */
  getAgents(): Array<{ config: ACPAgentConfig; status: ACPAgentStatus; error?: string }> {
    const configured = this.getConfiguredAgents()
    return configured.map(cfg => {
      const instance = this.agents.get(cfg.name)
      return {
        config: cfg,
        status: instance?.status || 'stopped',
        error: instance?.error,
      }
    })
  }

  /** Get a single agent's status */
  getAgentStatus(agentName: string): { status: ACPAgentStatus; error?: string } | undefined {
    const configured = this.getConfiguredAgents().find(a => a.name === agentName)
    if (!configured) return undefined
    const instance = this.agents.get(agentName)
    return {
      status: instance?.status || 'stopped',
      error: instance?.error,
    }
  }

  /** Add an agent config */
  addAgent(agentConfig: ACPAgentConfig): void {
    const config = configStore.get() as Record<string, unknown>
    const agents = [...((config.acpAgents || []) as ACPAgentConfig[])]
    if (agents.find(a => a.name === agentConfig.name)) {
      throw new Error(`Agent '${agentConfig.name}' already exists`)
    }
    agents.push(agentConfig)
    configStore.save({ ...config, acpAgents: agents })
  }

  /** Remove an agent config (and stop if running) */
  async removeAgent(agentName: string): Promise<void> {
    await this.stopAgent(agentName)
    const config = configStore.get() as Record<string, unknown>
    const agents = ((config.acpAgents || []) as ACPAgentConfig[]).filter(a => a.name !== agentName)
    configStore.save({ ...config, acpAgents: agents })
  }

  /** Update an agent config */
  updateAgent(agentName: string, updates: Partial<ACPAgentConfig>): void {
    const config = configStore.get() as Record<string, unknown>
    const agents = [...((config.acpAgents || []) as ACPAgentConfig[])]
    const idx = agents.findIndex(a => a.name === agentName)
    if (idx === -1) throw new Error(`Agent '${agentName}' not found`)
    agents[idx] = { ...agents[idx], ...updates, name: agentName }
    configStore.save({ ...config, acpAgents: agents })
  }

  /** Spawn an ACP agent process */
  async spawnAgent(agentName: string): Promise<void> {
    const agentConfig = this.getConfiguredAgents().find(a => a.name === agentName)
    if (!agentConfig) throw new Error(`Agent '${agentName}' not found in configuration`)
    if (agentConfig.enabled === false) throw new Error(`Agent '${agentName}' is disabled`)

    const existing = this.agents.get(agentName)
    if (existing?.status === 'ready') return
    if (existing?.status === 'starting') return

    const { command, args = [], env = {}, cwd } = agentConfig.connection
    if (!command) throw new Error(`No command specified for agent '${agentName}'`)

    const instance: ACPAgentInstance = {
      config: agentConfig,
      status: 'starting',
      pendingRequests: new Map(),
      nextRequestId: 1,
      buffer: '',
    }
    this.agents.set(agentName, instance)

    try {
      const processEnv = { ...process.env, ...env }
      const proc = spawn(command, args, {
        env: processEnv,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
        ...(cwd && { cwd }),
      })
      instance.process = proc

      proc.stdout?.on('data', (data: Buffer) => {
        this.handleStdoutData(agentName, data)
      })

      proc.stderr?.on('data', () => { /* captured but not logged */ })

      proc.on('exit', () => {
        instance.status = 'stopped'
        instance.process = undefined
        // Reject all pending requests
        for (const [, pending] of instance.pendingRequests) {
          pending.reject(new Error('Agent process exited'))
        }
        instance.pendingRequests.clear()
      })

      proc.on('error', (error) => {
        instance.status = 'error'
        instance.error = error.message
      })

      // Try to initialize via ACP protocol
      await this.initializeAgent(agentName)
    } catch (error) {
      instance.status = 'error'
      instance.error = error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  /** Stop an ACP agent */
  async stopAgent(agentName: string): Promise<void> {
    const instance = this.agents.get(agentName)
    if (!instance?.process) return

    // Reject pending requests
    for (const [, pending] of instance.pendingRequests) {
      pending.reject(new Error('Agent stopped'))
    }
    instance.pendingRequests.clear()

    try {
      instance.process.kill('SIGTERM')
      // Give it 3 seconds to exit gracefully
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          instance.process?.kill('SIGKILL')
          resolve()
        }, 3000)
        instance.process?.on('exit', () => {
          clearTimeout(timeout)
          resolve()
        })
      })
    } catch { /* ignore */ }

    instance.status = 'stopped'
    instance.process = undefined
  }

  /** Stop all running agents */
  async stopAllAgents(): Promise<void> {
    const promises: Promise<void>[] = []
    for (const [agentName] of this.agents) {
      promises.push(this.stopAgent(agentName))
    }
    await Promise.allSettled(promises)
  }

  /** Run a task on an agent */
  async runTask(agentName: string, input: string): Promise<ACPRunResponse> {
    const instance = this.agents.get(agentName)
    if (!instance || instance.status !== 'ready') {
      // Try to spawn first
      try {
        await this.spawnAgent(agentName)
      } catch (error) {
        return { success: false, error: `Agent not ready: ${error instanceof Error ? error.message : String(error)}` }
      }
    }

    try {
      // Create session if needed
      if (!instance?.sessionId) {
        await this.createSession(agentName)
      }

      // Send prompt
      const result = await this.sendRequest(agentName, 'session/prompt', {
        sessionId: this.agents.get(agentName)?.sessionId,
        prompt: [{ type: 'text', text: input }],
      }) as { content?: Array<{ type: string; text?: string }>; stopReason?: string }

      const text = result?.content
        ?.filter(c => c.type === 'text' && c.text)
        .map(c => c.text)
        .join('\n') || ''

      return { success: true, result: text }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  // ---- Private helpers ----

  private handleStdoutData(agentName: string, data: Buffer): void {
    const instance = this.agents.get(agentName)
    if (!instance) return

    instance.buffer += data.toString()
    const lines = instance.buffer.split('\n')
    instance.buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const msg = JSON.parse(line)
        if (msg.id !== undefined && instance.pendingRequests.has(msg.id)) {
          const pending = instance.pendingRequests.get(msg.id)!
          instance.pendingRequests.delete(msg.id)
          if (msg.error) {
            pending.reject(new Error(msg.error.message || 'JSON-RPC error'))
          } else {
            pending.resolve(msg.result)
          }
        }
        // Notifications (no id) are logged but not processed further
      } catch { /* skip non-JSON lines */ }
    }
  }

  private async sendRequest(agentName: string, method: string, params?: unknown): Promise<unknown> {
    const instance = this.agents.get(agentName)
    if (!instance?.process || instance.status !== 'ready') {
      throw new Error(`Agent '${agentName}' is not ready`)
    }

    const id = instance.nextRequestId++
    const request = { jsonrpc: '2.0', id, method, params }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        instance.pendingRequests.delete(id)
        reject(new Error(`Request timed out: ${method}`))
      }, 60000)

      instance.pendingRequests.set(id, {
        resolve: (result: unknown) => { clearTimeout(timeout); resolve(result) },
        reject: (error: Error) => { clearTimeout(timeout); reject(error) },
      })

      const message = JSON.stringify(request) + '\n'
      instance.process?.stdin?.write(message, (error) => {
        if (error) {
          clearTimeout(timeout)
          instance.pendingRequests.delete(id)
          reject(error)
        }
      })
    })
  }

  private async initializeAgent(agentName: string): Promise<void> {
    const instance = this.agents.get(agentName)
    if (!instance) return

    try {
      await this.sendRequest(agentName, 'initialize', {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
        },
        clientInfo: { name: 'speakmcp-server', title: 'SpeakMCP Server', version: '1.2.0' },
      })
      instance.initialized = true
      instance.status = 'ready'
    } catch (error) {
      instance.status = 'error'
      instance.error = error instanceof Error ? error.message : String(error)
    }
  }

  private async createSession(agentName: string): Promise<string | undefined> {
    const instance = this.agents.get(agentName)
    if (!instance || instance.status !== 'ready') return undefined

    try {
      const result = await this.sendRequest(agentName, 'session/new', {
        cwd: process.cwd(),
      }) as { sessionId?: string }

      if (result?.sessionId) {
        instance.sessionId = result.sessionId
      }
      return result?.sessionId
    } catch {
      return undefined
    }
  }
}

export const acpService = new ACPService()


