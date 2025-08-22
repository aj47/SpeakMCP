import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { QRCodeIcon, WifiIcon, SmartphoneIcon, PowerIcon, RefreshCwIcon } from 'lucide-react'

interface MobileSession {
  id: string
  participantId: string
  roomName: string
  connectedAt: string
  lastActivityAt: string
  status: 'connecting' | 'connected' | 'processing' | 'disconnected'
  transcript?: string
}

interface MobileServerStatus {
  mobileServer: {
    enabled: boolean
    status: 'starting' | 'running' | 'stopped' | 'error'
    error?: string
  }
  ngrokTunnel: {
    enabled: boolean
    status: 'connecting' | 'connected' | 'disconnected' | 'error'
    url?: string
  }
  activeSessions: MobileSession[]
  qrCode?: {
    data: string
    expiresAt: string
  }
}

export function MobileServerPanel() {
  const [status, setStatus] = useState<MobileServerStatus>({
    mobileServer: { enabled: false, status: 'stopped' },
    ngrokTunnel: { enabled: false, status: 'disconnected' },
    activeSessions: []
  })
  
  const [qrCode, setQrCode] = useState<string>('')
  const [isGeneratingQR, setIsGeneratingQR] = useState(false)
  const [selectedSession, setSelectedSession] = useState<string>('')

  useEffect(() => {
    // Subscribe to mobile server status updates
    window.electron.ipcRenderer.on('mobile-status-update', (data) => {
      setStatus(data)
    })

    return () => {
      window.electron.ipcRenderer.removeAllListeners('mobile-status-update')
    }
  }, [])

  const handleToggleMobileServer = async () => {
    try {
      if (status.mobileServer.enabled) {
        await window.electron.ipcRenderer.invoke('stop-mobile-server')
      } else {
        await window.electron.ipcRenderer.invoke('start-mobile-server')
      }
    } catch (error) {
      console.error('Failed to toggle mobile server:', error)
    }
  }

  const handleGenerateQRCode = async () => {
    setIsGeneratingQR(true)
    try {
      const roomName = `speakmcp-session-${Date.now()}`
      const participantId = `mobile-user-${Date.now()}`
      
      const qrData = await window.electron.ipcRenderer.invoke('generate-qr-code', {
        roomName,
        participantId
      })
      
      setQrCode(qrData)
    } catch (error) {
      console.error('Failed to generate QR code:', error)
    } finally {
      setIsGeneratingQR(false)
    }
  }

  const handleRefreshQRCode = async () => {
    setQrCode('')
    await handleGenerateQRCode()
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running':
      case 'connected':
        return 'text-green-600'
      case 'starting':
      case 'connecting':
        return 'text-yellow-600'
      case 'error':
        return 'text-red-600'
      default:
        return 'text-gray-600'
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'running':
      case 'connected':
        return <Badge variant="default">{status}</Badge>
      case 'starting':
      case 'connecting':
        return <Badge variant="secondary">{status}</Badge>
      case 'error':
        return <Badge variant="destructive">{status}</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SmartphoneIcon className="w-5 h-5" />
            Mobile Server
          </CardTitle>
          <CardDescription>
            Enable mobile app connections via LiveKit and ngrok tunneling
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PowerIcon className="w-4 h-4" />
              <span>Mobile Server</span>
            </div>
            <div className="flex items-center gap-2">
              {getStatusBadge(status.mobileServer.status)}
              <Switch
                checked={status.mobileServer.enabled}
                onCheckedChange={handleToggleMobileServer}
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <WifiIcon className="w-4 h-4" />
              <span>Ngrok Tunnel</span>
            </div>
            <div className="flex items-center gap-2">
              {getStatusBadge(status.ngrokTunnel.status)}
              {status.ngrokTunnel.url && (
                <span className="text-sm text-muted-foreground">
                  {status.ngrokTunnel.url}
                </span>
              )}
            </div>
          </div>

          {status.mobileServer.error && (
            <div className="text-sm text-red-600">
              {status.mobileServer.error}
            </div>
          )}

          {status.ngrokTunnel.error && (
            <div className="text-sm text-red-600">
              {status.ngrokTunnel.error}
            </div>
          )}
        </CardContent>
      </Card>

      {status.mobileServer.enabled && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <QRCodeIcon className="w-5 h-5" />
              Connection QR Code
            </CardTitle>
            <CardDescription>
              Scan this QR code with your 01-app mobile application
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Button
                onClick={handleGenerateQRCode}
                disabled={isGeneratingQR || !status.ngrokTunnel.url}
                className="flex-1"
              >
                {isGeneratingQR ? 'Generating...' : 'Generate QR Code'}
              </Button>
              {qrCode && (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleRefreshQRCode}
                  disabled={isGeneratingQR}
                >
                  <RefreshCwIcon className="w-4 h-4" />
                </Button>
              )}
            </div>

            {qrCode && (
              <div className="flex justify-center">
                <img 
                  src={qrCode} 
                  alt="Mobile Connection QR Code"
                  className="border rounded-lg"
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {status.activeSessions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Active Sessions</CardTitle>
            <CardDescription>
              Currently connected mobile devices
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {status.activeSessions.map((session) => (
                <div key={session.id} className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <div className="font-medium">{session.participantId}</div>
                    <div className="text-sm text-muted-foreground">
                      {new Date(session.connectedAt).toLocaleString()}
                    </div>
                  </div>
                  <Badge variant={session.status === 'connected' ? 'default' : 'secondary'}>
                    {session.status}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
