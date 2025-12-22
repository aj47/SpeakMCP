import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useConfig } from './config'
import {
  TunnelClient,
  TunnelMessage,
  TunnelMetadata,
  TunnelState,
} from '../lib/tunnelClient'

export type TunnelManager = {
  state: TunnelState
  metadata: TunnelMetadata | undefined
  send: (message: TunnelMessage) => Promise<void>
  reconnect: (forceNew?: boolean) => Promise<void>
  forceNewTunnel: () => Promise<void>
}

const TunnelManagerContext = createContext<TunnelManager | null>(null)

export function TunnelManagerProvider({ children }: { children: ReactNode }) {
  const config = useConfig()
  const manager = useTunnelManagerProvider({
    baseUrl: config.config.baseUrl,
    apiKey: config.config.apiKey,
  })

  return <TunnelManagerContext.Provider value={manager}>{children}</TunnelManagerContext.Provider>
}

export function useTunnelManager(): TunnelManager {
  const ctx = useContext(TunnelManagerContext)
  if (!ctx) {
    throw new Error('useTunnelManager must be used within a TunnelManagerProvider')
  }
  return ctx
}

type ProviderConfig = {
  baseUrl: string
  apiKey: string
}

export function useTunnelManagerProvider(config: ProviderConfig): TunnelManager {
  const clientRef = useRef<TunnelClient | null>(null)
  const [state, setState] = useState<TunnelState>({
    status: 'idle',
    retryCount: 0,
    isAppActive: true,
  })

  useEffect(() => {
    if (!config.baseUrl || !config.apiKey) {
      setState((prev) => ({ ...prev, status: 'idle' }))
      if (clientRef.current) {
        clientRef.current.cleanup()
        clientRef.current = null
      }
      return undefined
    }

    const client = new TunnelClient({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      onStatusChange: setState,
      onMessage: (msg) => {
        // Future: route inbound tunnel messages; currently just log for observability.
        if (__DEV__) {
          console.log('[TunnelManager] message', msg)
        }
      },
    })

    clientRef.current = client

    // Kick off initial connection in the background
    client.ensureConnected().catch((err) => {
      console.warn('[TunnelManager] initial connect failed', err)
    })

    return () => {
      client.cleanup()
      clientRef.current = null
    }
  }, [config.apiKey, config.baseUrl])

  const send = useMemo(
    () => async (message: TunnelMessage) => {
      if (!clientRef.current) return
      await clientRef.current.send(message)
    },
    [],
  )

  const reconnect = useMemo(
    () => async (forceNew?: boolean) => {
      if (!clientRef.current) return
      await clientRef.current.ensureConnected(Boolean(forceNew))
    },
    [],
  )

  const forceNewTunnel = useMemo(
    () => async () => {
      if (!clientRef.current) return
      await clientRef.current.forceNewTunnel()
    },
    [],
  )

  return {
    state,
    metadata: state.metadata,
    send,
    reconnect,
    forceNewTunnel,
  }
}
