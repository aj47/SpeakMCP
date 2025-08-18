import { mcpService } from "./mcp-service"
import { configStore } from "./config"
import { isDebugTools, logTools } from "./debug"

/**
 * Voice command patterns for MCP toggle functionality
 */
const MCP_TOGGLE_PATTERNS = [
  // Global MCP toggle
  /^(toggle|switch|turn\s+(on|off))\s+mcp(\s+tools?)?$/i,
  /^(enable|disable)\s+mcp(\s+tools?)?$/i,
  /^mcp\s+(on|off|enable|disable)$/i,
  
  // Server-specific commands
  /^(start|stop|restart)\s+mcp\s+server\s+(.+)$/i,
  /^(enable|disable)\s+mcp\s+server\s+(.+)$/i,
  /^mcp\s+server\s+(.+)\s+(on|off|start|stop|enable|disable)$/i,
  
  // Profile switching
  /^switch\s+to\s+mcp\s+profile\s+(.+)$/i,
  /^load\s+mcp\s+profile\s+(.+)$/i,
  /^use\s+mcp\s+profile\s+(.+)$/i,
  
  // Status queries
  /^(show|get|check)\s+mcp\s+status$/i,
  /^what\s+mcp\s+(servers?|tools?)\s+are\s+(running|active|enabled)$/i,
  /^list\s+mcp\s+(servers?|tools?)$/i,
]

/**
 * Result of processing a voice command
 */
export interface VoiceCommandResult {
  handled: boolean
  response?: string
  shouldContinueProcessing?: boolean
}

/**
 * Process transcript to check for MCP toggle commands
 */
export async function processMcpVoiceCommand(transcript: string): Promise<VoiceCommandResult> {
  const trimmedTranscript = transcript.trim()
  
  if (isDebugTools()) {
    logTools("Processing potential MCP voice command:", trimmedTranscript)
  }

  // Check each pattern
  for (const pattern of MCP_TOGGLE_PATTERNS) {
    const match = trimmedTranscript.match(pattern)
    if (match) {
      if (isDebugTools()) {
        logTools("Matched MCP voice command pattern:", pattern, match)
      }
      
      return await handleMcpVoiceCommand(match, trimmedTranscript)
    }
  }

  return { handled: false, shouldContinueProcessing: true }
}

/**
 * Handle a matched MCP voice command
 */
async function handleMcpVoiceCommand(match: RegExpMatchArray, originalTranscript: string): Promise<VoiceCommandResult> {
  try {
    const fullMatch = match[0].toLowerCase()
    
    // Global MCP toggle commands
    if (fullMatch.includes("toggle mcp") || fullMatch.includes("switch mcp")) {
      return await handleGlobalMcpToggle()
    }
    
    if (fullMatch.includes("enable mcp") || fullMatch.includes("mcp on")) {
      return await handleGlobalMcpEnable()
    }
    
    if (fullMatch.includes("disable mcp") || fullMatch.includes("mcp off")) {
      return await handleGlobalMcpDisable()
    }
    
    // Server-specific commands
    if (fullMatch.includes("server")) {
      return await handleServerCommand(match)
    }
    
    // Profile commands
    if (fullMatch.includes("profile")) {
      return await handleProfileCommand(match)
    }
    
    // Status commands
    if (fullMatch.includes("status") || fullMatch.includes("list") || fullMatch.includes("show") || fullMatch.includes("what")) {
      return await handleStatusCommand()
    }
    
    return { handled: false, shouldContinueProcessing: true }
    
  } catch (error) {
    if (isDebugTools()) {
      logTools("Error handling MCP voice command:", error)
    }
    
    return {
      handled: true,
      response: `Error processing MCP command: ${error instanceof Error ? error.message : String(error)}`,
      shouldContinueProcessing: false
    }
  }
}

/**
 * Handle global MCP toggle
 */
async function handleGlobalMcpToggle(): Promise<VoiceCommandResult> {
  const config = configStore.get()
  const newState = !config.mcpToolsEnabled
  
  // Update config
  configStore.save({
    ...config,
    mcpToolsEnabled: newState
  })
  
  if (newState) {
    // Enable MCP and initialize servers
    await mcpService.initialize()
    return {
      handled: true,
      response: "MCP tools have been enabled and servers are starting up.",
      shouldContinueProcessing: false
    }
  } else {
    // Disable MCP and stop all servers
    await mcpService.stopAllServers()
    return {
      handled: true,
      response: "MCP tools have been disabled and all servers have been stopped.",
      shouldContinueProcessing: false
    }
  }
}

/**
 * Handle global MCP enable
 */
async function handleGlobalMcpEnable(): Promise<VoiceCommandResult> {
  const config = configStore.get()
  
  if (config.mcpToolsEnabled) {
    return {
      handled: true,
      response: "MCP tools are already enabled.",
      shouldContinueProcessing: false
    }
  }
  
  // Enable MCP
  configStore.save({
    ...config,
    mcpToolsEnabled: true
  })
  
  await mcpService.initialize()
  
  return {
    handled: true,
    response: "MCP tools have been enabled and servers are starting up.",
    shouldContinueProcessing: false
  }
}

