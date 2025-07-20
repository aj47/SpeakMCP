import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { configStore } from "./config"
import { MCPConfig, MCPServerConfig } from "../shared/types"
import { spawn, ChildProcess } from "child_process"
import { promisify } from "util"
import { access, constants } from "fs"
import path from "path"
import os from "os"

const accessAsync = promisify(access)


export interface MCPTool {
  name: string
  description: string
  inputSchema: any
}

export interface MCPToolCall {
  name: string
  arguments: any
}

export interface MCPToolResult {
  content: Array<{
    type: "text"
    text: string
  }>
  isError?: boolean
}

export interface LLMToolCallResponse {
  content?: string
  toolCalls?: MCPToolCall[]
}

class MCPService {
  private clients: Map<string, Client> = new Map()
  private transports: Map<string, StdioClientTransport> = new Map()
  private availableTools: MCPTool[] = []
  private disabledTools: Set<string> = new Set()
  private isInitializing = false
  private initializationProgress: { current: number; total: number; currentServer?: string } = { current: 0, total: 0 }

  async initialize(): Promise<void> {
    console.log("[MCP-DEBUG] 🚀 Initializing MCP service...")

    this.isInitializing = true
    this.initializationProgress = { current: 0, total: 0 }

    const config = configStore.get()
    const mcpConfig = config.mcpConfig

    if (!mcpConfig || !mcpConfig.mcpServers || Object.keys(mcpConfig.mcpServers).length === 0) {
      console.log("[MCP-DEBUG] No MCP servers configured")
      this.availableTools = []
      this.isInitializing = false
      return
    }

    // Count enabled servers for progress tracking
    const enabledServers = Object.entries(mcpConfig.mcpServers).filter(([_, config]) => !config.disabled)
    this.initializationProgress.total = enabledServers.length

    // Initialize configured MCP servers
    for (const [serverName, serverConfig] of enabledServers) {
      this.initializationProgress.currentServer = serverName

      try {
        await this.initializeServer(serverName, serverConfig)
      } catch (error) {
        console.error(`[MCP-DEBUG] Failed to initialize server ${serverName}:`, error)
      }

      this.initializationProgress.current++
    }

    this.isInitializing = false
    console.log(`[MCP-DEBUG] ✅ MCP service initialized with ${this.availableTools.length} tools:`,
      this.availableTools.map(t => t.name))
  }



  private async initializeServer(serverName: string, serverConfig: MCPServerConfig) {
    console.log(`[MCP-DEBUG] Initializing server: ${serverName}`)

    // Resolve command path and prepare environment
    const resolvedCommand = await this.resolveCommandPath(serverConfig.command)
    const environment = await this.prepareEnvironment(serverConfig.env)

    // Create transport and client
    const transport = new StdioClientTransport({
      command: resolvedCommand,
      args: serverConfig.args,
      env: environment
    })

    const client = new Client({
      name: "speakmcp-mcp-client",
      version: "1.0.0"
    }, {
      capabilities: {}
    })

    // Connect to the server
    await client.connect(transport)

    // Get available tools from the server
    const toolsResult = await client.listTools()

    // Add tools to our registry with server prefix
    for (const tool of toolsResult.tools) {
      this.availableTools.push({
        name: `${serverName}:${tool.name}`,
        description: tool.description || `Tool from ${serverName} server`,
        inputSchema: tool.inputSchema
      })
    }

    // Store references
    this.transports.set(serverName, transport)
    this.clients.set(serverName, client)

    console.log(`[MCP-DEBUG] Server ${serverName} initialized with ${toolsResult.tools.length} tools`)
  }

  private cleanupServer(serverName: string) {
    this.transports.delete(serverName)
    this.clients.delete(serverName)

    // Remove tools from this server
    this.availableTools = this.availableTools.filter(tool =>
      !tool.name.startsWith(`${serverName}:`)
    )
  }

