import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { configService, MCPServerConfig } from './config-service.js'
import { profileService, ProfileMcpServerConfig } from './profile-service.js'
import { spawn, ChildProcess } from 'child_process'

export interface MCPTool {
  name: string
  description: string
  inputSchema: any
  serverName: string
}

export interface MCPToolCall {
  name: string
  arguments: any
}

export interface MCPToolResult {
  content: Array<{
    type: 'text'
    text: string
  }>
  isError?: boolean
}

export interface ServerStatus {
  name: string
  connected: boolean
  toolCount: number
  enabled: boolean
  runtimeEnabled: boolean
  configDisabled: boolean
  error?: string
}

export interface ServerLogEntry {
  timestamp: number
  message: string
}

type Transport = StdioClientTransport | WebSocketClientTransport | StreamableHTTPClientTransport

class MCPService {
  private clients: Map<string, Client> = new Map()
  private transports: Map<string, Transport> = new Map()
  private childProcesses: Map<string, ChildProcess> = new Map()
  private availableTools: MCPTool[] = []
  private disabledTools: Set<string> = new Set()
  private runtimeDisabledServers: Set<string> = new Set()
  private serverLogs: Map<string, ServerLogEntry[]> = new Map()
  private isInitializing = false
  private initializationPromise: Promise<void> | null = null
  private readonly MAX_LOG_ENTRIES = 1000

  constructor() {
    this.loadPersistedState()
  }

  private async loadPersistedState(): Promise<void> {
    try {
      const config = await configService.get()
      if (Array.isArray(config.mcpRuntimeDisabledServers)) {
        for (const serverName of config.mcpRuntimeDisabledServers) {
          this.runtimeDisabledServers.add(serverName)
        }
      }
      if (Array.isArray(config.mcpDisabledTools)) {
        for (const toolName of config.mcpDisabledTools) {
          this.disabledTools.add(toolName)
        }
      }
    } catch {
      // Ignore errors during initialization
    }
  }

  private addLogEntry(serverName: string, message: string): void {
    const logs = this.serverLogs.get(serverName) || []
    logs.push({ timestamp: Date.now(), message })
    if (logs.length > this.MAX_LOG_ENTRIES) {
      logs.shift()
    }
    this.serverLogs.set(serverName, logs)
  }

  private inferTransportType(config: MCPServerConfig): 'stdio' | 'websocket' | 'streamableHttp' {
    if (config.transport) return config.transport
    if (config.command) return 'stdio'
    if (config.url) {
      if (config.url.startsWith('ws://') || config.url.startsWith('wss://')) {
        return 'websocket'
      }
      return 'streamableHttp'
    }
    return 'stdio'
  }

  async initialize(): Promise<void> {
    if (this.initializationPromise) {
      return this.initializationPromise
    }

    if (this.isInitializing) {
      return
    }

    this.isInitializing = true
    this.initializationPromise = this.doInitialize()
    
    try {
      await this.initializationPromise
    } finally {
      this.isInitializing = false
      this.initializationPromise = null
    }
  }

  private async doInitialize(): Promise<void> {
    const config = await configService.get()
    const mcpConfig = config.mcpConfig
    
    if (!mcpConfig?.mcpServers) {
      this.availableTools = []
      return
    }

    const serverNames = Object.keys(mcpConfig.mcpServers)
    
    for (const serverName of serverNames) {
      if (this.runtimeDisabledServers.has(serverName)) {
        continue
      }

      const serverConfig = mcpConfig.mcpServers[serverName]
      if (serverConfig.disabled) {
        continue
      }

      try {
        await this.connectToServer(serverName, serverConfig)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.addLogEntry(serverName, `Failed to connect: ${message}`)
        console.error(`Failed to connect to MCP server ${serverName}:`, error)
      }
    }

    await this.refreshAvailableTools()
  }