/**
 * Handle global MCP disable
 */
async function handleGlobalMcpDisable(): Promise<VoiceCommandResult> {
  const config = configStore.get()
  
  if (!config.mcpToolsEnabled) {
    return {
      handled: true,
      response: "MCP tools are already disabled.",
      shouldContinueProcessing: false
    }
  }
  
  // Disable MCP
  configStore.save({
    ...config,
    mcpToolsEnabled: false
  })
  
  await mcpService.stopAllServers()
  
  return {
    handled: true,
    response: "MCP tools have been disabled and all servers have been stopped.",
    shouldContinueProcessing: false
  }
}

/**
 * Handle server-specific commands
 */
async function handleServerCommand(match: RegExpMatchArray): Promise<VoiceCommandResult> {
  // Extract server name and action from the match
  let serverName: string | undefined
  let action: string | undefined
  
  // Try different match patterns
  if (match[2] && match[1]) {
    // Pattern: "(start|stop|restart) mcp server (.+)"
    action = match[1].toLowerCase()
    serverName = match[2].trim()
  } else if (match[1] && match[2]) {
    // Pattern: "(enable|disable) mcp server (.+)"
    action = match[1].toLowerCase()
    serverName = match[2].trim()
  } else if (match[1] && match[2]) {
    // Pattern: "mcp server (.+) (on|off|start|stop|enable|disable)"
    serverName = match[1].trim()
    action = match[2].toLowerCase()
  }
  
  if (!serverName || !action) {
    return {
      handled: true,
      response: "Could not understand the server command. Please specify the server name and action clearly.",
      shouldContinueProcessing: false
    }
  }
  
  // Map actions to enable/disable
  const shouldEnable = ["start", "enable", "on"].includes(action)
  const shouldDisable = ["stop", "disable", "off"].includes(action)
  const shouldRestart = action === "restart"
  
  if (shouldRestart) {
    const result = await mcpService.restartServer(serverName)
    return {
      handled: true,
      response: result.success 
        ? `Server ${serverName} has been restarted.`
        : `Failed to restart server ${serverName}: ${result.error}`,
      shouldContinueProcessing: false
    }
  } else if (shouldEnable) {
    const enableResult = await mcpService.setServerRuntimeEnabled(serverName, true)
    if (enableResult.success) {
      const restartResult = await mcpService.restartServer(serverName)
      return {
        handled: true,
        response: restartResult.success
          ? `Server ${serverName} has been enabled and started.`
          : `Server ${serverName} was enabled but failed to start: ${restartResult.error}`,
        shouldContinueProcessing: false
      }
    } else {
      return {
        handled: true,
        response: `Failed to enable server ${serverName}: ${enableResult.error}`,
        shouldContinueProcessing: false
      }
    }
  } else if (shouldDisable) {
    const disableResult = await mcpService.setServerRuntimeEnabled(serverName, false)
    if (disableResult.success) {
      const stopResult = await mcpService.stopServer(serverName)
      return {
        handled: true,
        response: stopResult.success
          ? `Server ${serverName} has been disabled and stopped.`
          : `Server ${serverName} was disabled but failed to stop cleanly: ${stopResult.error}`,
        shouldContinueProcessing: false
      }
    } else {
      return {
        handled: true,
        response: `Failed to disable server ${serverName}: ${disableResult.error}`,
        shouldContinueProcessing: false
      }
    }
  }
  
  return {
    handled: true,
    response: `Unknown action "${action}" for server ${serverName}.`,
    shouldContinueProcessing: false
  }
}

/**
 * Handle profile commands (placeholder for future implementation)
 */
async function handleProfileCommand(match: RegExpMatchArray): Promise<VoiceCommandResult> {
  return {
    handled: true,
    response: "MCP profile management is not yet implemented. This feature will be available in a future update.",
    shouldContinueProcessing: false
  }
}

/**
 * Handle status commands
 */
async function handleStatusCommand(): Promise<VoiceCommandResult> {
  const config = configStore.get()
  
  if (!config.mcpToolsEnabled) {
    return {
      handled: true,
      response: "MCP tools are currently disabled.",
      shouldContinueProcessing: false
    }
  }
  
  const serverStatus = await mcpService.getServerStatus()
  const serverNames = Object.keys(serverStatus)
  
  if (serverNames.length === 0) {
    return {
      handled: true,
      response: "MCP tools are enabled but no servers are configured.",
      shouldContinueProcessing: false
    }
  }
  
  const connectedServers = serverNames.filter(name => serverStatus[name].connected)
  const disconnectedServers = serverNames.filter(name => !serverStatus[name].connected)
  
  let response = "MCP Status:\n"
  
  if (connectedServers.length > 0) {
    response += `Connected servers: ${connectedServers.join(", ")}\n`
  }
  
  if (disconnectedServers.length > 0) {
    response += `Disconnected servers: ${disconnectedServers.join(", ")}\n`
  }
  
  const totalTools = Object.values(serverStatus).reduce((sum, status) => sum + status.toolCount, 0)
  response += `Total available tools: ${totalTools}`
  
  return {
    handled: true,
    response,
    shouldContinueProcessing: false
  }
}
