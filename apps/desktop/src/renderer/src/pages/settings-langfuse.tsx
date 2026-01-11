import { useCallback } from "react"
import { Control, ControlGroup, ControlLabel } from "@renderer/components/ui/control"
import { Switch } from "@renderer/components/ui/switch"
import { Input } from "@renderer/components/ui/input"
import { useConfigQuery, useSaveConfigMutation } from "@renderer/lib/query-client"
import type { Config } from "@shared/types"
import { ExternalLink } from "lucide-react"

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

  const enabled = cfg.langfuseEnabled ?? false

  return (
    <div className="modern-panel h-full overflow-y-auto overflow-x-hidden px-6 py-4">
      <div className="grid gap-4">
        <ControlGroup
          title="Langfuse Observability"
          endDescription={(
            <div className="break-words whitespace-normal">
              <a
                href="https://langfuse.com"
                target="_blank"
                rel="noreferrer noopener"
                className="underline inline-flex items-center gap-1"
              >
                Langfuse
                <ExternalLink className="h-3 w-3" />
              </a>{" "}
              is an open-source LLM observability platform. Enable this to trace LLM calls, agent sessions, and tool executions for debugging and monitoring.
            </div>
          )}
        >
          <Control label="Enable Langfuse Tracing" className="px-3">
            <Switch
              checked={enabled}
              onCheckedChange={(value) => {
                saveConfig({ langfuseEnabled: value })
              }}
            />
          </Control>

          {enabled && (
            <>
              <Control label={<ControlLabel label="Public Key" tooltip="Your Langfuse project's public key" />} className="px-3">
                <Input
                  type="text"
                  value={cfg.langfusePublicKey ?? ""}
                  onChange={(e) => saveConfig({ langfusePublicKey: e.currentTarget.value || undefined })}
                  placeholder="pk-lf-..."
                  className="w-full sm:w-[360px] max-w-full min-w-0 font-mono text-xs"
                />
              </Control>

              <Control label={<ControlLabel label="Secret Key" tooltip="Your Langfuse project's secret key" />} className="px-3">
                <Input
                  type="password"
                  value={cfg.langfuseSecretKey ?? ""}
                  onChange={(e) => saveConfig({ langfuseSecretKey: e.currentTarget.value || undefined })}
                  placeholder="sk-lf-..."
                  className="w-full sm:w-[360px] max-w-full min-w-0 font-mono text-xs"
                />
              </Control>

              <Control label={<ControlLabel label="Base URL" tooltip="Langfuse API endpoint. Leave empty for Langfuse Cloud (cloud.langfuse.com)" />} className="px-3">
                <Input
                  type="text"
                  value={cfg.langfuseBaseUrl ?? ""}
                  onChange={(e) => saveConfig({ langfuseBaseUrl: e.currentTarget.value || undefined })}
                  placeholder="https://cloud.langfuse.com (default)"
                  className="w-full sm:w-[360px] max-w-full min-w-0"
                />
                <div className="mt-1 text-xs text-muted-foreground">
                  Use this for self-hosted Langfuse instances. Leave empty for Langfuse Cloud.
                </div>
              </Control>

              {/* Status indicator */}
              {cfg.langfusePublicKey && cfg.langfuseSecretKey && (
                <Control label="Status" className="px-3">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
                    <span className="text-sm text-green-600 dark:text-green-400">Configured</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Traces will be sent to Langfuse for each agent session.
                  </div>
                </Control>
              )}

              {(!cfg.langfusePublicKey || !cfg.langfuseSecretKey) && (
                <div className="px-3 py-2">
                  <div className="text-sm text-amber-600 dark:text-amber-400">
                    Enter both Public Key and Secret Key to enable tracing.
                  </div>
                </div>
              )}
            </>
          )}
        </ControlGroup>
      </div>
    </div>
  )
}