  private async executeServerTool(serverName: string, toolName: string, arguments_: any): Promise<MCPToolResult> {
    const client = this.clients.get(serverName)
    if (!client) {
      throw new Error(`Server ${serverName} not found or not connected`)
    }

    try {
      const result = await client.callTool({
        name: toolName,
        arguments: arguments_
      })

      // Ensure content is properly formatted
      const content = Array.isArray(result.content)
        ? result.content.map(item => ({
            type: "text" as const,
            text: typeof item === 'string' ? item : (item.text || JSON.stringify(item))
          }))
        : [{
            type: "text" as const,
            text: "Tool executed successfully"
          }]

      return {
        content,
        isError: Boolean(result.isError)
      }
    } catch (error) {
      console.error(`[MCP-DEBUG] Error executing tool ${toolName} on server ${serverName}:`, error)
      return {
        content: [{
          type: "text",
          text: `Error executing tool: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      }
    }
  }

  getAvailableTools(): MCPTool[] {
    const enabledTools = this.availableTools.filter(tool => !this.disabledTools.has(tool.name))
    console.log(`[MCP-DEBUG] 📋 Getting available tools (${enabledTools.length}/${this.availableTools.length} tools enabled)`)
    return enabledTools
  }

  getDetailedToolList(): Array<{
    name: string
    description: string
    serverName: string
    enabled: boolean
    inputSchema: any
  }> {
    return this.availableTools.map(tool => {
      const serverName = tool.name.includes(':') ? tool.name.split(':')[0] : 'unknown'
      return {
        name: tool.name,
        description: tool.description,
        serverName,
        enabled: !this.disabledTools.has(tool.name),
        inputSchema: tool.inputSchema
      }
    })
  }

  getServerStatus(): Record<string, { connected: boolean; toolCount: number; error?: string }> {
    const status: Record<string, { connected: boolean; toolCount: number; error?: string }> = {}

    for (const [serverName, client] of this.clients) {
      const transport = this.transports.get(serverName)
      const toolCount = this.availableTools.filter(tool => tool.name.startsWith(`${serverName}:`)).length

      status[serverName] = {
        connected: !!client && !!transport,
        toolCount
      }
    }

    return status
  }

  getInitializationStatus(): { isInitializing: boolean; progress: { current: number; total: number; currentServer?: string } } {
    return {
      isInitializing: this.isInitializing,
      progress: { ...this.initializationProgress }
    }
  }

  setToolEnabled(toolName: string, enabled: boolean): boolean {
    const toolExists = this.availableTools.some(tool => tool.name === toolName)
    if (!toolExists) {
      console.warn(`[MCP-DEBUG] Tool ${toolName} not found`)
      return false
    }

    if (enabled) {
      this.disabledTools.delete(toolName)
      console.log(`[MCP-DEBUG] Enabled tool: ${toolName}`)
    } else {
      this.disabledTools.add(toolName)
      console.log(`[MCP-DEBUG] Disabled tool: ${toolName}`)
    }

    return true
  }

  getDisabledTools(): string[] {
    return Array.from(this.disabledTools)
  }

  async testServerConnection(serverName: string, serverConfig: MCPServerConfig): Promise<{ success: boolean; error?: string; toolCount?: number }> {
    try {
      console.log(`[MCP-DEBUG] Testing connection to server: ${serverName}`)

      // Basic validation
      if (!serverConfig.command) {
        return { success: false, error: "Command is required" }
      }

      if (!Array.isArray(serverConfig.args)) {
        return { success: false, error: "Args must be an array" }
      }

      // Try to resolve the command path
      try {
        const resolvedCommand = await this.resolveCommandPath(serverConfig.command)
        console.log(`[MCP-DEBUG] Resolved command path: ${resolvedCommand}`)
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : `Failed to resolve command: ${serverConfig.command}`
        }
      }

      // Try to create a temporary connection to test the server
      const timeout = serverConfig.timeout || 10000
      const testPromise = this.createTestConnection(serverName, serverConfig)
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Connection test timeout')), timeout)
      })

      const result = await Promise.race([testPromise, timeoutPromise])
      return result
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  private async createTestConnection(serverName: string, serverConfig: MCPServerConfig): Promise<{ success: boolean; error?: string; toolCount?: number }> {
    let transport: StdioClientTransport | null = null
    let client: Client | null = null

    try {
      // Resolve command and prepare environment
      const resolvedCommand = await this.resolveCommandPath(serverConfig.command)
      const environment = await this.prepareEnvironment(serverConfig.env)

      // Create a temporary transport and client for testing
      transport = new StdioClientTransport({
        command: resolvedCommand,
        args: serverConfig.args,
        env: environment
      })

      client = new Client({
        name: "speakmcp-mcp-test-client",
        version: "1.0.0"
      }, {
        capabilities: {}
      })

      // Try to connect
      await client.connect(transport)

      // Try to list tools
      const toolsResult = await client.listTools()

      return {
        success: true,
        toolCount: toolsResult.tools.length
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    } finally {
      // Clean up test connection
      if (client) {
        try {
          await client.close()
        } catch (error) {
          console.error(`[MCP-DEBUG] Error closing test client:`, error)
        }
      }
      if (transport) {
        try {
          await transport.close()
        } catch (error) {
          console.error(`[MCP-DEBUG] Error closing test transport:`, error)
        }
      }
    }
  }

  async restartServer(serverName: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`[MCP-DEBUG] Restarting server: ${serverName}`)

      // Get the current config for this server
      const config = configStore.get()
      const mcpConfig = config.mcpConfig

      if (!mcpConfig?.mcpServers?.[serverName]) {
        return { success: false, error: `Server ${serverName} not found in configuration` }
      }

      const serverConfig = mcpConfig.mcpServers[serverName]

      // Clean up existing server
      await this.stopServer(serverName)

      // Reinitialize the server
      await this.initializeServer(serverName, serverConfig)

      return { success: true }
    } catch (error) {
      console.error(`[MCP-DEBUG] Failed to restart server ${serverName}:`, error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async stopServer(serverName: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`[MCP-DEBUG] Stopping server: ${serverName}`)

      const client = this.clients.get(serverName)
      const transport = this.transports.get(serverName)

      if (client) {
        try {
          await client.close()
        } catch (error) {
          console.error(`[MCP-DEBUG] Error closing client for ${serverName}:`, error)
        }
      }

      if (transport) {
        try {
          await transport.close()
        } catch (error) {
          console.error(`[MCP-DEBUG] Error closing transport for ${serverName}:`, error)
        }
      }

      // Clean up references
      this.cleanupServer(serverName)

      return { success: true }
    } catch (error) {
      console.error(`[MCP-DEBUG] Failed to stop server ${serverName}:`, error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  async executeToolCall(toolCall: MCPToolCall): Promise<MCPToolResult> {
    console.log(`[MCP-DEBUG] 🔧 Executing tool call: ${toolCall.name}`, toolCall.arguments)

    try {
      // Check if this is a server-prefixed tool
      if (toolCall.name.includes(':')) {
        const [serverName, toolName] = toolCall.name.split(':', 2)
        return await this.executeServerTool(serverName, toolName, toolCall.arguments)
      }

      // No fallback tools available
      console.log(`[MCP-DEBUG] ❌ Unknown tool: ${toolCall.name}`)
      const result: MCPToolResult = {
        content: [{
          type: "text",
          text: `Unknown tool: ${toolCall.name}. Only MCP server tools are supported.`
        }],
        isError: true
      }

      console.log(`[MCP-DEBUG] ✅ Tool execution completed:`, result)
      return result

    } catch (error) {
      console.error(`[MCP-DEBUG] ❌ Tool execution error for ${toolCall.name}:`, error)
      return {
        content: [{
          type: "text",
          text: `Error executing tool ${toolCall.name}: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      }
    }
  }



  /**
   * Resolve the full path to a command, handling different platforms and PATH resolution
   */
  async resolveCommandPath(command: string): Promise<string> {
    // If it's already an absolute path, return as-is
    if (path.isAbsolute(command)) {
      return command
    }

    // Get the system PATH
    const systemPath = process.env.PATH || ''
    const pathSeparator = process.platform === 'win32' ? ';' : ':'
    const pathExtensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat'] : ['']

    // Split PATH and search for the command
    const pathDirs = systemPath.split(pathSeparator)

    // Add common Node.js paths that might be missing in Electron
    const additionalPaths = [
      '/usr/local/bin',
      '/opt/homebrew/bin',
      path.join(os.homedir(), '.npm-global', 'bin'),
      path.join(os.homedir(), 'node_modules', '.bin')
    ]

    pathDirs.push(...additionalPaths)

    for (const dir of pathDirs) {
      if (!dir) continue

      for (const ext of pathExtensions) {
        const fullPath = path.join(dir, command + ext)
        try {
          await accessAsync(fullPath, constants.F_OK | constants.X_OK)
          return fullPath
        } catch {
          // Continue searching
        }
      }
    }

    // If not found, check if npx is available and this might be an npm package
    if (command === 'npx' || command.startsWith('@')) {
      throw new Error(`npx not found in PATH. Please ensure Node.js is properly installed.`)
    }

    // Return original command and let the system handle it
    return command
  }

  /**
   * Prepare environment variables for spawning MCP servers
   */
  async prepareEnvironment(serverEnv?: Record<string, string>): Promise<Record<string, string>> {
    // Create a clean environment with only string values
    const environment: Record<string, string> = {}

    // Copy process.env, filtering out undefined values
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        environment[key] = value
      }
    }

    // Ensure PATH is properly set for finding npm/npx
    if (!environment.PATH) {
      environment.PATH = '/usr/local/bin:/usr/bin:/bin'
    }

    // Add common Node.js paths to PATH if not already present
    const additionalPaths = [
      '/usr/local/bin',
      '/opt/homebrew/bin',
      path.join(os.homedir(), '.npm-global', 'bin'),
      path.join(os.homedir(), 'node_modules', '.bin')
    ]

    const pathSeparator = process.platform === 'win32' ? ';' : ':'
    const currentPaths = environment.PATH.split(pathSeparator)

    for (const additionalPath of additionalPaths) {
      if (!currentPaths.includes(additionalPath)) {
        environment.PATH += pathSeparator + additionalPath
      }
    }

    // Add server-specific environment variables
    if (serverEnv) {
      Object.assign(environment, serverEnv)
    }

    return environment
  }



  /**
   * Shutdown all servers (alias for cleanup for backward compatibility)
   */
  async shutdown(): Promise<void> {
    await this.cleanup()
  }

  async cleanup(): Promise<void> {
    // Close all clients and transports
    for (const [serverName, client] of this.clients) {
      try {
        await client.close()
      } catch (error) {
        console.error(`[MCP-DEBUG] Error closing client for ${serverName}:`, error)
      }
    }

    for (const [serverName, transport] of this.transports) {
      try {
        await transport.close()
      } catch (error) {
        console.error(`[MCP-DEBUG] Error closing transport for ${serverName}:`, error)
      }
    }

    // Clear all maps
    this.clients.clear()
    this.transports.clear()
    this.availableTools = []
  }
}

export const mcpService = new MCPService()
