import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { MCPTool, MCPToolCall, MCPToolResult } from "./types"
import { ProfileMcpServerConfig } from "../../shared/types"
import { isDebugTools, logTools } from "../debug"
import { diagnosticsService } from "../diagnostics"
import { executeBuiltinTool, isBuiltinTool, builtinTools } from "../builtin-tools"
import { dialog } from "electron"
import { configStore } from "../config"

/**
 * ToolExecutor - Executes MCP tool calls with parameter fixing
 *
 * Responsibilities:
 * - Execute tool calls on MCP servers
 * - Handle parameter type mismatches and normalization
 * - Retry with corrected parameters on errors
 * - Tool approval flow
 */
export class ToolExecutor {
  /**
   * Execute a server tool call
   */
  async executeServerTool(
    serverName: string,
    toolName: string,
    arguments_: any,
    client: Client,
    availableTools: MCPTool[],
    updateResourceActivity: (serverId: string, resourceId: string, resourceType?: string) => void,
    onProgress?: (message: string) => void
  ): Promise<MCPToolResult> {
    if (!client) {
      throw new Error(`Server ${serverName} not found or not connected`)
    }

    // Enhanced argument processing with session injection
    let processedArguments = { ...arguments_ }

    // Auto-fix common parameter type mismatches based on tool schema
    if (availableTools.length > 0) {
      const toolSchema = availableTools.find(t => t.name === `${serverName}:${toolName}`)?.inputSchema
      if (toolSchema?.properties) {
        for (const [paramName, paramValue] of Object.entries(processedArguments)) {
          const expectedType = toolSchema.properties[paramName]?.type
          if (expectedType && typeof paramValue !== expectedType) {
            // Convert common type mismatches
            if (expectedType === 'string' && Array.isArray(paramValue)) {
              processedArguments[paramName] = paramValue.length === 0 ? "" : paramValue.join(", ")
            } else if (expectedType === 'array' && typeof paramValue === 'string') {
              processedArguments[paramName] = paramValue ? [paramValue] : []
            } else if (expectedType === 'number' && typeof paramValue === 'string') {
              const num = parseFloat(paramValue)
              if (!isNaN(num)) processedArguments[paramName] = num
            } else if (expectedType === 'boolean' && typeof paramValue === 'string') {
              processedArguments[paramName] = paramValue.toLowerCase() === 'true'
            }
          }
        }

        // Enum normalization based on tool schema (schema-driven; no tool-specific logic)
        for (const [paramName, paramValue] of Object.entries(processedArguments)) {
          const schema = (toolSchema as any)?.properties?.[paramName]
          const enumVals = schema?.enum
          if (Array.isArray(enumVals) && !enumVals.includes(paramValue)) {
            const toStr = (v: any) => (typeof v === "string" ? v : String(v))
            const pv = toStr(paramValue).trim()
            // Case-insensitive match first
            const ci = enumVals.find((ev: any) => toStr(ev).toLowerCase() === pv.toLowerCase())
            if (ci !== undefined) {
              processedArguments[paramName] = ci
              continue
            }
            // Generic synonym mapping (kept generic so it works across tools & flows)
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
                processedArguments[paramName] = target
              }
            }
          }
        }
      }
    }

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
          updateResourceActivity(serverName, value, "session")
        }
      }

      // Ensure content is properly formatted
      const content = Array.isArray(result.content)
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

      const finalResult: MCPToolResult = {
        content: content.map(item => ({
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
      // Check if this is a parameter naming issue and try to fix it
      if (error instanceof Error) {
        const errorMessage = error.message
        if (
          errorMessage.includes("missing field") ||
          errorMessage.includes("Invalid arguments")
        ) {
          // Try to fix common parameter naming issues
          const correctedArgs = this.fixParameterNaming(
            arguments_,
            errorMessage,
          )
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
              if (isDebugTools()) {
                logTools("Retry result", { serverName, toolName, retryResult })
              }

              const retryContent = Array.isArray(retryResult.content)
                ? retryResult.content.map((item) => ({
                    type: "text" as const,
                    text:
                      typeof item === "string"
                        ? item
                        : item.text || JSON.stringify(item),
                  }))
                : [
                    {
                      type: "text" as const,
                      text: "Tool executed successfully (after parameter correction)",
                    },
                  ]

              return {
                content: retryContent,
                isError: Boolean(retryResult.isError),
              }
            } catch (retryError) {
              // Retry failed, will fall through to error return
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
   * Fix parameter naming (snake_case to camelCase)
   */
  private fixParameterNaming(args: any, errorMessage?: string): any {
    if (!args || typeof args !== "object") return args

    const fixed = { ...args }

    // General snake_case to camelCase conversion
    const snakeToCamel = (str: string): string => {
      return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
    }

    // If we have an error message, try to extract the expected field name
    if (errorMessage) {
      const missingFieldMatch = errorMessage.match(/missing field `([^`]+)`/)
      if (missingFieldMatch) {
        const expectedField = missingFieldMatch[1]
        // Look for snake_case version of the expected field
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
   * Execute a tool call with approval flow and server routing
   */
  async executeToolCall(
    toolCall: MCPToolCall,
    clients: Map<string, Client>,
    availableTools: MCPTool[],
    runtimeDisabledServers: Set<string>,
    updateResourceActivity: (serverId: string, resourceId: string, resourceType?: string) => void,
    trackResourceFromResult: (serverName: string, result: MCPToolResult) => void,
    processToolResponse: (serverName: string, toolName: string, result: MCPToolResult, onProgress?: (message: string) => void) => Promise<MCPToolResult>,
    onProgress?: (message: string) => void,
    skipApprovalCheck: boolean = false,
    profileMcpConfig?: ProfileMcpServerConfig
  ): Promise<MCPToolResult> {
    try {
      if (isDebugTools()) {
        logTools("Requested tool call", toolCall)
      }

      // Safety gate: require user approval before executing any tool call if enabled in config
      // Skip if approval was already handled by the caller (e.g., inline approval in agent mode UI)
      const cfg = configStore.get()
      if (cfg.mcpRequireApprovalBeforeToolCall && !skipApprovalCheck) {
        // This path is only hit when called outside of agent mode (e.g., single-shot tool calling)
        // In agent mode, approval is handled inline in the UI via tipc.ts wrapper
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
        if (response !== 0) {
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
        const result = await executeBuiltinTool(toolCall.name, toolCall.arguments || {})
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

        // Guard against executing tools that are disabled in the profile config
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

        const client = clients.get(serverName)
        if (!client) {
          return {
            content: [
              {
                type: "text",
                text: `Server ${serverName} not found or not connected`,
              },
            ],
            isError: true,
          }
        }

        const result = await this.executeServerTool(
          serverName,
          toolName,
          toolCall.arguments,
          client,
          availableTools,
          updateResourceActivity,
          onProgress
        )

        // Track resource information from tool results
        trackResourceFromResult(serverName, result)

        // Process the response (filtering, summarization)
        return await processToolResponse(serverName, toolName, result, onProgress)
      }

      // Try to find a matching tool without prefix (fallback for LLM inconsistencies)
      const matchingTool = this.findMatchingTool(
        toolCall.name,
        availableTools,
        profileMcpConfig,
        runtimeDisabledServers
      )

      if (matchingTool && matchingTool.name.includes(":")) {
        // Check if it's a built-in tool
        if (isBuiltinTool(matchingTool.name)) {
          const result = await executeBuiltinTool(matchingTool.name, toolCall.arguments || {})
          if (result) {
            return result
          }
        }

        const [serverName, toolName] = matchingTool.name.split(":", 2)

        // Guard against executing tools that are disabled in the profile config
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

        const client = clients.get(serverName)
        if (!client) {
          return {
            content: [
              {
                type: "text",
                text: `Server ${serverName} not found or not connected`,
              },
            ],
            isError: true,
          }
        }

        const result = await this.executeServerTool(
          serverName,
          toolName,
          toolCall.arguments,
          client,
          availableTools,
          updateResourceActivity,
          onProgress
        )

        // Track resource information from tool results
        trackResourceFromResult(serverName, result)

        // Process the response (filtering, summarization)
        return await processToolResponse(serverName, toolName, result, onProgress)
      }

      // No matching tools found
      const enabledExternalTools = this.getEnabledToolsForSession(
        availableTools,
        profileMcpConfig,
        runtimeDisabledServers
      )
      const availableToolNames = enabledExternalTools
        .map((t) => t.name)
        .join(", ")
      const result: MCPToolResult = {
        content: [
          {
            type: "text",
            text: `Unknown tool: ${toolCall.name}. Available tools: ${availableToolNames || "none"}. Make sure to use the exact tool name including server prefix.`,
          },
        ],
        isError: true,
      }

      return result
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
   * Find a matching tool for a tool call
   */
  private findMatchingTool(
    toolName: string,
    availableTools: MCPTool[],
    profileMcpConfig: ProfileMcpServerConfig | undefined,
    runtimeDisabledServers: Set<string>
  ): MCPTool | undefined {
    const enabledTools = this.getEnabledToolsForSession(
      availableTools,
      profileMcpConfig,
      runtimeDisabledServers
    )

    return enabledTools.find((tool) => {
      if (tool.name.includes(":")) {
        const [, tName] = tool.name.split(":", 2)
        return tName === toolName
      }
      return tool.name === toolName
    })
  }

  /**
   * Get enabled tools for a session
   */
  private getEnabledToolsForSession(
    availableTools: MCPTool[],
    profileMcpConfig: ProfileMcpServerConfig | undefined,
    runtimeDisabledServers: Set<string>
  ): MCPTool[] {
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

    return [...enabledExternalTools, ...builtinTools]
  }
}
