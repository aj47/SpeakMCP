/**
 * ACP (Agent Communication Protocol) Module
 *
 * This module provides the infrastructure for delegating tasks to external AI agents
 * via the Agent Communication Protocol (Zed ACP) for user-to-agent interaction.
 * 
 * For agent-to-agent communication, see the A2A module (../a2a).
 * 
 * Architecture:
 * - ACP (this module): User-facing agent interaction (Zed ACP protocol)
 * - A2A (../a2a): Backend agent-to-agent delegation (Google A2A protocol)
 */

// Re-export all types
export * from './types'

// Re-export named exports from each module
export { acpRegistry, ACPRegistry, configToDefinition } from './acp-registry'
export { acpClientService, ACPClientService } from './acp-client-service'
export { acpProcessManager, ACPProcessManager } from './acp-process-manager'
export { 
  acpRouterToolDefinitions, 
  toolNameAliases, 
  resolveToolName, 
  isRouterTool 
} from './acp-router-tool-definitions'
export {
  executeACPRouterTool,
  isACPRouterTool,
  getDelegatedRunsForSession,
  getDelegatedRunDetails,
  getAllDelegationsForSession,
  cleanupOldDelegatedRuns
} from './acp-router-tools'
export { acpSmartRouter, ACPSmartRouter, type UnifiedAgent, type RoutingDecision } from './acp-smart-router'
export { acpBackgroundNotifier, ACPBackgroundNotifier } from './acp-background-notifier'
