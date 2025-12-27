import { useState, useEffect, useCallback } from 'react'
import type { SpeakMCPClient, HealthStatus } from '@speakmcp/client'

interface UseServerHealthOptions {
  client: SpeakMCPClient | null
  pollInterval?: number // ms, set to 0 to disable polling
}

interface ServerHealthState {
  health: HealthStatus | null
  isLoading: boolean
  error: Error | null
  lastChecked: number | null
}

/**
 * Hook to monitor server health status
 */
export function useServerHealth(options: UseServerHealthOptions) {
  const { client, pollInterval = 30000 } = options

  const [state, setState] = useState<ServerHealthState>({
    health: null,
    isLoading: false,
    error: null,
    lastChecked: null,
  })

  const checkHealth = useCallback(async () => {
    if (!client) return

    setState(s => ({ ...s, isLoading: true, error: null }))

    try {
      const health = await client.getHealth()
      setState({
        health,
        isLoading: false,
        error: null,
        lastChecked: Date.now(),
      })
    } catch (error) {
      setState(s => ({
        ...s,
        isLoading: false,
        error: error instanceof Error ? error : new Error('Health check failed'),
      }))
    }
  }, [client])

  // Initial check and polling
  useEffect(() => {
    if (!client) return

    checkHealth()

    if (pollInterval > 0) {
      const interval = setInterval(checkHealth, pollInterval)
      return () => clearInterval(interval)
    }
  }, [client, pollInterval, checkHealth])

  return {
    ...state,
    checkHealth,
    isHealthy: state.health?.status === 'healthy',
    isDegraded: state.health?.status === 'degraded',
    isUnhealthy: state.health?.status === 'unhealthy',
  }
}

