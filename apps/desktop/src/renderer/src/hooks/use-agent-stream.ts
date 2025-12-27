import { useState, useCallback, useRef } from 'react'
import type { SpeakMCPClient, AgentProgress, AgentOptions } from '@speakmcp/client'

interface UseAgentStreamOptions {
  client: SpeakMCPClient | null
  onProgress?: (progress: AgentProgress) => void
  onComplete?: (content: string) => void
  onError?: (error: string) => void
}

interface AgentStreamState {
  isProcessing: boolean
  currentSessionId: string | null
  progress: AgentProgress[]
  finalContent: string | null
  error: string | null
}

/**
 * Hook for managing agent processing with streaming updates
 */
export function useAgentStream(options: UseAgentStreamOptions) {
  const { client, onProgress, onComplete, onError } = options

  const [state, setState] = useState<AgentStreamState>({
    isProcessing: false,
    currentSessionId: null,
    progress: [],
    finalContent: null,
    error: null,
  })

  const abortRef = useRef(false)

  const process = useCallback(async (
    input: string,
    agentOptions?: AgentOptions
  ) => {
    if (!client) {
      const error = 'Client not initialized'
      setState(s => ({ ...s, error }))
      onError?.(error)
      return
    }

    abortRef.current = false
    setState({
      isProcessing: true,
      currentSessionId: null,
      progress: [],
      finalContent: null,
      error: null,
    })

    try {
      for await (const progress of client.processAgent(input, agentOptions)) {
        if (abortRef.current) break

        setState(s => ({
          ...s,
          currentSessionId: progress.sessionId,
          progress: [...s.progress, progress],
        }))

        onProgress?.(progress)

        if (progress.type === 'response' && progress.content) {
          setState(s => ({ ...s, finalContent: progress.content! }))
          onComplete?.(progress.content)
        }

        if (progress.type === 'error') {
          setState(s => ({ ...s, error: progress.error ?? 'Unknown error' }))
          onError?.(progress.error ?? 'Unknown error')
        }

        if (progress.type === 'done' || progress.type === 'error') {
          break
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      setState(s => ({ ...s, error: errorMsg }))
      onError?.(errorMsg)
    } finally {
      setState(s => ({ ...s, isProcessing: false }))
    }
  }, [client, onProgress, onComplete, onError])

  const stop = useCallback(async () => {
    abortRef.current = true
    if (client && state.currentSessionId) {
      try {
        await client.stopAgent(state.currentSessionId)
      } catch {
        // Ignore stop errors
      }
    }
    setState(s => ({ ...s, isProcessing: false }))
  }, [client, state.currentSessionId])

  const reset = useCallback(() => {
    setState({
      isProcessing: false,
      currentSessionId: null,
      progress: [],
      finalContent: null,
      error: null,
    })
  }, [])

  return {
    ...state,
    process,
    stop,
    reset,
  }
}

