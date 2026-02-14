/**
 * MCP Service - Core Model Context Protocol client implementation
 * Ported from acp-remote
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { ClientCapabilities, Tool } from "@modelcontextprotocol/sdk/types.js"
import type { MCPConfig, MCPServerConfig, MCPTransportType } from "../shared/types.js"
import { inferTransportType } from "../shared/mcp-utils.js"

export interface MCPTool {
  name: string
  description: string
  inputSchema: object
}

export interface MCPToolCall {
  name: string
  arguments: object
}

export interface MCPToolResult {
  content: Array<{
    type: "text" | "image" | "audio"
    text?: string
    data?: string
    mimeType?: string
  }>
  isError?: boolean
}

export class MCPService {
  private clients: Map<string, Client> = new Map()
  private transports: Map<
    string,
    StdioClientTransport | WebSocketClientTransport | StreamableHTTPClientTransport
  > = new Map()
  private availableTools: MCPTool[] = []
  private disabledTools: Set<string> = new Set()
  private initializedServers: Set<string> = new Set()

  /**
   * Get client capabilities for MCP initialization
   */
  private getClientCapabilities(): ClientCapabilities {
    return {
      roots: {
        listChanged: true,
      },
    }
  }

  /**
   * Create transport based on server configuration
   */
  private createTransport(
    serverName: string,
    config: MCPServerConfig
  ): StdioClientTransport | WebSocketClientTransport | StreamableHTTPClientTransport {
    const transportType = config.transport || inferTransportType(config)

    switch (transportType) {
      case "websocket":
        if (!config.url) {
          throw new Error(`WebSocket transport requires URL for server: ${serverName}`)
        }
        return new WebSocketClientTransport(new URL(config.url))

      case "streamableHttp":
        if (!config.url) {
          throw new Error(`HTTP transport requires URL for server: ${serverName}`)
        }
        return new StreamableHTTPClientTransport(new URL(config.url), {
          requestInit: {
            headers: config.headers || {},
          },
        })

      case "stdio":
      default:
        if (!config.command) {
          throw new Error(`stdio transport requires command for server: ${serverName}`)
        }
        return new StdioClientTransport({
          command: config.command,
          args: config.args || [],
          env: config.env || {},
        })
    }
  }

  /**
   * Connect to an MCP server
   */
  async connect(serverName: string, config: MCPServerConfig): Promise<void> {
    if (this.clients.has(serverName)) {
      await this.disconnect(serverName)
    }

    const client = new Client(
      {
        name: "speakmcp",
        version: "1.0.0",
      },
      {
        capabilities: this.getClientCapabilities(),
      }
    )

    const transport = this.createTransport(serverName, config)

    this.clients.set(serverName, client)
    this.transports.set(serverName, transport)

    await client.connect(transport)

    // List available tools after connection
    const toolsResult = await client.listTools()
    this.availableTools = toolsResult.tools.map((tool: Tool) => ({
      name: tool.name,
      description: tool.description || "",
      inputSchema: tool.inputSchema,
    }))

    this.initializedServers.add(serverName)
  }

  /**
   * Disconnect from an MCP server
   */
  async disconnect(serverName: string): Promise<void> {
    const client = this.clients.get(serverName)
    const transport = this.transports.get(serverName)

    if (client) {
      try {
        await client.close()
      } catch (error) {
        console.error(`Error closing client for ${serverName}:`, error)
      }
      this.clients.delete(serverName)
    }

    if (transport) {
      try {
        await transport.close()
      } catch (error) {
        console.error(`Error closing transport for ${serverName}:`, error)
      }
      this.transports.delete(serverName)
    }

    this.initializedServers.delete(serverName)

    // Remove tools from this server
    this.availableTools = this.availableTools.filter(
      (tool) => !tool.name.startsWith(`${serverName}_`)
    )
  }

  /**
   * Call an MCP tool
   */
  async callTool(
    serverName: string,
    toolName: string,
    arguments_: object
  ): Promise<MCPToolResult> {
    const client = this.clients.get(serverName)
    if (!client) {
      throw new Error(`Not connected to server: ${serverName}`)
    }

    const fullToolName = toolName.includes("_")
      ? toolName
      : `${serverName}_${toolName}`

    const result = await client.callTool({
      name: fullToolName,
      arguments: arguments_,
    })

    return {
      content: result.content.map((content) => {
        if (content.type === "text") {
          return {
            type: "text" as const,
            text: content.text,
          }
        }
        return {
          type: content.type,
          data: (content as any).data,
          mimeType: (content as any).mimeType,
        }
      }),
      isError: result.isError,
    }
  }

  /**
   * Get all available tools from all connected servers
   */
  getAvailableTools(): MCPTool[] {
    return this.availableTools.filter(
      (tool) => !this.disabledTools.has(tool.name)
    )
  }

  /**
   * Get tools from a specific server
   */
  getToolsForServer(serverName: string): MCPTool[] {
    return this.availableTools.filter(
      (tool) =>
        tool.name.startsWith(`${serverName}_`) &&
        !this.disabledTools.has(tool.name)
    )
  }

  /**
   * Disable a tool
   */
  disableTool(toolName: string): void {
    this.disabledTools.add(toolName)
  }

  /**
   * Enable a tool
   */
  enableTool(toolName: string): void {
    this.disabledTools.delete(toolName)
  }

  /**
   * Check if connected to a server
   */
  isConnected(serverName: string): boolean {
    return this.clients.has(serverName)
  }

  /**
   * Get list of initialized servers
   */
  getInitializedServers(): string[] {
    return Array.from(this.initializedServers)
  }

  /**
   * Connect to all servers in config
   */
  async connectAll(mcpConfig: MCPConfig): Promise<void> {
    const entries = Object.entries(mcpConfig.mcpServers || {})

    for (const [serverName, serverConfig] of entries) {
      if (serverConfig.disabled) {
        continue
      }

      try {
        await this.connect(serverName, serverConfig)
      } catch (error) {
        console.error(`Failed to connect to ${serverName}:`, error)
      }
    }
  }

  /**
   * Disconnect from all servers
   */
  async disconnectAll(): Promise<void> {
    const serverNames = Array.from(this.clients.keys())
    await Promise.all(serverNames.map((name) => this.disconnect(name)))
  }
}

export const mcpService = new MCPService()
