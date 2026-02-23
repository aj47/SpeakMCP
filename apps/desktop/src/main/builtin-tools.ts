/**
 * Built-in MCP Tools for SpeakMCP Settings Management
 *
 * These tools are registered as a virtual "speakmcp-settings" server and provide
 * functionality for managing SpeakMCP settings directly from the LLM:
 * - List MCP servers and their status
 * - Enable/disable MCP servers
 * - List and switch profiles
 * - Agent lifecycle management (kill switch)
 *
 * Unlike external MCP servers, these tools run directly in the main process
 * and have direct access to the app's services.
 */

import { configStore } from "./config"
import { agentProfileService, toolConfigToMcpServerConfig } from "./agent-profile-service"
import { mcpService, type MCPTool, type MCPToolResult, handleWhatsAppToggle } from "./mcp-service"
import { agentSessionTracker } from "./agent-session-tracker"
import { agentSessionStateManager, toolApprovalManager } from "./state"
import { emergencyStopAll } from "./emergency-stop"
import { executeACPRouterTool, isACPRouterTool } from "./acp/acp-router-tools"
import { memoryService } from "./memory-service"
import { messageQueueService } from "./message-queue-service"
import { setSessionUserResponse } from "./session-user-response-store"
import { exec } from "child_process"
import { promisify } from "util"
import path from "path"
import type { AgentMemory } from "../shared/types"

const execAsync = promisify(exec)

// Re-export from the dependency-free definitions module for backward compatibility
// This breaks the circular dependency: profile-service -> builtin-tool-definitions (no cycle)
// while builtin-tools -> profile-service is still valid since profile-service no longer imports from here
export {
  BUILTIN_SERVER_NAME,
  builtinToolDefinitions as builtinTools,
  getBuiltinToolNames,
} from "./builtin-tool-definitions"

// Import for local use
import { BUILTIN_SERVER_NAME, builtinToolDefinitions } from "./builtin-tool-definitions"

interface BuiltinToolContext {
  sessionId?: string
}

// Tool execution handlers
type ToolHandler = (
  args: Record<string, unknown>,
  context: BuiltinToolContext
) => Promise<MCPToolResult>

function isMemoryEnabledForContext(context: BuiltinToolContext): boolean {
  if (context.sessionId) {
    const snapshot = agentSessionTracker.getSessionProfileSnapshot(context.sessionId)
    if (snapshot?.memoryConfig?.memoriesEnabled !== undefined) {
      return snapshot.memoryConfig.memoriesEnabled
    }
  }
  // Default fallback if no session or config found
  const mainAgent = agentProfileService.getByName("main-agent")
  return mainAgent?.memoryConfig?.memoriesEnabled !== false
}

