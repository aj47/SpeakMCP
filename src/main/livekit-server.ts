import { Room, RoomServiceClient } from "livekit-server-sdk"
import { Server } from "ws"
import { EventEmitter } from "events"
import { IncomingMessage } from "http"
import { URL } from "url"
import jwt from "jsonwebtoken"

export interface MobileSession {
  id: string
  participantId: string
  roomName: string
  connectedAt: Date
  lastActivityAt: Date
  audioTracks: Map<string, MediaStreamTrack>
  dataChannel?: RTCDataChannel
}

export interface LiveKitConfig {
  apiKey: string
  apiSecret: string
  serverPort: number
  serverUrl: string
}

export class LiveKitServer extends EventEmitter {
  private config: LiveKitConfig
  private roomService: RoomServiceClient
  private activeRooms: Map<string, Room> = new Map()
  private mobileSessions: Map<string, MobileSession> = new Map()
  private wsServer?: Server

  constructor(config: LiveKitConfig) {
    super()
    this.config = config
    this.roomService = new RoomServiceClient(config.serverUrl, config.apiKey, config.apiSecret)
  }

  async start(): Promise<void> {
    try {
      // Create initial room for mobile connections
      const roomName = `speakmcp-session-${Date.now()}`
      await this.createRoom(roomName)
      
      this.emit('serverStarted', {
        roomName,
        serverUrl: this.config.serverUrl,
        port: this.config.serverPort
      })
    } catch (error) {
      this.emit('error', error)
      throw error
    }
  }

  async createRoom(roomName: string): Promise<Room> {
    try {
      // Create room with specific configuration for mobile sessions
      const room = await this.roomService.createRoom({
        name: roomName,
        emptyTimeout: 300, // 5 minutes
        maxParticipants: 2, // Mobile app + SpeakMCP
        metadata: JSON.stringify({
          type: 'speakmcp-mobile',
          createdAt: new Date().toISOString()
        })
      })

      this.activeRooms.set(roomName, room)
      this.emit('roomCreated', { roomName, room })
      return room
    } catch (error) {
      this.emit('error', { error, context: 'createRoom' })
      throw error
    }
  }

  async handleParticipantConnected(roomName: string, participantInfo: any): Promise<void> {
    try {
      const session: MobileSession = {
        id: `session-${Date.now()}`,
        participantId: participantInfo.identity,
        roomName,
        connectedAt: new Date(),
        lastActivityAt: new Date(),
        audioTracks: new Map()
      }

      this.mobileSessions.set(participantInfo.identity, session)
      this.emit('mobileConnected', session)
    } catch (error) {
      this.emit('error', { error, context: 'handleParticipantConnected' })
    }
  }

  async handleParticipantDisconnected(participantId: string): Promise<void> {
    try {
      const session = this.mobileSessions.get(participantId)
      if (session) {
        this.mobileSessions.delete(participantId)
        this.emit('mobileDisconnected', session)
      }
    } catch (error) {
      this.emit('error', { error, context: 'handleParticipantDisconnected' })
    }
  }

  generateToken(participantId: string, roomName: string): string {
    const payload = {
      room: roomName,
      participant: participantId,
      exp: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours
      metadata: JSON.stringify({
        type: 'speakmcp-mobile',
        version: '1.0'
      })
    }

    return jwt.sign(payload, this.config.apiSecret, {
      issuer: this.config.apiKey,
      algorithm: 'HS256'
    })
  }

  async processAudioTrack(trackInfo: any, audioData: Buffer): Promise<void> {
    try {
      this.emit('audioDataReceived', {
        trackId: trackInfo.sid,
        participantId: trackInfo.participantIdentity,
        audioData,
        timestamp: new Date()
      })
    } catch (error) {
      this.emit('error', { error, context: 'processAudioTrack' })
    }
  }

  async publishAudioResponse(sessionId: string, audioBuffer: Buffer): Promise<void> {
    try {
      const session = Array.from(this.mobileSessions.values()).find(s => s.id === sessionId)
      if (!session) {
        throw new Error(`Session ${sessionId} not found`)
      }

      this.emit('audioResponseReady', {
        sessionId,
        participantId: session.participantId,
        audioBuffer,
        timestamp: new Date()
      })
    } catch (error) {
      this.emit('error', { error, context: 'publishAudioResponse' })
    }
  }

  getActiveSessions(): MobileSession[] {
    return Array.from(this.mobileSessions.values())
  }

  getActiveRooms(): string[] {
    return Array.from(this.activeRooms.keys())
  }

  async shutdown(): Promise<void> {
    try {
      // Close all active rooms
      for (const roomName of this.activeRooms.keys()) {
        await this.roomService.deleteRoom(roomName)
      }

      this.activeRooms.clear()
      this.mobileSessions.clear()
      this.emit('serverStopped')
    } catch (error) {
      this.emit('error', { error, context: 'shutdown' })
      throw error
    }
  }
}
