import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { SpeakMCPClient, type WebSocketStatus, type HealthStatus } from '@speakmcp/client'

export type ConnectionMode = 'local' | 'remote'

interface ServerConnectionState {
  // Connection mode
  mode: ConnectionMode
  
  // Remote server config
  remoteServerUrl: string
  remoteApiKey: string
  
  // Connection state
  isConnected: boolean
  isConnecting: boolean
  wsStatus: WebSocketStatus
  healthStatus: HealthStatus | null
  lastError: string | null
  
  // Client instance (not persisted)
  client: SpeakMCPClient | null
  
  // Actions
  setMode: (mode: ConnectionMode) => void
  setRemoteConfig: (url: string, apiKey: string) => void
  connect: () => Promise<void>
  disconnect: () => void
  checkHealth: () => Promise<void>
  getClient: () => SpeakMCPClient | null
}

export const useServerConnectionStore = create<ServerConnectionState>()(
  persist(
    (set, get) => ({
      // Initial state
      mode: 'local',
      remoteServerUrl: 'http://localhost:3456',
      remoteApiKey: '',
      isConnected: false,
      isConnecting: false,
      wsStatus: 'disconnected',
      healthStatus: null,
      lastError: null,
      client: null,
      
      setMode: (mode) => {
        const state = get()
        // Disconnect when switching modes
        if (state.client) {
          state.disconnect()
        }
        set({ mode })
      },
      
      setRemoteConfig: (url, apiKey) => {
        set({ remoteServerUrl: url, remoteApiKey: apiKey })
      },
      
      connect: async () => {
        const state = get()
        
        if (state.mode === 'local') {
          // Local mode - no client needed, uses IPC
          set({ isConnected: true, isConnecting: false, lastError: null })
          return
        }
        
        // Remote mode - create client and connect
        set({ isConnecting: true, lastError: null })
        
        try {
          const client = new SpeakMCPClient({
            baseUrl: state.remoteServerUrl,
            apiKey: state.remoteApiKey,
            onError: (error) => {
              set({ lastError: error.message })
            },
            onAuthError: () => {
              set({ lastError: 'Authentication failed - check your API key' })
            },
          })
          
          // Check health first
          const health = await client.getHealth()
          
          // Connect WebSocket
          client.connectWebSocket((status) => {
            set({ wsStatus: status })
            if (status === 'error') {
              set({ lastError: 'WebSocket connection failed' })
            }
          })
          
          set({
            client,
            isConnected: true,
            isConnecting: false,
            healthStatus: health,
            lastError: null,
          })
        } catch (error) {
          set({
            isConnected: false,
            isConnecting: false,
            lastError: error instanceof Error ? error.message : 'Connection failed',
          })
        }
      },
      
      disconnect: () => {
        const state = get()
        if (state.client) {
          state.client.disconnectWebSocket()
        }
        set({
          client: null,
          isConnected: false,
          wsStatus: 'disconnected',
          healthStatus: null,
        })
      },
      
      checkHealth: async () => {
        const state = get()
        if (!state.client) return
        
        try {
          const health = await state.client.getHealth()
          set({ healthStatus: health, lastError: null })
        } catch (error) {
          set({ lastError: error instanceof Error ? error.message : 'Health check failed' })
        }
      },
      
      getClient: () => get().client,
    }),
    {
      name: 'speakmcp-server-connection',
      storage: createJSONStorage(() => localStorage),
      // Only persist these fields
      partialize: (state) => ({
        mode: state.mode,
        remoteServerUrl: state.remoteServerUrl,
        remoteApiKey: state.remoteApiKey,
      }),
    }
  )
)

// Helper hooks
export const useIsRemoteMode = () => useServerConnectionStore((s) => s.mode === 'remote')
export const useServerClient = () => useServerConnectionStore((s) => s.client)
export const useServerHealth = () => useServerConnectionStore((s) => s.healthStatus)

