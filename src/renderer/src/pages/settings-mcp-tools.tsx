import { useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@renderer/components/ui/button"
import { Label } from "@renderer/components/ui/label"
import { useConfigQuery } from "@renderer/lib/query-client"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { tipcClient } from "@renderer/lib/tipc-client"
import { Config, MCPConfig } from "@shared/types"
import { MCPConfigManager } from "@renderer/components/mcp-config-manager"
import { MCPToolManager } from "@renderer/components/mcp-tool-manager"
import { DebugLogsManager } from "@renderer/components/debug-logs-manager"

export function Component() {
  const navigate = useNavigate()
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

  useEffect(() => {
    // If MCP is disabled, we still allow viewing the page but hint to enable it in Agents
  }, [config.mcpToolsEnabled])

  return (
    <div className="modern-panel h-full overflow-auto px-6 py-4">

      {!config.mcpToolsEnabled ? (
        <div className="space-y-4">
          <div className="rounded-lg border p-4">
            <h3 className="text-lg font-semibold">MCP Tool Calling is disabled</h3>
            <p className="text-sm text-muted-foreground">
              Enable MCP Tool Calling in the Agents page to configure servers and manage tools.
            </p>
            <div className="mt-3">
              <Button onClick={() => navigate("/settings/tools")}>Go to Agents</Button>
            </div>
          </div>

          
        </div>
      ) : (
        <div className="space-y-8">
          

          <div className="space-y-8 border-t pt-6">
            <MCPConfigManager
              config={config.mcpConfig || { mcpServers: {} }}
              onConfigChange={updateMcpConfig}
            />

            <div className="border-t pt-6">
              <MCPToolManager />
            </div>

            <div className="border-t pt-6">
              <DebugLogsManager
                config={config}
                onConfigChange={updateConfig}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

