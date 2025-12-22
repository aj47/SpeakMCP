import AsyncStorage from '@react-native-async-storage/async-storage'
import EventSource from 'react-native-sse'
import {
  ConnectionRecoveryConfig,
  ConnectionRecoveryManager,
  DEFAULT_RECOVERY_CONFIG,
  isRetryableError,
} from './connectionRecovery'

const STORAGE_KEY = 'tunnel_state_v1'

export type TunnelStatus =
  | 'idle'
  | 'connecting'
  | 'resuming'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'failed'

export type TunnelMessage = {
  type?: string
  [key: string]: any
}

export type TunnelMetadata = {
  deviceId: string
  tunnelId: string
  resumeToken: string
  streamUrl: string
  sendUrl?: string
  createdAt?: number
}

export type TunnelState = {
  status: TunnelStatus
  retryCount: number
  lastError?: string
  isAppActive: boolean
  metadata?: TunnelMetadata
  lastHeartbeatAt?: number
}

export type TunnelClientOptions = {
  baseUrl: string
  apiKey: string
  recoveryConfig?: Partial<ConnectionRecoveryConfig>
  onStatusChange?: (state: TunnelState) => void
  onMessage?: (message: TunnelMessage) => void
}

type PersistedState = {
  metadata: TunnelMetadata
  lastStatus?: TunnelStatus
  lastHeartbeatAt?: number
  updatedAt: number
}

type TunnelApiResponse = {
  tunnelId: string
  resumeToken: string
  streamEndpoint?: string
  endpoint?: string
  streamUrl?: string
  sendEndpoint?: string
  sendUrl?: string
}

function nowMs(): number {
  return Date.now()
}

function normalizeUrl(baseUrl: string, maybeRelative?: string): string | undefined {
  if (!maybeRelative) return undefined
  if (maybeRelative.startsWith('http://') || maybeRelative.startsWith('https://')) {
    return maybeRelative
  }
  const trimmedBase = baseUrl.replace(/\/+$/, '')
  const relative = maybeRelative.startsWith('/') ? maybeRelative : `/${maybeRelative}`
  return `${trimmedBase}${relative}`
}

function generateDeviceId(): string {
  // RFC4122-ish without crypto dependency to keep compatibility with RN runtime
  const rnd = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1)
  return `device-${rnd()}${rnd()}-${rnd()}-${rnd()}-${rnd()}-${rnd()}${rnd()}${rnd()}`
}

export class TunnelClient {
  private readonly options: TunnelClientOptions
  private readonly recovery: ConnectionRecoveryManager
  private state: TunnelState
  private eventSource: EventSource | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private queue: TunnelMessage[] = []
  private isShuttingDown = false
  private initialised = false

  constructor(options: TunnelClientOptions) {
    this.options = options
    this.state = {
      status: 'idle',
      retryCount: 0,
      isAppActive: true,
    }

    this.recovery = new ConnectionRecoveryManager(
      {
        ...DEFAULT_RECOVERY_CONFIG,
        ...options.recoveryConfig,
      },
      (recoveryState) => {
        this.state.isAppActive = recoveryState.isAppActive
        this.state.retryCount = recoveryState.retryCount
        this.notify()
      },
    )
  }

  getMetadata(): TunnelMetadata | undefined {
    return this.state.metadata
  }

  getState(): TunnelState {
    return { ...this.state }
  }

  async initialize(): Promise<void> {
    if (this.initialised) return

    const persisted = await AsyncStorage.getItem(STORAGE_KEY)
    if (persisted) {
      try {
        const parsed = JSON.parse(persisted) as PersistedState
        if (parsed?.metadata?.deviceId && parsed?.metadata?.resumeToken && parsed?.metadata?.tunnelId) {
          this.state.metadata = parsed.metadata
          this.state.lastHeartbeatAt = parsed.lastHeartbeatAt
          this.state.status = parsed.lastStatus ?? 'idle'
        }
      } catch (err) {
        console.warn('[TunnelClient] Failed to parse persisted tunnel state', err)
      }
    }

    if (!this.state.metadata?.deviceId) {
      const deviceId = generateDeviceId()
      this.state.metadata = {
        deviceId,
        tunnelId: '',
        resumeToken: '',
        streamUrl: '',
      }
      await this.persistState()
    }

    this.initialised = true
  }

