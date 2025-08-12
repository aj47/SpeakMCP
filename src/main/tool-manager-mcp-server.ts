import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { dynamicToolManager } from "./dynamic-tool-manager"
import { mcpService } from "./mcp-service"
import { isDebugTools, logTools } from "./debug"

/**
 * Internal MCP server that provides tool management capabilities to agents
 * This server exposes tools that allow agents to discover and control other MCP tools
 */
export class ToolManagerMCPServer {
  private server: Server
  private isRunning = false

  constructor() {
    this.server = new Server(
      {
        name: "tool-manager",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    )

    this.setupHandlers()
  }

  private setupHandlers(): void {
    // List available tool management tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "list_tools",
            description: "List all available MCP tools and their current status",
            inputSchema: {
              type: "object",
              properties: {
                includeDisabled: {
                  type: "boolean",
                  description: "Whether to include disabled tools in the list",
                  default: true,
                },
                serverFilter: {
                  type: "string",
                  description: "Optional server name to filter tools by",
                },
              },
            },
          },
          {
            name: "get_tool_status",
            description: "Get detailed status information for a specific tool",
            inputSchema: {
              type: "object",
              properties: {
                toolName: {
                  type: "string",
                  description: "Full name of the tool (including server prefix)",
                },
              },
              required: ["toolName"],
            },
          },
          {
            name: "enable_tool",
            description: "Enable a specific MCP tool",
            inputSchema: {
              type: "object",
              properties: {
                toolName: {
                  type: "string",
                  description: "Full name of the tool to enable (including server prefix)",
                },
                reason: {
                  type: "string",
                  description: "Optional reason for enabling the tool",
                },
              },
              required: ["toolName"],
            },
          },
          {
            name: "disable_tool",
            description: "Disable a specific MCP tool",
            inputSchema: {
              type: "object",
              properties: {
                toolName: {
                  type: "string",
                  description: "Full name of the tool to disable (including server prefix)",
                },
                reason: {
                  type: "string",
                  description: "Reason for disabling the tool",
                },
                duration: {
                  type: "number",
                  description: "Optional duration in milliseconds for temporary disable",
                },
              },
              required: ["toolName"],
            },
          },
          {
            name: "get_tool_permissions",
            description: "Check what operations are allowed for a specific tool",
            inputSchema: {
              type: "object",
              properties: {
                toolName: {
                  type: "string",
                  description: "Full name of the tool (including server prefix)",
                },
              },
              required: ["toolName"],
            },
          },
          {
            name: "get_tool_usage_stats",
            description: "Get usage statistics for a specific tool",
            inputSchema: {
              type: "object",
              properties: {
                toolName: {
                  type: "string",
                  description: "Full name of the tool (including server prefix)",
                },
              },
              required: ["toolName"],
            },
          },
        ],
      }
    })

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params

      try {
        switch (name) {
          case "list_tools":
            return await this.handleListTools(args)
          case "get_tool_status":
            return await this.handleGetToolStatus(args)
          case "enable_tool":
            return await this.handleEnableTool(args)
          case "disable_tool":
            return await this.handleDisableTool(args)
          case "get_tool_permissions":
            return await this.handleGetToolPermissions(args)
          case "get_tool_usage_stats":
            return await this.handleGetToolUsageStats(args)
          default:
            throw new Error(`Unknown tool: ${name}`)
        }
      } catch (error) {
        if (isDebugTools()) {
          logTools("Tool manager error", { name, args, error })
        }
        return {
          content: [
            {
              type: "text",
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        }
      }
    })
  }

  private async handleListTools(args: any) {
    const { includeDisabled = true, serverFilter } = args || {}
    
    // Get all available tools from MCP service
    const allTools = mcpService.getDetailedToolList()
    
    // Filter tools based on parameters
    let filteredTools = allTools
    
    if (!includeDisabled) {
      filteredTools = filteredTools.filter(tool => tool.enabled)
    }
    
    if (serverFilter) {
      filteredTools = filteredTools.filter(tool => tool.serverName === serverFilter)
    }

    // Enhance with dynamic tool manager information
    const enhancedTools = filteredTools.map(tool => {
      const dynamicState = dynamicToolManager.getToolState(tool.name)
      return {
        ...tool,
        dynamicallyControlled: dynamicState?.dynamicallyControlled || false,
        permissions: dynamicState?.permissions,
        usageStats: dynamicState?.usageStats,
        temporaryDisableUntil: dynamicState?.temporaryDisableUntil,
        disableReason: dynamicState?.disableReason,
      }
    })

    const result = {
      totalTools: enhancedTools.length,
      enabledTools: enhancedTools.filter(t => t.enabled).length,
      disabledTools: enhancedTools.filter(t => !t.enabled).length,
      tools: enhancedTools,
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        },
      ],
    }
  }

  private async handleGetToolStatus(args: any) {
    const { toolName } = args
    
    if (!toolName) {
      throw new Error("toolName is required")
    }

    const dynamicState = dynamicToolManager.getToolState(toolName)
    if (!dynamicState) {
      throw new Error(`Tool not found: ${toolName}`)
    }

    const toolInfo = mcpService.getDetailedToolList().find(t => t.name === toolName)
    if (!toolInfo) {
      throw new Error(`Tool not found in MCP service: ${toolName}`)
    }

    const status = {
      ...toolInfo,
      ...dynamicState,
      isTemporarilyDisabled: dynamicState.temporaryDisableUntil ? 
        Date.now() < dynamicState.temporaryDisableUntil : false,
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(status, null, 2),
        },
      ],
    }
  }

  private async handleEnableTool(args: any) {
    const { toolName, reason } = args
    
    if (!toolName) {
      throw new Error("toolName is required")
    }

    const response = await dynamicToolManager.processToolControlRequest({
      toolName,
      action: 'enable',
      reason,
      requestedBy: 'agent',
    })

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
      isError: !response.success,
    }
  }

  private async handleDisableTool(args: any) {
    const { toolName, reason, duration } = args
    
    if (!toolName) {
      throw new Error("toolName is required")
    }

    const response = await dynamicToolManager.processToolControlRequest({
      toolName,
      action: 'disable',
      reason,
      duration,
      requestedBy: 'agent',
    })

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
      isError: !response.success,
    }
  }

  private async handleGetToolPermissions(args: any) {
    const { toolName } = args
    
    if (!toolName) {
      throw new Error("toolName is required")
    }

    const dynamicState = dynamicToolManager.getToolState(toolName)
    if (!dynamicState) {
      throw new Error(`Tool not found: ${toolName}`)
    }

    const permissions = {
      toolName,
      permissions: dynamicState.permissions,
      currentlyEnabled: dynamicState.enabled,
      dynamicallyControlled: dynamicState.dynamicallyControlled,
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(permissions, null, 2),
        },
      ],
    }
  }

  private async handleGetToolUsageStats(args: any) {
    const { toolName } = args
    
    if (!toolName) {
      throw new Error("toolName is required")
    }

    const dynamicState = dynamicToolManager.getToolState(toolName)
    if (!dynamicState) {
      throw new Error(`Tool not found: ${toolName}`)
    }

    const stats = {
      toolName,
      usageStats: dynamicState.usageStats,
      lastModified: dynamicState.lastModified,
      modifiedBy: dynamicState.modifiedBy,
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(stats, null, 2),
        },
      ],
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      return
    }

    const transport = new StdioServerTransport()
    await this.server.connect(transport)
    this.isRunning = true

    if (isDebugTools()) {
      logTools("Tool Manager MCP Server started")
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return
    }

    await this.server.close()
    this.isRunning = false

    if (isDebugTools()) {
      logTools("Tool Manager MCP Server stopped")
    }
  }

  isServerRunning(): boolean {
    return this.isRunning
  }
}

export const toolManagerMCPServer = new ToolManagerMCPServer()
