/**
 * ACP Parallel Orchestrator - handles running multiple ACP agents in parallel
 * and aggregating their results.
 */

import { acpRegistry } from './acp-registry';
import { acpClientService } from './acp-client-service';
import { acpProcessManager } from './acp-process-manager';
import type { ACPRunRequest, ACPRunResult, ACPSubAgentState } from './types';

/**
 * Represents a group of tasks to be executed in parallel.
 */
export interface ParallelTaskGroup {
  /** Unique identifier for this task group */
  groupId: string;
  /** Parent session ID linking to the main SpeakMCP session */
  parentSessionId: string;
  /** Array of tasks to execute */
  tasks: Array<{
    /** Name of the agent to run */
    agentName: string;
    /** Task/prompt to send to the agent */
    task: string;
    /** Optional context to provide to the agent */
    context?: string;
    /** Priority for execution (higher = run first if limited concurrency) */
    priority?: number;
  }>;
  /** Maximum parallel runs (default: all tasks run in parallel) */
  maxConcurrency?: number;
  /** Overall timeout for the group in milliseconds */
  timeout?: number;
  /** Stop all tasks if one fails */
  failFast?: boolean;
}

/**
 * Result from executing a parallel task group.
 */
export interface ParallelExecutionResult {
  /** Group identifier */
  groupId: string;
  /** Overall status of the parallel execution */
  status: 'completed' | 'partial' | 'failed';
  /** Successful results from agents */
  results: Array<{
    agentName: string;
    task: string;
    result: ACPRunResult;
  }>;
  /** Errors from failed agent runs */
  errors: Array<{
    agentName: string;
    task: string;
    error: string;
  }>;
  /** Total duration in milliseconds */
  totalDuration: number;
}

/**
 * Log parallel orchestrator debug messages.
 */
function logParallelOrchestrator(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(`[${new Date().toISOString()}] [ACP-ParallelOrchestrator]`, ...args);
}

/**
 * Internal state for an active group execution.
 */
interface ActiveGroupState {
  tasks: ParallelTaskGroup;
  controller: AbortController;
  results: ParallelExecutionResult;
}

/**
 * Orchestrator for running multiple ACP agents in parallel with concurrency control.
 */
export class ACPParallelOrchestrator {
  /** Map of active group executions */
  private activeGroups: Map<string, ActiveGroupState> = new Map();