  async ensureConnected(forceNewTunnel: boolean = false): Promise<void> {
    if (this.isShuttingDown) return
    await this.initialize()

    // Avoid overlapping connection attempts
    if (this.state.status === 'connecting' || this.state.status === 'resuming') {
      return
    }

    // If we already have an open stream, do nothing
    if (!forceNewTunnel && this.state.status === 'connected' && this.eventSource) {
      return
    }

    await this.connectInternal(forceNewTunnel)
  }

  async send(message: TunnelMessage): Promise<void> {
    // Queue until we know the tunnel is connected
    if (this.state.status !== 'connected' || !this.state.metadata?.tunnelId || !this.state.metadata?.sendUrl) {
      this.queue.push(message)
      return
    }

    await this.sendImmediately(message)
  }

  async forceNewTunnel(): Promise<void> {
    if (this.state.metadata) {
      // Preserve deviceId but drop tunnel identifiers
      this.state.metadata = {
        deviceId: this.state.metadata.deviceId,
        tunnelId: '',
        resumeToken: '',
        streamUrl: '',
      }
      await this.persistState()
    }
    await this.ensureConnected(true)
  }

  async disconnect(): Promise<void> {
    this.isShuttingDown = true
    this.clearReconnectTimer()
    this.closeStream()
    this.recovery.stopHeartbeat()
    this.state.status = 'disconnected'
    this.notify()
  }

  cleanup(): void {
    this.disconnect()
  }

  // Internal helpers
  private updateStatus(status: TunnelStatus, error?: string): void {
    this.state.status = status
    if (error) {
      this.state.lastError = error
    }
    this.state.retryCount = this.recovery.getState().retryCount
    this.notify()
  }

  private notify(): void {
    this.options.onStatusChange?.({ ...this.state })
  }

  private buildUrl(path: string): string {
    const base = this.options.baseUrl.replace(/\/+$/, '')
    const suffix = path.startsWith('/') ? path : `/${path}`
    return `${base}${suffix}`
  }

