import * as ngrok from "ngrok"
import { EventEmitter } from "events"

export interface NgrokConfig {
  authToken: string
  region?: string
  subdomain?: string
  port: number
}

export interface TunnelInfo {
  url: string
  publicUrl: string
  proto: string
  config: NgrokConfig
  status: 'connecting' | 'connected' | 'disconnected' | 'error'
}

export class NgrokTunnelManager extends EventEmitter {
  private config: NgrokConfig
  private tunnel?: ngrok.Session
  private tunnelInfo?: TunnelInfo
  private reconnectAttempts: number = 0
  private maxReconnectAttempts: number = 5
  private reconnectDelay: number = 3000

  constructor(config: NgrokConfig) {
    super()
    this.config = config
  }

  async start(): Promise<TunnelInfo> {
    try {
      this.emit('status', 'connecting')

      // Create ngrok session
      const session = await ngrok.connect({
        authtoken: this.config.authToken,
        region: this.config.region || 'us',
        port: this.config.port,
        subdomain: this.config.subdomain,
        proto: 'https',
        bind_tls: true
      })

      this.tunnel = session
      
      // Get tunnel info
      const tunnels = await ngrok.getTunnels()
      const tunnelUrl = tunnels[0]?.public_url || ''

      this.tunnelInfo = {
        url: tunnelUrl,
        publicUrl: tunnelUrl,
        proto: 'https',
        config: this.config,
        status: 'connected'
      }

      this.emit('status', 'connected')
      this.emit('tunnelReady', this.tunnelInfo)

      // Reset reconnect attempts on successful connection
      this.reconnectAttempts = 0

      return this.tunnelInfo
    } catch (error) {
      this.emit('status', 'error')
      this.emit('error', error)
      
      // Attempt reconnection if within limits
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++
        this.emit('reconnecting', {
          attempt: this.reconnectAttempts,
          maxAttempts: this.maxReconnectAttempts
        })
        
        setTimeout(() => this.start(), this.reconnectDelay)
      }
      
      throw error
    }
  }

  async stop(): Promise<void> {
    try {
      if (this.tunnel) {
        await ngrok.disconnect()
        this.tunnel = undefined
        this.tunnelInfo = undefined
        this.emit('status', 'disconnected')
        this.emit('tunnelClosed')
      }
    } catch (error) {
      this.emit('error', error)
      throw error
    }
  }

  getTunnelInfo(): TunnelInfo | undefined {
    return this.tunnelInfo
  }

  getPublicUrl(): string | undefined {
    return this.tunnelInfo?.publicUrl
  }

  isConnected(): boolean {
    return this.tunnelInfo?.status === 'connected'
  }

  async restart(): Promise<TunnelInfo> {
    await this.stop()
    return await this.start()
  }

  updateConfig(newConfig: Partial<NgrokConfig>): void {
    this.config = { ...this.config, ...newConfig }
    
    // Restart tunnel if already connected
    if (this.isConnected()) {
      this.restart()
    }
  }

  getStatus(): string {
    return this.tunnelInfo?.status || 'disconnected'
  }

  getHealthStatus(): {
    status: string
    lastActivity: Date
    reconnectAttempts: number
  } {
    return {
      status: this.getStatus(),
      lastActivity: new Date(),
      reconnectAttempts: this.reconnectAttempts
    }
  }
}