  /**
   * Execute a group of tasks in parallel.
   * @param group - The parallel task group to execute
   * @param onProgress - Optional callback for progress updates
   * @returns The aggregated execution result
   */
  async executeParallel(
    group: ParallelTaskGroup,
    onProgress?: (agentName: string, status: string) => void
  ): Promise<ParallelExecutionResult> {
    const startTime = Date.now();
    const controller = new AbortController();

    // Initialize result structure
    const result: ParallelExecutionResult = {
      groupId: group.groupId,
      status: 'completed',
      results: [],
      errors: [],
      totalDuration: 0,
    };

    // Store active group state
    this.activeGroups.set(group.groupId, {
      tasks: group,
      controller,
      results: result,
    });

    logParallelOrchestrator(`Starting parallel execution for group: ${group.groupId}`);

    try {
      // Validate and prepare agents
      const agentNames = group.tasks.map((t) => t.agentName);
      const { ready, failed } = await this.ensureAgentsReady(agentNames);

      // Add errors for agents that failed to start
      for (const failedAgent of failed) {
        const task = group.tasks.find((t) => t.agentName === failedAgent);
        if (task) {
          result.errors.push({
            agentName: failedAgent,
            task: task.task,
            error: `Agent "${failedAgent}" failed to start or is not available`,
          });
          onProgress?.(failedAgent, 'failed');
        }
      }

      // Filter tasks to only include ready agents
      const readyTasks = group.tasks.filter((t) => ready.includes(t.agentName));

      if (readyTasks.length === 0) {
        result.status = 'failed';
        result.totalDuration = Date.now() - startTime;
        return result;
      }

      // Sort by priority (higher priority first)
      const sortedTasks = [...readyTasks].sort(
        (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
      );

      // Create task executors
      const taskExecutors = sortedTasks.map((task) => {
        return async () => {
          if (controller.signal.aborted) {
            throw new Error('Group execution was cancelled');
          }

          onProgress?.(task.agentName, 'running');
          logParallelOrchestrator(`Running task for agent: ${task.agentName}`);

          const agent = acpRegistry.getAgent(task.agentName);
          if (!agent) {
            throw new Error(`Agent "${task.agentName}" not found`);
          }

          // Prepare input with context
          let input = task.task;
          if (task.context) {
            input = `Context: ${task.context}\n\nTask: ${task.task}`;
          }

          const runRequest: ACPRunRequest & { baseUrl: string } = {
            agentName: task.agentName,
            input,
            mode: 'sync',
            parentSessionId: group.parentSessionId,
            timeout: group.timeout,
            baseUrl: agent.definition.baseUrl,
          };

          const runResult = await acpClientService.runAgentSync(runRequest);
          onProgress?.(task.agentName, 'completed');

          return {
            agentName: task.agentName,
            task: task.task,
            result: runResult,
          };
        };
      });

      // Execute with concurrency limit
      const maxConcurrency = group.maxConcurrency ?? sortedTasks.length;

      if (group.failFast) {
        // Use Promise.all - fails fast on first error
        const executionResults = await this.executeWithConcurrencyLimit(
          taskExecutors,
          maxConcurrency
        );
        result.results = executionResults;
      } else {
        // Use Promise.allSettled - collect all results
        const wrappedExecutors = taskExecutors.map((executor, index) => {
          return async () => {
            try {
              return { status: 'fulfilled' as const, value: await executor() };
            } catch (error) {
              const task = sortedTasks[index];
              return {
                status: 'rejected' as const,
                reason: error,
                agentName: task.agentName,
                task: task.task,
              };
            }
          };
        });

        const settledResults = await this.executeWithConcurrencyLimit(
          wrappedExecutors,
          maxConcurrency
        );

        for (const settled of settledResults) {
          if (settled.status === 'fulfilled') {
            result.results.push(settled.value);
          } else {
            const errorMessage =
              settled.reason instanceof Error
                ? settled.reason.message
                : String(settled.reason);
            result.errors.push({
              agentName: settled.agentName,
              task: settled.task,
              error: errorMessage,
            });
            onProgress?.(settled.agentName, 'failed');
          }
        }
      }

      // Determine final status
      if (result.errors.length === 0) {
        result.status = 'completed';
      } else if (result.results.length > 0) {
        result.status = 'partial';
      } else {
        result.status = 'failed';
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logParallelOrchestrator(`Group execution failed: ${errorMessage}`);
      result.status = 'failed';
      result.errors.push({
        agentName: 'orchestrator',
        task: 'parallel-execution',
        error: errorMessage,
      });
    } finally {
      result.totalDuration = Date.now() - startTime;
      this.activeGroups.delete(group.groupId);
      logParallelOrchestrator(
        `Completed group ${group.groupId} in ${result.totalDuration}ms`
      );
    }

    return result;
  }

  /**
   * Execute tasks with a concurrency limit using a queue/semaphore pattern.
   * @param tasks - Array of task functions to execute
   * @param limit - Maximum number of concurrent executions
   * @returns Array of results in order of completion
   */
  async executeWithConcurrencyLimit<T>(
    tasks: Array<() => Promise<T>>,
    limit: number
  ): Promise<T[]> {
    const results: T[] = [];
    const executing: Promise<void>[] = [];

    for (const task of tasks) {
      const promise = task().then((result) => {
        results.push(result);
        executing.splice(executing.indexOf(promise), 1);
      });
      executing.push(promise);

      if (executing.length >= limit) {
        await Promise.race(executing);
      }
    }

    await Promise.all(executing);
    return results;
  }

  /**
   * Cancel all running tasks in a group.
   * @param groupId - The group ID to cancel
   */
  cancelGroup(groupId: string): void {
    const group = this.activeGroups.get(groupId);
    if (!group) {
      logParallelOrchestrator(`Group ${groupId} not found or already completed`);
      return;
    }

    logParallelOrchestrator(`Cancelling group: ${groupId}`);
    group.controller.abort();
    group.results.status = 'failed';
    group.results.errors.push({
      agentName: 'orchestrator',
      task: 'parallel-execution',
      error: 'Group execution was cancelled',
    });
    this.activeGroups.delete(groupId);
  }

  /**
   * Get the current status of a group execution.
   * @param groupId - The group ID to check
   * @returns The current execution result or undefined if not found
   */
  getGroupStatus(groupId: string): ParallelExecutionResult | undefined {
    const group = this.activeGroups.get(groupId);
    return group?.results;
  }

  /**
   * Aggregate results from multiple agent runs into a summary.
   * @param results - Array of agent results to aggregate
   * @returns Formatted summary string
   */
  aggregateResults(
    results: Array<{ agentName: string; result: ACPRunResult }>
  ): string {
    if (results.length === 0) {
      return 'No results to aggregate.';
    }

    const summaries: string[] = [];

    for (const { agentName, result } of results) {
      let content = '';

      if (result.output && result.output.length > 0) {
        // Extract content from output messages
        content = result.output
          .map((msg) => {
            if (msg.parts && msg.parts.length > 0) {
              return msg.parts.map((p) => p.content).join('\n');
            }
            return '';
          })
          .filter(Boolean)
          .join('\n');
      }

      const status = result.status === 'completed' ? '✓' : '✗';
      const duration = result.metadata?.duration
        ? ` (${result.metadata.duration}ms)`
        : '';

      summaries.push(
        `### ${status} ${agentName}${duration}\n\n${content || result.error || 'No output'}`
      );
    }

    return `# Parallel Execution Results\n\n${summaries.join('\n\n---\n\n')}`;
  }

  /**
   * Ensure all specified agents are ready to accept requests.
   * Spawns agents if necessary.
   * @param agentNames - List of agent names to check/prepare
   * @returns Object with ready and failed agent lists
   */
  private async ensureAgentsReady(
    agentNames: string[]
  ): Promise<{ ready: string[]; failed: string[] }> {
    const uniqueNames = Array.from(new Set(agentNames));
    const ready: string[] = [];
    const failed: string[] = [];

    const checkPromises = uniqueNames.map(async (agentName) => {
      const agent = acpRegistry.getAgent(agentName);

      if (!agent) {
        logParallelOrchestrator(`Agent "${agentName}" not found in registry`);
        failed.push(agentName);
        return;
      }

      // Check if agent is already ready
      if (agent.status === 'ready') {
        ready.push(agentName);
        return;
      }

      // Check if agent is running (process manager)
      if (acpProcessManager.isAgentRunning(agentName)) {
        ready.push(agentName);
        return;
      }

      // Try to spawn the agent if it has spawn config
      if (agent.definition.spawnConfig) {
        logParallelOrchestrator(`Attempting to spawn agent: ${agentName}`);
        const spawned = await acpProcessManager.spawnAgent(agentName);
        if (spawned) {
          ready.push(agentName);
        } else {
          failed.push(agentName);
        }
        return;
      }

      // Agent exists but can't be spawned - assume remote agent
      // Check if it's reachable by verifying baseUrl exists
      if (agent.definition.baseUrl) {
        ready.push(agentName);
      } else {
        logParallelOrchestrator(
          `Agent "${agentName}" has no baseUrl and cannot be spawned`
        );
        failed.push(agentName);
      }
    });

    await Promise.all(checkPromises);

    logParallelOrchestrator(
      `Agents ready: [${ready.join(', ')}], failed: [${failed.join(', ')}]`
    );

    return { ready, failed };
  }

  /**
   * Generate a unique group ID.
   * @returns Unique group identifier
   */
  private generateGroupId(): string {
    const random = Math.random().toString(36).substring(2, 10);
    return `parallel_group_${Date.now()}_${random}`;
  }
}

/** Singleton instance of the ACP parallel orchestrator */
export const acpParallelOrchestrator = new ACPParallelOrchestrator();
