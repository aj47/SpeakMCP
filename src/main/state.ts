import { ChildProcess } from "child_process"

export const state = {
  isRecording: false,
  isTextInputActive: false,
  focusedAppBeforeRecording: null as string | null,
  // Agent mode state
  isAgentModeActive: false,
  agentProcesses: new Set<ChildProcess>(),
  shouldStopAgent: false,
  agentIterationCount: 0
}

// Process management for agent mode
export const agentProcessManager = {
  // Register a process created during agent mode
  registerProcess(process: ChildProcess) {
    state.agentProcesses.add(process)

    // Clean up when process exits
    process.on('exit', (code, signal) => {
      state.agentProcesses.delete(process)
    })

    process.on('error', (error) => {
      state.agentProcesses.delete(process)
    })
  },

  // Kill all agent processes gracefully
  async killAllProcesses(): Promise<void> {
    const processes = Array.from(state.agentProcesses)
    const killPromises: Promise<void>[] = []

    for (const process of processes) {
      killPromises.push(new Promise<void>((resolve) => {
        if (process.killed || process.exitCode !== null) {
          resolve()
          return
        }

        // Try graceful shutdown first
        process.kill('SIGTERM')

        // Force kill after timeout
        const forceKillTimeout = setTimeout(() => {
          if (!process.killed && process.exitCode === null) {
            process.kill('SIGKILL')
          }
          resolve()
        }, 3000) // 3 second timeout

        process.on('exit', () => {
          clearTimeout(forceKillTimeout)
          resolve()
        })
      }))
    }

    await Promise.all(killPromises)
    state.agentProcesses.clear()
  },

  // Emergency stop - immediately kill all processes
  emergencyStop(): void {
    for (const process of state.agentProcesses) {
      try {
        if (!process.killed && process.exitCode === null) {
          process.kill('SIGKILL')
        }
      } catch (error) {
        // Ignore errors during emergency stop
      }
    }
    state.agentProcesses.clear()
  },

  // Get count of active processes
  getActiveProcessCount(): number {
    return state.agentProcesses.size
  }
}
