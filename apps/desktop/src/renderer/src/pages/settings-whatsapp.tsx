import { useCallback } from "react"
import { Control, ControlGroup, ControlLabel } from "@renderer/components/ui/control"
import { Switch } from "@renderer/components/ui/switch"
import { Input } from "@renderer/components/ui/input"
import { useConfigQuery, useSaveConfigMutation } from "@renderer/lib/query-client"
import type { Config } from "@shared/types"
import { AlertTriangle, MessageCircle } from "lucide-react"

export function Component() {
  const configQuery = useConfigQuery()
  const saveConfigMutation = useSaveConfigMutation()

  const cfg = configQuery.data as Config | undefined

  const saveConfig = useCallback(
    (partial: Partial<Config>) => {
      if (!cfg) return
      saveConfigMutation.mutate({ config: { ...cfg, ...partial } })
    },
    [cfg, saveConfigMutation],
  )

  if (!cfg) return null

  const enabled = cfg.whatsappEnabled ?? false
  const remoteServerEnabled = cfg.remoteServerEnabled ?? false
  const hasApiKey = !!cfg.remoteServerApiKey

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

          {enabled && (
            <>
              <Control 
                label={<ControlLabel label="Allowed Phone Numbers" tooltip="Only messages from these numbers will be processed. Leave empty to allow all (not recommended)." />} 
                className="px-3"
              >
                <Input
                  type="text"
                  value={(cfg.whatsappAllowFrom || []).join(", ")}
                  onChange={(e) => {
                    const numbers = e.currentTarget.value
                      .split(",")
                      .map(s => s.trim().replace(/[^0-9]/g, ""))
                      .filter(Boolean)
                    saveConfig({ whatsappAllowFrom: numbers })
                  }}
                  placeholder="14155551234, 14155555678"
                  className="w-full"
                />
                <div className="mt-1 text-xs text-muted-foreground">
                  Enter phone numbers in international format without + sign, separated by commas
                </div>
                {(!cfg.whatsappAllowFrom || cfg.whatsappAllowFrom.length === 0) && (
                  <div className="mt-1 text-xs text-amber-600 dark:text-amber-400">
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
                  disabled={!remoteServerEnabled || !hasApiKey}
                />
                {cfg.whatsappAutoReply && remoteServerEnabled && hasApiKey && (
                  <div className="mt-1 text-xs text-green-600 dark:text-green-400">
                    ✓ Auto-reply enabled - incoming messages will be processed and replied to
                  </div>
                )}
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
            </>
          )}
        </ControlGroup>

        {/* Setup Instructions */}
        {enabled && (
          <ControlGroup
            title="Setup Instructions"
            endDescription="Follow these steps to connect your WhatsApp account"
          >
            <div className="px-3 py-2 text-sm space-y-3">
              <div className="flex items-start gap-2">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-medium shrink-0">1</span>
                <span>Ask the AI agent: <code className="bg-muted px-1 rounded">"Connect to WhatsApp"</code></span>
              </div>
              <div className="flex items-start gap-2">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-medium shrink-0">2</span>
                <span>A QR code will appear in the terminal/logs</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-medium shrink-0">3</span>
                <span>On your phone: WhatsApp → Settings → Linked Devices → Link a Device</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-medium shrink-0">4</span>
                <span>Scan the QR code - you're connected!</span>
              </div>
            </div>
          </ControlGroup>
        )}
      </div>
    </div>
  )
}

