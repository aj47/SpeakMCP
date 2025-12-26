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
export { acpParallelOrchestrator, ACPParallelOrchestrator } from './acp-parallel-orchestrator'
export { acpBackgroundNotifier, ACPBackgroundNotifier } from './acp-background-notifier'

import type { ACPAgentConfig } from './types'
import { acpRegistry } from './acp-registry'
import { acpProcessManager } from './acp-process-manager'
import { acpClientService } from './acp-client-service'
import { acpBackgroundNotifier } from './acp-background-notifier'

/**
 * Initialize the ACP subsystem
 * Call this during app startup to load configured agents
 */
export async function initializeACP(config: { acpAgents?: ACPAgentConfig[] }): Promise<void> {
  if (config.acpAgents && config.acpAgents.length > 0) {
    acpRegistry.loadFromConfig(config.acpAgents)
    console.log(`[ACP] Loaded ${config.acpAgents.length} agent configurations`)

    // Auto-spawn agents that have autoSpawn: true
    for (const agentConfig of config.acpAgents) {
      if (agentConfig.autoSpawn) {
        try {
          await acpProcessManager.spawnAgent(agentConfig.name)
          console.log(`[ACP] Auto-spawned agent: ${agentConfig.name}`)
        } catch (error) {
          console.error(`[ACP] Failed to auto-spawn agent ${agentConfig.name}:`, error)
        }
      }
    }
  }
}

/**
 * Cleanup ACP resources on shutdown
 */
export async function shutdownACP(): Promise<void> {
  console.log('[ACP] Shutting down ACP subsystem...')
  acpBackgroundNotifier.stopPolling()
  await acpProcessManager.stopAllAgents()
  acpClientService.cancelAllRuns()
  console.log('[ACP] ACP shutdown complete')
}