const toolHandlers: Record<string, ToolHandler> = {
  list_mcp_servers: async (): Promise<MCPToolResult> => {
    const config = configStore.get()
    const mcpConfig = config.mcpConfig || { mcpServers: {} }
    const runtimeDisabled = new Set(config.mcpRuntimeDisabledServers || [])
    const serverStatus = mcpService.getServerStatus()

    const servers = Object.entries(mcpConfig.mcpServers).map(([name, serverConfig]) => {
      const isConfigDisabled = serverConfig.disabled === true
      const isRuntimeDisabled = runtimeDisabled.has(name)
      const status = isConfigDisabled || isRuntimeDisabled ? "disabled" : "enabled"
      const transport = serverConfig.transport || "stdio"
      const connectionInfo = serverStatus[name]

      return {
        name,
        status,
        connected: connectionInfo?.connected ?? false,
        toolCount: connectionInfo?.toolCount ?? 0,
        transport,
        configDisabled: isConfigDisabled,
        runtimeDisabled: isRuntimeDisabled,
        command: serverConfig.command,
        url: serverConfig.url,
      }
    })

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ servers, count: servers.length }, null, 2),
        },
      ],
      isError: false,
    }
  },

  toggle_mcp_server: async (args: Record<string, unknown>): Promise<MCPToolResult> => {
    // Validate serverName parameter
    if (typeof args.serverName !== "string" || args.serverName.trim() === "") {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "serverName must be a non-empty string" }) }],
        isError: true,
      }
    }

    // Validate enabled parameter if provided (optional)
    if (args.enabled !== undefined && typeof args.enabled !== "boolean") {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "enabled must be a boolean if provided" }) }],
        isError: true,
      }
    }

    const serverName = args.serverName

    const config = configStore.get()
    const mcpConfig = config.mcpConfig || { mcpServers: {} }

    // Check if server exists
    if (!mcpConfig.mcpServers[serverName]) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: `Server '${serverName}' not found. Available servers: ${Object.keys(mcpConfig.mcpServers).join(", ") || "none"}`,
            }),
          },
        ],
        isError: true,
      }
    }

    // Update runtime disabled servers list
    const runtimeDisabled = new Set(config.mcpRuntimeDisabledServers || [])

    // Check if the server is disabled at the config level (in mcp.json)
    const configDisabled = mcpConfig.mcpServers[serverName].disabled === true

    // Determine the new enabled state: use provided value or toggle current state
    const isCurrentlyRuntimeDisabled = runtimeDisabled.has(serverName)
    const isCurrentlyDisabled = isCurrentlyRuntimeDisabled || configDisabled
    const enabled = typeof args.enabled === "boolean" ? args.enabled : isCurrentlyDisabled // toggle to opposite

    if (enabled) {
      runtimeDisabled.delete(serverName)
    } else {
      runtimeDisabled.add(serverName)
    }

    configStore.save({
      ...config,
      mcpRuntimeDisabledServers: Array.from(runtimeDisabled),
    })

    // Calculate the effective enabled state (considering both runtime and config)
    const effectivelyEnabled = enabled && !configDisabled

    // Build a clear message that indicates actual state
    let message = `Server '${serverName}' runtime setting has been ${enabled ? "enabled" : "disabled"}.`
    if (enabled && configDisabled) {
      message += ` Warning: Server is still disabled in config file (disabled: true). Edit mcp.json to fully enable.`
    } else {
      message += ` Restart agent mode or the app for changes to take effect.`
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            serverName,
            enabled,
            configDisabled,
            effectivelyEnabled,
            message,
          }),
        },
      ],
      isError: false,
    }
  },


  list_running_agents: async (): Promise<MCPToolResult> => {
    const activeSessions = agentSessionTracker.getActiveSessions()

    if (activeSessions.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              agents: [],
              count: 0,
              message: "No agents currently running",
            }, null, 2),
          },
        ],
        isError: false,
      }
    }

    const agents = activeSessions.map((session) => ({
      sessionId: session.id,
      conversationId: session.conversationId,
      title: session.conversationTitle,
      status: session.status,
      currentIteration: session.currentIteration,
      maxIterations: session.maxIterations,
      lastActivity: session.lastActivity,
      startTime: session.startTime,
      isSnoozed: session.isSnoozed,
      // Calculate runtime in seconds
      runtimeSeconds: Math.floor((Date.now() - session.startTime) / 1000),
    }))

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            agents,
            count: agents.length,
          }, null, 2),
        },
      ],
      isError: false,
    }
  },

  send_agent_message: async (args: Record<string, unknown>): Promise<MCPToolResult> => {
    // Validate required parameters with proper type guards
    if (!args.sessionId || typeof args.sessionId !== "string") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: "sessionId is required and must be a string",
            }),
          },
        ],
        isError: true,
      }
    }

    if (!args.message || typeof args.message !== "string") {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: "message is required and must be a string",
            }),
          },
        ],
        isError: true,
      }
    }

    const sessionId = args.sessionId
    const message = args.message

    // Get target session
    const session = agentSessionTracker.getSession(sessionId)
    if (!session) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: `Agent session not found: ${sessionId}`,
            }),
          },
        ],
        isError: true,
      }
    }

    // Must have a conversation to queue message
    if (!session.conversationId) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: "Target agent session has no linked conversation",
            }),
          },
        ],
        isError: true,
      }
    }

    // Queue message for the target agent's conversation
    const queuedMessage = messageQueueService.enqueue(session.conversationId, message)

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            sessionId,
            conversationId: session.conversationId,
            queuedMessageId: queuedMessage.id,
            message: `Message queued for agent session ${sessionId} (${session.conversationTitle})`,
          }, null, 2),
        },
      ],
      isError: false,
    }
  },

  kill_agent: async (args: Record<string, unknown>): Promise<MCPToolResult> => {
    const sessionId = args.sessionId as string

    if (!sessionId) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: "sessionId is required",
            }),
          },
        ],
        isError: true,
      }
    }

    // Check if session exists
    const session = agentSessionTracker.getSession(sessionId)
    if (!session) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: `Agent session not found: ${sessionId}`,
            }),
          },
        ],
        isError: true,
      }
    }

    // Stop the session in the state manager (aborts LLM requests, kills processes)
    agentSessionStateManager.stopSession(sessionId)

    // Cancel any pending tool approvals for this session so executeToolCall doesn't hang
    toolApprovalManager.cancelSessionApprovals(sessionId)

    // Mark the session as stopped in the tracker
    agentSessionTracker.stopSession(sessionId)

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            sessionId,
            message: `Agent session ${sessionId} (${session.conversationTitle}) has been terminated`,
          }, null, 2),
        },
      ],
      isError: false,
    }
  },

  kill_all_agents: async (): Promise<MCPToolResult> => {
    const activeSessions = agentSessionTracker.getActiveSessions()
    const sessionCount = activeSessions.length

    if (sessionCount === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              message: "No agents were running",
              sessionsTerminated: 0,
              processesKilled: 0,
            }, null, 2),
          },
        ],
        isError: false,
      }
    }

    // Cancel any pending tool approvals to prevent sessions from hanging
    toolApprovalManager.cancelAllApprovals()

    // Perform emergency stop
    const { before, after } = await emergencyStopAll()

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            message: `Emergency stop completed: ${sessionCount} agent session(s) terminated`,
            sessionsTerminated: sessionCount,
            processesKilled: before - after,
            processesBeforeStop: before,
            processesAfterStop: after,
          }, null, 2),
        },
      ],
      isError: false,
    }
  },

  get_settings: async (): Promise<MCPToolResult> => {
    const config = configStore.get()

    // Post-processing requires both the toggle AND a prompt to be set
    const postProcessingEnabled = config.transcriptPostProcessingEnabled ?? false
    const postProcessingPromptConfigured = !!(config.transcriptPostProcessingPrompt?.trim())
    const postProcessingEffective = postProcessingEnabled && postProcessingPromptConfigured

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            postProcessingEnabled: postProcessingEnabled,
            postProcessingPromptConfigured: postProcessingPromptConfigured,
            postProcessingEffective: postProcessingEffective,
            ttsEnabled: config.ttsEnabled ?? true,
            toolApprovalEnabled: config.mcpRequireApprovalBeforeToolCall ?? false,
            verificationEnabled: config.mcpVerifyCompletionEnabled ?? true,
            messageQueueEnabled: config.mcpMessageQueueEnabled ?? true,
            parallelToolExecutionEnabled: config.mcpParallelToolExecution ?? true,
            whatsappEnabled: config.whatsappEnabled ?? false,
            descriptions: {
              postProcessingEnabled: "When enabled AND a prompt is configured, transcripts are cleaned up and improved using AI",
              postProcessingPromptConfigured: "Whether a post-processing prompt has been configured in settings",
              postProcessingEffective: "True only when post-processing is both enabled AND a prompt is configured",
              ttsEnabled: "When enabled, assistant responses are read aloud",
              toolApprovalEnabled: "When enabled, a confirmation dialog appears before any tool executes (affects new sessions only)",
              verificationEnabled: "When enabled, the agent verifies task completion before finishing. Disable for faster responses without verification",
              messageQueueEnabled: "When enabled, users can queue messages while the agent is processing",
              parallelToolExecutionEnabled: "When enabled, multiple tool calls from a single LLM response are executed concurrently",
              whatsappEnabled: "When enabled, allows sending and receiving WhatsApp messages through SpeakMCP",
            },
          }, null, 2),
        },
      ],
      isError: false,
    }
  },

  toggle_post_processing: async (args: Record<string, unknown>): Promise<MCPToolResult> => {
    const config = configStore.get()
    const currentValue = config.transcriptPostProcessingEnabled ?? false

    // Validate enabled parameter if provided (optional)
    if (args.enabled !== undefined && typeof args.enabled !== "boolean") {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "enabled must be a boolean if provided" }) }],
        isError: true,
      }
    }

    // Determine new value: use provided value or toggle
    const enabled = typeof args.enabled === "boolean" ? args.enabled : !currentValue

    configStore.save({
      ...config,
      transcriptPostProcessingEnabled: enabled,
    })

    // Check if prompt is configured
    const promptConfigured = !!(config.transcriptPostProcessingPrompt?.trim())
    let message = `Post-processing has been ${enabled ? "enabled" : "disabled"}.`
    if (enabled && !promptConfigured) {
      message += " Note: A post-processing prompt must also be configured in settings for this feature to take effect."
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            setting: "postProcessingEnabled",
            previousValue: currentValue,
            newValue: enabled,
            promptConfigured: promptConfigured,
            effectivelyActive: enabled && promptConfigured,
            message: message,
          }, null, 2),
        },
      ],
      isError: false,
    }
  },

  toggle_tts: async (args: Record<string, unknown>): Promise<MCPToolResult> => {
    const config = configStore.get()
    const currentValue = config.ttsEnabled ?? true

    // Validate enabled parameter if provided (optional)
    if (args.enabled !== undefined && typeof args.enabled !== "boolean") {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "enabled must be a boolean if provided" }) }],
        isError: true,
      }
    }

    // Determine new value: use provided value or toggle
    const enabled = typeof args.enabled === "boolean" ? args.enabled : !currentValue

    configStore.save({
      ...config,
      ttsEnabled: enabled,
    })

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            setting: "ttsEnabled",
            previousValue: currentValue,
            newValue: enabled,
            message: `Text-to-speech has been ${enabled ? "enabled" : "disabled"}`,
          }, null, 2),
        },
      ],
      isError: false,
    }
  },

  toggle_tool_approval: async (args: Record<string, unknown>): Promise<MCPToolResult> => {
    const config = configStore.get()
    const currentValue = config.mcpRequireApprovalBeforeToolCall ?? false

    // Validate enabled parameter if provided (optional)
    if (args.enabled !== undefined && typeof args.enabled !== "boolean") {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "enabled must be a boolean if provided" }) }],
        isError: true,
      }
    }

    // Determine new value: use provided value or toggle
    const enabled = typeof args.enabled === "boolean" ? args.enabled : !currentValue

    configStore.save({
      ...config,
      mcpRequireApprovalBeforeToolCall: enabled,
    })

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            setting: "toolApprovalEnabled",
            previousValue: currentValue,
            newValue: enabled,
            message: `Tool approval has been ${enabled ? "enabled" : "disabled"}. Note: This change takes effect for new agent sessions only; currently running sessions are not affected.`,
          }, null, 2),
        },
      ],
      isError: false,
    }
  },

  toggle_verification: async (args: Record<string, unknown>): Promise<MCPToolResult> => {
    const config = configStore.get()
    const currentValue = config.mcpVerifyCompletionEnabled ?? true

    // Validate enabled parameter if provided (optional)
    if (args.enabled !== undefined && typeof args.enabled !== "boolean") {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "enabled must be a boolean if provided" }) }],
        isError: true,
      }
    }

    // Determine new value: use provided value or toggle
    const enabled = typeof args.enabled === "boolean" ? args.enabled : !currentValue

    configStore.save({
      ...config,
      mcpVerifyCompletionEnabled: enabled,
    })

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            setting: "verificationEnabled",
            previousValue: currentValue,
            newValue: enabled,
            message: `Task completion verification has been ${enabled ? "enabled" : "disabled"}. ${enabled ? "The agent will verify task completion before finishing." : "The agent will respond faster without verification."} Note: This change takes effect for new agent sessions only; currently running sessions are not affected.`,
          }, null, 2),
        },
      ],
      isError: false,
    }
  },

  respond_to_user: async (args: Record<string, unknown>, context: BuiltinToolContext): Promise<MCPToolResult> => {
    if (typeof args.text !== "string" || args.text.trim() === "") {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "text must be a non-empty string" }) }],
        isError: true,
      }
    }

    if (!context.sessionId) {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "respond_to_user requires an active agent session" }) }],
        isError: true,
      }
    }

    const text = args.text.trim()
    setSessionUserResponse(context.sessionId, text)

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            message: "Response recorded for delivery to user.",
            textLength: text.length,
          }, null, 2),
        },
      ],
      isError: false,
    }
  },

  // Backward compatibility alias for speak_to_user (deprecated, use respond_to_user instead)
  speak_to_user: async (args: Record<string, unknown>, context: BuiltinToolContext): Promise<MCPToolResult> => {
    // Delegate to respond_to_user with the same args and context
    return toolHandlers.respond_to_user(args, context)
  },

  mark_work_complete: async (args: Record<string, unknown>): Promise<MCPToolResult> => {
    if (typeof args.summary !== "string" || args.summary.trim() === "") {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "summary must be a non-empty string" }) }],
        isError: true,
      }
    }

    if (args.confidence !== undefined && (typeof args.confidence !== "number" || Number.isNaN(args.confidence))) {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "confidence must be a number if provided" }) }],
        isError: true,
      }
    }

    const summary = args.summary.trim()
    const confidence = typeof args.confidence === "number"
      ? Math.max(0, Math.min(1, args.confidence))
      : undefined

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            markedComplete: true,
            summary,
            confidence,
            message: "Completion signal recorded. Provide the final user-facing response next.",
          }, null, 2),
        },
      ],
      isError: false,
    }
  },

  toggle_whatsapp: async (args: Record<string, unknown>): Promise<MCPToolResult> => {
    const config = configStore.get()
    const currentValue = config.whatsappEnabled ?? false

    // Validate enabled parameter if provided (optional)
    if (args.enabled !== undefined && typeof args.enabled !== "boolean") {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "enabled must be a boolean if provided" }) }],
        isError: true,
      }
    }

    // Determine new value: use provided value or toggle
    const enabled = typeof args.enabled === "boolean" ? args.enabled : !currentValue

    configStore.save({
      ...config,
      whatsappEnabled: enabled,
    })

    // Trigger WhatsApp MCP server lifecycle changes
    try {
      await handleWhatsAppToggle(currentValue, enabled)
    } catch (_e) {
      // lifecycle is best-effort
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            setting: "whatsappEnabled",
            previousValue: currentValue,
            newValue: enabled,
            message: `WhatsApp integration has been ${enabled ? "enabled" : "disabled"}.`,
          }, null, 2),
        },
      ],
      isError: false,
    }
  },

  execute_command: async (args: Record<string, unknown>): Promise<MCPToolResult> => {
    const { skillsService } = await import("./skills-service")

    // Validate required command parameter
    if (!args.command || typeof args.command !== "string") {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "command parameter is required and must be a string" }) }],
        isError: true,
      }
    }

    const command = args.command as string
    const skillId = args.skillId as string | undefined
    // Validate timeout: must be a finite non-negative number, otherwise use default
    // This prevents NaN or negative values from disabling the timeout entirely
    const rawTimeout = args.timeout
    const timeout = (typeof rawTimeout === "number" && Number.isFinite(rawTimeout) && rawTimeout >= 0)
      ? rawTimeout
      : 30000

    // Determine the working directory
    let cwd: string | undefined
    let skillName: string | undefined

    if (skillId) {
      // Find the skill and get its directory
      let skill = skillsService.getSkill(skillId)
      if (!skill) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: `Skill not found: ${skillId}` }) }],
          isError: true,
        }
      }

      if (!skill.filePath) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: `Skill has no file path (not imported from disk): ${skill.name}` }) }],
          isError: true,
        }
      }

      // For local files, use the directory containing SKILL.md
      // For GitHub skills, automatically upgrade to local clone
      if (skill.filePath.startsWith("github:")) {
        try {
          // Dynamically import skills-service to avoid circular dependency
          const { skillsService: skillsSvc } = await import("./skills-service")
          skill = await skillsSvc.upgradeGitHubSkillToLocal(skillId)
        } catch (upgradeError) {
          return {
            content: [{ type: "text", text: JSON.stringify({ success: false, error: `Failed to upgrade GitHub skill to local: ${upgradeError instanceof Error ? upgradeError.message : String(upgradeError)}` }) }],
            isError: true,
          }
        }
      }

      cwd = path.dirname(skill.filePath!)
      skillName = skill.name
    }

    try {
      const execOptions: { cwd?: string; timeout?: number; maxBuffer?: number; shell?: string } = {
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
        shell: process.platform === "win32" ? "cmd.exe" : "/bin/bash",
      }

      if (cwd) {
        execOptions.cwd = cwd
      }

      if (timeout > 0) {
        execOptions.timeout = timeout
      }

      const { stdout, stderr } = await execAsync(command, execOptions)

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              command,
              cwd: cwd || process.cwd(),
              skillName,
              stdout: stdout || "",
              stderr: stderr || "",
            }, null, 2),
          },
        ],
        isError: false,
      }
    } catch (error: any) {
      // exec errors include stdout/stderr in the error object
      const stdout = error.stdout || ""
      const stderr = error.stderr || ""
      const errorMessage = error.message || String(error)
      const exitCode = error.code

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              command,
              cwd: cwd || process.cwd(),
              skillName,
              error: errorMessage,
              exitCode,
              stdout,
              stderr,
            }, null, 2),
          },
        ],
        isError: true,
      }
    }
  },

  save_memory: async (args: Record<string, unknown>, context: BuiltinToolContext): Promise<MCPToolResult> => {
    // Check if memories are enabled
    if (!isMemoryEnabledForContext(context)) {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "Memory system disabled" }) }],
        isError: true,
      }
    }

    if (typeof args.content !== "string" || args.content.trim() === "") {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "content required" }) }],
        isError: true,
      }
    }

    const content = args.content.trim().replace(/[\r\n]+/g, ' ').slice(0, 80) // Max 80 chars, single line
    const importance = (["low", "medium", "high", "critical"].includes(args.importance as string)
      ? args.importance
      : "medium") as "low" | "medium" | "high" | "critical"

    const now = Date.now()
    const memory: AgentMemory = {
      id: `memory_${now}_${Math.random().toString(36).substr(2, 9)}`,
      profileId: undefined,
      createdAt: now,
      updatedAt: now,
      title: content.slice(0, 50),
      content,
      tags: [],
      importance,
    }

    try {
      const success = await memoryService.saveMemory(memory)
      if (success) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: true, id: memory.id, content: memory.content }) }],
          isError: false,
        }
      } else {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: "Failed to save" }) }],
          isError: true,
        }
      }
    } catch (error) {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: String(error) }) }],
        isError: true,
      }
    }
  },

  list_memories: async (_args: Record<string, unknown>, context: BuiltinToolContext): Promise<MCPToolResult> => {
    if (!isMemoryEnabledForContext(context)) {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "Memory system disabled" }) }],
        isError: true,
      }
    }

    try {
      const memories = await memoryService.getAllMemories()

      const list = memories.map(m => ({ id: m.id, content: m.content, importance: m.importance }))
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, count: list.length, memories: list }) }],
        isError: false,
      }
    } catch (error) {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: String(error) }) }],
        isError: true,
      }
    }
  },

  delete_memory: async (args: Record<string, unknown>, context: BuiltinToolContext): Promise<MCPToolResult> => {
    if (!isMemoryEnabledForContext(context)) {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "Memory system disabled" }) }],
        isError: true,
      }
    }

    if (typeof args.memoryId !== "string" || args.memoryId.trim() === "") {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "memoryId required" }) }],
        isError: true,
      }
    }

    const memoryId = args.memoryId.trim()

    try {
      const success = await memoryService.deleteMemory(memoryId)
      return {
        content: [{ type: "text", text: JSON.stringify({ success, deleted: memoryId }) }],
        isError: !success,
      }
    } catch (error) {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: String(error) }) }],
        isError: true,
      }
    }
  },

  delete_multiple_memories: async (args: Record<string, unknown>, context: BuiltinToolContext): Promise<MCPToolResult> => {
    if (!isMemoryEnabledForContext(context)) {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "Memory system disabled" }) }],
        isError: true,
      }
    }

    if (!Array.isArray(args.memoryIds) || args.memoryIds.length === 0) {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "memoryIds must be a non-empty array of strings" }) }],
        isError: true,
      }
    }

    // Validate all IDs are strings, tracking ignored entries
    const memoryIds: string[] = []
    const ignoredIds: unknown[] = []
    for (const id of args.memoryIds) {
      if (typeof id === "string" && id.trim() !== "") {
        memoryIds.push(id)
      } else {
        ignoredIds.push(id)
      }
    }
    if (memoryIds.length === 0) {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "memoryIds must contain valid string IDs" }) }],
        isError: true,
      }
    }

    try {
      const result = await memoryService.deleteMultipleMemories(memoryIds)
      if (result.error) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: result.error }) }],
          isError: true,
        }
      }
      const response: { success: true; deletedCount: number; requestedCount: number; ignoredIds?: unknown[] } = {
        success: true,
        deletedCount: result.deletedCount,
        requestedCount: args.memoryIds.length,
      }
      if (ignoredIds.length > 0) {
        response.ignoredIds = ignoredIds
      }
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
        isError: false,
      }
    } catch (error) {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: String(error) }) }],
        isError: true,
      }
    }
  },

  delete_all_memories: async (args: Record<string, unknown>, context: BuiltinToolContext): Promise<MCPToolResult> => {
    if (!isMemoryEnabledForContext(context)) {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "Memory system disabled" }) }],
        isError: true,
      }
    }

    // Require explicit confirmation
    if (args.confirm !== true) {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "Must set confirm: true to delete all memories" }) }],
        isError: true,
      }
    }

    try {
      const result = await memoryService.deleteAllMemories()
      if (result.error) {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: result.error }) }],
          isError: true,
        }
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ success: true, deletedCount: result.deletedCount, message: "All memories deleted for current profile" }) }],
        isError: false,
      }
    } catch (error) {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: String(error) }) }],
        isError: true,
      }
    }
  },

  list_server_tools: async (args: Record<string, unknown>): Promise<MCPToolResult> => {
    // Validate serverName parameter
    if (typeof args.serverName !== "string" || args.serverName.trim() === "") {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "serverName must be a non-empty string" }) }],
        isError: true,
      }
    }

    const serverName = args.serverName.trim()
    const allTools = mcpService.getAvailableTools()

    // Filter tools by server name
    const serverTools = allTools.filter((tool) => {
      const toolServerName = tool.name.includes(":") ? tool.name.split(":")[0] : "unknown"
      return toolServerName === serverName
    })

    if (serverTools.length === 0) {
      // Check if the server exists but has no tools
      const serverStatus = mcpService.getServerStatus()
      if (serverStatus[serverName]) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              serverName,
              connected: serverStatus[serverName].connected,
              tools: [],
              count: 0,
              message: serverStatus[serverName].connected
                ? "Server is connected but has no tools available"
                : "Server is not connected",
            }, null, 2),
          }],
          isError: false,
        }
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            error: `Server '${serverName}' not found. Use speakmcp-settings:list_mcp_servers to see available servers.`,
          }, null, 2),
        }],
        isError: true,
      }
    }

    // Return tools with brief descriptions (no full schemas)
    const toolList = serverTools.map((tool) => {
      const toolName = tool.name.includes(":") ? tool.name.split(":")[1] : tool.name
      return {
        name: tool.name,
        shortName: toolName,
        description: tool.description,
      }
    })

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          serverName,
          tools: toolList,
          count: toolList.length,
          hint: "Use speakmcp-settings:get_tool_schema to get full parameter details for a specific tool",
        }, null, 2),
      }],
      isError: false,
    }
  },

  get_tool_schema: async (args: Record<string, unknown>): Promise<MCPToolResult> => {
    // Validate toolName parameter
    if (typeof args.toolName !== "string" || args.toolName.trim() === "") {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "toolName must be a non-empty string" }) }],
        isError: true,
      }
    }

    const toolName = args.toolName.trim()
    const allTools = mcpService.getAvailableTools()

    // Find the tool (try exact match first, then partial match)
    let tool = allTools.find((t) => t.name === toolName)

    // If not found, try matching just the tool name part (without server prefix)
    if (!tool && !toolName.includes(":")) {
      // Find ALL matching tools to detect ambiguity
      const matchingTools = allTools.filter((t) => {
        const shortName = t.name.includes(":") ? t.name.split(":")[1] : t.name
        return shortName === toolName
      })

      if (matchingTools.length > 1) {
        // Ambiguous match - multiple servers have a tool with this name
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              error: `Ambiguous tool name '${toolName}' - found in multiple servers. Please use the fully-qualified name.`,
              matchingTools: matchingTools.map((t) => t.name),
              hint: "Use one of the fully-qualified tool names listed above (e.g., 'server:tool_name')",
            }, null, 2),
          }],
          isError: true,
        }
      }

      // Single match - use it
      tool = matchingTools[0]
    }

    if (!tool) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            error: `Tool '${toolName}' not found. Use speakmcp-settings:list_server_tools to see available tools for a server.`,
            availableTools: allTools.slice(0, 10).map((t) => t.name),
            hint: allTools.length > 10 ? `...and ${allTools.length - 10} more tools` : undefined,
          }, null, 2),
        }],
        isError: true,
      }
    }

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        }, null, 2),
      }],
      isError: false,
    }
  },

  load_skill_instructions: async (args: Record<string, unknown>): Promise<MCPToolResult> => {
    // Validate skillId parameter
    if (typeof args.skillId !== "string" || args.skillId.trim() === "") {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "skillId must be a non-empty string" }) }],
        isError: true,
      }
    }

    const skillId = args.skillId.trim()
    const { skillsService } = await import("./skills-service")
    const skill = skillsService.getSkill(skillId)

    if (!skill) {
      // Try to find by name as fallback
      const allSkills = skillsService.getSkills()
      const skillByName = allSkills.find(s => s.name.toLowerCase() === skillId.toLowerCase())

      if (skillByName) {
        return {
          content: [{
            type: "text",
            text: `# ${skillByName.name}\n\n${skillByName.instructions}`,
          }],
          isError: false,
        }
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            error: `Skill '${skillId}' not found. Check the Available Skills section in the system prompt for valid skill IDs.`,
          }),
        }],
        isError: true,
      }
    }

    return {
      content: [{
        type: "text",
        text: `# ${skill.name}\n\n${skill.instructions}`,
      }],
      isError: false,
    }
  },
}

