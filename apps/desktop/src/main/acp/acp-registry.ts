import type { ACPAgentDefinition, ACPAgentInstance, ACPAgentConfig } from './types'

/**
 * Converts a user-provided ACPAgentConfig to an ACPAgentDefinition.
 * This handles the transformation from user configuration format to the internal agent definition format.
 * @param config - The user configuration for an ACP agent
 * @returns The agent definition ready for registration
 */
export function configToDefinition(config: ACPAgentConfig): ACPAgentDefinition {
  // Determine baseUrl based on connection type
  let baseUrl: string
  if (config.connection.type === 'remote' && config.connection.baseUrl) {
    baseUrl = config.connection.baseUrl
  } else if (config.connection.type === 'internal') {
    // Internal agents don't have a baseUrl, but we use a placeholder
    baseUrl = 'internal://'
  } else {
    // stdio agents use localhost with a dynamically assigned port
    baseUrl = 'http://localhost'
  }

  // Build spawn config for stdio agents
  const spawnConfig =
    config.connection.type === 'stdio' && config.connection.command
      ? {
          command: config.connection.command,
          args: config.connection.args ?? [],
          env: config.connection.env,
          cwd: config.connection.cwd,
        }
      : undefined

  return {
    name: config.name,
    displayName: config.displayName ?? config.name,
    description: config.description ?? '',
    baseUrl,
    spawnConfig,
  }
}

/**
 * Registry for managing ACP (Agent Client Protocol) agents.
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
    const existing = this.agents.get(definition.name)
    if (existing) {
      existing.definition = definition
      return
    }

    const instance: ACPAgentInstance = {
      definition,
      // Remote agents are assumed reachable; spawned agents start stopped until spawned.
      status: definition.spawnConfig ? 'stopped' : 'ready',
      activeRuns: 0,
      lastUsed: undefined,
      lastError: undefined,
    }

    this.agents.set(definition.name, instance)
  }

  /**
   * Unregister an agent from the registry.
   * @param name - The name of the agent to unregister
   */
  unregisterAgent(name: string): void {
    this.agents.delete(name)
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
   * Get agents that are ready to accept requests.
   * An agent is considered available if its status is 'ready', or 'busy' but still below maxConcurrency.
   * @returns Array of ready agent instances
   */
  getReadyAgents(): ACPAgentInstance[] {
    return this.getAllAgents().filter(agent => {
      if (agent.status !== 'ready' && agent.status !== 'busy') {
        return false
      }

      // If maxConcurrency isn't configured, assume single-concurrency.
      const maxConcurrency = agent.definition.maxConcurrency ?? 1
      if (maxConcurrency <= 0) {
        return true
      }

      return agent.activeRuns < maxConcurrency
    })
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
      return
    }

    agent.status = status

    if (status === 'ready') {
      agent.lastError = undefined
    } else if (status === 'error') {
      agent.lastError = error ?? agent.lastError
    }
  }

  /**
   * Increment the active run count for an agent.
   * @param name - The name of the agent
   */
  incrementActiveRuns(name: string): void {
    const agent = this.agents.get(name)
    if (agent) {
      agent.activeRuns++
      agent.lastUsed = Date.now()

      // Best-effort status tracking based on concurrency.
      if (agent.status === 'ready' || agent.status === 'busy') {
        const maxConcurrency = agent.definition.maxConcurrency ?? 1
        if (maxConcurrency > 0 && agent.activeRuns >= maxConcurrency) {
          agent.status = 'busy'
        }
      }
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
      agent.lastUsed = Date.now()

      if (agent.status === 'busy') {
        const maxConcurrency = agent.definition.maxConcurrency ?? 1
        if (maxConcurrency <= 0 || agent.activeRuns < maxConcurrency) {
          agent.status = 'ready'
        }
      }
    }
  }

  /**
   * Load agents from user configuration.
   * Converts each ACPAgentConfig to an ACPAgentDefinition and registers it.
   * @param configs - Array of agent configurations
   */
  loadFromConfig(configs: ACPAgentConfig[]): void {
    this.configuredAgents = configs

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
            definition: instance.definition,
            status: instance.status,
            activeRuns: instance.activeRuns,
            pid: instance.pid,
            lastUsed: instance.lastUsed ? new Date(instance.lastUsed).toISOString() : undefined,
            lastError: instance.lastError,
          },
        ])
      ),
      configuredAgentsCount: this.configuredAgents.length,
    }
  }
}

/** Singleton instance of the ACP registry */
export const acpRegistry = new ACPRegistry()

