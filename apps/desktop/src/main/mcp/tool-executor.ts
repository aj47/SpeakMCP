import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { MCPTool, MCPToolCall, MCPToolResult } from "./types"
import { ProfileMcpServerConfig } from "../../shared/types"
import { isDebugTools, logTools } from "../debug"
import { diagnosticsService } from "../diagnostics"
import { configStore } from "../config"
import { dialog } from "electron"
import { isBuiltinTool, executeBuiltinTool, builtinTools } from "../builtin-tools"
import { ResponseProcessor } from "./response-processor"
import { ResourceTracker } from "./resource-tracker"

/**
 * ToolExecutor handles execution of MCP tool calls
 * Manages parameter validation, type conversion, and result processing
 */
export class ToolExecutor {
  private responseProcessor: ResponseProcessor
  private resourceTracker: ResourceTracker

  constructor(responseProcessor: ResponseProcessor, resourceTracker: ResourceTracker) {
    this.responseProcessor = responseProcessor
    this.resourceTracker = resourceTracker
  }

  /**
   * Execute a tool call
   */
  async executeToolCall(
    toolCall: MCPToolCall,
    clients: Map<string, Client>,
    availableTools: MCPTool[],
    runtimeDisabledServers: Set<string>,
    onProgress?: (message: string) => void,
    skipApprovalCheck: boolean = false,
    sessionId?: string,
    profileMcpConfig?: ProfileMcpServerConfig
  ): Promise<MCPToolResult> {
    try {
      if (isDebugTools()) {
        logTools("Requested tool call", toolCall)
      }

      // Safety gate: require user approval before executing any tool call if enabled in config
      if (!skipApprovalCheck) {
        const approved = await this.requestApproval(toolCall)
        if (!approved) {
          return {
            content: [
              {
                type: "text",
                text: `Tool call denied by user: ${toolCall.name}`,
              },
            ],
            isError: true,
          }
        }
      }

      // Check if this is a built-in tool first
      if (isBuiltinTool(toolCall.name)) {
        if (isDebugTools()) {
          logTools("Executing built-in tool", { name: toolCall.name, arguments: toolCall.arguments })
        }
        const result = await executeBuiltinTool(toolCall.name, toolCall.arguments || {}, sessionId)
        if (result) {
          if (isDebugTools()) {
            logTools("Built-in tool result", { name: toolCall.name, result })
          }
          return result
        }
      }

      // Check if this is a server-prefixed tool
      if (toolCall.name.includes(":")) {
        const [serverName, toolName] = toolCall.name.split(":", 2)

        // Guard against executing tools from disabled servers
        const isServerDisabledForSession = this.isServerDisabledForSession(
          serverName,
          profileMcpConfig,
          runtimeDisabledServers
        )

        if (isServerDisabledForSession) {
          return {
            content: [
              {
                type: "text",
                text: `Tool ${toolCall.name} is unavailable: server "${serverName}" is currently disabled.`,
              },
            ],
            isError: true,
          }
        }

        // Guard against executing disabled tools
        if (profileMcpConfig?.disabledTools?.includes(toolCall.name)) {
          return {
            content: [
              {
                type: "text",
                text: `Tool ${toolCall.name} is currently disabled for this profile.`,
              },
            ],
            isError: true,
          }
        }

        const result = await this.executeServerTool(
          clients,
          availableTools,
          serverName,
          toolName,
          toolCall.arguments,
          onProgress
        )

        // Track resource information from tool results
        this.resourceTracker.trackResourceFromResult(serverName, result)

        return result
      }

      // Try to find a matching tool without prefix
      const matchingTool = this.findMatchingTool(
        toolCall.name,
        availableTools,
        profileMcpConfig,
        runtimeDisabledServers
      )

      if (matchingTool && matchingTool.name.includes(":")) {
        // Check if it's a built-in tool
        if (isBuiltinTool(matchingTool.name)) {
          const result = await executeBuiltinTool(matchingTool.name, toolCall.arguments || {}, sessionId)
          if (result) {
            return result
          }
        }

        const [serverName, toolName] = matchingTool.name.split(":", 2)

        // Guard against executing disabled tools
        if (profileMcpConfig?.disabledTools?.includes(matchingTool.name)) {
          return {
            content: [
              {
                type: "text",
                text: `Tool ${matchingTool.name} is currently disabled for this profile.`,
              },
            ],
            isError: true,
          }
        }

        const result = await this.executeServerTool(
          clients,
          availableTools,
          serverName,
          toolName,
          toolCall.arguments,
          onProgress
        )

        // Track resource information from tool results
        this.resourceTracker.trackResourceFromResult(serverName, result)

        return result
      }

      // No matching tools found
      const allTools = [...availableTools, ...builtinTools]
      const availableToolNames = allTools.map((t) => t.name).join(", ")
      return {
        content: [
          {
            type: "text",
            text: `Unknown tool: ${toolCall.name}. Available tools: ${availableToolNames || "none"}. Make sure to use the exact tool name including server prefix.`,
          },
        ],
        isError: true,
      }
    } catch (error) {
      diagnosticsService.logError(
        "mcp-service",
        `Tool execution error for ${toolCall.name}`,
        error,
      )

      return {
        content: [
          {
            type: "text",
            text: `Error executing tool ${toolCall.name}: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      }
    }
  }

  /**
   * Execute a tool on an MCP server
   */
  private async executeServerTool(
    clients: Map<string, Client>,
    availableTools: MCPTool[],
    serverName: string,
    toolName: string,
    arguments_: any,
    onProgress?: (message: string) => void
  ): Promise<MCPToolResult> {
    const client = clients.get(serverName)
    if (!client) {
      throw new Error(`Server ${serverName} not found or not connected`)
    }

    // Process arguments (type conversion, enum normalization, etc.)
    let processedArguments = this.processToolArguments(
      arguments_,
      availableTools,
      serverName,
      toolName
    )

    try {
      if (isDebugTools()) {
        logTools("Executing tool", {
          serverName,
          toolName,
          arguments: processedArguments,
        })
      }

      const result = await client.callTool({
        name: toolName,
        arguments: processedArguments,
      })

      if (isDebugTools()) {
        logTools("Tool result", { serverName, toolName, result })
      }

      // Update resource activity if resource ID was used
      for (const [, value] of Object.entries(processedArguments)) {
        if (typeof value === "string" && value.match(/^[a-f0-9-]{20,}$/)) {
          this.resourceTracker.updateResourceActivity(serverName, value, "session")
        }
      }

      // Format content
      const content = this.formatToolResultContent(result)

      // Apply response filtering and processing
      const filteredContent = this.responseProcessor.filterToolResponse(serverName, toolName, content)
      const processedContent = await this.responseProcessor.processLargeToolResponse(
        serverName,
        toolName,
        filteredContent,
        onProgress
      )

      const finalResult: MCPToolResult = {
        content: processedContent.map(item => ({
          type: "text" as const,
          text: item.text
        })),
        isError: Boolean(result.isError),
      }

      if (isDebugTools()) {
        logTools("Normalized tool result", finalResult)
      }

      return finalResult
    } catch (error) {
      // Try parameter name correction if we get a parameter error
      if (error instanceof Error) {
        const errorMessage = error.message
        if (
          errorMessage.includes("missing field") ||
          errorMessage.includes("Invalid arguments")
        ) {
          const correctedArgs = this.fixParameterNaming(arguments_, errorMessage)
          if (JSON.stringify(correctedArgs) !== JSON.stringify(arguments_)) {
            try {
              if (isDebugTools()) {
                logTools("Retrying with corrected args", {
                  serverName,
                  toolName,
                  correctedArgs,
                })
              }

              const retryResult = await client.callTool({
                name: toolName,
                arguments: correctedArgs,
              })

              const retryContent = this.formatToolResultContent(retryResult)
              return {
                content: retryContent,
                isError: Boolean(retryResult.isError),
              }
            } catch (retryError) {
              // Fall through to error return
            }
          }
        }
      }

      return {
        content: [
          {
            type: "text",
            text: `Error executing tool: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      }
    }
  }

  /**
   * Process and normalize tool arguments
   */
  private processToolArguments(
    arguments_: any,
    availableTools: MCPTool[],
    serverName: string,
    toolName: string
  ): any {
    let processedArguments = { ...arguments_ }

    // Get tool schema
    const toolSchema = availableTools.find(t => t.name === `${serverName}:${toolName}`)?.inputSchema

    if (toolSchema?.properties) {
      // Auto-fix common parameter type mismatches
      for (const [paramName, paramValue] of Object.entries(processedArguments)) {
        const expectedType = toolSchema.properties[paramName]?.type
        if (expectedType && typeof paramValue !== expectedType) {
          processedArguments[paramName] = this.convertParameterType(
            paramValue,
            expectedType
          )
        }
      }

      // Enum normalization
      for (const [paramName, paramValue] of Object.entries(processedArguments)) {
        const schema = (toolSchema as any)?.properties?.[paramName]
        const enumVals = schema?.enum
        if (Array.isArray(enumVals) && !enumVals.includes(paramValue)) {
          const normalized = this.normalizeEnumValue(paramValue, enumVals)
          if (normalized !== undefined) {
            processedArguments[paramName] = normalized
          }
        }
      }
    }

    return processedArguments
  }

  /**
   * Convert parameter to expected type
   */
  private convertParameterType(value: any, expectedType: string): any {
    if (expectedType === 'string' && Array.isArray(value)) {
      return value.length === 0 ? "" : value.join(", ")
    } else if (expectedType === 'array' && typeof value === 'string') {
      return value ? [value] : []
    } else if (expectedType === 'number' && typeof value === 'string') {
      const num = parseFloat(value)
      return !isNaN(num) ? num : value
    } else if (expectedType === 'boolean' && typeof value === 'string') {
      return value.toLowerCase() === 'true'
    }
    return value
  }

  /**
   * Normalize enum values with case-insensitive matching and synonyms
   */
  private normalizeEnumValue(value: any, enumVals: any[]): any {
    const toStr = (v: any) => (typeof v === "string" ? v : String(v))
    const pv = toStr(value).trim()

    // Case-insensitive match first
    const ci = enumVals.find((ev: any) => toStr(ev).toLowerCase() === pv.toLowerCase())
    if (ci !== undefined) {
      return ci
    }

    // Generic synonym mapping
    const synMap: Record<string, string> = {
      complex: "hard",
      complicated: "hard",
      difficult: "hard",
      hard: "hard",
      moderate: "medium",
      avg: "medium",
      average: "medium",
      medium: "medium",
      simple: "easy",
      basic: "easy",
      straightforward: "easy",
      easy: "easy",
      high: "high",
      low: "low",
      maximum: "high",
      minimum: "low",
      max: "high",
      min: "low",
    }

    const syn = synMap[pv.toLowerCase()]
    if (syn) {
      const target = enumVals.find((ev: any) => toStr(ev).toLowerCase() === syn)
      if (target !== undefined) {
        return target
      }
    }

    return undefined
  }

  /**
   * Fix parameter naming (snake_case to camelCase conversion)
   */
  private fixParameterNaming(args: any, errorMessage?: string): any {
    if (!args || typeof args !== "object") return args

    const fixed = { ...args }

    const snakeToCamel = (str: string): string => {
      return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
    }

    // If we have an error message, try to extract the expected field name
    if (errorMessage) {
      const missingFieldMatch = errorMessage.match(/missing field `([^`]+)`/)
      if (missingFieldMatch) {
        const expectedField = missingFieldMatch[1]
        const snakeVersion = expectedField
          .replace(/([A-Z])/g, "_$1")
          .toLowerCase()
        if (snakeVersion in fixed && !(expectedField in fixed)) {
          fixed[expectedField] = fixed[snakeVersion]
          delete fixed[snakeVersion]
        }
      }
    }

    // General conversion of common snake_case patterns to camelCase
    const conversions: Record<string, string> = {}
    for (const key in fixed) {
      if (key.includes("_")) {
        const camelKey = snakeToCamel(key)
        if (camelKey !== key && !(camelKey in fixed)) {
          conversions[key] = camelKey
        }
      }
    }

    // Apply conversions
    for (const [oldKey, newKey] of Object.entries(conversions)) {
      fixed[newKey] = fixed[oldKey]
      delete fixed[oldKey]
    }

    return fixed
  }

  /**
   * Format tool result content
   */
  private formatToolResultContent(result: any): Array<{ type: "text"; text: string }> {
    return Array.isArray(result.content)
      ? result.content.map((item) => ({
          type: "text" as const,
          text:
            typeof item === "string"
              ? item
              : item.text || JSON.stringify(item),
        }))
      : [
          {
            type: "text" as const,
            text: "Tool executed successfully",
          },
        ]
  }

  /**
   * Request user approval for tool execution
   */
  private async requestApproval(toolCall: MCPToolCall): Promise<boolean> {
    const cfg = configStore.get()
    if (!cfg.mcpRequireApprovalBeforeToolCall) {
      return true
    }

    const argPreview = (() => {
      try {
        return JSON.stringify(toolCall.arguments, null, 2)
      } catch {
        return String(toolCall.arguments)
      }
    })()

    const { response } = await dialog.showMessageBox({
      type: "question",
      buttons: ["Allow", "Deny"],
      defaultId: 1,
      cancelId: 1,
      title: "Approve tool execution",
      message: `Allow tool to run?`,
      detail: `Tool: ${toolCall.name}\nArguments: ${argPreview}`,
      noLink: true,
    })

    return response === 0
  }

  /**
   * Check if a server is disabled for a session
   */
  private isServerDisabledForSession(
    serverName: string,
    profileMcpConfig: ProfileMcpServerConfig | undefined,
    runtimeDisabledServers: Set<string>
  ): boolean {
    if (profileMcpConfig) {
      const { allServersDisabledByDefault, enabledServers, disabledServers } = profileMcpConfig
      if (allServersDisabledByDefault) {
        return !(enabledServers || []).includes(serverName)
      } else {
        return (disabledServers || []).includes(serverName)
      }
    }
    return runtimeDisabledServers.has(serverName)
  }

  /**
   * Find a matching tool without prefix
   */
  private findMatchingTool(
    toolName: string,
    availableTools: MCPTool[],
    profileMcpConfig: ProfileMcpServerConfig | undefined,
    runtimeDisabledServers: Set<string>
  ): MCPTool | undefined {
    const enabledExternalTools = availableTools.filter((tool) => {
      const sName = tool.name.includes(":") ? tool.name.split(":")[0] : "unknown"
      if (profileMcpConfig) {
        const { allServersDisabledByDefault, enabledServers, disabledServers } = profileMcpConfig
        if (allServersDisabledByDefault) {
          return (enabledServers || []).includes(sName)
        } else {
          return !(disabledServers || []).includes(sName)
        }
      }
      return !runtimeDisabledServers.has(sName)
    })

    const allTools = [...enabledExternalTools, ...builtinTools]
    return allTools.find((tool) => {
      if (tool.name.includes(":")) {
        const [, tName] = tool.name.split(":", 2)
        return tName === toolName
      }
      return tool.name === toolName
    })
  }
}
