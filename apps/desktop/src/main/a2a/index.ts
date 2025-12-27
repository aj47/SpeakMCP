/**
 * A2A (Agent-to-Agent Protocol) Module
 * 
 * This module provides the infrastructure for delegating tasks to A2A-compatible agents
 * using the Google Agent-to-Agent Protocol.
 * 
 * Architecture:
 * - types.ts: A2A protocol types (Task, Message, AgentCard, etc.)
 * - agent-registry.ts: Agent discovery and registration
 * - a2a-client.ts: Client for communicating with A2A agents
 * - task-manager.ts: Task lifecycle management
 * - webhook-server.ts: Push notification receiver
 */

// Re-export all types
export * from './types';

// Re-export named exports from each module
export { 
  A2AAgentRegistry, 
  a2aAgentRegistry,
  type RegisteredAgent,
  type DiscoveryOptions,
  type AgentFilter,
} from './agent-registry';

export { 
  A2AClient, 
  createA2AClient,
  type A2AClientOptions,
} from './a2a-client';

export { 
  A2ATaskManager, 
  a2aTaskManager,
  type ManagedTask,
  type CreateTaskOptions,
  type TaskEventListener,
} from './task-manager';

export { 
  A2AWebhookServer, 
  a2aWebhookServer,
  type WebhookServerOptions,
  type WebhookEventHandler,
} from './webhook-server';

import { a2aAgentRegistry } from './agent-registry';
import { a2aTaskManager } from './task-manager';
import { a2aWebhookServer } from './webhook-server';

/** Handle for the periodic cleanup interval */
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/** Cleanup interval in milliseconds (30 minutes) */
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Initialize the A2A subsystem.
 * Call this during app startup.
 * 
 * @param config - Configuration options
 */
export async function initializeA2A(config: {
  /** URLs of A2A agents to discover at startup */
  agentUrls?: string[];
  /** Whether to start the webhook server */
  enableWebhooks?: boolean;
  /** Port for the webhook server (0 for auto-assign) */
  webhookPort?: number;
}): Promise<void> {
  console.log('[A2A] Initializing A2A subsystem...');

  // Discover pre-configured agents
  if (config.agentUrls && config.agentUrls.length > 0) {
    console.log(`[A2A] Discovering ${config.agentUrls.length} agents...`);
    
    const results = await Promise.allSettled(
      config.agentUrls.map(url => 
        a2aAgentRegistry.discoverAgent(url).catch(error => {
          console.error(`[A2A] Failed to discover agent at ${url}:`, error);
          throw error;
        })
      )
    );

    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    console.log(`[A2A] Discovered ${succeeded}/${config.agentUrls.length} agents`);
  }

  // Start webhook server if enabled
  if (config.enableWebhooks) {
    try {
      // Pass the configured webhookPort if provided
      if (config.webhookPort !== undefined) {
        a2aWebhookServer.setPort(config.webhookPort);
      }
      const port = await a2aWebhookServer.start();
      console.log(`[A2A] Webhook server started on port ${port}`);
    } catch (error) {
      console.error('[A2A] Failed to start webhook server:', error);
    }
  }

  // Start periodic cleanup to prevent memory leaks from old sessions
  startPeriodicCleanup();

  console.log('[A2A] A2A subsystem initialized');
}

/**
 * Start periodic cleanup of old sessions and delegations.
 * This prevents memory leaks from accumulating stale state.
 */
function startPeriodicCleanup(): void {
  if (cleanupInterval) {
    return; // Already running
  }

  cleanupInterval = setInterval(() => {
    try {
      // Import cleanup functions dynamically to avoid circular dependencies
      const { cleanupOldDelegatedRuns } = require('../acp/acp-router-tools');
      const { cleanupOldSubSessions } = require('../acp/internal-agent');

      // Clean up old delegated runs (1 hour threshold)
      cleanupOldDelegatedRuns(60 * 60 * 1000);

      // Clean up old sub-sessions (30 minute threshold)
      cleanupOldSubSessions(30 * 60 * 1000);

      // Clean up old A2A tasks
      a2aTaskManager.cleanup();

      console.log('[A2A] Periodic cleanup completed');
    } catch (error) {
      console.error('[A2A] Error during periodic cleanup:', error);
    }
  }, CLEANUP_INTERVAL_MS);

  console.log('[A2A] Periodic cleanup started (every 30 minutes)');
}

/**
 * Stop periodic cleanup.
 */
function stopPeriodicCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

/**
 * Shutdown the A2A subsystem.
 * Call this during app shutdown.
 */
export async function shutdownA2A(): Promise<void> {
  console.log('[A2A] Shutting down A2A subsystem...');

  // Stop periodic cleanup
  stopPeriodicCleanup();

  // Stop webhook server
  if (a2aWebhookServer.isListening()) {
    await a2aWebhookServer.stop();
  }

  // Clean up old tasks
  a2aTaskManager.cleanup();

  // Clear registry
  a2aAgentRegistry.clear();

  console.log('[A2A] A2A shutdown complete');
}

/**
 * Get A2A system status for debugging.
 */
export function getA2AStatus(): {
  registry: object;
  taskManager: object;
  webhookServer: object;
} {
  return {
    registry: a2aAgentRegistry.toJSON(),
    taskManager: a2aTaskManager.toJSON(),
    webhookServer: a2aWebhookServer.toJSON(),
  };
}
