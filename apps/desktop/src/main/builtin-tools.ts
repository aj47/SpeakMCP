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
import { profileService } from "./profile-service"
import { mcpService, type MCPTool, type MCPToolResult, handleWhatsAppToggle } from "./mcp-service"
import { agentSessionTracker } from "./agent-session-tracker"
import { agentSessionStateManager, toolApprovalManager } from "./state"
import { emergencyStopAll } from "./emergency-stop"
import { exec } from "child_process"
import { promisify } from "util"
import path from "path"

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

// Tool execution handlers
type ToolHandler = (args: Record<string, unknown>) => Promise<MCPToolResult>

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

  list_profiles: async (): Promise<MCPToolResult> => {
    const profiles = profileService.getProfiles()
    const currentProfile = profileService.getCurrentProfile()

    const profileList = profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      isActive: profile.id === currentProfile?.id,
      isDefault: profile.isDefault || false,
      guidelinesPreview: profile.guidelines.substring(0, 100) + (profile.guidelines.length > 100 ? "..." : ""),
    }))

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            profiles: profileList,
            currentProfileId: currentProfile?.id,
            count: profileList.length,
          }, null, 2),
        },
      ],
      isError: false,
    }
  },

  switch_profile: async (args: Record<string, unknown>): Promise<MCPToolResult> => {
    const profileIdOrName = args.profileIdOrName
    if (typeof profileIdOrName !== "string" || profileIdOrName.trim() === "") {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "profileIdOrName must be a non-empty string" }) }],
        isError: true,
      }
    }
    const profiles = profileService.getProfiles()

    // Find profile by ID or name (case-insensitive for name)
    const profile = profiles.find(
      (p) => p.id === profileIdOrName || p.name.toLowerCase() === profileIdOrName.toLowerCase()
    )

    if (!profile) {
      const availableProfiles = profiles.map((p) => `${p.name} (${p.id})`).join(", ")
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: `Profile '${profileIdOrName}' not found. Available profiles: ${availableProfiles}`,
            }),
          },
        ],
        isError: true,
      }
    }

    // Switch to the profile
    profileService.setCurrentProfile(profile.id)

    // Apply the profile's MCP server configuration
    // If the profile has no mcpServerConfig, we pass empty arrays to reset to default (all enabled)
    const { mcpService } = await import("./mcp-service")
    mcpService.applyProfileMcpConfig(
      profile.mcpServerConfig?.disabledServers ?? [],
      profile.mcpServerConfig?.disabledTools ?? [],
      profile.mcpServerConfig?.allServersDisabledByDefault ?? false,
      profile.mcpServerConfig?.enabledServers ?? []
    )

    // Update config with profile's guidelines, system prompt, and model configuration
    const config = configStore.get()
    const updatedConfig = {
      ...config,
      // Always apply guidelines and profile ID (same as TIPC setCurrentProfile)
      mcpToolsSystemPrompt: profile.guidelines,
      mcpCurrentProfileId: profile.id,
      // Apply custom system prompt if it exists, otherwise clear it to use default
      mcpCustomSystemPrompt: profile.systemPrompt || "",
      // Apply model config if it exists
      ...(profile.modelConfig?.mcpToolsProviderId && {
        mcpToolsProviderId: profile.modelConfig.mcpToolsProviderId,
      }),
      ...(profile.modelConfig?.mcpToolsOpenaiModel && {
        mcpToolsOpenaiModel: profile.modelConfig.mcpToolsOpenaiModel,
      }),
      ...(profile.modelConfig?.mcpToolsGroqModel && {
        mcpToolsGroqModel: profile.modelConfig.mcpToolsGroqModel,
      }),
      ...(profile.modelConfig?.mcpToolsGeminiModel && {
        mcpToolsGeminiModel: profile.modelConfig.mcpToolsGeminiModel,
      }),
      ...(profile.modelConfig?.currentModelPresetId && {
        currentModelPresetId: profile.modelConfig.currentModelPresetId,
      }),
      // STT Provider settings
      ...(profile.modelConfig?.sttProviderId && {
        sttProviderId: profile.modelConfig.sttProviderId,
      }),
      // Transcript Post-Processing settings
      ...(profile.modelConfig?.transcriptPostProcessingProviderId && {
        transcriptPostProcessingProviderId: profile.modelConfig.transcriptPostProcessingProviderId,
      }),
      ...(profile.modelConfig?.transcriptPostProcessingOpenaiModel && {
        transcriptPostProcessingOpenaiModel: profile.modelConfig.transcriptPostProcessingOpenaiModel,
      }),
      ...(profile.modelConfig?.transcriptPostProcessingGroqModel && {
        transcriptPostProcessingGroqModel: profile.modelConfig.transcriptPostProcessingGroqModel,
      }),
      ...(profile.modelConfig?.transcriptPostProcessingGeminiModel && {
        transcriptPostProcessingGeminiModel: profile.modelConfig.transcriptPostProcessingGeminiModel,
      }),
      // TTS Provider settings
      ...(profile.modelConfig?.ttsProviderId && {
        ttsProviderId: profile.modelConfig.ttsProviderId,
      }),
    }
    configStore.save(updatedConfig)

    const mcpConfigApplied = !!profile.mcpServerConfig
    const modelConfigApplied = !!profile.modelConfig
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            profile: {
              id: profile.id,
              name: profile.name,
              guidelines: profile.guidelines,
              mcpConfigApplied,
              disabledServers: profile.mcpServerConfig?.disabledServers || [],
              disabledTools: profile.mcpServerConfig?.disabledTools || [],
              modelConfigApplied,
              modelConfig: profile.modelConfig || null,
            },
            message: `Switched to profile '${profile.name}'${[mcpConfigApplied && 'MCP', modelConfigApplied && 'model'].filter(Boolean).length > 0 ? ' with ' + [mcpConfigApplied && 'MCP', modelConfigApplied && 'model'].filter(Boolean).join(' and ') + ' configuration' : ''}`,
          }, null, 2),
        },
      ],
      isError: false,
    }
  },

  get_current_profile: async (): Promise<MCPToolResult> => {
    const currentProfile = profileService.getCurrentProfile()

    if (!currentProfile) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: "No current profile found",
            }),
          },
        ],
        isError: true,
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            profile: {
              id: currentProfile.id,
              name: currentProfile.name,
              guidelines: currentProfile.guidelines,
              isDefault: currentProfile.isDefault || false,
              createdAt: currentProfile.createdAt,
              updatedAt: currentProfile.updatedAt,
            },
          }, null, 2),
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

  create_profile: async (args: Record<string, unknown>): Promise<MCPToolResult> => {
    // Validate required parameters
    if (typeof args.name !== "string" || args.name.trim() === "") {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "name must be a non-empty string" }) }],
        isError: true,
      }
    }

    if (typeof args.guidelines !== "string") {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "guidelines must be a string" }) }],
        isError: true,
      }
    }

    // Validate optional systemPrompt
    if (args.systemPrompt !== undefined && typeof args.systemPrompt !== "string") {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "systemPrompt must be a string if provided" }) }],
        isError: true,
      }
    }

    const name = args.name.trim()
    const guidelines = args.guidelines
    const systemPrompt = args.systemPrompt as string | undefined

    // Check if a profile with the same name already exists (case-insensitive)
    const profiles = profileService.getProfiles()
    const existingProfile = profiles.find((p) => p.name.toLowerCase() === name.toLowerCase())
    if (existingProfile) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: `A profile named '${name}' already exists. Profile names must be unique (case-insensitive).`,
            }),
          },
        ],
        isError: true,
      }
    }

    try {
      const profile = profileService.createProfile(name, guidelines, systemPrompt)

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              profile: {
                id: profile.id,
                name: profile.name,
                guidelines: profile.guidelines,
                systemPrompt: profile.systemPrompt,
                createdAt: profile.createdAt,
              },
              message: `Profile '${profile.name}' created successfully. All MCP servers are disabled by default - use switch_profile to activate it.`,
            }, null, 2),
          },
        ],
        isError: false,
      }
    } catch (error) {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }) }],
        isError: true,
      }
    }
  },

  update_profile: async (args: Record<string, unknown>): Promise<MCPToolResult> => {
    // Validate required parameter
    if (typeof args.profileIdOrName !== "string" || args.profileIdOrName.trim() === "") {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "profileIdOrName must be a non-empty string" }) }],
        isError: true,
      }
    }

    // Validate optional parameters
    if (args.name !== undefined && typeof args.name !== "string") {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "name must be a string if provided" }) }],
        isError: true,
      }
    }

    if (args.guidelines !== undefined && typeof args.guidelines !== "string") {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "guidelines must be a string if provided" }) }],
        isError: true,
      }
    }

    if (args.systemPrompt !== undefined && typeof args.systemPrompt !== "string") {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "systemPrompt must be a string if provided" }) }],
        isError: true,
      }
    }

    // Check if at least one update field is provided
    if (args.name === undefined && args.guidelines === undefined && args.systemPrompt === undefined) {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "At least one of name, guidelines, or systemPrompt must be provided" }) }],
        isError: true,
      }
    }

    const profileIdOrName = args.profileIdOrName.trim()
    const profiles = profileService.getProfiles()

    // Find profile by ID or name (case-insensitive for name)
    const profile = profiles.find(
      (p) => p.id === profileIdOrName || p.name.toLowerCase() === profileIdOrName.toLowerCase()
    )

    if (!profile) {
      const availableProfiles = profiles.map((p) => `${p.name} (${p.id})`).join(", ")
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: `Profile '${profileIdOrName}' not found. Available profiles: ${availableProfiles}`,
            }),
          },
        ],
        isError: true,
      }
    }

    // Build updates object
    const updates: { name?: string; guidelines?: string; systemPrompt?: string } = {}
    if (args.name !== undefined) {
      const trimmedName = (args.name as string).trim()
      if (trimmedName === "") {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: "name must be a non-empty string" }) }],
          isError: true,
        }
      }
      // Check if the new name conflicts with an existing profile (case-insensitive, excluding current profile)
      const existingProfile = profiles.find(
        (p) => p.id !== profile.id && p.name.toLowerCase() === trimmedName.toLowerCase()
      )
      if (existingProfile) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: false,
                error: `A profile named '${trimmedName}' already exists. Profile names must be unique (case-insensitive).`,
              }),
            },
          ],
          isError: true,
        }
      }
      updates.name = trimmedName
    }
    if (args.guidelines !== undefined) updates.guidelines = args.guidelines as string
    if (args.systemPrompt !== undefined) updates.systemPrompt = args.systemPrompt as string

    try {
      const updatedProfile = profileService.updateProfile(profile.id, updates)

      // If this is the currently active profile, sync live config so changes take effect immediately
      // This mirrors the behavior in switch_profile where configStore is updated with guidelines/systemPrompt
      const currentProfile = profileService.getCurrentProfile()
      if (currentProfile && currentProfile.id === profile.id) {
        const config = configStore.get()
        const updatedConfig = {
          ...config,
          // Only update the fields that were changed
          ...(updates.guidelines !== undefined && { mcpToolsSystemPrompt: updates.guidelines }),
          ...(updates.systemPrompt !== undefined && { mcpCustomSystemPrompt: updates.systemPrompt }),
        }
        configStore.save(updatedConfig)
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              profile: {
                id: updatedProfile.id,
                name: updatedProfile.name,
                guidelines: updatedProfile.guidelines,
                systemPrompt: updatedProfile.systemPrompt,
                updatedAt: updatedProfile.updatedAt,
              },
              updatedFields: Object.keys(updates),
              message: `Profile '${updatedProfile.name}' updated successfully`,
              liveConfigSynced: currentProfile?.id === profile.id,
            }, null, 2),
          },
        ],
        isError: false,
      }
    } catch (error) {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }) }],
        isError: true,
      }
    }
  },

  delete_profile: async (args: Record<string, unknown>): Promise<MCPToolResult> => {
    // Validate required parameter
    if (typeof args.profileIdOrName !== "string" || args.profileIdOrName.trim() === "") {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "profileIdOrName must be a non-empty string" }) }],
        isError: true,
      }
    }

    const profileIdOrName = args.profileIdOrName.trim()
    const profiles = profileService.getProfiles()

    // Find profile by ID or name (case-insensitive for name)
    const profile = profiles.find(
      (p) => p.id === profileIdOrName || p.name.toLowerCase() === profileIdOrName.toLowerCase()
    )

    if (!profile) {
      const availableProfiles = profiles.map((p) => `${p.name} (${p.id})`).join(", ")
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: `Profile '${profileIdOrName}' not found. Available profiles: ${availableProfiles}`,
            }),
          },
        ],
        isError: true,
      }
    }

    // Check if this is the current profile
    const currentProfile = profileService.getCurrentProfile()
    if (currentProfile && currentProfile.id === profile.id) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: `Cannot delete the currently active profile '${profile.name}'. Switch to a different profile first.`,
            }),
          },
        ],
        isError: true,
      }
    }

    try {
      const deleted = profileService.deleteProfile(profile.id)

      if (deleted) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                deletedProfile: {
                  id: profile.id,
                  name: profile.name,
                },
                message: `Profile '${profile.name}' has been deleted`,
              }, null, 2),
            },
          ],
          isError: false,
        }
      } else {
        return {
          content: [{ type: "text", text: JSON.stringify({ success: false, error: "Failed to delete profile" }) }],
          isError: true,
        }
      }
    } catch (error) {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }) }],
        isError: true,
      }
    }
  },

  duplicate_profile: async (args: Record<string, unknown>): Promise<MCPToolResult> => {
    // Validate required parameters
    if (typeof args.sourceProfileIdOrName !== "string" || args.sourceProfileIdOrName.trim() === "") {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "sourceProfileIdOrName must be a non-empty string" }) }],
        isError: true,
      }
    }

    if (typeof args.newName !== "string" || args.newName.trim() === "") {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: "newName must be a non-empty string" }) }],
        isError: true,
      }
    }

    const sourceProfileIdOrName = args.sourceProfileIdOrName.trim()
    const newName = args.newName.trim()
    const profiles = profileService.getProfiles()

    // Find source profile by ID or name (case-insensitive for name)
    const sourceProfile = profiles.find(
      (p) => p.id === sourceProfileIdOrName || p.name.toLowerCase() === sourceProfileIdOrName.toLowerCase()
    )

    if (!sourceProfile) {
      const availableProfiles = profiles.map((p) => `${p.name} (${p.id})`).join(", ")
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: `Source profile '${sourceProfileIdOrName}' not found. Available profiles: ${availableProfiles}`,
            }),
          },
        ],
        isError: true,
      }
    }

    // Check if a profile with newName already exists
    const existingProfile = profiles.find((p) => p.name.toLowerCase() === newName.toLowerCase())
    if (existingProfile) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: `A profile named '${newName}' already exists`,
            }),
          },
        ],
        isError: true,
      }
    }

    try {
      // Create the new profile with same guidelines and systemPrompt
      const newProfile = profileService.createProfile(newName, sourceProfile.guidelines, sourceProfile.systemPrompt)

      // Copy MCP server configuration
      // Note: createProfile() initializes with all servers disabled by default (opt-in mode)
      // If source has explicit mcpServerConfig, copy it directly
      // If source has NO mcpServerConfig (legacy "all enabled" behavior), we need to explicitly
      // set the duplicate to "all enabled" mode to preserve the source behavior
      if (sourceProfile.mcpServerConfig) {
        profileService.updateProfileMcpConfig(newProfile.id, sourceProfile.mcpServerConfig)
      } else {
        // Legacy profile without mcpServerConfig means "all enabled"
        // Override the default opt-in config to enable all servers/tools
        profileService.updateProfileMcpConfig(newProfile.id, {
          disabledServers: [],
          disabledTools: [],
          allServersDisabledByDefault: false,
          enabledServers: [],
        })
      }

      // Copy model configuration if exists
      if (sourceProfile.modelConfig) {
        profileService.updateProfileModelConfig(newProfile.id, sourceProfile.modelConfig)
      }

      // Copy skills configuration if exists
      if (sourceProfile.skillsConfig) {
        profileService.updateProfileSkillsConfig(newProfile.id, sourceProfile.skillsConfig)
      }

      // Get the updated profile with all configurations
      const duplicatedProfile = profileService.getProfile(newProfile.id)!

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              sourceProfile: {
                id: sourceProfile.id,
                name: sourceProfile.name,
              },
              newProfile: {
                id: duplicatedProfile.id,
                name: duplicatedProfile.name,
                guidelines: duplicatedProfile.guidelines,
                systemPrompt: duplicatedProfile.systemPrompt,
                createdAt: duplicatedProfile.createdAt,
                hasMcpConfig: !!duplicatedProfile.mcpServerConfig,
                hasModelConfig: !!duplicatedProfile.modelConfig,
                hasSkillsConfig: !!duplicatedProfile.skillsConfig,
              },
              message: `Profile '${sourceProfile.name}' duplicated as '${duplicatedProfile.name}'`,
            }, null, 2),
          },
        ],
        isError: false,
      }
    } catch (error) {
      return {
        content: [{ type: "text", text: JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }) }],
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
      tool = allTools.find((t) => {
        const shortName = t.name.includes(":") ? t.name.split(":")[1] : t.name
        return shortName === toolName
      })
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
}

/**
 * Execute a built-in tool by name
 * @param toolName The full tool name (e.g., "speakmcp-settings:list_mcp_servers")
 * @param args The tool arguments
 * @returns The tool result
 */
export async function executeBuiltinTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<MCPToolResult | null> {
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
    return await handler(args)
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
 */
export function isBuiltinTool(toolName: string): boolean {
  return toolName.startsWith(`${BUILTIN_SERVER_NAME}:`)
}
