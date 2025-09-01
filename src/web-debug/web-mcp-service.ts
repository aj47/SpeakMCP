/**
 * Web-compatible MCP service for debugging mode
 * This service runs the real MCP implementation in a Node.js environment
 * and exposes it via HTTP API for the web debugging interface
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { spawn, ChildProcess } from "child_process"
import { AgentProgressStep, AgentProgressUpdate, MCPConfig, MCPServerConfig } from '../shared/types'
import { EventEmitter } from 'events'
import { getWebDebugMCPConfig, getRecommendedMCPConfig } from './default-mcp-config'

// Re-export types that we need
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

export interface WebMCPConfig {
  mcpConfig: MCPConfig
  enableProgressUpdates: boolean
  maxIterations: number
}

export class WebMCPService extends EventEmitter {
  private clients: Map<string, Client> = new Map()
  private serverProcesses: Map<string, ChildProcess> = new Map()
  private availableTools: MCPTool[] = []
  private config: WebMCPConfig
  private progressCallback?: (update: AgentProgressUpdate) => void
  private currentIteration = 0

  constructor(config: Partial<WebMCPConfig> = {}) {
    super()

    this.config = {
      mcpConfig: getWebDebugMCPConfig(),
      enableProgressUpdates: true,
      maxIterations: 10,
      ...config
    }
  }

  public setProgressCallback(callback: (update: AgentProgressUpdate) => void) {
    this.progressCallback = callback
  }

  public async initialize(): Promise<void> {
    try {
      console.log('[WebMCPService] Initializing with MCP servers:', Object.keys(this.config.mcpConfig.mcpServers))

      // Initialize each MCP server
      for (const [serverName, serverConfig] of Object.entries(this.config.mcpConfig.mcpServers)) {
        if (serverConfig.disabled) {
          console.log(`[WebMCPService] Skipping disabled server: ${serverName}`)
          continue
        }

        try {
          await this.connectToServer(serverName, serverConfig)
        } catch (error) {
          console.warn(`[WebMCPService] Failed to connect to server ${serverName}:`, error)
          // Continue with other servers
        }
      }

      // Load all available tools
      await this.loadAvailableTools()

      console.log(`[WebMCPService] Initialized with ${this.clients.size} servers and ${this.availableTools.length} tools`)
    } catch (error) {
      console.error('[WebMCPService] Failed to initialize:', error)
      throw error
    }
  }

  private async connectToServer(serverName: string, serverConfig: MCPServerConfig): Promise<void> {
    if (serverConfig.transport !== 'stdio') {
      throw new Error(`Unsupported transport type: ${serverConfig.transport}`)
    }

    if (!serverConfig.command) {
      throw new Error('Command is required for stdio transport')
    }

    console.log(`[WebMCPService] Connecting to server ${serverName} with command: ${serverConfig.command}`)

    // Spawn the MCP server process
    const childProcess = spawn(serverConfig.command, serverConfig.args || [], {
      env: { ...process.env, ...serverConfig.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // Store the process reference
    this.serverProcesses.set(serverName, childProcess)

    // Create transport and client
    const transport = new StdioClientTransport({
      command: serverConfig.command,
      args: serverConfig.args || [],
      env: { ...process.env, ...serverConfig.env },
    })

    const client = new Client(
      {
        name: "speakmcp-web-debug-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      },
    )

    // Connect with timeout
    const connectTimeout = serverConfig.timeout || 10000
    const connectPromise = client.connect(transport)
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Connection timeout after ${connectTimeout}ms`)), connectTimeout)
    })

    await Promise.race([connectPromise, timeoutPromise])

    // Store the client
    this.clients.set(serverName, client)
    console.log(`[WebMCPService] Successfully connected to server: ${serverName}`)
  }

  private async loadAvailableTools(): Promise<void> {
    this.availableTools = []

    for (const [serverName, client] of this.clients.entries()) {
      try {
        const toolsResult = await client.listTools()

        for (const tool of toolsResult.tools) {
          this.availableTools.push({
            name: `${serverName}:${tool.name}`,
            description: tool.description || `Tool ${tool.name} from ${serverName}`,
            inputSchema: tool.inputSchema
          })
        }

        console.log(`[WebMCPService] Loaded ${toolsResult.tools.length} tools from server: ${serverName}`)
      } catch (error) {
        console.warn(`[WebMCPService] Failed to load tools from server ${serverName}:`, error)
      }
    }
  }

  public async getAvailableTools(): Promise<MCPTool[]> {
    return [...this.availableTools]
  }

  public async executeToolCall(toolCall: MCPToolCall): Promise<MCPToolResult> {
    try {
      console.log('[WebMCPService] Executing tool call:', toolCall)

      // Parse server name and tool name from the tool call
      let serverName: string
      let toolName: string

      if (toolCall.name.includes(':')) {
        [serverName, toolName] = toolCall.name.split(':', 2)
      } else {
        // Try to find a matching tool without prefix
        const matchingTool = this.availableTools.find(tool => {
          if (tool.name.includes(':')) {
            const [, tName] = tool.name.split(':', 2)
            return tName === toolCall.name
          }
          return tool.name === toolCall.name
        })

        if (matchingTool && matchingTool.name.includes(':')) {
          [serverName, toolName] = matchingTool.name.split(':', 2)
        } else {
          throw new Error(`Tool not found: ${toolCall.name}`)
        }
      }

      const client = this.clients.get(serverName)
      if (!client) {
        throw new Error(`Server ${serverName} not found or not connected`)
      }

      const result = await client.callTool({
        name: toolName,
        arguments: toolCall.arguments || {}
      })

      console.log('[WebMCPService] Tool call result:', result)

      return {
        content: result.content || [{
          type: 'text',
          text: 'Tool executed successfully but returned no content'
        }],
        isError: result.isError || false
      }
    } catch (error) {
      console.error('[WebMCPService] Tool call failed:', error)
      return {
        content: [{
          type: 'text',
          text: `Error executing tool ${toolCall.name}: ${error instanceof Error ? error.message : String(error)}`
        }],
        isError: true
      }
    }
  }

  public async simulateAgentMode(transcript: string, maxIterations: number = 10): Promise<string> {
    this.currentIteration = 0
    const steps: AgentProgressStep[] = []

    try {
      // Emit initial progress
      this.emitProgress(0, maxIterations, steps, false)

      // Step 1: Thinking/Analysis
      const thinkingStep: AgentProgressStep = {
        id: `step_${Date.now()}_thinking`,
        type: 'thinking',
        title: 'Analyzing request',
        description: `Processing: "${transcript.substring(0, 100)}${transcript.length > 100 ? '...' : ''}"`,
        status: 'in_progress',
        timestamp: Date.now()
      }

      steps.push(thinkingStep)
      this.emitProgress(this.currentIteration, maxIterations, steps, false)

      await this.delay(1000)

      thinkingStep.status = 'completed'
      this.emitProgress(this.currentIteration, maxIterations, steps, false)

      // Step 2: Get available tools
      const availableTools = await this.getAvailableTools()
      console.log('[WebMCPService] Available tools:', availableTools.map(t => t.name))

      // Step 3: Determine which tools to use based on the transcript
      const toolsToCall = this.determineToolsFromTranscript(transcript, availableTools)

      if (toolsToCall.length === 0) {
        // No tools needed, just return a simple response
        const finalStep: AgentProgressStep = {
          id: `step_${Date.now()}_final`,
          type: 'final_response',
          title: 'Generating response',
          description: 'No tools needed for this request',
          status: 'completed',
          timestamp: Date.now()
        }

        steps.push(finalStep)
        this.emitProgress(maxIterations, maxIterations, steps, true)

        return `I've analyzed your request: "${transcript}". This appears to be a simple request that doesn't require any tool calls.`
      }

      // Step 4: Execute tool calls
      let toolResults: string[] = []

      for (const toolCall of toolsToCall) {
        if (this.currentIteration >= maxIterations) break

        this.currentIteration++

        // Tool call step
        const toolCallStep: AgentProgressStep = {
          id: `step_${Date.now()}_tool_${toolCall.name}`,
          type: 'tool_call',
          title: `Calling ${toolCall.name}`,
          description: `Executing ${toolCall.name} with provided arguments`,
          status: 'in_progress',
          timestamp: Date.now(),
          toolCall
        }

        steps.push(toolCallStep)
        this.emitProgress(this.currentIteration, maxIterations, steps, false)

        try {
          const result = await this.executeToolCall(toolCall)

          toolCallStep.status = result.isError ? 'error' : 'completed'
          toolCallStep.result = result

          const resultText = result.content.map(c => c.text).join('\n')
          toolResults.push(`${toolCall.name}: ${resultText}`)

          this.emitProgress(this.currentIteration, maxIterations, steps, false)
        } catch (error) {
          toolCallStep.status = 'error'
          toolCallStep.error = error instanceof Error ? error.message : String(error)
          this.emitProgress(this.currentIteration, maxIterations, steps, false)
        }

        await this.delay(500)
      }

      // Final response
      const finalStep: AgentProgressStep = {
        id: `step_${Date.now()}_final`,
        type: 'final_response',
        title: 'Generating final response',
        description: 'Synthesizing results from tool calls',
        status: 'completed',
        timestamp: Date.now()
      }

      steps.push(finalStep)
      this.emitProgress(maxIterations, maxIterations, steps, true)

      const finalResponse = `I've completed the requested task: "${transcript}"\n\nExecuted ${toolsToCall.length} tool calls across ${this.currentIteration} iterations.\n\nResults:\n${toolResults.join('\n')}`

      return finalResponse

    } catch (error) {
      console.error('[WebMCPService] Agent simulation failed:', error)

      // Mark current step as failed
      if (steps.length > 0) {
        const lastStep = steps[steps.length - 1]
        lastStep.status = 'error'
        lastStep.error = error instanceof Error ? error.message : String(error)
      }

      this.emitProgress(this.currentIteration, maxIterations, steps, true)

      return `Agent simulation failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  private determineToolsFromTranscript(transcript: string, availableTools: MCPTool[]): MCPToolCall[] {
    const tools: MCPToolCall[] = []
    const lowerTranscript = transcript.toLowerCase()

    // Simple keyword-based tool selection
    for (const tool of availableTools) {
      const toolName = tool.name.toLowerCase()

      // Check if the transcript mentions this tool or related keywords
      if (lowerTranscript.includes(toolName) ||
          lowerTranscript.includes(toolName.replace('_', ' ')) ||
          this.matchesToolKeywords(lowerTranscript, tool)) {

        // Generate appropriate arguments based on the tool schema
        const args = this.generateToolArguments(transcript, tool)

        tools.push({
          name: tool.name,
          arguments: args
        })
      }
    }

    // If no specific tools matched, try some common ones based on keywords
    if (tools.length === 0) {
      if (lowerTranscript.includes('file') || lowerTranscript.includes('read') || lowerTranscript.includes('write')) {
        const fileTools = availableTools.filter(t => t.name.includes('file') || t.name.includes('read') || t.name.includes('write'))
        if (fileTools.length > 0) {
          tools.push({
            name: fileTools[0].name,
            arguments: this.generateToolArguments(transcript, fileTools[0])
          })
        }
      }

      if (lowerTranscript.includes('search') || lowerTranscript.includes('find') || lowerTranscript.includes('look up')) {
        const searchTools = availableTools.filter(t => t.name.includes('search') || t.name.includes('web'))
        if (searchTools.length > 0) {
          tools.push({
            name: searchTools[0].name,
            arguments: { query: transcript.substring(0, 100), limit: 5 }
          })
        }
      }
    }

    return tools.slice(0, 3) // Limit to 3 tools max
  }

  private matchesToolKeywords(transcript: string, tool: MCPTool): boolean {
    // Add more sophisticated keyword matching based on tool descriptions
    const description = tool.description.toLowerCase()
    const keywords = description.split(/\s+/).filter(word => word.length > 3)

    return keywords.some(keyword => transcript.includes(keyword))
  }

  private generateToolArguments(transcript: string, tool: MCPTool): any {
    // Generate basic arguments based on the tool's input schema
    const schema = tool.inputSchema
    const args: any = {}

    if (schema && schema.properties) {
      for (const [propName, propSchema] of Object.entries(schema.properties)) {
        const prop = propSchema as any

        if (prop.type === 'string') {
          if (propName.includes('path') || propName.includes('file')) {
            args[propName] = '/example/file.txt'
          } else if (propName.includes('query') || propName.includes('search')) {
            args[propName] = transcript.substring(0, 100)
          } else if (propName.includes('text') || propName.includes('content')) {
            args[propName] = transcript
          } else {
            args[propName] = 'example value'
          }
        } else if (prop.type === 'number') {
          args[propName] = propName.includes('limit') ? 5 : 1
        } else if (prop.type === 'boolean') {
          args[propName] = true
        }
      }
    }

    return args
  }

  private emitProgress(currentIteration: number, maxIterations: number, steps: AgentProgressStep[], isComplete: boolean) {
    if (!this.config.enableProgressUpdates || !this.progressCallback) return

    const update: AgentProgressUpdate = {
      currentIteration,
      maxIterations,
      steps,
      isComplete,
      timestamp: Date.now()
    }

    this.progressCallback(update)
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  public getConfig(): WebMCPConfig {
    return { ...this.config }
  }

  public async updateConfig(newConfig: Partial<WebMCPConfig>): Promise<void> {
    this.config = { ...this.config, ...newConfig }

    // Re-initialize if MCP config changed
    if (newConfig.mcpConfig) {
      await this.initialize()
    }
  }

  public async shutdown(): Promise<void> {
    try {
      console.log('[WebMCPService] Shutting down...')

      // Close all MCP clients
      for (const [serverName, client] of this.clients.entries()) {
        try {
          await client.close()
          console.log(`[WebMCPService] Closed client for server: ${serverName}`)
        } catch (error) {
          console.warn(`[WebMCPService] Error closing client for ${serverName}:`, error)
        }
      }
      this.clients.clear()

      // Kill all server processes
      for (const [serverName, process] of this.serverProcesses.entries()) {
        try {
          if (!process.killed) {
            process.kill('SIGTERM')
            console.log(`[WebMCPService] Terminated process for server: ${serverName}`)
          }
        } catch (error) {
          console.warn(`[WebMCPService] Error terminating process for ${serverName}:`, error)
        }
      }
      this.serverProcesses.clear()

      // Clear available tools
      this.availableTools = []

      console.log('[WebMCPService] Shutdown complete')
    } catch (error) {
      console.error('[WebMCPService] Shutdown error:', error)
    }
  }
}
