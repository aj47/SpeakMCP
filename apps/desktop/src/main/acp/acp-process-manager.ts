import { spawn, ChildProcess } from 'child_process';
import { acpRegistry } from './acp-registry';
import type { ACPAgentDefinition, ACPAgentInstance, ACPAgentConfig } from './types';
// Note: acpClientService may be used for future agent communication features
import { acpClientService } from './acp-client-service';

/**
 * Log ACP process manager debug messages.
 */
function logACP(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(`[${new Date().toISOString()}] [ACP-ProcessManager]`, ...args);
}

/**
 * Information about a spawned agent process.
 */
interface SpawnedProcess {
  process: ChildProcess;
  port: number;
  startTime: number;
}

/**
 * Manager for spawning and managing ACP agent processes.
 * Handles process lifecycle, health checks, and idle timeouts.
 */
export class ACPProcessManager {
  /** Map of agent name to spawned process info */
  private processes: Map<string, SpawnedProcess> = new Map();

  /** Map of agent name to health check interval */
  private healthCheckIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();

  /** Map of agent name to idle timeout */
  private idleTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();

  /** Health check interval in milliseconds */
  private readonly HEALTH_CHECK_INTERVAL_MS = 30000;

  /** Kill timeout after SIGTERM in milliseconds */
  private readonly KILL_TIMEOUT_MS = 5000;

  /**
   * Spawn an agent process.
   * @param agentName - Name of the agent to spawn
   * @returns True if the agent was spawned successfully
   */
  async spawnAgent(agentName: string): Promise<boolean> {
    const instance = acpRegistry.getAgent(agentName);
    if (!instance) {
      logACP(`Agent "${agentName}" not found in registry`);
      return false;
    }

    const definition = instance.definition;

    // Check if already running
    if (this.isAgentRunning(agentName)) {
      logACP(`Agent "${agentName}" is already running`);
      return true;
    }

    // Check if spawn config exists
    if (!definition.spawnConfig) {
      logACP(`Agent "${agentName}" has no spawn configuration`);
      return false;
    }

    const { command, args, env, startupTimeMs } = definition.spawnConfig;

    logACP(`Spawning agent "${agentName}": ${command} ${args.join(' ')}`);

    // Update status to starting
    acpRegistry.updateAgentStatus(agentName, 'starting');

    try {
      // Spawn the process
      const childProcess = spawn(command, args, {
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      // Extract port from baseUrl
      const port = this.extractPort(definition.baseUrl);

      // Store process info
      this.processes.set(agentName, {
        process: childProcess,
        port,
        startTime: Date.now(),
      });

      // Handle stdout
      childProcess.stdout?.on('data', (data: Buffer) => {
        logACP(`[${agentName}] stdout:`, data.toString().trim());
      });

      // Handle stderr
      childProcess.stderr?.on('data', (data: Buffer) => {
        logACP(`[${agentName}] stderr:`, data.toString().trim());
      });

      // Handle process exit
      childProcess.on('exit', (code) => {
        this.handleProcessExit(agentName, code);
      });

      childProcess.on('error', (error) => {
        logACP(`Agent "${agentName}" process error:`, error.message);
        acpRegistry.updateAgentStatus(agentName, 'error', error.message);
      });

      // Wait for agent to be ready
      const timeoutMs = startupTimeMs ?? 30000;
      const isReady = await this.waitForReady(definition.baseUrl, timeoutMs);

      if (!isReady) {
        logACP(`Agent "${agentName}" failed to become ready within ${timeoutMs}ms`);
        await this.stopAgent(agentName);
        return false;
      }

      // Update status to ready
      acpRegistry.updateAgentStatus(agentName, 'ready');

      // Start health check
      this.startHealthCheck(agentName, definition.baseUrl);

      logACP(`Agent "${agentName}" spawned successfully on port ${port}`);
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logACP(`Failed to spawn agent "${agentName}":`, errorMessage);
      acpRegistry.updateAgentStatus(agentName, 'error', errorMessage);
      return false;
    }
  }

  /**
   * Stop an agent process.
   * @param agentName - Name of the agent to stop
   */
  async stopAgent(agentName: string): Promise<void> {
    const spawnedProcess = this.processes.get(agentName);
    if (!spawnedProcess) {
      logACP(`Agent "${agentName}" is not running`);
      return;
    }

    logACP(`Stopping agent "${agentName}"...`);

    // Clear health check interval
    this.clearHealthCheck(agentName);

    // Clear idle timeout
    this.clearIdleTimeout(agentName);

    const { process: childProcess } = spawnedProcess;

    // Send SIGTERM first
    childProcess.kill('SIGTERM');

    // Wait for graceful shutdown, then SIGKILL
    await new Promise<void>((resolve) => {
      const killTimeout = setTimeout(() => {
        if (!childProcess.killed) {
          logACP(`Agent "${agentName}" did not stop gracefully, sending SIGKILL`);
          childProcess.kill('SIGKILL');
        }
        resolve();
      }, this.KILL_TIMEOUT_MS);

      childProcess.once('exit', () => {
        clearTimeout(killTimeout);
        resolve();
      });
    });

    // Clean up
    this.processes.delete(agentName);
    acpRegistry.updateAgentStatus(agentName, 'stopped');
    logACP(`Agent "${agentName}" stopped`);
  }

  /**
   * Stop all spawned agent processes.
   */
  async stopAllAgents(): Promise<void> {
    logACP(`Stopping all ${this.processes.size} spawned agents...`);
    const stopPromises = Array.from(this.processes.keys()).map((agentName) =>
      this.stopAgent(agentName)
    );
    await Promise.all(stopPromises);
    logACP('All agents stopped');
  }

  /**
   * Restart an agent process.
   * @param agentName - Name of the agent to restart
   * @returns True if the agent was restarted successfully
   */
  async restartAgent(agentName: string): Promise<boolean> {
    logACP(`Restarting agent "${agentName}"...`);
    await this.stopAgent(agentName);
    return this.spawnAgent(agentName);
  }

  /**
   * Check if an agent process is running.
   * @param agentName - Name of the agent to check
   * @returns True if the agent is running
   */
  isAgentRunning(agentName: string): boolean {
    const spawnedProcess = this.processes.get(agentName);
    if (!spawnedProcess) {
      return false;
    }
    return !spawnedProcess.process.killed && spawnedProcess.process.exitCode === null;
  }

  /**
   * Get the port an agent is listening on.
   * @param agentName - Name of the agent
   * @returns The port number or undefined if not running
   */
  getAgentPort(agentName: string): number | undefined {
    const spawnedProcess = this.processes.get(agentName);
    return spawnedProcess?.port;
  }

  /**
   * Reset the idle timeout for an agent.
   * Call this when the agent is used to prevent it from being stopped.
   * @param agentName - Name of the agent
   */
  resetIdleTimeout(agentName: string): void {
    const instance = acpRegistry.getAgent(agentName);
    if (!instance) {
      return;
    }

    this.clearIdleTimeout(agentName);

    // Check if the agent has an idle timeout configured
    // For now, use a default of 5 minutes if not specified
    const idleTimeoutMs = instance.definition.idleTimeoutMs ?? 300000;

    if (idleTimeoutMs > 0) {
      this.startIdleTimeout(agentName, idleTimeoutMs);
    }
  }

  /**
   * Wait for an agent to become ready by polling its health endpoint.
   * @param baseUrl - The base URL of the agent
   * @param timeoutMs - Maximum time to wait in milliseconds
   * @returns True if the agent became ready
   */
  private async waitForReady(baseUrl: string, timeoutMs: number): Promise<boolean> {
    const startTime = Date.now();
    const pollIntervalMs = 500;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await fetch(`${baseUrl}/agents`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(5000),
        });

        if (response.ok) {
          return true;
        }
      } catch {
        // Agent not ready yet, continue polling
      }

      await this.sleep(pollIntervalMs);
    }

