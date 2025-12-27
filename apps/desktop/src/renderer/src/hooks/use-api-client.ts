import { useMemo, useCallback, useRef, useEffect, useState } from 'react'
import { SpeakMCPClient, type ClientConfig, type AgentProgress } from '@speakmcp/client'

interface UseApiClientOptions {
  baseUrl?: string
  apiKey?: string
  autoConnect?: boolean
}

interface ApiClientState {
  client: SpeakMCPClient | null
  isConnected: boolean
  isConnecting: boolean
  error: Error | null
}

/**
 * Hook to get and manage the SpeakMCP API client
 * Provides a singleton client instance that persists across renders
 */
export function useApiClient(options: UseApiClientOptions = {}) {
  const [state, setState] = useState<ApiClientState>({
    client: null,
    isConnected: false,
    isConnecting: false,
    error: null,
  })

  const clientRef = useRef<SpeakMCPClient | null>(null)

  // Create or get client
  const client = useMemo(() => {
    if (clientRef.current) return clientRef.current

    const config: ClientConfig = {
      baseUrl: options.baseUrl ?? 'http://localhost:3456',
      apiKey: options.apiKey ?? 'dev-api-key',
      onAuthError: () => {
        setState(s => ({ ...s, error: new Error('Authentication failed') }))
      },
      onError: (error) => {
        setState(s => ({ ...s, error }))
      },
    }

    const newClient = new SpeakMCPClient(config)
    clientRef.current = newClient
    setState(s => ({ ...s, client: newClient }))

    return newClient
  }, [options.baseUrl, options.apiKey])

  // Connect WebSocket
  const connect = useCallback(() => {
    if (!client) return

    setState(s => ({ ...s, isConnecting: true }))

    client.connectWebSocket((status) => {
      setState(s => ({
        ...s,
        isConnected: status === 'connected',
        isConnecting: status === 'connecting',
        error: status === 'error' ? new Error('WebSocket connection failed') : s.error,
      }))
    })
  }, [client])

  // Disconnect WebSocket
  const disconnect = useCallback(() => {
    if (!client) return
    client.disconnectWebSocket()
    setState(s => ({ ...s, isConnected: false }))
  }, [client])

  // Auto-connect if requested
  useEffect(() => {
    if (options.autoConnect && client) {
      connect()
    }

    return () => {
      disconnect()
    }
  }, [options.autoConnect, client, connect, disconnect])

  return {
    client,
    isConnected: state.isConnected,
    isConnecting: state.isConnecting,
    error: state.error,
    connect,
    disconnect,
  }
}

/**
 * Hook specifically for server configuration from Electron
 * Reads config from electron preload and creates appropriate client
 */
export function useElectronApiClient() {
  const [config, setConfig] = useState<{ baseUrl: string; apiKey: string } | null>(null)

  useEffect(() => {
    // Try to get config from electron
    // @ts-ignore - window.electron may not exist in all contexts
    if (typeof window !== 'undefined' && window.electron?.getServerConfig) {
      // @ts-ignore
      window.electron.getServerConfig().then((cfg: any) => {
        setConfig({
          baseUrl: cfg?.serverUrl ?? 'http://localhost:3456',
          apiKey: cfg?.apiKey ?? 'dev-api-key',
        })
      })
    } else {
      // Default config for development
      setConfig({
        baseUrl: 'http://localhost:3456',
        apiKey: 'dev-api-key',
      })
    }
  }, [])

  return useApiClient({
    baseUrl: config?.baseUrl,
    apiKey: config?.apiKey,
    autoConnect: !!config,
  })
}

