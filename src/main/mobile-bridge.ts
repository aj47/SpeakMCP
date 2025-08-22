import { EventEmitter } from 'events'
import { LiveKitServer } from './livekit-server'
import { NgrokTunnelManager } from './ngrok-tunnel'
import { QRCodeGenerator } from './qr-generator'
import { AudioPipeline } from './audio-pipeline'

export interface MobileBridgeConfig {
  livekit: {
    apiKey: string
    apiSecret: string
    serverPort: number
    serverUrl: string
  }
  ngrok: {
    authToken: string
    region?: string
  }
  audio: {
    sampleRate: number
    channels: number
    bitrate: number
    bufferSize: number
  }
}

export interface MobileSession {
  id: string
  participantId: string
  roomName: string
  connectedAt: Date
  lastActivityAt: Date
  status: 'connecting' | 'connected' | 'processing' | 'disconnected'
  transcript?: string
  responseAudio?: Buffer
}

export interface BridgeStatus {
  mobileServer: {
    enabled: boolean
    status: 'starting' | 'running' | 'stopped' | 'error'
    error?: string
  }
  ngrokTunnel: {
    enabled: boolean
    status: 'connecting' | 'connected' | 'disconnected' | 'error'
    url?: string
    error?: string
  }
  activeSessions: MobileSession[]
  qrCode?: {
    data: string
    expiresAt: Date
  }
}

export class MobileBridge extends EventEmitter {
  private config: MobileBridgeConfig
  private liveKitServer?: LiveKitServer
  private tunnelManager?: NgrokTunnelManager
  private qrGenerator?: QRCodeGenerator
  private audioPipeline?: AudioPipeline
  private activeSessions: Map<string, MobileSession> = new Map()
  private isRunning: boolean = false

  constructor(config: MobileBridgeConfig) {
    super()
    this.config = config
  }

  async start(): Promise<void> {
    try {
      this.emit('status', { mobileServer: { enabled: true, status: 'starting' } })

      // Initialize LiveKit server
      this.liveKitServer = new LiveKitServer({
        apiKey: this.config.livekit.apiKey,
        apiSecret: this.config.livekit.apiSecret,
        serverPort: this.config.livekit.serverPort,
        serverUrl: this.config.livekit.serverUrl
      })

      // Initialize ngrok tunnel
      this.tunnelManager = new NgrokTunnelManager({
        authToken: this.config.ngrok.authToken,
        region: this.config.ngrok.region,
        port: this.config.livekit.serverPort
      })

      // Initialize audio pipeline
      this.audioPipeline = new AudioPipeline(
        {
          sampleRate: this.config.audio.sampleRate,
          channels: this.config.audio.channels,
          bitrate: this.config.audio.bitrate,
          frameSize: 1024,
          bufferSize: this.config.audio.bufferSize
        },
        this.liveKitServer
      )

      // Initialize QR generator
      this.qrGenerator = new QRCodeGenerator(this.liveKitServer, this.tunnelManager)

      // Setup event handlers
      this.setupEventHandlers()

      // Start services
      await this.liveKitServer.start()
      await this.tunnelManager.start()

      this.isRunning = true
      this.emit('status', await this.getStatus())
      
    } catch (error) {
      this.emit('error', error)
      throw error
    }
  }

  private setupEventHandlers(): void {
    if (!this.liveKitServer || !this.tunnelManager || !this.audioPipeline) return

    // LiveKit server events
    this.liveKitServer.on('mobileConnected', (session) => {
      this.handleMobileConnected(session)
    })

    this.liveKitServer.on('mobileDisconnected', (session) => {
      this.handleMobileDisconnected(session)
    })

    // Tunnel manager events
    this.tunnelManager.on('tunnelReady', (info) => {
      this.emit('tunnelReady', info)
    })

    this.tunnelManager.on('status', (status) => {
      this.emit('tunnelStatus', status)
    })

    // Audio pipeline events
    this.audioPipeline.on('transcriptReady', (data) => {
      this.handleTranscriptReady(data)
    })

    this.audioPipeline.on('ttsRequired', (data) => {
      this.handleTTSRequired(data)
    })
  }

  private handleMobileConnected(session: any): void {
    const mobileSession: MobileSession = {
      id: session.id,
      participantId: session.participantId,
      roomName: session.roomName,
      connectedAt: new Date(),
      lastActivityAt: new Date(),
      status: 'connected'
    }

    this.activeSessions.set(session.participantId, mobileSession)
    this.emit('mobileConnected', mobileSession)
  }

  private handleMobileDisconnected(session: any): void {
    this.activeSessions.delete(session.participantId)
    this.emit('mobileDisconnected', session)
  }

  private handleTranscriptReady(data: any): void {
    const session = this.activeSessions.get(data.sessionKey)
    if (session) {
      session.transcript = data.transcript
      session.lastActivityAt = new Date()
      session.status = 'processing'
      
      this.emit('transcriptReady', {
        session,
        transcript: data.transcript
      })
    }
  }

  private handleTTSRequired(data: any): void {
    this.emit('ttsRequired', data)
  }

  async generateQRCode(roomName: string, participantId: string): Promise<string> {
    if (!this.qrGenerator) {
      throw new Error('QR generator not initialized')
    }

    const result = await this.qrGenerator.generateConnectionQR(roomName, participantId)
    return result.qrCode
  }

  async getStatus(): Promise<BridgeStatus> {
    const tunnelInfo = this.tunnelManager?.getTunnelInfo()
    const activeSessions = Array.from(this.activeSessions.values())

    return {
      mobileServer: {
        enabled: this.isRunning,
        status: this.isRunning ? 'running' : 'stopped'
      },
      ngrokTunnel: {
        enabled: !!this.tunnelManager,
        status: tunnelInfo?.status || 'disconnected',
        url: tunnelInfo?.publicUrl
      },
      activeSessions,
      qrCode: undefined // Would be populated when QR is generated
    }
  }

  getActiveSessions(): MobileSession[] {
    return Array.from(this.activeSessions.values())
  }

  async stop(): Promise<void> {
    try {
      this.isRunning = false
      
      if (this.liveKitServer) {
        await this.liveKitServer.shutdown()
      }
      
      if (this.tunnelManager) {
        await this.tunnelManager.stop()
      }
      
      if (this.audioPipeline) {
        this.audioPipeline.cleanup()
      }

      this.activeSessions.clear()
      this.emit('status', await this.getStatus())
      
    } catch (error) {
      this.emit('error', error)
      throw error
    }
  }

  async restart(): Promise<void> {
    await this.stop()
    await this.start()
  }

  getHealthStatus(): {
    mobileServer: boolean
    tunnel: boolean
    totalSessions: number
    uptime: number
  } {
    return {
      mobileServer: this.isRunning,
      tunnel: this.tunnelManager?.isConnected() || false,
      totalSessions: this.activeSessions.size,
      uptime: Date.now() // Placeholder for actual uptime calculation
    }
  }
}
