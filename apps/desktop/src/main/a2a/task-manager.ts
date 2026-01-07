/**
 * A2A Task Manager
 * 
 * Manages the lifecycle of A2A tasks, including state tracking,
 * history management, and task completion handling.
 */

import type {
  A2ATask,
  A2ATaskState,
  A2ATaskStatus,
  A2AMessage,
  A2AArtifact,
  A2AStreamEvent,
} from './types';
import { isTerminalState, generateTaskId, generateContextId } from './types';

function logA2A(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log(`[${new Date().toISOString()}] [A2A TaskManager]`, ...args);
}

/**
 * Task event listener callback.
 */
export type TaskEventListener = (event: {
  taskId: string;
  type: 'status' | 'artifact' | 'message' | 'completed' | 'failed';
  data: A2ATaskStatus | A2AArtifact | A2AMessage | string;
}) => void;

/**
 * Managed task with additional tracking metadata.
 */
export interface ManagedTask {
  /** The A2A task */
  task: A2ATask;
  /** Parent session ID (for SpeakMCP integration) */
  parentSessionId?: string;
  /** Original request/task description */
  description?: string;
  /** When the task was created locally */
  createdAt: number;
  /** When the task was last updated locally */
  updatedAt: number;
  /** Agent URL this task was sent to */
  agentUrl?: string;
  /** Agent name this task was sent to */
  agentName?: string;
  /** Whether we're actively polling/streaming this task */
  isActive: boolean;
  /** Listeners for this task */
  listeners: Set<TaskEventListener>;
}

/**
 * Options for creating a new task.
 */
export interface CreateTaskOptions {
  /** Task ID (auto-generated if not provided) */
  taskId?: string;
  /** Context ID for grouping related tasks */
  contextId?: string;
  /** Parent session ID for SpeakMCP integration */
  parentSessionId?: string;
  /** Task description */
  description?: string;
  /** Agent URL */
  agentUrl?: string;
  /** Agent name */
  agentName?: string;
  /** Initial message history */
  initialHistory?: A2AMessage[];
}

/**
 * A2A Task Manager - manages task lifecycle and state.
 */
export class A2ATaskManager {
  /** Map of task ID to managed task */
  private tasks: Map<string, ManagedTask> = new Map();

  /** Map of parent session ID to task IDs */
  private sessionTasks: Map<string, Set<string>> = new Map();

  /** Map of context ID to task IDs */
  private contextTasks: Map<string, Set<string>> = new Map();

  /** Global listeners for all task events */
  private globalListeners: Set<TaskEventListener> = new Set();

  /**
   * Create a new task.
   * 
   * @param options - Task creation options
   * @returns The created managed task
   */
  createTask(options: CreateTaskOptions = {}): ManagedTask {
    const taskId = options.taskId || generateTaskId();
    const contextId = options.contextId || generateContextId();
    const now = Date.now();

    const task: A2ATask = {
      id: taskId,
      contextId,
      status: {
        state: 'submitted',
        timestamp: new Date(now).toISOString(),
      },
      history: options.initialHistory || [],
      artifacts: [],
    };

    const managedTask: ManagedTask = {
      task,
      parentSessionId: options.parentSessionId,
      description: options.description,
      createdAt: now,
      updatedAt: now,
      agentUrl: options.agentUrl,
      agentName: options.agentName,
      isActive: true,
      listeners: new Set(),
    };

    this.tasks.set(taskId, managedTask);

    // Index by parent session
    if (options.parentSessionId) {
      if (!this.sessionTasks.has(options.parentSessionId)) {
        this.sessionTasks.set(options.parentSessionId, new Set());
      }
      this.sessionTasks.get(options.parentSessionId)!.add(taskId);
    }

    // Index by context
    if (!this.contextTasks.has(contextId)) {
      this.contextTasks.set(contextId, new Set());
    }
    this.contextTasks.get(contextId)!.add(taskId);

    logA2A(`Created task: ${taskId} (context: ${contextId})`);
    return managedTask;
  }

  /**
   * Get a task by ID.
   * 
   * @param taskId - The task ID
   * @returns The managed task or undefined
   */
  getTask(taskId: string): ManagedTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get all tasks.
   * 
   * @returns Array of all managed tasks
   */
  getAllTasks(): ManagedTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get tasks for a parent session.
   * 
   * @param parentSessionId - The parent session ID
   * @returns Array of managed tasks
   */
  getTasksForSession(parentSessionId: string): ManagedTask[] {
    const taskIds = this.sessionTasks.get(parentSessionId);
    if (!taskIds) return [];

    return Array.from(taskIds)
      .map(id => this.tasks.get(id))
      .filter((t): t is ManagedTask => t !== undefined);
  }

