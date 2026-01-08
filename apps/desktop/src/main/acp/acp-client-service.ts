import type {
  ACPAgentDefinition,
  ACPMessage,
  ACPRunRequest,
  ACPRunResult,
} from './types';
import { acpRegistry } from './acp-registry';

interface ActiveRun {
  controller: AbortController;
  agentName: string;
  parentSessionId?: string;
}

function generateRunId(): string {
  const random = Math.random().toString(36).substring(2, 10);
  return `acp_run_${Date.now()}_${random}`;
}

function formatInput(input: string | ACPMessage[]): ACPMessage[] {
  if (typeof input === 'string') {
    return [
      {
        role: 'user',
        parts: [{ content: input, content_type: 'text/plain' }],
      },
    ];
  }
  return input;
}

export class ACPClientService {
  private activeRuns: Map<string, ActiveRun> = new Map();

  private getBaseUrlForAgent(agentName: string): string {
    const agent = acpRegistry.getAgent(agentName);
    if (!agent) {
      throw new Error(`ACP agent "${agentName}" not found in registry`);
    }

    // Normalize trailing slash to avoid double slashes in URL joins.
    return agent.definition.baseUrl.replace(/\/$/, '');
  }

  async discoverAgents(baseUrl: string): Promise<ACPAgentDefinition[]> {
    try {
      const response = await fetch(`${baseUrl}/agents`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to discover agents: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.agents || data || [];
    } catch (error) {
      throw error;
    }
  }

  async runAgentSync(request: ACPRunRequest): Promise<ACPRunResult> {
    const runId = generateRunId();
    const controller = new AbortController();
    const baseUrl = this.getBaseUrlForAgent(request.agentName);

    // Wire external abort signal to internal controller
    const externalSignal = request.signal;
    let externalAbortHandler: (() => void) | undefined;
    if (externalSignal) {
      if (externalSignal.aborted) {
        // Already aborted, abort immediately
        controller.abort();
      } else {
        externalAbortHandler = () => controller.abort();
        externalSignal.addEventListener('abort', externalAbortHandler);
      }
    }

    this.activeRuns.set(runId, {
      controller,
      agentName: request.agentName,
      parentSessionId: request.parentSessionId,
    });

    try {
      const response = await fetch(`${baseUrl}/runs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_name: request.agentName,
          input: formatInput(request.input),
          mode: 'sync',
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to run agent: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      return result as ACPRunResult;
    } catch (error) {
      throw error;
    } finally {
      this.activeRuns.delete(runId);
      // Clean up external signal listener
      if (externalSignal && externalAbortHandler) {
        externalSignal.removeEventListener('abort', externalAbortHandler);
      }
    }
  }

  async runAgentAsync(request: ACPRunRequest): Promise<string> {
    const localRunId = generateRunId();
    const controller = new AbortController();
    const baseUrl = this.getBaseUrlForAgent(request.agentName);

    // Wire external abort signal to internal controller
    const externalSignal = request.signal;
    let externalAbortHandler: (() => void) | undefined;
    if (externalSignal) {
      if (externalSignal.aborted) {
        // Already aborted, abort immediately
        controller.abort();
      } else {
        externalAbortHandler = () => controller.abort();
        externalSignal.addEventListener('abort', externalAbortHandler);
      }
    }

    // Track only while the start request is in-flight.
    // Note: without a server-side cancel endpoint, cancellation is limited to aborting the local
    // HTTP request (it may not stop a server-side run once started).
    this.activeRuns.set(localRunId, {
      controller,
      agentName: request.agentName,
      parentSessionId: request.parentSessionId,
    });

    // Key used in activeRuns. This may be re-keyed to serverRunId if the ACP server returns a
    // different identifier.
    let activeRunId = localRunId;

    try {
      const response = await fetch(`${baseUrl}/runs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agent_name: request.agentName,
          input: formatInput(request.input),
          mode: 'async',
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to start async run: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      const serverRunId: string | undefined = result.run_id;

      // If the server returns a different id, re-key our local tracking so callers can cancel
      // using the returned run id during the in-flight window.
      if (serverRunId && serverRunId !== localRunId) {
        const tracked = this.activeRuns.get(activeRunId);
        if (tracked) {
          this.activeRuns.delete(activeRunId);
          this.activeRuns.set(serverRunId, tracked);
          activeRunId = serverRunId;
        }
      }

      return serverRunId || localRunId;
    } catch (error) {
      throw error;
    } finally {
      // Async mode only needs tracking while the start request is in-flight.
      this.activeRuns.delete(activeRunId);
      // Clean up external signal listener
      if (externalSignal && externalAbortHandler) {
        externalSignal.removeEventListener('abort', externalAbortHandler);
      }
    }
  }

  async getRunStatus(baseUrl: string, runId: string): Promise<ACPRunResult> {
    try {
      const response = await fetch(`${baseUrl}/runs/${runId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get run status: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      return result as ACPRunResult;
    } catch (error) {
      throw error;
    }
  }

  async streamAgent(
    request: ACPRunRequest,
    onChunk: (content: string, thought?: string) => void
  ): Promise<ACPRunResult> {
    const runId = generateRunId();
    const controller = new AbortController();
    const startTime = Date.now();
    const baseUrl = this.getBaseUrlForAgent(request.agentName);

    // Wire external abort signal to internal controller
    const externalSignal = request.signal;
    let externalAbortHandler: (() => void) | undefined;
    if (externalSignal) {
      if (externalSignal.aborted) {
        // Already aborted, abort immediately
        controller.abort();
      } else {
        externalAbortHandler = () => controller.abort();
        externalSignal.addEventListener('abort', externalAbortHandler);
      }
    }

    this.activeRuns.set(runId, {
      controller,
      agentName: request.agentName,
      parentSessionId: request.parentSessionId,
    });

    try {
      const response = await fetch(`${baseUrl}/runs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          agent_name: request.agentName,
          input: formatInput(request.input),
          mode: 'stream',
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to stream agent: ${response.status} ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body for streaming');
      }

      const decoder = new TextDecoder();
      let finalResult: Partial<ACPRunResult> | null = null;
      let buffer = '';
      let collectedContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          // SSE field grammar allows both "data: " (with space) and "data:" (without space)
          if (line.startsWith('data:')) {
            // Handle both "data: value" and "data:value" formats per SSE spec
            const data = line.startsWith('data: ') ? line.slice(6).trim() : line.slice(5).trim();
            if (data === '[DONE]') continue;

            try {
              const event = JSON.parse(data);
              if (event.type === 'chunk' || event.type === 'content') {
                const content = event.content || '';
                collectedContent += content;
                onChunk(content, event.thought);
              } else if (event.type === 'result' || event.type === 'complete') {
                finalResult = event as Partial<ACPRunResult>;
              }
            } catch {
              // Ignore parse errors for partial data
            }
          }
        }
      }

      const endTime = Date.now();
      const output: ACPMessage[] = collectedContent
        ? [
            {
              role: 'assistant',
              parts: [{ content: collectedContent, content_type: 'text/plain' }],
            },
          ]
        : [];

      const baseResult: ACPRunResult = {
        runId,
        agentName: request.agentName,
        status: 'completed',
        startTime,
        endTime,
        output,
        metadata: { duration: endTime - startTime },
      };

      return finalResult ? { ...baseResult, ...finalResult } : baseResult;
    } catch (error) {
      throw error;
    } finally {
      this.activeRuns.delete(runId);
      // Clean up external signal listener
      if (externalSignal && externalAbortHandler) {
        externalSignal.removeEventListener('abort', externalAbortHandler);
      }
    }
  }

  cancelRun(runId: string): void {
    const run = this.activeRuns.get(runId);
    if (run) {
      run.controller.abort();
      this.activeRuns.delete(runId);
    }
  }

  cancelAllRuns(): void {
    for (const [runId, run] of this.activeRuns) {
      run.controller.abort();
    }
    this.activeRuns.clear();
  }

  getActiveRuns(): string[] {
    return Array.from(this.activeRuns.keys());
  }
}

export const acpClientService = new ACPClientService();
