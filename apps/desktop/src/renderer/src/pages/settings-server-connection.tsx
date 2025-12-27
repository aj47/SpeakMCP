import { useCallback, useState, useEffect } from "react"
import { Control, ControlGroup, ControlLabel } from "@renderer/components/ui/control"
import { Switch } from "@renderer/components/ui/switch"
import { Input } from "@renderer/components/ui/input"
import { Button } from "@renderer/components/ui/button"
import { useServerConnectionStore } from "@renderer/stores"

export function Component() {
  const {
    mode,
    remoteServerUrl,
    remoteApiKey,
    isConnected,
    isConnecting,
    wsStatus,
    healthStatus,
    lastError,
    setMode,
    setRemoteConfig,
    connect,
    disconnect,
  } = useServerConnectionStore()

  // Local state for form
  const [url, setUrl] = useState(remoteServerUrl)
  const [apiKey, setApiKey] = useState(remoteApiKey)
  
  // Sync from store on mount
  useEffect(() => {
    setUrl(remoteServerUrl)
    setApiKey(remoteApiKey)
  }, [remoteServerUrl, remoteApiKey])

  const isRemote = mode === 'remote'

  const handleConnect = useCallback(async () => {
    setRemoteConfig(url, apiKey)
    await connect()
  }, [url, apiKey, setRemoteConfig, connect])

  const handleDisconnect = useCallback(() => {
    disconnect()
  }, [disconnect])

  const getStatusColor = () => {
    if (!isRemote) return 'bg-gray-400'
    if (isConnecting) return 'bg-yellow-500 animate-pulse'
    if (isConnected && wsStatus === 'connected') return 'bg-green-500'
    if (isConnected) return 'bg-blue-500'
    if (lastError) return 'bg-red-500'
    return 'bg-gray-400'
  }

  const getStatusText = () => {
    if (!isRemote) return 'Using local mode'
    if (isConnecting) return 'Connecting...'
    if (isConnected && wsStatus === 'connected') return 'Connected (WebSocket active)'
    if (isConnected) return 'Connected (HTTP only)'
    if (lastError) return `Error: ${lastError}`
    return 'Disconnected'
  }

  return (
    <div className="modern-panel h-full overflow-y-auto overflow-x-hidden px-6 py-4">
      <div className="grid gap-4">
        <ControlGroup
          title="Server Connection"
          endDescription={(
            <div className="break-words whitespace-normal">
              Connect to a remote SpeakMCP server instead of using the local embedded services.
              This allows multiple clients to share the same agent, conversations, and MCP servers.
            </div>
          )}
        >
          <Control label="Use Remote Server" className="px-3">
            <Switch
              checked={isRemote}
              onCheckedChange={(checked) => {
                setMode(checked ? 'remote' : 'local')
                if (!checked) {
                  disconnect()
                }
              }}
            />
          </Control>

          {isRemote && (
            <>
              <Control label={<ControlLabel label="Server URL" tooltip="URL of the SpeakMCP server (e.g., http://localhost:3456)" />} className="px-3">
                <Input
                  type="url"
                  value={url}
                  onChange={(e) => setUrl(e.currentTarget.value)}
                  placeholder="http://localhost:3456"
                  className="w-full sm:w-[360px]"
                  disabled={isConnected}
                />
              </Control>

              <Control label={<ControlLabel label="API Key" tooltip="Bearer token for authentication" />} className="px-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.currentTarget.value)}
                    placeholder="Enter API key"
                    className="w-full sm:w-[300px]"
                    disabled={isConnected}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => apiKey && navigator.clipboard.writeText(apiKey)}
                    disabled={!apiKey}
                  >
                    Copy
                  </Button>
                </div>
              </Control>

              <Control label="Connection Status" className="px-3">
                <div className="flex items-center gap-2">
                  <span className={`inline-block w-2 h-2 rounded-full ${getStatusColor()}`} />
                  <span className="text-sm">{getStatusText()}</span>
                </div>
              </Control>

              <Control label="Actions" className="px-3">
                <div className="flex flex-wrap items-center gap-2">
                  {!isConnected ? (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={handleConnect}
                      disabled={isConnecting || !url || !apiKey}
                    >
                      {isConnecting ? 'Connecting...' : 'Connect'}
                    </Button>
                  ) : (
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleDisconnect}
                    >
                      Disconnect
                    </Button>
                  )}
                </div>
              </Control>

              {healthStatus && (
                <Control label="Server Health" className="px-3">
                  <div className="text-sm space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block w-2 h-2 rounded-full ${
                        healthStatus.status === 'healthy' ? 'bg-green-500' :
                        healthStatus.status === 'degraded' ? 'bg-yellow-500' : 'bg-red-500'
                      }`} />
                      <span className="capitalize">{healthStatus.status}</span>
                    </div>
                  </div>
                </Control>
              )}
            </>
          )}
        </ControlGroup>
      </div>
    </div>
  )
}

