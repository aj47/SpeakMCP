import { Notification } from 'electron'
import { acpClientService } from './acp-client-service'
import { emitAgentProgress } from '../emit-agent-progress'
import type { ACPDelegationProgress } from '../../shared/types'
import { logApp } from '../debug'
import type { ACPSubAgentState } from './types'

/**
 * Background polling and notification system for ACP delegations.
 * Monitors running delegated tasks and emits completion notifications to the UI.
 */
export class ACPBackgroundNotifier {
  private pollingInterval: ReturnType<typeof setInterval> | undefined
  private delegatedRuns: Map<string, ACPSubAgentState> | undefined
  private readonly POLL_INTERVAL_MS = 3000

  /**
   * Sets the reference to the delegated runs map from acp-router-tools.
   */
  setDelegatedRunsMap(map: Map<string, ACPSubAgentState>): void {
    this.delegatedRuns = map
  }

  /**
   * Starts the polling loop if not already running.
   */
  startPolling(): void {
    if (this.pollingInterval) {
      return
    }

    logApp('[ACPBackgroundNotifier] Starting polling for delegated tasks')
    this.pollingInterval = setInterval(() => {
      this.pollRunningTasks().catch((error) => {
        logApp('[ACPBackgroundNotifier] Error during polling:', error)
      })
    }, this.POLL_INTERVAL_MS)
  }

  /**
   * Clears the polling interval.
   */
  stopPolling(): void {
    if (this.pollingInterval) {
      logApp('[ACPBackgroundNotifier] Stopping polling')
      clearInterval(this.pollingInterval)
      this.pollingInterval = undefined
    }
  }

  /**
   * Returns true if any tasks are poll-worthy (running with required fields).
   */
  hasRunningTasks(): boolean {
    if (!this.delegatedRuns) {
      return false
    }

    for (const state of this.delegatedRuns.values()) {
      if (state.status === 'running' && state.baseUrl && state.acpRunId) {
        return true
      }
    }
    return false
  }

  /**
   * Polls running tasks for status updates and emits notifications.
   */
  async pollRunningTasks(): Promise<void> {
    if (!this.delegatedRuns) {
      return
    }

    for (const [runId, state] of this.delegatedRuns.entries()) {
      if (state.status !== 'running' || !state.baseUrl || !state.acpRunId) {
        continue
      }

      try {
        const result = await acpClientService.getRunStatus(state.baseUrl, state.acpRunId)

        if (result.status === 'completed' || result.status === 'failed') {
          // Update the task state
          state.status = result.status
          state.result = result

          logApp(
            `[ACPBackgroundNotifier] Task ${runId} (${state.agentName}) ${result.status}`
          )

          // Notify the UI
          await this.emitDelegationComplete(state)
        }
      } catch (error) {
        logApp(
          `[ACPBackgroundNotifier] Error checking status for task ${runId}:`,
          error
        )
      }
    }

    // Stop polling if no running tasks remain
    if (!this.hasRunningTasks()) {
      this.stopPolling()
    }
  }

  /**
   * Emits a notification when a delegation completes.
   */
  private async emitDelegationComplete(state: ACPSubAgentState): Promise<void> {
    logApp(
      `[ACPBackgroundNotifier] Emitting completion notification for ${state.agentName} (${state.runId})`
    )

    // Extract result summary from output messages
    let resultSummary: string | undefined
    if (state.result?.output && state.result.output.length > 0) {
      // Get text content from the first message's parts
      const firstMessage = state.result.output[0]
      if (firstMessage.parts && firstMessage.parts.length > 0) {
        // Filter for text parts (content_type is undefined or text/plain)
        const textParts = firstMessage.parts
          .filter((p) => !p.content_type || p.content_type.startsWith('text/'))
          .map((p) => p.content)
          .join(' ')
        resultSummary = textParts.substring(0, 200)
      }
    }

    const delegationProgress: ACPDelegationProgress = {
      runId: state.runId,
      agentName: state.agentName,
      task: state.task,
      status: state.status,
      startTime: state.startTime,
      endTime: Date.now(),
      progressMessage: state.progress,
      resultSummary,
      error: state.status === 'failed' ? state.result?.error : undefined,
    }

    // Mark as complete for any terminal state (completed or failed)
    const isTerminalState = state.status === 'completed' || state.status === 'failed'

    // Emit progress update to UI
    await emitAgentProgress({
      sessionId: state.parentSessionId,
      currentIteration: 0,
      maxIterations: 1,
      isComplete: isTerminalState,
      steps: [
        {
          id: `delegation-complete-${state.runId}`,
          type: 'completion',
          title: `Delegation ${state.status}: ${state.agentName}`,
          description: state.task,
          status: state.status === 'completed' ? 'completed' : 'error',
          timestamp: Date.now(),
          delegation: delegationProgress,
        },
      ],
    })

    // Show native OS notification
    this.showSystemNotification(state, resultSummary)
  }

  /**
   * Shows a native OS notification for delegation completion.
   */
  private showSystemNotification(state: ACPSubAgentState, resultSummary?: string): void {
    try {
      if (!Notification.isSupported()) {
        logApp('[ACPBackgroundNotifier] System notifications not supported')
        return
      }

      const isSuccess = state.status === 'completed'
      const duration = Math.round((Date.now() - state.startTime) / 1000)

      const notification = new Notification({
        title: isSuccess
          ? `✅ ${state.agentName} completed`
          : `❌ ${state.agentName} failed`,
        body: resultSummary
          ? `${state.task.substring(0, 50)}${state.task.length > 50 ? '...' : ''}\n${resultSummary.substring(0, 100)}${resultSummary.length > 100 ? '...' : ''}`
          : `${state.task.substring(0, 100)}${state.task.length > 100 ? '...' : ''}\nCompleted in ${duration}s`,
        silent: false,
      })

      notification.show()
    } catch (error) {
      logApp('[ACPBackgroundNotifier] Failed to show system notification:', error)
    }
  }
}

export const acpBackgroundNotifier = new ACPBackgroundNotifier()

