/**
 * ACP Smart Router - Generates delegation prompt additions for ACP agents.
 */

import type { ACPAgentDefinition } from './types'

type ACPAgentForDelegationPrompt = {
  definition: {
    name: ACPAgentDefinition['name']
    displayName?: ACPAgentDefinition['displayName'] | undefined
    description?: ACPAgentDefinition['description'] | undefined
  }
}

/**
 * Smart router for ACP agent delegation decisions.
 */
export class ACPSmartRouter {
  /**
   * Format available ACP agents into compact delegation lines for a unified prompt.
   *
   * @param availableAgents - List of agents to include in the prompt
   * @returns Array of formatted lines for system prompt injection
   *
   * @example
   * ```typescript
   * const agents = acpRegistry.getReadyAgents()
   * const lines = acpSmartRouter.formatDelegationAgentLines(agents)
   * // Returns: ["- **research-agent** (external): Web research and fact-finding", ...]
   * ```
   */
  formatDelegationAgentLines(availableAgents: ReadonlyArray<ACPAgentForDelegationPrompt>): string[] {
    if (availableAgents.length === 0) {
      return []
    }

    return availableAgents.map(agent => {
      const def = agent.definition
      const summary = (def.description || def.displayName || 'External agent').trim()
      return `- **${def.name}** (external): ${summary}`
    })
  }
}

/** Singleton instance of the ACP smart router */
export const acpSmartRouter = new ACPSmartRouter()
