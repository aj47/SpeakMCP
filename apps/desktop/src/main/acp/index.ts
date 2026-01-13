/**
 * ACP (Agent Communication Protocol) Module
 *
 * This module provides the infrastructure for delegating tasks to external AI agents
 * via the Agent Communication Protocol (Zed ACP) for user-to-agent interaction.
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
export { acpSmartRouter, ACPSmartRouter } from './acp-smart-router'
export { acpBackgroundNotifier, ACPBackgroundNotifier } from './acp-background-notifier'
