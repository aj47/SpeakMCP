import { useCallback, useState, useEffect } from "react"
import { Control, ControlGroup, ControlLabel } from "@renderer/components/ui/control"
import { Switch } from "@renderer/components/ui/switch"
import { Input } from "@renderer/components/ui/input"
import { Button } from "@renderer/components/ui/button"
import { useConfigQuery, useSaveConfigMutation } from "@renderer/lib/query-client"
import type { Config } from "@shared/types"
import { AlertTriangle, Loader2, CheckCircle2, XCircle, RefreshCw, LogOut, QrCode as QrCodeIcon, EyeOff } from "lucide-react"
import { tipcClient } from "@renderer/lib/tipc-client"
import { QRCodeSVG } from "qrcode.react"

/**
 * Mask a phone number for streamer mode
 * Replaces digits with asterisks while preserving structure
 */
function maskPhoneNumber(phone: string | undefined): string {
  if (!phone) return "***-***-****"
  // Replace all but first 2 and last 2 digits with asterisks
  if (phone.length <= 4) return "****"
  return phone.slice(0, 2) + "*".repeat(phone.length - 4) + phone.slice(-2)
}

interface WhatsAppStatus {
  available: boolean
  connected: boolean
  phoneNumber?: string
  userName?: string
  hasQrCode?: boolean
  qrCode?: string
  hasCredentials?: boolean
  lastError?: string
  error?: string
}

