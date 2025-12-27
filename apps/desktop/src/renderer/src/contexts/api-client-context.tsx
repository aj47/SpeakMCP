import React, { createContext, useContext, useMemo, useEffect, useState, useCallback } from 'react'
import { SpeakMCPClient, type ClientConfig, type WebSocketStatus } from '@speakmcp/client'

interface ApiClientContextValue {
  client: SpeakMCPClient | null
  isConnected: boolean
  wsStatus: WebSocketStatus
  error: Error | null
  connect: () => void
  disconnect: () => void
}

const ApiClientContext = createContext<ApiClientContextValue | null>(null)

interface ApiClientProviderProps {
  children: React.ReactNode
  config?: Partial<ClientConfig>
}

/**
 * Provider component that creates and manages the SpeakMCP API client
 * Should wrap the entire app or sections that need API access
 */
export function ApiClientProvider({ children, config }: ApiClientProviderProps) {
  const [wsStatus, setWsStatus] = useState<WebSocketStatus>('disconnected')
  const [error, setError] = useState<Error | null>(null)

  const client = useMemo(() => {
    const clientConfig: ClientConfig = {
      baseUrl: config?.baseUrl ?? 'http://localhost:3456',
      apiKey: config?.apiKey ?? 'dev-api-key',
      timeout: config?.timeout ?? 30000,
      onAuthError: () => {
        setError(new Error('Authentication failed - invalid API key'))
      },
      onError: (err) => {
        setError(err)
      },
    }

    return new SpeakMCPClient(clientConfig)
  }, [config?.baseUrl, config?.apiKey, config?.timeout])

  const connect = useCallback(() => {
    if (!client) return
    
    setError(null)
    client.connectWebSocket((status) => {
      setWsStatus(status)
      if (status === 'error') {
        setError(new Error('WebSocket connection failed'))
      }
    })
  }, [client])

  const disconnect = useCallback(() => {
    if (!client) return
    client.disconnectWebSocket()
    setWsStatus('disconnected')
  }, [client])

  // Clean up on unmount
  useEffect(() => {
    return () => {
      disconnect()
    }
  }, [disconnect])

  const value = useMemo(
    () => ({
      client,
      isConnected: wsStatus === 'connected',
      wsStatus,
      error,
      connect,
      disconnect,
    }),
    [client, wsStatus, error, connect, disconnect]
  )

  return (
    <ApiClientContext.Provider value={value}>
      {children}
    </ApiClientContext.Provider>
  )
}

/**
 * Hook to access the API client from context
 * Must be used within an ApiClientProvider
 */
export function useApiClientContext(): ApiClientContextValue {
  const context = useContext(ApiClientContext)
  if (!context) {
    throw new Error('useApiClientContext must be used within an ApiClientProvider')
  }
  return context
}

/**
 * Hook to get just the client instance
 * Returns null if not in provider context
 */
export function useClient(): SpeakMCPClient | null {
  const context = useContext(ApiClientContext)
  return context?.client ?? null
}