  private authHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.options.apiKey}`,
      'Content-Type': 'application/json',
    }
  }

  private async persistState(): Promise<void> {
    if (!this.state.metadata) return
    const payload: PersistedState = {
      metadata: this.state.metadata,
      lastStatus: this.state.status,
      lastHeartbeatAt: this.state.lastHeartbeatAt,
      updatedAt: nowMs(),
    }
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    } catch (err) {
      console.warn('[TunnelClient] Failed to persist state', err)
    }
  }

  private normalizeMetadata(apiData: TunnelApiResponse, deviceId: string): TunnelMetadata {
    const streamUrl = normalizeUrl(
      this.options.baseUrl,
      apiData.streamUrl || apiData.streamEndpoint || apiData.endpoint,
    ) || this.buildUrl(`/tunnels/${apiData.tunnelId}/stream`)

    const sendUrl = normalizeUrl(
      this.options.baseUrl,
      apiData.sendUrl || apiData.sendEndpoint,
    ) || this.buildUrl(`/tunnels/${apiData.tunnelId}/messages`)

    return {
      deviceId,
      tunnelId: apiData.tunnelId,
      resumeToken: apiData.resumeToken,
      streamUrl,
      sendUrl,
      createdAt: nowMs(),
    }
  }

  private async connectInternal(forceNewTunnel: boolean): Promise<void> {
    if (!this.state.metadata?.deviceId) {
      this.state.metadata = {
        deviceId: generateDeviceId(),
        tunnelId: '',
        resumeToken: '',
        streamUrl: '',
      }
    }

    // Prefer resume if we have a resume token and not forcing a new tunnel
    if (!forceNewTunnel && this.state.metadata?.resumeToken && this.state.metadata.tunnelId) {
      this.updateStatus('resuming')
      const resumed = await this.tryResume()
      if (resumed) return
      console.warn('[TunnelClient] Resume failed, falling back to new tunnel')
    }

    this.updateStatus('connecting')
    await this.createTunnel()
  }

  private async tryResume(): Promise<boolean> {
    if (!this.state.metadata) return false

    try {
      const response = await fetch(this.buildUrl('/tunnels/resume'), {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify({
          deviceId: this.state.metadata.deviceId,
          resumeToken: this.state.metadata.resumeToken,
        }),
      })

      if (!response.ok) {
        this.updateStatus('reconnecting', `Resume failed (${response.status})`)
        return false
      }

      const data = (await response.json()) as TunnelApiResponse
      const metadata = this.normalizeMetadata(data, this.state.metadata.deviceId)
      this.state.metadata = metadata
      await this.persistState()
      await this.startStream(metadata)
      return true
    } catch (err: any) {
      const msg = err?.message || 'Resume request failed'
      if (!isRetryableError(msg)) {
        this.updateStatus('failed', msg)
        return false
      }
      this.updateStatus('reconnecting', msg)
      return false
    }
  }

  private async createTunnel(): Promise<void> {
    const deviceId = this.state.metadata?.deviceId || generateDeviceId()
    const previousTunnelId = this.state.metadata?.tunnelId || undefined
    const previousResumeToken = this.state.metadata?.resumeToken || undefined

    try {
      const response = await fetch(this.buildUrl(`/tunnels/${encodeURIComponent(deviceId)}`), {
        method: 'PUT',
        headers: this.authHeaders(),
        body: JSON.stringify({
          previousTunnelId,
          previousResumeToken,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        const msg = `Create tunnel failed (${response.status}): ${errorText}`
        this.handleConnectionError(msg)
        return
      }

      const data = (await response.json()) as TunnelApiResponse
      const metadata = this.normalizeMetadata(data, deviceId)
      this.state.metadata = metadata
      await this.persistState()
      await this.startStream(metadata)
    } catch (err: any) {
      const msg = err?.message || 'Create tunnel failed'
      this.handleConnectionError(msg)
    }
  }

  private async startStream(metadata: TunnelMetadata): Promise<void> {
    this.closeStream()
    this.recovery.reset()
    this.recovery.startHeartbeat(() => {
      this.handleConnectionError('Heartbeat missed')
    })

    try {
      const es = new EventSource(metadata.streamUrl, {
        headers: {
          ...this.authHeaders(),
          // Avoid gzip buffering on Android (mirrors openaiClient logic)
          'Accept-Encoding': 'identity',
        },
        timeout: 0,
        withCredentials: false,
        debug: __DEV__,
      })

      this.eventSource = es

      es.addEventListener('open', () => {
        this.recovery.markConnected()
        this.state.lastHeartbeatAt = nowMs()
        this.updateStatus('connected')
        this.flushQueue()
        this.persistState()
      })

      es.addEventListener('message', (event: any) => {
        this.recovery.recordHeartbeat()
        this.state.lastHeartbeatAt = nowMs()
        this.persistState()

        try {
          const payload = event.data ? (JSON.parse(event.data) as TunnelMessage) : {}
          if (payload?.type === 'ping') {
            return
          }
          this.options.onMessage?.(payload)
        } catch (err) {
          console.warn('[TunnelClient] Failed to parse tunnel message', err)
        }
      })

      es.addEventListener('error', (event: Event & { message?: string }) => {
        const msg = event?.message || 'Tunnel stream error'
        this.handleConnectionError(msg)
      })
    } catch (err: any) {
      const msg = err?.message || 'Failed to open tunnel stream'
      this.handleConnectionError(msg)
    }
  }

  private async sendImmediately(message: TunnelMessage): Promise<void> {
    if (!this.state.metadata?.sendUrl) {
      this.queue.push(message)
      return
    }

    try {
      const response = await fetch(this.state.metadata.sendUrl, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(message),
      })

      if (!response.ok) {
        const msg = `Send failed (${response.status})`
        console.warn('[TunnelClient] Send failed', msg)
        this.queue.push(message)
        this.handleConnectionError(msg)
      }
    } catch (err: any) {
      const msg = err?.message || 'Send failed'
      this.queue.push(message)
      this.handleConnectionError(msg)
    }
  }

  private async flushQueue(): Promise<void> {
    if (!this.queue.length) return
    if (this.state.status !== 'connected') return

    const pending = [...this.queue]
    this.queue = []

    for (const item of pending) {
      await this.sendImmediately(item)
    }
  }

  private handleConnectionError(error: string): void {
    if (this.isShuttingDown) return
    this.closeStream()

    const retryable = isRetryableError(error) || this.recovery.shouldRetry()
    if (!retryable) {
      this.recovery.markFailed(error)
      this.updateStatus('failed', error)
      return
    }

    this.updateStatus('reconnecting', error)
    const delay = this.recovery.prepareRetry()
    this.scheduleReconnect(delay)
  }

  private scheduleReconnect(delayMs: number): void {
    this.clearReconnectTimer()
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connectInternal(false).catch((err) => {
        const msg = err?.message || 'Reconnect failed'
        this.handleConnectionError(msg)
      })
    }, delayMs)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private closeStream(): void {
    try {
      this.eventSource?.close()
    } catch {}
    this.eventSource = null
  }
}