  private async connectToServer(
    serverName: string,
    serverConfig: MCPServerConfig
  ): Promise<void> {
    const transportType = this.inferTransportType(serverConfig)
    let transport: Transport

    this.addLogEntry(serverName, `Connecting with ${transportType} transport...`)

    if (transportType === 'stdio' && serverConfig.command) {
      const child = spawn(serverConfig.command, serverConfig.args || [], {
        env: { ...process.env, ...serverConfig.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      child.stderr?.on('data', (data) => {
        this.addLogEntry(serverName, `stderr: ${data.toString()}`)
      })

      child.on('error', (error) => {
        this.addLogEntry(serverName, `Process error: ${error.message}`)
      })

      child.on('exit', (code) => {
        this.addLogEntry(serverName, `Process exited with code ${code}`)
        this.clients.delete(serverName)
        this.transports.delete(serverName)
        this.childProcesses.delete(serverName)
      })

      this.childProcesses.set(serverName, child)
      transport = new StdioClientTransport({
        command: serverConfig.command,
        args: serverConfig.args,
        env: serverConfig.env,
      })
    } else if (transportType === 'websocket' && serverConfig.url) {
      transport = new WebSocketClientTransport(new URL(serverConfig.url))
    } else if (transportType === 'streamableHttp' && serverConfig.url) {
      transport = new StreamableHTTPClientTransport(new URL(serverConfig.url))
    } else {
      throw new Error(`Invalid server configuration for ${serverName}`)
    }

    const client = new Client(
      { name: 'speakmcp-server', version: '0.1.0' },
      { capabilities: {} }
    )

    await client.connect(transport)
    
    this.clients.set(serverName, client)
    this.transports.set(serverName, transport)
    this.addLogEntry(serverName, 'Connected successfully')
  }

  private async refreshAvailableTools(): Promise<void> {
    const tools: MCPTool[] = []

    for (const [serverName, client] of this.clients) {
      try {
        const result = await client.listTools()
        for (const tool of result.tools) {
          tools.push({
            name: `${serverName}:${tool.name}`,
            description: tool.description || '',
            inputSchema: tool.inputSchema,
            serverName,
          })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.addLogEntry(serverName, `Failed to list tools: ${message}`)
      }
    }

    this.availableTools = tools
  }

  getAvailableTools(): MCPTool[] {
    return this.availableTools.filter(tool => !this.disabledTools.has(tool.name))
  }

  getAvailableToolsForProfile(mcpServerConfig?: ProfileMcpServerConfig): MCPTool[] {
    if (!mcpServerConfig) {
      return this.getAvailableTools()
    }

    const { disabledServers = [], disabledTools = [], allServersDisabledByDefault, enabledServers = [] } = mcpServerConfig

    return this.availableTools.filter(tool => {
      // Check if tool is globally disabled
      if (this.disabledTools.has(tool.name)) return false
      
      // Check if tool is disabled in profile
      if (disabledTools.includes(tool.name)) return false

      // Check server availability
      if (allServersDisabledByDefault) {
        return enabledServers.includes(tool.serverName)
      } else {
        return !disabledServers.includes(tool.serverName)
      }
    })
  }

  async executeToolCall(
    toolCall: MCPToolCall,
    onProgress?: (message: string) => void
  ): Promise<MCPToolResult> {
    const [serverName, ...toolNameParts] = toolCall.name.split(':')
    const actualToolName = toolNameParts.join(':')

    const client = this.clients.get(serverName)
    if (!client) {
      return {
        content: [{ type: 'text', text: `Server ${serverName} not connected` }],
        isError: true,
      }
    }

    try {
      onProgress?.(`Executing ${actualToolName}...`)
      
      const result = await client.callTool({
        name: actualToolName,
        arguments: toolCall.arguments,
      })

      const content = Array.isArray(result.content)
        ? result.content.map((c: any) => ({
            type: 'text' as const,
            text: typeof c === 'string' ? c : c.text || JSON.stringify(c),
          }))
        : [{ type: 'text' as const, text: String(result.content) }]

      return {
        content,
        isError: (result.isError as boolean | undefined) ?? false,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.addLogEntry(serverName, `Tool execution failed: ${message}`)
      return {
        content: [{ type: 'text', text: `Tool execution failed: ${message}` }],
        isError: true,
      }
    }
  }

  getServerStatus(): Record<string, ServerStatus> {
    const status: Record<string, ServerStatus> = {}
    
    // Get all configured servers
    configService.get().then(config => {
      const mcpServers = config.mcpConfig?.mcpServers || {}
      for (const [name, serverConfig] of Object.entries(mcpServers)) {
        const client = this.clients.get(name)
        const toolCount = this.availableTools.filter(t => t.serverName === name).length
        
        status[name] = {
          name,
          connected: !!client,
          toolCount,
          enabled: !this.runtimeDisabledServers.has(name) && !serverConfig.disabled,
          runtimeEnabled: !this.runtimeDisabledServers.has(name),
          configDisabled: serverConfig.disabled ?? false,
          error: undefined,
        }
      }
    })

    // Also include currently connected servers
    for (const [name, client] of this.clients) {
      if (!status[name]) {
        const toolCount = this.availableTools.filter(t => t.serverName === name).length
        status[name] = {
          name,
          connected: true,
          toolCount,
          enabled: !this.runtimeDisabledServers.has(name),
          runtimeEnabled: !this.runtimeDisabledServers.has(name),
          configDisabled: false,
        }
      }
    }

    return status
  }

  async setServerRuntimeEnabled(serverName: string, enabled: boolean): Promise<boolean> {
    const config = await configService.get()
    const serverConfig = config.mcpConfig?.mcpServers?.[serverName]
    
    if (!serverConfig) {
      return false
    }

    if (enabled) {
      this.runtimeDisabledServers.delete(serverName)
      // Try to connect if not already connected
      if (!this.clients.has(serverName)) {
        try {
          await this.connectToServer(serverName, serverConfig)
          await this.refreshAvailableTools()
        } catch (error) {
          console.error(`Failed to connect to ${serverName}:`, error)
        }
      }
    } else {
      this.runtimeDisabledServers.add(serverName)
      // Disconnect if connected
      await this.disconnectServer(serverName)
    }

    // Persist state
    await configService.update({
      mcpRuntimeDisabledServers: Array.from(this.runtimeDisabledServers),
    })

    return true
  }

  async setToolEnabled(toolName: string, enabled: boolean): Promise<void> {
    if (enabled) {
      this.disabledTools.delete(toolName)
    } else {
      this.disabledTools.add(toolName)
    }

    await configService.update({
      mcpDisabledTools: Array.from(this.disabledTools),
    })
  }

  private async disconnectServer(serverName: string): Promise<void> {
    const client = this.clients.get(serverName)
    if (client) {
      try {
        await client.close()
      } catch {
        // Ignore close errors
      }
      this.clients.delete(serverName)
    }

    const transport = this.transports.get(serverName)
    if (transport) {
      try {
        await transport.close()
      } catch {
        // Ignore close errors
      }
      this.transports.delete(serverName)
    }

    const child = this.childProcesses.get(serverName)
    if (child) {
      child.kill()
      this.childProcesses.delete(serverName)
    }

    // Remove tools from this server
    this.availableTools = this.availableTools.filter(t => t.serverName !== serverName)
    
    this.addLogEntry(serverName, 'Disconnected')
  }

  async restartServer(serverName: string): Promise<void> {
    await this.disconnectServer(serverName)
    
    const config = await configService.get()
    const serverConfig = config.mcpConfig?.mcpServers?.[serverName]
    
    if (serverConfig && !this.runtimeDisabledServers.has(serverName)) {
      await this.connectToServer(serverName, serverConfig)
      await this.refreshAvailableTools()
    }
  }

  getServerLogs(serverName: string): ServerLogEntry[] {
    return this.serverLogs.get(serverName) || []
  }

  clearServerLogs(serverName: string): void {
    this.serverLogs.delete(serverName)
  }

  async shutdown(): Promise<void> {
    for (const serverName of this.clients.keys()) {
      await this.disconnectServer(serverName)
    }
  }

  applyProfileMcpConfig(
    disabledServers?: string[],
    disabledTools?: string[],
    allServersDisabledByDefault?: boolean,
    enabledServers?: string[]
  ): void {
    // This method is used when switching profiles
    // For simplicity, we'll update the runtime state based on the profile config
    
    if (allServersDisabledByDefault && enabledServers) {
      // Disable all servers except those explicitly enabled
      configService.get().then(config => {
        const allServerNames = Object.keys(config.mcpConfig?.mcpServers || {})
        this.runtimeDisabledServers.clear()
        for (const name of allServerNames) {
          if (!enabledServers.includes(name)) {
            this.runtimeDisabledServers.add(name)
          }
        }
      })
    } else if (disabledServers) {
      this.runtimeDisabledServers = new Set(disabledServers)
    }

    if (disabledTools) {
      this.disabledTools = new Set(disabledTools)
    }
  }
}

export const mcpService = new MCPService()
