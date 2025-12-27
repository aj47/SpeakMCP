import type { WebSocketMessage, Unsubscribe } from './types.js'

export type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface WebSocketClientOptions {
  url: string
  apiKey?: string
  reconnect?: boolean
  reconnectInterval?: number
  maxReconnectAttempts?: number
  onStatusChange?: (status: WebSocketStatus) => void
}

type MessageHandler = (message: WebSocketMessage) => void

export class WebSocketClient {
  private ws: WebSocket | null = null
  private url: string
  private apiKey?: string
  private reconnect: boolean
  private reconnectInterval: number
  private maxReconnectAttempts: number
  private reconnectAttempts = 0
  private status: WebSocketStatus = 'disconnected'
  private onStatusChange?: (status: WebSocketStatus) => void
  private handlers = new Map<string, Set<MessageHandler>>()
  private globalHandlers = new Set<MessageHandler>()
  private subscriptions = new Set<string>()

  constructor(options: WebSocketClientOptions) {
    this.url = options.url
    this.apiKey = options.apiKey
    this.reconnect = options.reconnect ?? true
    this.reconnectInterval = options.reconnectInterval ?? 3000
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 10
    this.onStatusChange = options.onStatusChange
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return

    this.setStatus('connecting')

    // Add API key as query param for WebSocket auth
    let wsUrl = this.url
    if (this.apiKey) {
      const separator = wsUrl.includes('?') ? '&' : '?'
      wsUrl += `${separator}apiKey=${encodeURIComponent(this.apiKey)}`
    }

    this.ws = new WebSocket(wsUrl)

    this.ws.onopen = () => {
      this.setStatus('connected')
      this.reconnectAttempts = 0

      // Resubscribe to channels
      for (const channel of this.subscriptions) {
        this.send({ type: 'subscribe', channel })
      }
    }

    this.ws.onclose = () => {
      this.setStatus('disconnected')
      this.attemptReconnect()
    }

    this.ws.onerror = () => {
      this.setStatus('error')
    }

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as WebSocketMessage
        this.handleMessage(message)
      } catch {
        // Ignore invalid messages
      }
    }
  }

  disconnect(): void {
    this.reconnect = false
    this.ws?.close()
    this.ws = null
    this.setStatus('disconnected')
  }

  private setStatus(status: WebSocketStatus): void {
    this.status = status
    this.onStatusChange?.(status)
  }

  private attemptReconnect(): void {
    if (!this.reconnect) return
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return

    this.reconnectAttempts++
    setTimeout(() => this.connect(), this.reconnectInterval)
  }

  private handleMessage(message: WebSocketMessage): void {
    // Call global handlers
    for (const handler of this.globalHandlers) {
      handler(message)
    }

    // Call channel-specific handlers
    if (message.channel) {
      const channelHandlers = this.handlers.get(message.channel)
      if (channelHandlers) {
        for (const handler of channelHandlers) {
          handler(message)
        }
      }
    }

    // Call type-specific handlers
    const typeHandlers = this.handlers.get(message.type)
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        handler(message)
      }
    }
  }

  send(message: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    }
  }

  subscribe(channel: string): void {
    this.subscriptions.add(channel)
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({ type: 'subscribe', channel })
    }
  }

  unsubscribe(channel: string): void {
    this.subscriptions.delete(channel)
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({ type: 'unsubscribe', channel })
    }
  }

  on(channelOrType: string, handler: MessageHandler): Unsubscribe {
    let handlers = this.handlers.get(channelOrType)
    if (!handlers) {
      handlers = new Set()
      this.handlers.set(channelOrType, handlers)
    }
    handlers.add(handler)

    return () => {
      handlers?.delete(handler)
      if (handlers?.size === 0) {
        this.handlers.delete(channelOrType)
      }
    }
  }

  onAny(handler: MessageHandler): Unsubscribe {
    this.globalHandlers.add(handler)
    return () => {
      this.globalHandlers.delete(handler)
    }
  }

  getStatus(): WebSocketStatus {
    return this.status
  }

  isConnected(): boolean {
    return this.status === 'connected'
  }

  // Convenience method for tool approval
  respondToApproval(sessionId: string, approved: boolean): void {
    this.send({
      type: 'approval',
      sessionId,
      approved,
    })
  }
}

