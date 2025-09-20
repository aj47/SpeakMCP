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
import type { Config } from "@shared/types"

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

  return (
    <div className="modern-panel h-full overflow-auto px-6 py-4">
      <div className="grid gap-4">
        <ControlGroup title="Remote Server">
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
                <div className="flex items-center gap-2">
                  <Input type="password" value={cfg.remoteServerApiKey || ""} readOnly className="w-[360px]" />
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

              {baseUrl && (
                <Control label="Base URL" className="px-3">
                  <div className="text-sm text-muted-foreground select-text">{baseUrl}</div>
                </Control>
              )}
            </>
          )}
        </ControlGroup>
      </div>
    </div>
  )
}

