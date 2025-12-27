import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { EventEmitter } from 'events'
import { z } from 'zod'

export const McpServerConfigSchema = z.object({
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  url: z.string().optional(),
  transport: z.enum(['stdio', 'sse', 'http']).optional(),
  timeout: z.number().optional(),
  disabled: z.boolean().optional(),
})

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>

export interface McpServer {
  name: string
  config: McpServerConfig
  client: Client | null
  transport: StdioClientTransport | SSEClientTransport | null
  status: 'stopped' | 'starting' | 'running' | 'error'
  error?: string
  tools: McpTool[]
  enabled: boolean
}

export interface McpTool {
  name: string
  description?: string
  inputSchema: unknown
  serverName: string
  enabled: boolean
}

export interface McpServerStatus {
  name: string
  status: string
  toolCount: number
  error?: string
  enabled: boolean
}

// Events emitted by the MCP service
export interface McpServiceEvents {
  'server:starting': { name: string }
  'server:started': { name: string; tools: McpTool[] }
  'server:stopped': { name: string }
  'server:error': { name: string; error: string }
  'server:exit': { name: string; code: number | null }
  'tools:updated': { serverName: string; tools: McpTool[] }
}

class McpService extends EventEmitter {
  private servers: Map<string, McpServer> = new Map()
  private disabledTools: Set<string> = new Set()
  private logs: Map<string, string[]> = new Map()
  private globalDisabledServers: Set<string> = new Set()

  async startServer(name: string, config: McpServerConfig): Promise<void> {
    // Stop existing server if running
    if (this.servers.has(name)) {
      await this.stopServer(name)
    }

    const server: McpServer = {
      name,
      config,
      client: null,
      transport: null,
      status: 'starting',
      tools: [],
      enabled: !config.disabled && !this.globalDisabledServers.has(name),
    }
    this.servers.set(name, server)
    this.logs.set(name, [])
    this.emit('server:starting', { name })

    try {
      let transport: StdioClientTransport | SSEClientTransport

      if (config.url) {
        // SSE/HTTP transport
        transport = new SSEClientTransport(new URL(config.url))
      } else if (config.command) {
        // Stdio transport
        transport = new StdioClientTransport({
          command: config.command,
          args: config.args,
          env: { ...process.env, ...config.env } as Record<string, string>,
        })

        // Capture stderr for logs
        transport.stderr?.on('data', (data: Buffer) => {
          const log = data.toString()
          this.addLog(name, log)
        })
      } else {
        throw new Error('Server config must have either "command" or "url"')
      }

      server.transport = transport

      // Create MCP client
      const client = new Client(
        { name: `speakmcp-${name}`, version: '1.0.0' },
        { capabilities: {} }
      )

      await client.connect(transport)
      server.client = client
      server.status = 'running'

      // Fetch tools
      try {
        const toolsResult = await client.listTools()
        server.tools = toolsResult.tools.map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          serverName: name,
          enabled: !this.disabledTools.has(`${name}:${t.name}`),
        }))
      } catch (e) {
        // Server might not support tools
        this.addLog(name, `Warning: Could not list tools: ${e}`)
      }

      this.emit('server:started', { name, tools: server.tools })
    } catch (error) {
      server.status = 'error'
      server.error = error instanceof Error ? error.message : String(error)
      this.emit('server:error', { name, error: server.error })
      throw error
    }
  }

  async stopServer(name: string): Promise<void> {
    const server = this.servers.get(name)
    if (!server) return

    try {
      if (server.client) {
        await server.client.close()
      }
    } catch (e) {
      this.addLog(name, `Error closing client: ${e}`)
    }

    server.status = 'stopped'
    server.client = null
    server.transport = null
    server.tools = []
    this.emit('server:stopped', { name })
  }

  async restartServer(name: string): Promise<void> {
    const server = this.servers.get(name)
    if (!server) throw new Error(`Server ${name} not found`)
    await this.startServer(name, server.config)
  }

  setServerEnabled(name: string, enabled: boolean): void {
    if (enabled) {
      this.globalDisabledServers.delete(name)
    } else {
      this.globalDisabledServers.add(name)
    }
    const server = this.servers.get(name)
    if (server) {
      server.enabled = enabled
    }
  }

  getStatus(): McpServerStatus[] {
    return Array.from(this.servers.values()).map(s => ({
      name: s.name,
      status: s.status,
      toolCount: s.tools.length,
      error: s.error,
      enabled: s.enabled,
    }))
  }

  getServer(name: string): McpServer | undefined {
    return this.servers.get(name)
  }

  getAllTools(): McpTool[] {
    const tools: McpTool[] = []
    for (const server of this.servers.values()) {
      if (server.status === 'running' && server.enabled) {
        tools.push(...server.tools)
      }
    }
    return tools
  }

  getEnabledTools(): McpTool[] {
    return this.getAllTools().filter(t => t.enabled)
  }

  setToolEnabled(serverName: string, toolName: string, enabled: boolean): void {
    const key = `${serverName}:${toolName}`
    if (enabled) {
      this.disabledTools.delete(key)
    } else {
      this.disabledTools.add(key)
    }

    // Update in-memory tool
    const server = this.servers.get(serverName)
    if (server) {
      const tool = server.tools.find(t => t.name === toolName)
      if (tool) tool.enabled = enabled
    }
  }

  async executeTool(serverName: string, toolName: string, args: unknown): Promise<unknown> {
    const server = this.servers.get(serverName)
    if (!server || !server.client) {
      throw new Error(`Server ${serverName} not connected`)
    }

    if (!server.enabled) {
      throw new Error(`Server ${serverName} is disabled`)
    }

    const result = await server.client.callTool({
      name: toolName,
      arguments: args as Record<string, unknown>
    })
    return result
  }

  async executeToolByName(toolName: string, args: unknown): Promise<unknown> {
    // Find which server has this tool
    const tool = this.getEnabledTools().find(t => t.name === toolName)
    if (!tool) {
      throw new Error(`Tool ${toolName} not found`)
    }
    return this.executeTool(tool.serverName, toolName, args)
  }

  private addLog(name: string, log: string): void {
    const logs = this.logs.get(name) ?? []
    logs.push(`[${new Date().toISOString()}] ${log}`)
    // Keep last 1000 lines
    if (logs.length > 1000) logs.shift()
    this.logs.set(name, logs)
  }

  getLogs(name: string): string[] {
    return this.logs.get(name) ?? []
  }

  clearLogs(name: string): void {
    this.logs.set(name, [])
  }

  // Initialize multiple servers from config
  async initializeFromConfig(servers: Record<string, McpServerConfig>): Promise<void> {
    const results: Array<{ name: string; success: boolean; error?: string }> = []

    for (const [name, config] of Object.entries(servers)) {
      if (config.disabled) {
        this.servers.set(name, {
          name,
          config,
          client: null,
          transport: null,
          status: 'stopped',
          tools: [],
          enabled: false,
        })
        continue
      }

      try {
        await this.startServer(name, config)
        results.push({ name, success: true })
      } catch (error) {
        results.push({
          name,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    return
  }

  // Shutdown all servers
  async shutdown(): Promise<void> {
    for (const name of this.servers.keys()) {
      await this.stopServer(name)
    }
  }
}

export const mcpService = new McpService()
