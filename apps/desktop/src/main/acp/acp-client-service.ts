import type {
  ACPAgentDefinition,
  ACPMessage,
  ACPMessagePart,
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
        parts: [{ type: 'text', content: input }] as ACPMessagePart[],
      },
    ];
  }
  return input;
}

class ACPClientService {
  private activeRuns: Map<string, ActiveRun> = new Map();

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
      console.error('[ACP Client] Error discovering agents:', error);
      throw error;
    }
  }

  async runAgentSync(request: ACPRunRequest): Promise<ACPRunResult> {
    const runId = generateRunId();
    const controller = new AbortController();

    this.activeRuns.set(runId, {
      controller,
      agentName: request.agentName,
      parentSessionId: request.parentSessionId,
    });

    try {
      const response = await fetch(`${request.baseUrl}/runs`, {
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
      if ((error as Error).name === 'AbortError') {
        console.log(`[ACP Client] Run ${runId} was cancelled`);
      } else {
        console.error('[ACP Client] Error running agent sync:', error);
      }
      throw error;
    } finally {
      this.activeRuns.delete(runId);
    }
  }

  async runAgentAsync(request: ACPRunRequest): Promise<string> {
    const runId = generateRunId();
    const controller = new AbortController();

    this.activeRuns.set(runId, {
      controller,
      agentName: request.agentName,
      parentSessionId: request.parentSessionId,
    });

    try {
      const response = await fetch(`${request.baseUrl}/runs`, {
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
      return result.run_id || runId;
    } catch (error) {
      console.error('[ACP Client] Error running agent async:', error);
      this.activeRuns.delete(runId);
      throw error;
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
      console.error('[ACP Client] Error getting run status:', error);
      throw error;
    }
  }

  async streamAgent(
    request: ACPRunRequest,
    onChunk: (content: string, thought?: string) => void
  ): Promise<ACPRunResult> {
    const runId = generateRunId();
    const controller = new AbortController();

    this.activeRuns.set(runId, {
      controller,
      agentName: request.agentName,
      parentSessionId: request.parentSessionId,
    });

    try {
      const response = await fetch(`${request.baseUrl}/runs`, {
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
      let finalResult: ACPRunResult | null = null;
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;

            try {
              const event = JSON.parse(data);
              if (event.type === 'chunk' || event.type === 'content') {
                onChunk(event.content || '', event.thought);
              } else if (event.type === 'result' || event.type === 'complete') {
                finalResult = event as ACPRunResult;
              }
            } catch {
              // Ignore parse errors for partial data
            }
          }
        }
      }

      return finalResult || { status: 'completed', output: [] };
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        console.log(`[ACP Client] Stream ${runId} was cancelled`);
      } else {
        console.error('[ACP Client] Error streaming agent:', error);
      }
      throw error;
    } finally {
      this.activeRuns.delete(runId);
    }
  }

  cancelRun(runId: string): void {
    const run = this.activeRuns.get(runId);
    if (run) {
      console.log(`[ACP Client] Cancelling run ${runId}`);
      run.controller.abort();
      this.activeRuns.delete(runId);
    }
  }

  cancelAllRuns(): void {
    console.log(`[ACP Client] Cancelling all ${this.activeRuns.size} active runs`);
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
