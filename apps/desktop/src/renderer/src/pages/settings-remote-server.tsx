import { useCallback, useMemo } from "react"
import { Control, ControlGroup, ControlLabel } from "@renderer/components/ui/control"
import { Switch } from "@renderer/components/ui/switch"
import { Input } from "@renderer/components/ui/input"
import { Button } from "@renderer/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import { useConfigQuery, useSaveConfigMutation } from "@renderer/lib/query-client"
import { tipcClient } from "@renderer/lib/tipc-client"
import type { Config } from "@shared/types"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { QRCodeSVG } from "qrcode.react"
import { EyeOff, ExternalLink } from "lucide-react"

/**
 * Mask a URL for streamer mode - masks all alphanumeric content (including the protocol)
 * while preserving URL structure characters (://, ., /, :)
 */
function maskUrl(url: string): string {
  if (!url) return "https://***.***.***.***:****/v1"
  // Replace the sensitive parts with asterisks while preserving structure
  return url.replace(/([a-zA-Z0-9-]+)/g, (match) => "*".repeat(Math.min(match.length, 8)))
}

export function Component() {
  const configQuery = useConfigQuery()
  const saveConfigMutation = useSaveConfigMutation()
  const queryClient = useQueryClient()

  const cfg = configQuery.data as Config | undefined

  const saveConfig = useCallback(
    (partial: Partial<Config>) => {
      if (!cfg) return
      saveConfigMutation.mutate({ config: { ...cfg, ...partial } })
    },
    [cfg, saveConfigMutation],
  )

  // Cloudflare Tunnel queries and mutations
  const cloudflaredInstalledQuery = useQuery({
    queryKey: ["cloudflared-installed"],
    queryFn: () => tipcClient.checkCloudflaredInstalled(),
    staleTime: 60000, // Check once per minute
  })

  const cloudflaredLoggedInQuery = useQuery({
    queryKey: ["cloudflared-logged-in"],
    queryFn: () => tipcClient.checkCloudflaredLoggedIn(),
    staleTime: 60000, // Check once per minute
    enabled: cfg?.remoteServerEnabled && cfg?.cloudflareTunnelMode === "named",
  })

  const tunnelListQuery = useQuery({
    queryKey: ["cloudflare-tunnel-list"],
    queryFn: () => tipcClient.listCloudflareTunnels(),
    staleTime: 60000, // Refresh once per minute
    enabled: cfg?.remoteServerEnabled && cfg?.cloudflareTunnelMode === "named" && (cloudflaredLoggedInQuery.data ?? false),
  })

  const tunnelStatusQuery = useQuery({
    queryKey: ["cloudflare-tunnel-status"],
    queryFn: () => tipcClient.getCloudflareTunnelStatus(),
    refetchInterval: 2000, // Poll every 2 seconds when tunnel is active
    enabled: cfg?.remoteServerEnabled ?? false,
  })

  const startTunnelMutation = useMutation({
    mutationFn: () => tipcClient.startCloudflareTunnel(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cloudflare-tunnel-status"] })
    },
  })

  const startNamedTunnelMutation = useMutation({
    mutationFn: (params: { tunnelId: string; hostname: string; credentialsPath?: string }) =>
      tipcClient.startNamedCloudflareTunnel(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cloudflare-tunnel-status"] })
    },
  })

  const stopTunnelMutation = useMutation({
    mutationFn: () => tipcClient.stopCloudflareTunnel(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cloudflare-tunnel-status"] })
    },
  })

  const tunnelStatus = tunnelStatusQuery.data
  const isCloudflaredInstalled = cloudflaredInstalledQuery.data ?? false
  const isCloudflaredLoggedIn = cloudflaredLoggedInQuery.data ?? false
  const tunnelList = tunnelListQuery.data?.tunnels ?? []
  const tunnelMode = cfg?.cloudflareTunnelMode ?? "quick"

  const bindOptions: Array<{ label: string; value: "127.0.0.1" | "0.0.0.0" }> = useMemo(
    () => [
      { label: "Localhost (127.0.0.1)", value: "127.0.0.1" },
      { label: "All Interfaces (0.0.0.0)", value: "0.0.0.0" },
    ],
    [],
  )

  if (!cfg) return null

  const enabled = cfg.remoteServerEnabled ?? false
  const streamerMode = cfg.streamerModeEnabled ?? false

  const baseUrl = cfg.remoteServerBindAddress && cfg.remoteServerPort
    ? `http://${cfg.remoteServerBindAddress}:${cfg.remoteServerPort}/v1`
    : undefined

  return (
    <div className="modern-panel h-full overflow-y-auto overflow-x-hidden px-6 py-4">
      <div className="grid gap-4">
        <ControlGroup
          title="Remote Server"
          endDescription={(
            <div className="break-words whitespace-normal">
              Exposes your SpeakMCP agent over an OpenAI BaseURL-compatible /v1 HTTP endpoint so other clients (e.g., mobile or other apps) can connect to this desktop app and use the agent remotely. Recommended: use with the{" "}
              <a
                href="https://github.com/aj47/SpeakMCPMobile"
                target="_blank"
                rel="noreferrer noopener"
                className="underline"
              >
                SpeakMCP Mobile app
              </a>.
            </div>
          )}
        >
          <Control label="Enable Remote Server" className="px-3">
            <Switch
              checked={enabled}
              onCheckedChange={(value) => {
                saveConfig({ remoteServerEnabled: value })
              }}
            />
          </Control>

          {enabled && (
            <>
              <Control label={<ControlLabel label="Auto-Show Panel" tooltip="Automatically show the floating panel when receiving messages from remote clients" />} className="px-3">
                <Switch
                  checked={cfg.remoteServerAutoShowPanel ?? false}
                  onCheckedChange={(value) => {
                    saveConfig({ remoteServerAutoShowPanel: value })
                  }}
                />
              </Control>

              <Control label={<ControlLabel label="Port" tooltip="HTTP port to listen on" />} className="px-3">
                <Input
                  type="number"
                  min={1}
                  max={65535}
                  value={cfg.remoteServerPort ?? 3210}
                  onChange={(e) =>
                    saveConfig({ remoteServerPort: parseInt(e.currentTarget.value || "3210", 10) })
                  }
                  className="w-36"
                />
              </Control>

              <Control label={<ControlLabel label="Bind Address" tooltip="127.0.0.1 for local-only access; 0.0.0.0 to allow LAN access (requires API key)" />} className="px-3">
                <Select
                  value={(cfg.remoteServerBindAddress as any) || "127.0.0.1"}
                  onValueChange={(value: any) =>
                    saveConfig({ remoteServerBindAddress: value })
                  }
                >
                  <SelectTrigger className="w-[220px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {bindOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {cfg.remoteServerBindAddress === "0.0.0.0" && (
                  <div className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                    Warning: Exposes the server on your local network. Keep your API key secure.
                  </div>
                )}
              </Control>

              <Control label={<ControlLabel label="API Key" tooltip="Bearer token required in Authorization header" />} className="px-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Input type="password" value={cfg.remoteServerApiKey || ""} readOnly className="w-full sm:w-[360px] max-w-full min-w-0" />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={streamerMode}
                    title={streamerMode ? "Disabled in Streamer Mode" : undefined}
                    onClick={() => cfg.remoteServerApiKey && !streamerMode && navigator.clipboard.writeText(cfg.remoteServerApiKey)}
                  >
                    {streamerMode ? <><EyeOff className="h-3.5 w-3.5 mr-1" />Hidden</> : "Copy"}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      // Generate a new 32-byte API key (hex)
                      const bytes = new Uint8Array(32)
                      window.crypto.getRandomValues(bytes)
                      const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("")
                      saveConfig({ remoteServerApiKey: hex })
                      await configQuery.refetch()
                    }}
                  >
                    Regenerate
                  </Button>
                </div>
                {streamerMode && (
                  <div className="mt-1 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <EyeOff className="h-3 w-3" />
                    Copy disabled in Streamer Mode
                  </div>
                )}
              </Control>

              <Control label={<ControlLabel label="Log Level" tooltip="Fastify logger level" />} className="px-3">
                <Select
                  value={(cfg.remoteServerLogLevel as any) || "info"}
                  onValueChange={(value: any) => saveConfig({ remoteServerLogLevel: value })}
                >
                  <SelectTrigger className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="error">error</SelectItem>
                    <SelectItem value="info">info</SelectItem>
                    <SelectItem value="debug">debug</SelectItem>
                  </SelectContent>
                </Select>
              </Control>

              <Control label={<ControlLabel label="CORS Origins" tooltip="Allowed origins for CORS requests. Use * for all origins (development), or specify comma-separated URLs like http://localhost:8081" />} className="px-3">
                <Input
                  type="text"
                  value={(cfg.remoteServerCorsOrigins || ["*"]).join(", ")}
                  onChange={(e) => {
                    const origins = e.currentTarget.value
                      .split(",")
                      .map(s => s.trim())
                      .filter(Boolean)
                    saveConfig({ remoteServerCorsOrigins: origins.length > 0 ? origins : ["*"] })
                  }}
                  placeholder="* or http://localhost:8081, http://example.com"
                  className="w-full"
                />
                <div className="mt-1 text-xs text-muted-foreground">
                  Use * for development or specify allowed origins separated by commas
                </div>
              </Control>

              {baseUrl && (
                <>
                  <Control label="Base URL" className="px-3">
                    <div className="text-sm text-muted-foreground select-text break-all">
                      {streamerMode ? maskUrl(baseUrl) : baseUrl}
                    </div>
                    {streamerMode && (
                      <div className="mt-1 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                        <EyeOff className="h-3 w-3" />
                        URL masked in Streamer Mode
                      </div>
                    )}
                  </Control>

                  {cfg?.remoteServerApiKey && (
                    <Control label={<ControlLabel label="Mobile App QR Code" tooltip="Scan this QR code with the SpeakMCP mobile app to connect (local network only)" />} className="px-3">
                      <div className="flex flex-col items-start gap-3">
                        {streamerMode ? (
                          <div className="p-3 bg-muted/50 rounded-lg flex flex-col items-center justify-center" style={{ width: 160, height: 160 }}>
                            <EyeOff className="h-8 w-8 text-muted-foreground mb-2" />
                            <span className="text-xs text-muted-foreground text-center">QR hidden<br />Streamer Mode</span>
                          </div>
                        ) : (
                          <div className="p-3 bg-white rounded-lg">
                            <QRCodeSVG
                              value={`speakmcp://config?baseUrl=${encodeURIComponent(baseUrl)}&apiKey=${encodeURIComponent(cfg.remoteServerApiKey)}`}
                              size={160}
                              level="M"
                            />
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={streamerMode}
                            title={streamerMode ? "Disabled in Streamer Mode" : undefined}
                            onClick={() => {
                              if (streamerMode) return
                              const deepLink = `speakmcp://config?baseUrl=${encodeURIComponent(baseUrl)}&apiKey=${encodeURIComponent(cfg.remoteServerApiKey || "")}`
                              navigator.clipboard.writeText(deepLink)
                            }}
                          >
                            {streamerMode ? <><EyeOff className="h-3.5 w-3.5 mr-1" />Hidden</> : "Copy Deep Link"}
                          </Button>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {streamerMode
                            ? "QR code and deep link hidden in Streamer Mode"
                            : "Scan with the SpeakMCP mobile app to auto-configure. Works on local network only. For internet access, use Cloudflare Tunnel below."}
                        </div>
                      </div>
                    </Control>
                  )}
                </>
              )}
            </>
          )}
        </ControlGroup>

        {/* Cloudflare Tunnel Section - only show when remote server is enabled */}
        {enabled && (
          <ControlGroup
            title="Cloudflare Tunnel"
            endDescription={(
              <div className="break-words whitespace-normal">
                Create a secure tunnel to expose your remote server to the internet.{" "}
                <strong>Quick tunnels</strong> provide random URLs (no account needed).{" "}
                <strong>Named tunnels</strong> provide{" "}
                <a
                  href="https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline"
                >
                  persistent URLs
                </a>{" "}
                (requires Cloudflare account).
              </div>
            )}
          >
            {!isCloudflaredInstalled ? (
              <div className="px-3 py-2">
                <div className="text-sm text-amber-600 dark:text-amber-400 mb-2">
                  cloudflared is not installed. Please install it to use Cloudflare Tunnel.
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open("https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/", "_blank")}
                >
                  Download cloudflared
                </Button>
              </div>
            ) : (
              <>
                <Control label={<ControlLabel label="Tunnel Mode" tooltip="Quick tunnels are easy but have random URLs. Named tunnels require setup but have persistent URLs." />} className="px-3">
                  <Select
                    value={tunnelMode}
                    onValueChange={(value: "quick" | "named") => {
                      // Stop any running tunnel when switching modes
                      if (tunnelStatus?.running) {
                        stopTunnelMutation.mutate()
                      }
                      saveConfig({ cloudflareTunnelMode: value })
                    }}
                  >
                    <SelectTrigger className="w-[200px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="quick">Quick Tunnel (Random URL)</SelectItem>
                      <SelectItem value="named">Named Tunnel (Persistent)</SelectItem>
                    </SelectContent>
                  </Select>
                </Control>

                {/* Named Tunnel Configuration */}
                {tunnelMode === "named" && (
                  <>
                    {!isCloudflaredLoggedIn ? (
                      <div className="px-3 py-2">
                        <div className="text-sm text-amber-600 dark:text-amber-400 mb-2">
                          You need to authenticate with Cloudflare first. Run <code className="bg-muted px-1 rounded">cloudflared tunnel login</code> in your terminal.
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => window.open("https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-a-cloudflare-tunnel/", "_blank")}
                        >
                          <ExternalLink className="h-3.5 w-3.5 mr-1" />
                          Setup Guide
                        </Button>
                      </div>
                    ) : (
                      <>
                        <Control label={<ControlLabel label="Tunnel ID" tooltip="The UUID of your named tunnel. Find it with 'cloudflared tunnel list'" />} className="px-3">
                          <div className="flex flex-col gap-2">
                            <Input
                              type="text"
                              value={cfg?.cloudflareTunnelId ?? ""}
                              onChange={(e) => saveConfig({ cloudflareTunnelId: e.currentTarget.value })}
                              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                              className="w-full sm:w-[360px] max-w-full min-w-0 font-mono text-xs"
                            />
                            {tunnelList.length > 0 && (
                              <div className="text-xs text-muted-foreground">
                                Available tunnels: {tunnelList.map((t) => (
                                  <button
                                    key={t.id}
                                    type="button"
                                    className="underline cursor-pointer ml-1 hover:text-foreground"
                                    onClick={() => saveConfig({
                                      cloudflareTunnelId: t.id,
                                      cloudflareTunnelName: t.name,
                                    })}
                                  >
                                    {t.name}
                                  </button>
                                )).reduce<React.ReactNode[]>((acc, el, i) => (i === 0 ? [el] : [...acc, ", ", el]), [])}
                              </div>
                            )}
                          </div>
                        </Control>

                        <Control label={<ControlLabel label="Hostname" tooltip="The public hostname for your tunnel (e.g., myapp.example.com). Must be configured in Cloudflare DNS." />} className="px-3">
                          <Input
                            type="text"
                            value={cfg?.cloudflareTunnelHostname ?? ""}
                            onChange={(e) => saveConfig({ cloudflareTunnelHostname: e.currentTarget.value })}
                            placeholder="myapp.example.com"
                            className="w-full sm:w-[300px] max-w-full min-w-0"
                          />
                        </Control>

                        <Control label={<ControlLabel label="Credentials Path" tooltip="Path to credentials JSON file. Leave empty to use default (~/.cloudflared/<tunnel-id>.json)" />} className="px-3">
                          <Input
                            type="text"
                            value={cfg?.cloudflareTunnelCredentialsPath ?? ""}
                            onChange={(e) => saveConfig({ cloudflareTunnelCredentialsPath: e.currentTarget.value })}
                            placeholder="~/.cloudflared/<tunnel-id>.json (default)"
                            className="w-full sm:w-[360px] max-w-full min-w-0 font-mono text-xs"
                          />
                        </Control>
                      </>
                    )}
                  </>
                )}

                <Control label="Tunnel Status" className="px-3">
                  <div className="flex items-center gap-2">
                    {tunnelStatus?.starting ? (
                      <>
                        <span className="inline-block w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
                        <span className="text-sm text-yellow-600 dark:text-yellow-400">Starting...</span>
                      </>
                    ) : tunnelStatus?.running ? (
                      <>
                        <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
                        <span className="text-sm text-green-600 dark:text-green-400">
                          Connected {tunnelStatus.mode === "named" ? "(Named)" : "(Quick)"}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="inline-block w-2 h-2 rounded-full bg-gray-400" />
                        <span className="text-sm text-muted-foreground">Not running</span>
                      </>
                    )}
                  </div>
                </Control>

                <Control label="Actions" className="px-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {!tunnelStatus?.running && !tunnelStatus?.starting ? (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => {
                          if (tunnelMode === "named") {
                            if (!cfg?.cloudflareTunnelId || !cfg?.cloudflareTunnelHostname) {
                              return // Validation handled in UI
                            }
                            startNamedTunnelMutation.mutate({
                              tunnelId: cfg.cloudflareTunnelId,
                              hostname: cfg.cloudflareTunnelHostname,
                              credentialsPath: cfg.cloudflareTunnelCredentialsPath || undefined,
                            })
                          } else {
                            startTunnelMutation.mutate()
                          }
                        }}
                        disabled={
                          startTunnelMutation.isPending ||
                          startNamedTunnelMutation.isPending ||
                          (tunnelMode === "named" && (!cfg?.cloudflareTunnelId || !cfg?.cloudflareTunnelHostname))
                        }
                      >
                        {startTunnelMutation.isPending || startNamedTunnelMutation.isPending
                          ? "Starting..."
                          : "Start Tunnel"}
                      </Button>
                    ) : (
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => stopTunnelMutation.mutate()}
                        disabled={stopTunnelMutation.isPending || tunnelStatus?.starting}
                      >
                        {stopTunnelMutation.isPending ? "Stopping..." : "Stop Tunnel"}
                      </Button>
                    )}
                    {tunnelMode === "named" && !cfg?.cloudflareTunnelId && (
                      <span className="text-xs text-amber-600 dark:text-amber-400">
                        Enter Tunnel ID to start
                      </span>
                    )}
                    {tunnelMode === "named" && cfg?.cloudflareTunnelId && !cfg?.cloudflareTunnelHostname && (
                      <span className="text-xs text-amber-600 dark:text-amber-400">
                        Enter Hostname to start
                      </span>
                    )}
                  </div>
                </Control>

                {tunnelStatus?.url && tunnelStatus?.running && (
                  <>
                    <Control label={<ControlLabel label="Public URL" tooltip="Use this URL to access your remote server from anywhere" />} className="px-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          type={streamerMode ? "password" : "text"}
                          value={streamerMode ? "••••••••••••••••••••" : `${tunnelStatus.url}/v1`}
                          readOnly
                          className="w-full sm:w-[360px] max-w-full min-w-0 font-mono text-xs"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={streamerMode}
                          title={streamerMode ? "Disabled in Streamer Mode" : undefined}
                          onClick={() => !streamerMode && navigator.clipboard.writeText(`${tunnelStatus.url}/v1`)}
                        >
                          {streamerMode ? <><EyeOff className="h-3.5 w-3.5 mr-1" />Hidden</> : "Copy"}
                        </Button>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {streamerMode
                          ? <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1"><EyeOff className="h-3 w-3" />URL hidden in Streamer Mode</span>
                          : tunnelStatus.mode === "named"
                            ? "This URL is persistent and will remain the same across restarts."
                            : "This URL is temporary and will change when you restart the tunnel."}
                      </div>
                    </Control>

                    {cfg?.remoteServerApiKey && (
                      <Control label={<ControlLabel label="Mobile App QR Code" tooltip="Scan this QR code with the SpeakMCP mobile app to connect" />} className="px-3">
                        <div className="flex flex-col items-start gap-3">
                          {streamerMode ? (
                            <div className="p-3 bg-muted/50 rounded-lg flex flex-col items-center justify-center" style={{ width: 160, height: 160 }}>
                              <EyeOff className="h-8 w-8 text-muted-foreground mb-2" />
                              <span className="text-xs text-muted-foreground text-center">QR hidden<br />Streamer Mode</span>
                            </div>
                          ) : (
                            <div className="p-3 bg-white rounded-lg">
                              <QRCodeSVG
                                value={`speakmcp://config?baseUrl=${encodeURIComponent(`${tunnelStatus.url}/v1`)}&apiKey=${encodeURIComponent(cfg.remoteServerApiKey)}`}
                                size={160}
                                level="M"
                              />
                            </div>
                          )}
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={streamerMode}
                              title={streamerMode ? "Disabled in Streamer Mode" : undefined}
                              onClick={() => {
                                if (streamerMode) return
                                const deepLink = `speakmcp://config?baseUrl=${encodeURIComponent(`${tunnelStatus.url}/v1`)}&apiKey=${encodeURIComponent(cfg.remoteServerApiKey || "")}`
                                navigator.clipboard.writeText(deepLink)
                              }}
                            >
                              {streamerMode ? <><EyeOff className="h-3.5 w-3.5 mr-1" />Hidden</> : "Copy Deep Link"}
                            </Button>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {streamerMode
                              ? "QR code and deep link hidden in Streamer Mode"
                              : "Scan with the SpeakMCP mobile app to auto-configure the connection."}
                          </div>
                        </div>
                      </Control>
                    )}
                  </>
                )}

                {tunnelStatus?.error && (
                  <div className="px-3 py-2">
                    <div className="text-sm text-red-600 dark:text-red-400">
                      Error: {tunnelStatus.error}
                    </div>
                  </div>
                )}
              </>
            )}
          </ControlGroup>
        )}
      </div>
    </div>
  )
}