  /**
   * Get tasks for a context.
   * 
   * @param contextId - The context ID
   * @returns Array of managed tasks
   */
  getTasksForContext(contextId: string): ManagedTask[] {
    const taskIds = this.contextTasks.get(contextId);
    if (!taskIds) return [];

    return Array.from(taskIds)
      .map(id => this.tasks.get(id))
      .filter((t): t is ManagedTask => t !== undefined);
  }

  /**
   * Update a task's status.
   * 
   * @param taskId - The task ID
   * @param state - New state
   * @param message - Optional status message
   */
  updateStatus(taskId: string, state: A2ATaskState, message?: A2AMessage): void {
    const managed = this.tasks.get(taskId);
    if (!managed) {
      logA2A(`Task not found: ${taskId}`);
      return;
    }

    const status: A2ATaskStatus = {
      state,
      message,
      timestamp: new Date().toISOString(),
    };

    managed.task.status = status;
    managed.updatedAt = Date.now();

    if (isTerminalState(state)) {
      managed.isActive = false;
    }

    // Emit event
    this.emitEvent(taskId, {
      taskId,
      type: 'status',
      data: status,
    });

    logA2A(`Task ${taskId} status: ${state}`);

    // Emit completion/failure events
    if (state === 'completed') {
      this.emitEvent(taskId, { taskId, type: 'completed', data: 'Task completed' });
    } else if (state === 'failed') {
      this.emitEvent(taskId, { taskId, type: 'failed', data: message ? extractTextFromMessage(message) : 'Task failed' });
    }
  }

  /**
   * Add a message to task history.
   * 
   * @param taskId - The task ID
   * @param message - The message to add
   */
  addMessage(taskId: string, message: A2AMessage): void {
    const managed = this.tasks.get(taskId);
    if (!managed) {
      logA2A(`Task not found: ${taskId}`);
      return;
    }

    if (!managed.task.history) {
      managed.task.history = [];
    }

    managed.task.history.push(message);
    managed.updatedAt = Date.now();

    this.emitEvent(taskId, {
      taskId,
      type: 'message',
      data: message,
    });
  }

  /**
   * Add an artifact to the task.
   * 
   * @param taskId - The task ID
   * @param artifact - The artifact to add
   */
  addArtifact(taskId: string, artifact: A2AArtifact): void {
    const managed = this.tasks.get(taskId);
    if (!managed) {
      logA2A(`Task not found: ${taskId}`);
      return;
    }

    if (!managed.task.artifacts) {
      managed.task.artifacts = [];
    }

    // Check if we're appending to an existing artifact
    if (artifact.append && artifact.artifactId) {
      const existing = managed.task.artifacts.find(a => a.artifactId === artifact.artifactId);
      if (existing) {
        existing.parts.push(...artifact.parts);
        existing.lastChunk = artifact.lastChunk;
        managed.updatedAt = Date.now();
        this.emitEvent(taskId, { taskId, type: 'artifact', data: existing });
        return;
      }
    }

    managed.task.artifacts.push(artifact);
    managed.updatedAt = Date.now();

    this.emitEvent(taskId, {
      taskId,
      type: 'artifact',
      data: artifact,
    });
  }

  /**
   * Apply a stream event to a task.
   * 
   * @param taskId - The task ID
   * @param event - The stream event
   */
  applyStreamEvent(taskId: string, event: A2AStreamEvent): void {
    if ('task' in event) {
      // Full task update
      this.updateFromTask(taskId, event.task);
    } else if ('statusUpdate' in event) {
      this.updateStatus(
        taskId,
        event.statusUpdate.status.state,
        event.statusUpdate.status.message
      );
    } else if ('artifactUpdate' in event) {
      this.addArtifact(taskId, event.artifactUpdate.artifact);
    } else if ('message' in event) {
      this.addMessage(taskId, event.message);
    }
  }

  /**
   * Update a managed task from a remote task.
   * 
   * @param taskId - The local task ID
   * @param remoteTask - The remote task data
   */
  updateFromTask(taskId: string, remoteTask: A2ATask): void {
    const managed = this.tasks.get(taskId);
    if (!managed) {
      logA2A(`Task not found: ${taskId}`);
      return;
    }

    // Update status
    if (remoteTask.status) {
      managed.task.status = remoteTask.status;
      
      if (isTerminalState(remoteTask.status.state)) {
        managed.isActive = false;
      }
    }

    // Update history
    if (remoteTask.history) {
      managed.task.history = remoteTask.history;
    }

    // Update artifacts
    if (remoteTask.artifacts) {
      managed.task.artifacts = remoteTask.artifacts;
    }

    // Update metadata
    if (remoteTask.metadata) {
      managed.task.metadata = { ...managed.task.metadata, ...remoteTask.metadata };
    }

    managed.updatedAt = Date.now();

    this.emitEvent(taskId, {
      taskId,
      type: 'status',
      data: managed.task.status,
    });
  }

