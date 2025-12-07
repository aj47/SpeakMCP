import { useConfigQuery } from "@renderer/lib/query-client"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { tipcClient } from "@renderer/lib/tipc-client"
import { Config, MCPConfig } from "@shared/types"
import { MCPConfigManager } from "@renderer/components/mcp-config-manager"
import { MCPToolManager } from "@renderer/components/mcp-tool-manager"
import { ProfileBadge } from "@renderer/components/profile-badge"

export function Component() {
  const queryClient = useQueryClient()
  const configQuery = useConfigQuery()
  const config = configQuery.data || {}

  const saveConfigMutation = useMutation({
    mutationFn: async (config: Config) => {
      await tipcClient.saveConfig({ config })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config"] })
    },
  })

  const updateConfig = (updates: Partial<Config>) => {
    const newConfig = { ...config, ...updates }
    saveConfigMutation.mutate(newConfig)
  }

  const updateMcpConfig = (mcpConfig: MCPConfig) => {
    updateConfig({ mcpConfig })
  }

  return (
    <div className="modern-panel h-full min-w-0 overflow-y-auto overflow-x-hidden px-6 py-4">
      <div className="min-w-0 space-y-8">
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">
            Server and tool enable/disable settings are saved per-profile.
          </p>
          <ProfileBadge />
        </div>

        <div className="min-w-0 space-y-8 border-t pt-6">
          <MCPConfigManager
            config={config.mcpConfig || { mcpServers: {} }}
            onConfigChange={updateMcpConfig}
          />

          <div className="min-w-0 border-t pt-6">
            <MCPToolManager />
          </div>
        </div>
      </div>
    </div>
  )
}