    return false;
  }

  /**
   * Start periodic health checks for an agent.
   * @param agentName - Name of the agent
   * @param baseUrl - The base URL of the agent
   */
  private startHealthCheck(agentName: string, baseUrl: string): void {
    this.clearHealthCheck(agentName);

    const interval = setInterval(async () => {
      try {
        const response = await fetch(`${baseUrl}/agents`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
          logACP(`Agent "${agentName}" health check failed: ${response.status}`);
          acpRegistry.updateAgentStatus(agentName, 'error', `Health check failed: ${response.status}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logACP(`Agent "${agentName}" health check error:`, errorMessage);
        acpRegistry.updateAgentStatus(agentName, 'error', `Health check error: ${errorMessage}`);
      }
    }, this.HEALTH_CHECK_INTERVAL_MS);

    this.healthCheckIntervals.set(agentName, interval);
  }

  /**
   * Clear the health check interval for an agent.
   * @param agentName - Name of the agent
   */
  private clearHealthCheck(agentName: string): void {
    const interval = this.healthCheckIntervals.get(agentName);
    if (interval) {
      clearInterval(interval);
      this.healthCheckIntervals.delete(agentName);
    }
  }

  /**
   * Start an idle timeout for an agent.
   * @param agentName - Name of the agent
   * @param timeoutMs - Time in milliseconds before the agent is stopped
   */
  private startIdleTimeout(agentName: string, timeoutMs: number): void {
    this.clearIdleTimeout(agentName);

    const timeout = setTimeout(async () => {
      logACP(`Agent "${agentName}" idle timeout reached, stopping...`);
      await this.stopAgent(agentName);
    }, timeoutMs);

    this.idleTimeouts.set(agentName, timeout);
  }

  /**
   * Clear the idle timeout for an agent.
   * @param agentName - Name of the agent
   */
  private clearIdleTimeout(agentName: string): void {
    const timeout = this.idleTimeouts.get(agentName);
    if (timeout) {
      clearTimeout(timeout);
      this.idleTimeouts.delete(agentName);
    }
  }

  /**
   * Handle a process exit event.
   * @param agentName - Name of the agent
   * @param code - Exit code or null if killed by signal
   */
  private handleProcessExit(agentName: string, code: number | null): void {
    logACP(`Agent "${agentName}" process exited with code: ${code}`);

    // Clean up intervals and timeouts
    this.clearHealthCheck(agentName);
    this.clearIdleTimeout(agentName);

    // Remove from processes map
    this.processes.delete(agentName);

    // Update registry status
    if (code === 0) {
      acpRegistry.updateAgentStatus(agentName, 'stopped');
    } else {
      acpRegistry.updateAgentStatus(agentName, 'error', `Process exited with code ${code}`);
    }
  }

  /**
   * Extract port number from a URL.
   * @param url - The URL to extract the port from
   * @returns The port number or default port based on protocol
   */
  private extractPort(url: string): number {
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.port) {
        return parseInt(parsedUrl.port, 10);
      }
      // Default ports
      return parsedUrl.protocol === 'https:' ? 443 : 80;
    } catch {
      return 80;
    }
  }

  /**
   * Sleep for a specified duration.
   * @param ms - Duration in milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/** Singleton instance of the ACP process manager */
export const acpProcessManager = new ACPProcessManager();

