/**
 * A2A Agent Registry
 * 
 * Manages discovery and registration of A2A agents.
 * Supports fetching AgentCards from well-known URLs and skill-based discovery.
 */

import type {
  A2AAgentCard,
  A2ASkill,
  A2AAgentCapabilities,
} from './types';

function logA2A(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(`[${new Date().toISOString()}] [A2A Registry]`, ...args);
}

/**
 * Registered agent with local metadata.
 */
export interface RegisteredAgent {
  /** The agent's card */
  card: A2AAgentCard;
  /** When the card was last fetched/updated */
  lastUpdated: number;
  /** Whether the agent is currently reachable */
  isReachable: boolean;
  /** Last error if agent is not reachable */
  lastError?: string;
  /** Local tags/categories for organization */
  tags?: string[];
}

/**
 * Options for agent discovery.
 */
export interface DiscoveryOptions {
  /** Timeout for discovery requests in milliseconds */
  timeoutMs?: number;
  /** Whether to validate the agent's capabilities */
  validateCapabilities?: boolean;
  /** Custom headers for the request */
  headers?: Record<string, string>;
}

/**
 * Agent filter criteria for searching.
 */
export interface AgentFilter {
  /** Filter by skill ID */
  skillId?: string;
  /** Filter by skill name (partial match) */
  skillName?: string;
  /** Filter by skill tags */
  skillTags?: string[];
  /** Filter by capability */
  capability?: keyof A2AAgentCapabilities;
  /** Filter by reachability */
  isReachable?: boolean;
  /** Filter by local tags */
  tags?: string[];
}

/**
 * A2A Agent Registry - manages agent discovery and registration.
 */
export class A2AAgentRegistry {
  /** Map of agent URL to registered agent */
  private agents: Map<string, RegisteredAgent> = new Map();
  
  /** Map of skill ID to agent URLs */
  private skillIndex: Map<string, Set<string>> = new Map();

