/**
 * TypeScript types and interfaces for the ACP (Agent Communication Protocol) multi-agent router system.
 */

import type { ChildProcess } from 'child_process';

/**
 * Definition of an ACP agent - describes an agent's capabilities and configuration.
 */
export interface ACPAgentDefinition {
  /** Unique identifier for the agent */
  name: string;
  /** Human-readable display name */
  displayName: string;
  /** Description of what the agent does */
  description: string;
  /** Capability tags like "research", "coding", "analysis" */
  capabilities: string[];
  /** ACP server URL for this agent */
  baseUrl: string;
  /** Configuration for spawning the agent process */
  spawnConfig?: {
    command: string;
    args: string[];
    env?: Record<string, string>;
    cwd?: string;
    startupTimeMs?: number;
  };
  /** JSON schema for agent input validation */
  inputSchema?: object;
  /** JSON schema for agent output validation */
  outputSchema?: object;
  /** Maximum concurrent runs allowed for this agent */
  maxConcurrency?: number;
  /** Default timeout in milliseconds */
  timeout?: number;
  /** Idle timeout in milliseconds - how long to wait before stopping an idle agent */
  idleTimeoutMs?: number;
}

/**
 * Runtime state of an ACP agent instance.
 */
export interface ACPAgentInstance {
  /** The agent's definition */
  definition: ACPAgentDefinition;
  /** Current status of the agent */
  status: 'stopped' | 'starting' | 'ready' | 'busy' | 'error';
  /** The spawned child process (if applicable) */
  process?: ChildProcess;
  /** Process ID of the spawned agent */
  pid?: number;
  /** Number of currently active runs */
  activeRuns: number;
  /** Timestamp of last usage */
  lastUsed?: number;
  /** Last error message if status is 'error' */
  lastError?: string;
}

/**
 * Part of an ACP message - represents a single content piece.
 */
export interface ACPMessagePart {
  /** The content of this message part */
  content: string;
  /** MIME type of the content (default: "text/plain") */
  content_type?: string;
  /** Optional name for this part (e.g., filename) */
  name?: string;
  /** Additional metadata for this part */
  metadata?: Record<string, unknown>;
}

/**
 * ACP protocol message - a complete message with one or more parts.
 */
export interface ACPMessage {
  /** Role of the message sender (e.g., "user", "assistant") */
  role: string;
  /** Array of message parts */
  parts: ACPMessagePart[];
  /** ISO timestamp when the message was created */
  created_at?: string;
  /** ISO timestamp when the message was completed */
  completed_at?: string;
}

/**
 * Request to run an ACP agent.
 */
export interface ACPRunRequest {
  /** Name of the agent to run */
  agentName: string;
  /** Input for the agent - either a string or array of messages */
  input: string | ACPMessage[];
  /** Execution mode */
  mode: 'sync' | 'async' | 'stream';
  /** Session ID for this run */
  sessionId?: string;
  /** Parent session ID - links to main SpeakMCP session */
  parentSessionId?: string;
  /** Timeout in milliseconds for this specific run */
  timeout?: number;
  /** External abort signal to cancel the request */
  signal?: AbortSignal;
}

/**
 * Result from an ACP agent run.
 */
export interface ACPRunResult {
  /** Unique identifier for this run */
  runId: string;
  /** Name of the agent that was run */
  agentName: string;
  /** Current status of the run */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  /** Output messages from the agent */
  output?: ACPMessage[];
  /** Error message if the run failed */
  error?: string;
  /** Timestamp when the run started */
  startTime: number;
  /** Timestamp when the run ended */
  endTime?: number;
  /** Additional metadata about the run */
  metadata?: {
    duration?: number;
    tokensUsed?: number;
    toolCalls?: number;
  };
}

/**
 * State of a delegated sub-agent run - tracks runs spawned by the main agent.
 */
export interface ACPSubAgentState {
  /** Unique identifier for this sub-agent run */
  runId: string;
  /** Name of the sub-agent */
  agentName: string;
  /** Parent session ID linking to the main SpeakMCP session */
  parentSessionId: string;
  /** Description of the task delegated to this sub-agent */
  task: string;
  /** Current status of the sub-agent run */
  status: 'pending' | 'running' | 'completed' | 'failed';
  /** Timestamp when the sub-agent run started */
  startTime: number;
  /** Result from the sub-agent run (when completed) */
  result?: ACPRunResult;
  /** Progress message or status update */
  progress?: string;
  /** The ACP server's run ID for async runs */
  acpRunId?: string;
  /** Base URL for the agent (needed for status checks) */
  baseUrl?: string;
}

/**
 * Configuration for an ACP agent - used in user configuration files.
 */
export interface ACPAgentConfig {
  /** Unique name identifier for the agent */
  name: string;
  /** Human-readable display name */
  displayName?: string;
  /** Description of the agent's purpose */
  description?: string;
  /** Capability tags for agent discovery */
  capabilities?: string[];
  /** Connection configuration - either remote URL or spawn configuration */
  connection:
    | { type: 'remote'; baseUrl: string }
    | {
        type: 'spawn';
        command: string;
        args?: string[];
        env?: Record<string, string>;
        cwd?: string;
        port?: number;
      };
  /** Whether to automatically spawn the agent when needed */
  autoSpawn?: boolean;
  /** Whether to keep the agent alive after runs complete */
  keepAlive?: boolean;
  /** Time in milliseconds before idle agent is stopped */
  idleTimeoutMs?: number;
  /** Maximum number of concurrent runs for this agent */
  maxConcurrentRuns?: number;
  /** Default timeout in milliseconds for agent runs */
  defaultTimeout?: number;
}