  /**
   * Cancel a task.
   * 
   * @param taskId - The task ID to cancel
   * @returns Whether the task was found and marked as canceled
   */
  cancelTask(taskId: string): boolean {
    const managed = this.tasks.get(taskId);
    if (!managed) {
      return false;
    }

    if (isTerminalState(managed.task.status.state)) {
      return false;
    }

    this.updateStatus(taskId, 'canceled');
    return true;
  }

  /**
   * Delete a task.
   * 
   * @param taskId - The task ID to delete
   * @returns Whether the task was found and deleted
   */
  deleteTask(taskId: string): boolean {
    const managed = this.tasks.get(taskId);
    if (!managed) {
      return false;
    }

    // Remove from session index
    if (managed.parentSessionId) {
      this.sessionTasks.get(managed.parentSessionId)?.delete(taskId);
    }

    // Remove from context index
    if (managed.task.contextId) {
      this.contextTasks.get(managed.task.contextId)?.delete(taskId);
    }

    this.tasks.delete(taskId);
    logA2A(`Deleted task: ${taskId}`);
    return true;
  }

  /**
   * Add a listener for a specific task.
   * 
   * @param taskId - The task ID
   * @param listener - The event listener
   * @returns Unsubscribe function
   */
  addTaskListener(taskId: string, listener: TaskEventListener): () => void {
    const managed = this.tasks.get(taskId);
    if (!managed) {
      throw new Error(`Task not found: ${taskId}`);
    }

    managed.listeners.add(listener);

    return () => {
      managed.listeners.delete(listener);
    };
  }

  /**
   * Add a global listener for all task events.
   * 
   * @param listener - The event listener
   * @returns Unsubscribe function
   */
  addGlobalListener(listener: TaskEventListener): () => void {
    this.globalListeners.add(listener);

    return () => {
      this.globalListeners.delete(listener);
    };
  }

  /**
   * Emit an event to listeners.
   */
  private emitEvent(
    taskId: string,
    event: Parameters<TaskEventListener>[0]
  ): void {
    // Task-specific listeners
    const managed = this.tasks.get(taskId);
    if (managed) {
      for (const listener of managed.listeners) {
        try {
          listener(event);
        } catch (error) {
          logA2A(`Listener error for task ${taskId}:`, error);
        }
      }
    }

    // Global listeners
    for (const listener of this.globalListeners) {
      try {
        listener(event);
      } catch (error) {
        logA2A('Global listener error:', error);
      }
    }
  }

  /**
   * Clean up old tasks.
   * 
   * @param maxAgeMs - Maximum age in milliseconds (default: 1 hour)
   * @param onlyTerminal - Only clean up tasks in terminal states
   */
  cleanup(maxAgeMs: number = 60 * 60 * 1000, onlyTerminal: boolean = true): number {
    const now = Date.now();
    let count = 0;

    for (const [taskId, managed] of this.tasks) {
      const age = now - managed.updatedAt;

      if (age > maxAgeMs) {
        if (!onlyTerminal || isTerminalState(managed.task.status.state)) {
          this.deleteTask(taskId);
          count++;
        }
      }
    }

    if (count > 0) {
      logA2A(`Cleaned up ${count} old tasks`);
    }

    return count;
  }

  /**
   * Get statistics about managed tasks.
   */
  getStats(): {
    total: number;
    byState: Record<A2ATaskState, number>;
    active: number;
    bySession: number;
    byContext: number;
  } {
    const byState: Record<A2ATaskState, number> = {
      submitted: 0,
      working: 0,
      'input-required': 0,
      completed: 0,
      failed: 0,
      canceled: 0,
      rejected: 0,
      unknown: 0,
    };

    let active = 0;

    for (const managed of this.tasks.values()) {
      byState[managed.task.status.state]++;
      if (managed.isActive) active++;
    }

    return {
      total: this.tasks.size,
      byState,
      active,
      bySession: this.sessionTasks.size,
      byContext: this.contextTasks.size,
    };
  }

  /**
   * Serialize the manager state for debugging.
   */
  toJSON(): object {
    return {
      stats: this.getStats(),
      tasks: Array.from(this.tasks.values()).map(m => ({
        id: m.task.id,
        contextId: m.task.contextId,
        state: m.task.status.state,
        agentName: m.agentName,
        description: m.description?.substring(0, 100),
        isActive: m.isActive,
        createdAt: new Date(m.createdAt).toISOString(),
        updatedAt: new Date(m.updatedAt).toISOString(),
        historyLength: m.task.history?.length || 0,
        artifactCount: m.task.artifacts?.length || 0,
      })),
    };
  }
}

/**
 * Helper to extract text from a message.
 */
function extractTextFromMessage(message: A2AMessage): string {
  return message.parts
    .filter((p): p is { text: string } => 'text' in p)
    .map(p => p.text)
    .join('\n');
}

/** Singleton instance of the A2A task manager */
export const a2aTaskManager = new A2ATaskManager();