export function Component() {
  const configQuery = useConfigQuery()
  const saveConfigMutation = useSaveConfigMutation()

  const cfg = configQuery.data as Config | undefined

  // WhatsApp connection state
  const [status, setStatus] = useState<WhatsAppStatus | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [qrCodeData, setQrCodeData] = useState<string | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)

  const saveConfig = useCallback(
    (partial: Partial<Config>) => {
      if (!cfg) return
      saveConfigMutation.mutate({ config: { ...cfg, ...partial } })
    },
    [cfg, saveConfigMutation],
  )

  // Fetch WhatsApp status periodically
  const fetchStatus = useCallback(async (): Promise<void> => {
    try {
      const result = await tipcClient.whatsappGetStatus()
      setStatus(result as WhatsAppStatus)
      setStatusError(null)

      // Store QR code data if available
      if (result.qrCode) {
        setQrCodeData(result.qrCode)
      } else {
        setQrCodeData(null)
      }
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : String(error))
    }
  }, [])

  // Poll for status when enabled
  useEffect(() => {
    if (!cfg?.whatsappEnabled) {
      return undefined
    }

    fetchStatus()
    const interval = setInterval(fetchStatus, 3000) // Poll every 3 seconds
    return () => clearInterval(interval)
  }, [cfg?.whatsappEnabled, fetchStatus])

  const handleConnect = async () => {
    setIsConnecting(true)
    setStatusError(null)
    try {
      const result = await tipcClient.whatsappConnect()
      if (!result.success) {
        setStatusError(result.error || "Failed to connect")
      } else if (result.qrCode) {
        setQrCodeData(result.qrCode)
      }
      // Refresh status
      await fetchStatus()
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsConnecting(false)
    }
  }

  const handleDisconnect = async () => {
    try {
      const result = await tipcClient.whatsappDisconnect()
      if (!result.success) {
        setStatusError(result.error || "Failed to disconnect")
      }
      await fetchStatus()
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : String(error))
    }
  }

  const handleLogout = async () => {
    try {
      const result = await tipcClient.whatsappLogout()
      if (!result.success) {
        setStatusError(result.error || "Failed to logout")
      } else {
        setQrCodeData(null)
      }
      await fetchStatus()
    } catch (error) {
      setStatusError(error instanceof Error ? error.message : String(error))
    }
  }

  if (!cfg) return null

  const enabled = cfg.whatsappEnabled ?? false
  const remoteServerEnabled = cfg.remoteServerEnabled ?? false
  const hasApiKey = !!cfg.remoteServerApiKey
  const streamerMode = cfg.streamerModeEnabled ?? false

  return (
    <div className="modern-panel h-full overflow-y-auto overflow-x-hidden px-6 py-4">
      <div className="grid gap-4">
        <ControlGroup
          title="WhatsApp Integration"
          endDescription={(
            <div className="break-words whitespace-normal">
              Connect your WhatsApp account to send and receive messages through SpeakMCP.
              Messages from allowed phone numbers can trigger the AI agent and receive automatic replies.
            </div>
          )}
        >
          {/* Warning if remote server is not enabled */}
          {!remoteServerEnabled && (
            <div className="mx-3 mb-2 flex items-start gap-2 rounded-md bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <strong>Remote Server Required:</strong> WhatsApp auto-reply requires the Remote Server to be enabled.
                <a href="/settings/remote-server" className="underline ml-1">Enable it here</a>.
              </div>
            </div>
          )}

          {remoteServerEnabled && !hasApiKey && (
            <div className="mx-3 mb-2 flex items-start gap-2 rounded-md bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <strong>API Key Required:</strong> Generate an API key in Remote Server settings for WhatsApp to work.
                <a href="/settings/remote-server" className="underline ml-1">Configure it here</a>.
              </div>
            </div>
          )}

          <Control label="Enable WhatsApp" className="px-3">
            <Switch
              checked={enabled}
              onCheckedChange={(value) => {
                saveConfig({ whatsappEnabled: value })
              }}
            />
          </Control>
        </ControlGroup>

        {/* Connection Status & QR Code */}
        {enabled && (
          <ControlGroup
            title="Connection"
            endDescription="Connect your WhatsApp account by scanning the QR code"
          >
            <div className="px-3 py-2">
              {/* Streamer mode indicator */}
              {streamerMode && (
                <div className="mb-3 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                  <EyeOff className="h-3.5 w-3.5" />
                  <span>Streamer Mode: Phone numbers and QR codes are hidden</span>
                </div>
              )}

              {/* Status display */}
              <div className="flex items-center gap-2 mb-4">
                {status?.connected ? (
                  <>
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                    <span className="text-sm text-green-600 dark:text-green-400">
                      Connected as {streamerMode ? "****" : (status.userName || "Unknown")} ({streamerMode ? maskPhoneNumber(status.phoneNumber) : status.phoneNumber})
                    </span>
                  </>
                ) : status?.available ? (
                  <>
                    <XCircle className="h-5 w-5 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Not connected</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                    <span className="text-sm text-amber-600 dark:text-amber-400">
                      {status?.error || "WhatsApp server not available"}
                    </span>
                  </>
                )}
              </div>

              {/* Error display */}
              {statusError && (
                <div className="mb-4 p-2 rounded bg-red-500/10 text-sm text-red-600 dark:text-red-400">
                  {statusError}
                </div>
              )}

              {/* QR Code display */}
              {qrCodeData && !status?.connected && (
                <div className="mb-4 flex flex-col items-center">
                  {streamerMode ? (
                    <div className="bg-muted/50 p-4 rounded-lg shadow-md flex flex-col items-center justify-center" style={{ width: 256, height: 256 }}>
                      <EyeOff className="h-12 w-12 text-muted-foreground mb-2" />
                      <span className="text-sm text-muted-foreground text-center">QR Code hidden<br />Streamer Mode is active</span>
                    </div>
                  ) : (
                    <div className="bg-white p-4 rounded-lg shadow-md">
                      <QRCodeSVG value={qrCodeData} size={256} />
                    </div>
                  )}
                  <p className="mt-2 text-sm text-muted-foreground text-center">
                    Open WhatsApp on your phone → Settings → Linked Devices → Scan this QR code
                  </p>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2 flex-wrap">
                {!status?.connected ? (
                  <Button
                    onClick={handleConnect}
                    disabled={isConnecting || !status?.available}
                    variant="default"
                    size="sm"
                  >
                    {isConnecting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      <>
                        <QrCodeIcon className="h-4 w-4 mr-2" />
                        {status?.hasCredentials ? "Reconnect" : "Connect with QR Code"}
                      </>
                    )}
                  </Button>
                ) : (
                  <Button onClick={handleDisconnect} variant="outline" size="sm">
                    <XCircle className="h-4 w-4 mr-2" />
                    Disconnect
                  </Button>
                )}

                <Button onClick={fetchStatus} variant="ghost" size="sm">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh
                </Button>

                {(status?.connected || status?.hasCredentials) && (
                  <Button onClick={handleLogout} variant="ghost" size="sm" className="text-red-600">
                    <LogOut className="h-4 w-4 mr-2" />
                    Logout
                  </Button>
                )}
              </div>
            </div>
          </ControlGroup>
        )}

        {/* Settings */}
        {enabled && (
          <ControlGroup title="Settings">
            <Control
              label={<ControlLabel label="Allowed Senders" tooltip="Only messages from these senders will be processed. Accepts phone numbers (E.164) or WhatsApp LIDs. Leave empty to allow all (not recommended)." />}
              className="px-3"
            >
              <Input
                type={streamerMode ? "password" : "text"}
                value={(cfg.whatsappAllowFrom || []).join(", ")}
                onChange={(e) => {
                  const numbers = e.currentTarget.value
                    .split(",")
                    .map(s => s.trim().replace(/[^0-9]/g, ""))
                    .filter(Boolean)
                  saveConfig({ whatsappAllowFrom: numbers })
                }}
                placeholder={streamerMode ? "••••••••••" : "14155551234, 98389177934034"}
                className="w-full"
              />
              <div className="mt-2 text-xs text-muted-foreground space-y-1">
                <p>Enter phone numbers or LIDs separated by commas (numbers only, no + sign)</p>
                <details className="cursor-pointer">
                  <summary className="text-blue-600 dark:text-blue-400 hover:underline">
                    ℹ️ What are LIDs? How do I find them?
                  </summary>
                  <div className="mt-2 p-2 bg-muted/50 rounded-md space-y-2">
                    <p>
                      <strong>LIDs (Linked IDs)</strong> are WhatsApp's privacy-focused identifiers that replace phone numbers in some cases.
                    </p>
                    <p>
                      <strong>To find a sender's LID:</strong>
                    </p>
                    <ol className="list-decimal list-inside space-y-1 ml-2">
                      <li>Enable "Log Message Content" below</li>
                      <li>Have the person send you a message</li>
                      <li>Check the logs - blocked messages show the LID to add</li>
                      <li>Copy the LID number and add it here</li>
                    </ol>
                    <p className="text-amber-600 dark:text-amber-400">
                      💡 Tip: Phone numbers still work for many contacts. Try the phone number first, then use LID if messages are blocked.
                    </p>
                  </div>
                </details>
              </div>
              {(!cfg.whatsappAllowFrom || cfg.whatsappAllowFrom.length === 0) && (
                <div className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                  ⚠️ No allowlist set - all incoming messages will be accepted
                </div>
              )}
            </Control>

            <Control
              label={<ControlLabel label="Auto-Reply" tooltip="Automatically send agent responses back to WhatsApp. Requires Remote Server to be enabled." />}
              className="px-3"
            >
              <Switch
                checked={cfg.whatsappAutoReply ?? false}
                onCheckedChange={(value) => {
                  saveConfig({ whatsappAutoReply: value })
                }}
                disabled={
                  // Only disable when trying to enable without prerequisites
                  // Always allow turning OFF (unchecking) so users can opt out
                  !(cfg.whatsappAutoReply ?? false) && (!remoteServerEnabled || !hasApiKey)
                }
              />
              {cfg.whatsappAutoReply && remoteServerEnabled && hasApiKey && (
                <div className="mt-1 text-xs text-green-600 dark:text-green-400">
                  ✓ Auto-reply enabled - incoming messages will be processed and replied to
                </div>
              )}
              {cfg.whatsappAutoReply && (!remoteServerEnabled || !hasApiKey) && (
                <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                  ⚠️ Auto-reply is enabled but Remote Server or API key is missing
                </div>
              )}
            </Control>

            <Control
              label={<ControlLabel label="Automatic Harness Output" tooltip="When enabled, the harness automatically sends typing indicators and messages to WhatsApp. When disabled, the agent must explicitly call WhatsApp tools." />}
              className="px-3"
            >
              <Switch
                checked={cfg.whatsappHarnessOutput ?? true}
                onCheckedChange={(value) => {
                  saveConfig({ whatsappHarnessOutput: value })
                }}
              />
              <div className="mt-1 text-xs text-muted-foreground">
                When enabled (default), WhatsApp becomes transparent like TTS - the harness automatically sends typing indicators and messages.
              </div>
              <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                ⚠️ Changes to this setting require restarting the WhatsApp connection to take effect.
              </div>
            </Control>

            <Control
              label={<ControlLabel label="Log Message Content" tooltip="Log the content of WhatsApp messages. Disable for privacy." />}
              className="px-3"
            >
              <Switch
                checked={cfg.whatsappLogMessages ?? false}
                onCheckedChange={(value) => {
                  saveConfig({ whatsappLogMessages: value })
                }}
              />
              <div className="mt-1 text-xs text-muted-foreground">
                When enabled, message content will appear in logs. Disable for privacy.
              </div>
            </Control>
          </ControlGroup>
        )}
      </div>
    </div>
  )
}