  /**
   * Discover an agent by fetching its AgentCard from the well-known URL.
   * 
   * @param baseUrl - Base URL of the A2A server
   * @param options - Discovery options
   * @returns The discovered agent card
   */
  async discoverAgent(
    baseUrl: string,
    options: DiscoveryOptions = {}
  ): Promise<A2AAgentCard> {
    const { timeoutMs = 10000, headers = {} } = options;

    // Normalize the base URL
    const normalizedUrl = baseUrl.replace(/\/$/, '');
    const agentCardUrl = `${normalizedUrl}/.well-known/agent-card.json`;

    logA2A(`Discovering agent at: ${agentCardUrl}`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(agentCardUrl, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...headers,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const card: A2AAgentCard = await response.json();

      // Validate required fields
      if (!card.name || !card.url || !card.protocolVersion) {
        throw new Error('Invalid AgentCard: missing required fields');
      }

      // Register the agent
      this.registerAgent(card);

      logA2A(`Discovered agent: ${card.name} (${card.skills?.length || 0} skills)`);
      return card;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logA2A(`Failed to discover agent at ${baseUrl}: ${errorMessage}`);

      // Update agent status if already registered
      const existing = this.agents.get(normalizedUrl);
      if (existing) {
        existing.isReachable = false;
        existing.lastError = errorMessage;
      }

      throw new Error(`Failed to discover agent: ${errorMessage}`);
    }
  }

  /**
   * Register an agent with its card.
   * 
   * @param card - The agent's card
   * @param tags - Optional local tags for organization
   */
  registerAgent(card: A2AAgentCard, tags?: string[]): void {
    const normalizedUrl = card.url.replace(/\/$/, '');

    // Create or update the registered agent
    const registered: RegisteredAgent = {
      card,
      lastUpdated: Date.now(),
      isReachable: true,
      tags,
    };

    this.agents.set(normalizedUrl, registered);

    // Update skill index
    if (card.skills) {
      for (const skill of card.skills) {
        if (!this.skillIndex.has(skill.id)) {
          this.skillIndex.set(skill.id, new Set());
        }
        this.skillIndex.get(skill.id)!.add(normalizedUrl);
      }
    }

    logA2A(`Registered agent: ${card.name} at ${normalizedUrl}`);
  }

  /**
   * Unregister an agent.
   * 
   * @param url - URL of the agent to unregister
   */
  unregisterAgent(url: string): void {
    const normalizedUrl = url.replace(/\/$/, '');
    const agent = this.agents.get(normalizedUrl);

    if (agent) {
      // Remove from skill index
      if (agent.card.skills) {
        for (const skill of agent.card.skills) {
          this.skillIndex.get(skill.id)?.delete(normalizedUrl);
        }
      }

      this.agents.delete(normalizedUrl);
      logA2A(`Unregistered agent: ${agent.card.name}`);
    }
  }

  /**
   * Get an agent by URL.
   * 
   * @param url - URL of the agent
   * @returns The registered agent or undefined
   */
  getAgent(url: string): RegisteredAgent | undefined {
    const normalizedUrl = url.replace(/\/$/, '');
    return this.agents.get(normalizedUrl);
  }

  /**
   * Get all registered agents.
   * 
   * @returns Array of all registered agents
   */
  getAllAgents(): RegisteredAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Find agents matching the given filter.
   * 
   * @param filter - Filter criteria
   * @returns Array of matching agents
   */
  findAgents(filter: AgentFilter): RegisteredAgent[] {
    let results = this.getAllAgents();

    // Filter by skill ID
    if (filter.skillId) {
      const agentUrls = this.skillIndex.get(filter.skillId);
      if (agentUrls) {
        results = results.filter(a => agentUrls.has(a.card.url.replace(/\/$/, '')));
      } else {
        results = [];
      }
    }

    // Filter by skill name (partial match)
    if (filter.skillName) {
      const searchTerm = filter.skillName.toLowerCase();
      results = results.filter(a =>
        a.card.skills?.some(s => s.name.toLowerCase().includes(searchTerm))
      );
    }

    // Filter by skill tags
    if (filter.skillTags && filter.skillTags.length > 0) {
      results = results.filter(a =>
        a.card.skills?.some(s =>
          filter.skillTags!.some(tag => s.tags?.includes(tag))
        )
      );
    }

    // Filter by capability
    if (filter.capability) {
      results = results.filter(a => {
        const capabilities = a.card.capabilities;
        if (!capabilities) return false;
        return capabilities[filter.capability!] === true;
      });
    }

    // Filter by reachability
    if (filter.isReachable !== undefined) {
      results = results.filter(a => a.isReachable === filter.isReachable);
    }

    // Filter by local tags
    if (filter.tags && filter.tags.length > 0) {
      results = results.filter(a =>
        filter.tags!.some(tag => a.tags?.includes(tag))
      );
    }

    return results;
  }

  /**
   * Find agents by skill.
   * 
   * @param skillName - Skill name to search for (partial match)
   * @returns Array of matching agents
   */
  findAgentsBySkill(skillName: string): RegisteredAgent[] {
    return this.findAgents({ skillName });
  }

  /**
   * Find agents by capability.
   * 
   * @param capability - Capability to filter by
   * @returns Array of agents with the capability
   */
  findAgentsByCapability(
    capability: keyof A2AAgentCapabilities
  ): RegisteredAgent[] {
    return this.findAgents({ capability });
  }

  /**
   * Get all unique skills across all registered agents.
   * 
   * @returns Array of unique skills
   */
  getAllSkills(): A2ASkill[] {
    const skillMap = new Map<string, A2ASkill>();

    for (const agent of this.agents.values()) {
      if (agent.card.skills) {
        for (const skill of agent.card.skills) {
          if (!skillMap.has(skill.id)) {
            skillMap.set(skill.id, skill);
          }
        }
      }
    }

    return Array.from(skillMap.values());
  }

  /**
   * Check if an agent is reachable.
   * 
   * @param url - URL of the agent to check
   * @param timeoutMs - Timeout in milliseconds
   * @returns Whether the agent is reachable
   */
  async checkReachability(url: string, timeoutMs: number = 5000): Promise<boolean> {
    const normalizedUrl = url.replace(/\/$/, '');
    const agent = this.agents.get(normalizedUrl);

    if (!agent) {
      return false;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(`${normalizedUrl}/.well-known/agent-card.json`, {
        method: 'HEAD',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      agent.isReachable = response.ok;
      agent.lastError = response.ok ? undefined : `HTTP ${response.status}`;

      return response.ok;
    } catch (error) {
      agent.isReachable = false;
      agent.lastError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /**
   * Refresh all registered agents by re-fetching their AgentCards.
   * 
   * @param options - Discovery options
   * @returns Map of agent URL to refresh result
   */
  async refreshAll(
    options: DiscoveryOptions = {}
  ): Promise<Map<string, { success: boolean; error?: string }>> {
    const results = new Map<string, { success: boolean; error?: string }>();

    const refreshPromises = Array.from(this.agents.keys()).map(async url => {
      try {
        await this.discoverAgent(url, options);
        results.set(url, { success: true });
      } catch (error) {
        results.set(url, {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    await Promise.allSettled(refreshPromises);
    return results;
  }

  /**
   * Clear all registered agents.
   */
  clear(): void {
    this.agents.clear();
    this.skillIndex.clear();
    logA2A('Registry cleared');
  }

  /**
   * Serialize the registry state.
   * 
   * @returns JSON-serializable object
   */
  toJSON(): object {
    return {
      agents: Array.from(this.agents.entries()).map(([url, agent]) => ({
        url,
        name: agent.card.name,
        description: agent.card.description,
        skills: agent.card.skills?.length || 0,
        isReachable: agent.isReachable,
        lastUpdated: new Date(agent.lastUpdated).toISOString(),
        lastError: agent.lastError,
      })),
      totalAgents: this.agents.size,
      totalSkills: this.skillIndex.size,
    };
  }
}

/** Singleton instance of the A2A agent registry */
export const a2aAgentRegistry = new A2AAgentRegistry();
