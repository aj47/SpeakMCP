import type { ACPAgentDefinition, ACPAgentInstance, ACPAgentConfig } from './types'

/**
 * Log ACP-related debug messages.
 * TODO: Integrate with debug.ts when ACP debug flag is added
 */
function logACP(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(`[${new Date().toISOString()}] [ACP]`, ...args)
}

/**
 * Converts a user-provided ACPAgentConfig to an ACPAgentDefinition.
 * This handles the transformation from user configuration format to the internal agent definition format.
 * @param config - The user configuration for an ACP agent
 * @returns The agent definition ready for registration
 */
export function configToDefinition(config: ACPAgentConfig): ACPAgentDefinition {
  return {
    name: config.name,
    description: config.description ?? '',
    capabilities: config.capabilities ?? [],
    endpoint: config.endpoint,
    transport: config.transport ?? 'http',
    auth: config.auth,
    metadata: config.metadata,
  }
}

/**
 * Registry for managing ACP (Agent Communication Protocol) agents.
 * Provides methods for registering, unregistering, querying, and managing agent lifecycle.
 */
export class ACPRegistry {
  /** Map of agent name to agent instance */
  private agents: Map<string, ACPAgentInstance> = new Map()

  /** Configured agents loaded from user configuration */
  private configuredAgents: ACPAgentConfig[] = []

  /**
   * Register a new agent in the registry.
   * Creates an ACPAgentInstance from the definition with initial status.
   * @param definition - The agent definition to register
   */
  registerAgent(definition: ACPAgentDefinition): void {
    if (this.agents.has(definition.name)) {
      logACP(`Agent "${definition.name}" already registered, updating definition`)
    }

    const instance: ACPAgentInstance = {
      definition,
      status: 'disconnected',
      activeRuns: 0,
      lastConnected: undefined,
      lastError: undefined,
    }

    this.agents.set(definition.name, instance)
    logACP(`Registered agent: ${definition.name}`)
  }

  /**
   * Unregister an agent from the registry.
   * @param name - The name of the agent to unregister
   */
  unregisterAgent(name: string): void {
    if (this.agents.delete(name)) {
      logACP(`Unregistered agent: ${name}`)
    } else {
      logACP(`Agent "${name}" not found for unregistration`)
    }
  }

  /**
   * Get an agent by name.
   * @param name - The name of the agent to retrieve
   * @returns The agent instance or undefined if not found
   */
  getAgent(name: string): ACPAgentInstance | undefined {
    return this.agents.get(name)
  }

  /**
   * Get all registered agents.
   * @returns Array of all agent instances
   */
  getAllAgents(): ACPAgentInstance[] {
    return Array.from(this.agents.values())
  }

  /**
   * Get agents that have a specific capability.
   * @param capability - The capability to filter by
   * @returns Array of agent instances with the specified capability
   */
  getAgentsByCapability(capability: string): ACPAgentInstance[] {
    return this.getAllAgents().filter(agent =>
      agent.definition.capabilities.includes(capability)
    )
  }

  /**
   * Get agents that are ready to accept requests.
   * An agent is ready if its status is 'ready'.
   * @returns Array of ready agent instances
   */
  getReadyAgents(): ACPAgentInstance[] {
    return this.getAllAgents().filter(agent => agent.status === 'ready')
  }

  /**
   * Update the status of an agent.
   * @param name - The name of the agent to update
   * @param status - The new status
   * @param error - Optional error message (used when status is 'error')
   */
  updateAgentStatus(name: string, status: ACPAgentInstance['status'], error?: string): void {
    const agent = this.agents.get(name)
    if (!agent) {
      logACP(`Cannot update status: agent "${name}" not found`)
      return
    }

    agent.status = status
    if (status === 'ready') {
      agent.lastConnected = new Date()
      agent.lastError = undefined
    } else if (status === 'error' && error) {
      agent.lastError = error
    }

    logACP(`Agent "${name}" status updated to: ${status}${error ? ` (${error})` : ''}`)
  }

  /**
   * Increment the active run count for an agent.
   * @param name - The name of the agent
   */
  incrementActiveRuns(name: string): void {
    const agent = this.agents.get(name)
    if (agent) {
      agent.activeRuns++
      logACP(`Agent "${name}" active runs: ${agent.activeRuns}`)
    }
  }

  /**
   * Decrement the active run count for an agent.
   * @param name - The name of the agent
   */
  decrementActiveRuns(name: string): void {
    const agent = this.agents.get(name)
    if (agent && agent.activeRuns > 0) {
      agent.activeRuns--
      logACP(`Agent "${name}" active runs: ${agent.activeRuns}`)
    }
  }

  /**
   * Load agents from user configuration.
   * Converts each ACPAgentConfig to an ACPAgentDefinition and registers it.
   * @param configs - Array of agent configurations
   */
  loadFromConfig(configs: ACPAgentConfig[]): void {
    this.configuredAgents = configs
    logACP(`Loading ${configs.length} agents from configuration`)

    for (const config of configs) {
      const definition = configToDefinition(config)
      this.registerAgent(definition)
    }
  }

  /**
   * Serialize registry state for debugging.
   * @returns Object representation of the registry state
   */
  toJSON(): object {
    return {
      agents: Object.fromEntries(
        Array.from(this.agents.entries()).map(([name, instance]) => [
          name,
          {
            ...instance,
            lastConnected: instance.lastConnected?.toISOString(),
          },
        ])
      ),
      configuredAgentsCount: this.configuredAgents.length,
    }
  }
}

/** Singleton instance of the ACP registry */
export const acpRegistry = new ACPRegistry()

