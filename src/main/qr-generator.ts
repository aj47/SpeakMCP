import * as QRCode from "qrcode"
import { LiveKitServer } from "./livekit-server"
import { NgrokTunnelManager } from "./ngrok-tunnel"

export interface QRCodeData {
  serverUrl: string
  token: string
  roomName: string
  timestamp: number
  expiresAt: number
}

export interface QRCodeResult {
  data: QRCodeData
  qrCode: string
  expiresAt: Date
}

export class QRCodeGenerator {
  private liveKitServer: LiveKitServer
  private tunnelManager: NgrokTunnelManager
  private activeCodes: Map<string, QRCodeResult> = new Map()
  private codeExpirationTime: number = 24 * 60 * 60 * 1000 // 24 hours

  constructor(liveKitServer: LiveKitServer, tunnelManager: NgrokTunnelManager) {
    this.liveKitServer = liveKitServer
    this.tunnelManager = tunnelManager
  }

  async generateConnectionQR(roomName: string, participantId: string): Promise<QRCodeResult> {
    try {
      const tunnelInfo = this.tunnelManager.getTunnelInfo()
      if (!tunnelInfo?.publicUrl) {
        throw new Error('No active tunnel available')
      }

      // Generate LiveKit token
      const token = this.liveKitServer.generateToken(participantId, roomName)
      
      const qrData: QRCodeData = {
        serverUrl: tunnelInfo.publicUrl,
        token,
        roomName,
        timestamp: Date.now(),
        expiresAt: Date.now() + this.codeExpirationTime
      }

      // Generate QR code as base64 string
      const qrCode = await QRCode.toDataURL(JSON.stringify(qrData), {
        type: 'image/png',
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      })

      const result: QRCodeResult = {
        data: qrData,
        qrCode,
        expiresAt: new Date(qrData.expiresAt)
      }

      this.activeCodes.set(roomName, result)
      
      return result
    } catch (error) {
      throw new Error(`Failed to generate QR code: ${error}`)
    }
  }

  async refreshQRCode(roomName: string, participantId: string): Promise<QRCodeResult> {
    // Remove existing code
    this.activeCodes.delete(roomName)
    
    // Generate new one
    return await this.generateConnectionQR(roomName, participantId)
  }

  getConnectionQR(roomName: string): QRCodeResult | undefined {
    const result = this.activeCodes.get(roomName)
    
    // Check if code is expired
    if (result && new Date() > result.expiresAt) {
      this.activeCodes.delete(roomName)
      return undefined
    }
    
    return result
  }

  getAllActiveQRCodes(): Array<{ roomName: string; result: QRCodeResult }> {
    const active = []
    
    for (const [roomName, result] of this.activeCodes.entries()) {
      if (new Date() > result.expiresAt) {
        this.activeCodes.delete(roomName)
        continue
      }
      
      active.push({ roomName, result })
    }
    
    return active
  }

  validateQRCode(qrData: QRCodeData): boolean {
    try {
      // Check expiration
      if (Date.now() > qrData.expiresAt) {
        return false
      }

      // Validate required fields
      if (!qrData.serverUrl || !qrData.token || !qrData.roomName) {
        return false
      }

      // Validate URL format
      const url = new URL(qrData.serverUrl)
      return url.protocol === 'https:' || url.protocol === 'wss:'
    } catch {
      return false
    }
  }

  async generateDemoQR(): Promise<string> {
    const demoData = {
      serverUrl: 'wss://demo.ngrok.io',
      token: 'demo-token-12345',
      roomName: 'speakmcp-demo',
      timestamp: Date.now(),
      expiresAt: Date.now() + this.codeExpirationTime
    }

    return await QRCode.toDataURL(JSON.stringify(demoData), {
      type: 'image/png',
      width: 200,
      margin: 1,
      color: {
        dark: '#333333',
        light: '#F5F5F5'
      }
    })
  }

  cleanup(): void {
    this.activeCodes.clear()
  }

  getQRCodeStats(): {
    activeCodes: number
    totalGenerated: number
    expiredCodes: number
  } {
    let expiredCount = 0
    
    for (const [roomName, result] of this.activeCodes.entries()) {
      if (new Date() > result.expiresAt) {
        expiredCount++
        this.activeCodes.delete(roomName)
      }
    }

    return {
      activeCodes: this.activeCodes.size,
      totalGenerated: this.activeCodes.size + expiredCount,
      expiredCodes: expiredCount
    }
  }
}