/**
 * Execute a built-in tool by name
 * @param toolName The full tool name (e.g., "speakmcp-settings:list_mcp_servers")
 * @param args The tool arguments
 * @param sessionId Optional session ID for ACP router tools
 * @returns The tool result
 */
export async function executeBuiltinTool(
  toolName: string,
  args: Record<string, unknown>,
  sessionId?: string
): Promise<MCPToolResult | null> {
  // Check for ACP router tools first
  if (isACPRouterTool(toolName)) {
    const result = await executeACPRouterTool(toolName, args, sessionId)
    return {
      content: [{ type: "text", text: result.content }],
      isError: result.isError
    }
  }

  // Check if this is a built-in tool
  if (!toolName.startsWith(`${BUILTIN_SERVER_NAME}:`)) {
    return null
  }

  // Extract the actual tool name
  const actualToolName = toolName.substring(BUILTIN_SERVER_NAME.length + 1)

  // Find and execute the handler
  const handler = toolHandlers[actualToolName]
  if (!handler) {
    return {
      content: [
        {
          type: "text",
          text: `Unknown built-in tool: ${actualToolName}`,
        },
      ],
      isError: true,
    }
  }

  try {
    return await handler(args, { sessionId })
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error executing built-in tool: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    }
  }
}

/**
 * Check if a tool name is a built-in tool
 * This includes both speakmcp-settings tools and ACP router tools (speakmcp-builtin)
 */
export function isBuiltinTool(toolName: string): boolean {
  return toolName.startsWith(`${BUILTIN_SERVER_NAME}:`) || isACPRouterTool(toolName)
}
