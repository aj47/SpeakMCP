import { useCallback, useMemo, useState } from "react"
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

  const stopTunnelMutation = useMutation({
    mutationFn: () => tipcClient.stopCloudflareTunnel(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cloudflare-tunnel-status"] })
    },
  })

  const tunnelStatus = tunnelStatusQuery.data
  const isCloudflaredInstalled = cloudflaredInstalledQuery.data ?? false

  const bindOptions: Array<{ label: string; value: "127.0.0.1" | "0.0.0.0" }> = useMemo(
    () => [
      { label: "Localhost (127.0.0.1)", value: "127.0.0.1" },
      { label: "All Interfaces (0.0.0.0)", value: "0.0.0.0" },
    ],
    [],
  )

  if (!cfg) return null

  const enabled = cfg.remoteServerEnabled ?? false

  const baseUrl = cfg.remoteServerBindAddress && cfg.remoteServerPort
    ? `http://${cfg.remoteServerBindAddress}:${cfg.remoteServerPort}/v1`
    : undefined

  const localWebhookUrl = baseUrl && cfg.whatsappWebhookSecret
    ? `${baseUrl}/whatsapp/webhook?token=${encodeURIComponent(cfg.whatsappWebhookSecret)}`
    : undefined

  const publicWebhookUrl = tunnelStatus?.url && cfg.whatsappWebhookSecret
    ? `${tunnelStatus.url}/v1/whatsapp/webhook?token=${encodeURIComponent(cfg.whatsappWebhookSecret)}`
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
                    onClick={() => cfg.remoteServerApiKey && navigator.clipboard.writeText(cfg.remoteServerApiKey)}
                  >
                    Copy
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
                    <div className="text-sm text-muted-foreground select-text break-all">{baseUrl}</div>
                  </Control>

                  {cfg?.remoteServerApiKey && (
                    <Control label={<ControlLabel label="Mobile App QR Code" tooltip="Scan this QR code with the SpeakMCP mobile app to connect (local network only)" />} className="px-3">
                      <div className="flex flex-col items-start gap-3">
                        <div className="p-3 bg-white rounded-lg">
                          <QRCodeSVG
                            value={`speakmcp://config?baseUrl=${encodeURIComponent(baseUrl)}&apiKey=${encodeURIComponent(cfg.remoteServerApiKey)}`}
                            size={160}
                            level="M"
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const deepLink = `speakmcp://config?baseUrl=${encodeURIComponent(baseUrl)}&apiKey=${encodeURIComponent(cfg.remoteServerApiKey || "")}`
                              navigator.clipboard.writeText(deepLink)
                            }}
                          >
                            Copy Deep Link
                          </Button>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Scan with the SpeakMCP mobile app to auto-configure. Works on local network only.
                          For internet access, use Cloudflare Tunnel below.
                        </div>
                      </div>
                    </Control>
                  )}
                </>
              )}
            </>
          )}
        </ControlGroup>

        {enabled && (
          <ControlGroup
            title="WhatsApp (Twilio)"
            endDescription={(
              <div className="break-words whitespace-normal">
                Receive WhatsApp messages via Twilio and send agent replies back. Requires a publicly reachable Remote Server URL (Cloudflare Tunnel recommended).
              </div>
            )}
          >
            <Control label="Enable WhatsApp Integration" className="px-3">
              <Switch
                checked={cfg.whatsappEnabled ?? false}
                onCheckedChange={(value) => saveConfig({ whatsappEnabled: value })}
              />
            </Control>

            {cfg.whatsappEnabled && (
              <>
                <Control
                  label={<ControlLabel label="Webhook Secret" tooltip="Shared secret to protect the webhook endpoint. Include as ?token=... or X-SpeakMCP-Webhook-Secret header." />}
                  className="px-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      type="password"
                      value={cfg.whatsappWebhookSecret || ""}
                      onChange={(e) => saveConfig({ whatsappWebhookSecret: e.currentTarget.value })}
                      placeholder="(auto-generated when enabled)"
                      className="w-full sm:w-[360px] max-w-full min-w-0"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => cfg.whatsappWebhookSecret && navigator.clipboard.writeText(cfg.whatsappWebhookSecret)}
                    >
                      Copy
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        const bytes = new Uint8Array(32)
                        window.crypto.getRandomValues(bytes)
                        const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("")
                        saveConfig({ whatsappWebhookSecret: hex })
                      }}
                    >
                      Regenerate
                    </Button>
                  </div>
                </Control>

                {localWebhookUrl && (
                  <Control
                    label={<ControlLabel label="Webhook URL (Local)" tooltip="Only reachable if your machine is accessible at this address. For Twilio, use a public URL (Cloudflare Tunnel below)." />}
                    className="px-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        type="text"
                        value={localWebhookUrl}
                        readOnly
                        className="w-full sm:w-[520px] max-w-full min-w-0 font-mono text-xs"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigator.clipboard.writeText(localWebhookUrl)}
                      >
                        Copy
                      </Button>
                    </div>
                    {cfg.remoteServerBindAddress === "127.0.0.1" && (
                      <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                        This URL is localhost-only. Twilio will not be able to reach it.
                      </div>
                    )}
                  </Control>
                )}

                {publicWebhookUrl && (
                  <Control
                    label={<ControlLabel label="Webhook URL (Cloudflare Tunnel)" tooltip="Use this URL in your Twilio WhatsApp webhook configuration. Note: Quick Tunnel URL changes when restarted." />}
                    className="px-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        type="text"
                        value={publicWebhookUrl}
                        readOnly
                        className="w-full sm:w-[520px] max-w-full min-w-0 font-mono text-xs"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigator.clipboard.writeText(publicWebhookUrl)}
                      >
                        Copy
                      </Button>
                    </div>
                  </Control>
                )}

                <Control label={<ControlLabel label="Twilio Account SID" tooltip="From your Twilio console" />} className="px-3">
                  <Input
                    type="text"
                    value={cfg.whatsappTwilioAccountSid || ""}
                    onChange={(e) => saveConfig({ whatsappTwilioAccountSid: e.currentTarget.value })}
                    className="w-full sm:w-[360px] max-w-full min-w-0"
                  />
                </Control>

                <Control label={<ControlLabel label="Twilio Auth Token" tooltip="Stored locally in your config" />} className="px-3">
                  <Input
                    type="password"
                    value={cfg.whatsappTwilioAuthToken || ""}
                    onChange={(e) => saveConfig({ whatsappTwilioAuthToken: e.currentTarget.value })}
                    className="w-full sm:w-[360px] max-w-full min-w-0"
                  />
                </Control>

                <Control
                  label={<ControlLabel label="Twilio From (WhatsApp)" tooltip="Your Twilio WhatsApp-enabled sender, e.g. whatsapp:+14155552671" />}
                  className="px-3"
                >
                  <Input
                    type="text"
                    value={cfg.whatsappTwilioFrom || ""}
                    onChange={(e) => saveConfig({ whatsappTwilioFrom: e.currentTarget.value })}
                    placeholder="whatsapp:+14155552671"
                    className="w-full sm:w-[360px] max-w-full min-w-0"
                  />
                </Control>

                <Control
                  label={<ControlLabel label="Max Message Length" tooltip="Long replies are split into multiple WhatsApp messages" />}
                  className="px-3"
                >
                  <Input
                    type="number"
                    min={100}
                    max={4096}
                    value={cfg.whatsappTwilioMaxMessageLength ?? 1500}
                    onChange={(e) =>
                      saveConfig({ whatsappTwilioMaxMessageLength: parseInt(e.currentTarget.value || "1500", 10) })
                    }
                    className="w-36"
                  />
                </Control>

                <div className="px-3 pb-2 text-xs text-muted-foreground">
                  Send <span className="font-mono">/new</span> or <span className="font-mono">/reset</span> to start a fresh conversation.
                </div>
              </>
            )}
          </ControlGroup>
        )}


        {/* Cloudflare Tunnel Section - only show when remote server is enabled */}
        {enabled && (
          <ControlGroup
            title="Cloudflare Tunnel"
            endDescription={(
              <div className="break-words whitespace-normal">
                Create a secure tunnel to expose your remote server to the internet using{" "}
                <a
                  href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="underline"
                >
                  Cloudflare Quick Tunnels
                </a>. No account required.
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
                        <span className="text-sm text-green-600 dark:text-green-400">Connected</span>
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
                        onClick={() => startTunnelMutation.mutate()}
                        disabled={startTunnelMutation.isPending}
                      >
                        {startTunnelMutation.isPending ? "Starting..." : "Start Tunnel"}
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
                  </div>
                </Control>

                {tunnelStatus?.url && tunnelStatus?.running && (
                  <>
                    <Control label={<ControlLabel label="Public URL" tooltip="Use this URL to access your remote server from anywhere" />} className="px-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          type="text"
                          value={`${tunnelStatus.url}/v1`}
                          readOnly
                          className="w-full sm:w-[360px] max-w-full min-w-0 font-mono text-xs"
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => navigator.clipboard.writeText(`${tunnelStatus.url}/v1`)}
                        >
                          Copy
                        </Button>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        This URL is temporary and will change when you restart the tunnel.
                      </div>
                    </Control>

                    {cfg?.remoteServerApiKey && (
                      <Control label={<ControlLabel label="Mobile App QR Code" tooltip="Scan this QR code with the SpeakMCP mobile app to connect" />} className="px-3">
                        <div className="flex flex-col items-start gap-3">
                          <div className="p-3 bg-white rounded-lg">
                            <QRCodeSVG
                              value={`speakmcp://config?baseUrl=${encodeURIComponent(`${tunnelStatus.url}/v1`)}&apiKey=${encodeURIComponent(cfg.remoteServerApiKey)}`}
                              size={160}
                              level="M"
                            />
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                const deepLink = `speakmcp://config?baseUrl=${encodeURIComponent(`${tunnelStatus.url}/v1`)}&apiKey=${encodeURIComponent(cfg.remoteServerApiKey || "")}`
                                navigator.clipboard.writeText(deepLink)
                              }}
                            >
                              Copy Deep Link
                            </Button>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Scan with the SpeakMCP mobile app to auto-configure the connection.
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

