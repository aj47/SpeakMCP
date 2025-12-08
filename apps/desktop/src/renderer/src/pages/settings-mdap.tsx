/**
 * MDAP Settings Page
 * Configuration for Massively Decomposed Agentic Processes (MAKER framework)
 */

import { useConfigQuery } from "@renderer/lib/query-client"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { tipcClient } from "@renderer/lib/tipc-client"
import { Config } from "@shared/types"
import { Label } from "@renderer/components/ui/label"
import { Input } from "@renderer/components/ui/input"
import { Switch } from "@renderer/components/ui/switch"

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

  return (
    <div className="modern-panel h-full min-w-0 overflow-y-auto overflow-x-hidden px-6 py-4">
      <div className="min-w-0 space-y-8">
        {/* Header */}
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            MDAP Settings
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Configure Massively Decomposed Agentic Processes (MDAP) for high-reliability task execution.
            Based on the MAKER framework from "Solving a Million-Step LLM Task with Zero Errors".
          </p>
        </div>

        {/* Enable MDAP */}
        <div className="space-y-4 border-t pt-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-base">Enable MDAP Mode</Label>
              <p className="text-sm text-muted-foreground">
                Enable MDAP for tasks that can benefit from decomposition and voting-based error correction.
              </p>
            </div>
            <Switch
              checked={config.mdapEnabled ?? false}
              onCheckedChange={(checked) => updateConfig({ mdapEnabled: checked })}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-base">Auto-Detect MDAP Suitability</Label>
              <p className="text-sm text-muted-foreground">
                Automatically detect if a task would benefit from MDAP decomposition.
              </p>
            </div>
            <Switch
              checked={config.mdapAutoDetect ?? true}
              onCheckedChange={(checked) => updateConfig({ mdapAutoDetect: checked })}
              disabled={!config.mdapEnabled}
            />
          </div>
        </div>

        {/* Voting Configuration */}
        <div className="space-y-4 border-t pt-6">
          <h3 className="text-md font-medium text-foreground">
            Voting Configuration
          </h3>
          <p className="text-sm text-muted-foreground">
            Configure the First-to-ahead-by-k voting mechanism for consensus-based error correction.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="mdapKThreshold">K-Threshold</Label>
              <Input
                id="mdapKThreshold"
                type="number"
                min={1}
                max={10}
                value={config.mdapKThreshold ?? 3}
                onChange={(e) => updateConfig({ mdapKThreshold: parseInt(e.target.value) || 3 })}
                disabled={!config.mdapEnabled}
              />
              <p className="text-xs text-muted-foreground">
                Minimum vote lead required to win (default: 3)
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="mdapMaxSamplesPerSubtask">Max Samples per Subtask</Label>
              <Input
                id="mdapMaxSamplesPerSubtask"
                type="number"
                min={5}
                max={50}
                value={config.mdapMaxSamplesPerSubtask ?? 20}
                onChange={(e) => updateConfig({ mdapMaxSamplesPerSubtask: parseInt(e.target.value) || 20 })}
                disabled={!config.mdapEnabled}
              />
              <p className="text-xs text-muted-foreground">
                Maximum voting samples before giving up (default: 20)
              </p>
            </div>
          </div>
        </div>

        {/* Decomposition Configuration */}
        <div className="space-y-4 border-t pt-6">
          <h3 className="text-md font-medium text-foreground">
            Task Decomposition
          </h3>
          <p className="text-sm text-muted-foreground">
            Configure how tasks are broken down into minimal subtasks.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="mdapMaxSubtasks">Max Subtasks</Label>
              <Input
                id="mdapMaxSubtasks"
                type="number"
                min={10}
                max={500}
                value={config.mdapMaxSubtasks ?? 100}
                onChange={(e) => updateConfig({ mdapMaxSubtasks: parseInt(e.target.value) || 100 })}
                disabled={!config.mdapEnabled}
              />
              <p className="text-xs text-muted-foreground">
                Maximum subtasks in decomposition (default: 100)
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="mdapParallelMicroagents">Parallel Microagents</Label>
              <Input
                id="mdapParallelMicroagents"
                type="number"
                min={1}
                max={10}
                value={config.mdapParallelMicroagents ?? 3}
                onChange={(e) => updateConfig({ mdapParallelMicroagents: parseInt(e.target.value) || 3 })}
                disabled={!config.mdapEnabled}
              />
              <p className="text-xs text-muted-foreground">
                Number of parallel microagent calls (default: 3)
              </p>
            </div>
          </div>
        </div>

        {/* Red-Flagging Configuration */}
        <div className="space-y-4 border-t pt-6">
          <h3 className="text-md font-medium text-foreground">
            Red-Flagging
          </h3>
          <p className="text-sm text-muted-foreground">
            Configure detection of suspicious responses for error prevention.
          </p>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="mdapMaxResponseTokens">Max Response Tokens</Label>
              <Input
                id="mdapMaxResponseTokens"
                type="number"
                min={100}
                max={2000}
                value={config.mdapMaxResponseTokens ?? 700}
                onChange={(e) => updateConfig({ mdapMaxResponseTokens: parseInt(e.target.value) || 700 })}
                disabled={!config.mdapEnabled}
              />
              <p className="text-xs text-muted-foreground">
                Responses exceeding this token count are flagged (default: 700)
              </p>
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-base">Enable Format Validation</Label>
                <p className="text-sm text-muted-foreground">
                  Flag responses with format violations (empty, refusals, errors)
                </p>
              </div>
              <Switch
                checked={config.mdapEnableFormatValidation ?? true}
                onCheckedChange={(checked) => updateConfig({ mdapEnableFormatValidation: checked })}
                disabled={!config.mdapEnabled}
              />
            </div>
          </div>
        </div>

        {/* Info Section */}
        <div className="space-y-4 border-t pt-6">
          <h3 className="text-md font-medium text-foreground">
            About MDAP
          </h3>
          <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
            <p className="text-sm text-blue-300">
              <strong>MDAP (Massively Decomposed Agentic Processes)</strong> is based on the MAKER framework
              which achieves high reliability by:
            </p>
            <ul className="list-disc list-inside text-sm text-blue-200 mt-2 space-y-1">
              <li><strong>Maximal Agentic Decomposition (MAD):</strong> Breaking tasks into smallest possible steps</li>
              <li><strong>K-threshold Voting:</strong> Multiple agents vote on each step until consensus</li>
              <li><strong>Red-flagging:</strong> Detecting and discarding suspicious responses</li>
            </ul>
            <p className="text-xs text-blue-400 mt-3">
              Reference: "Solving a Million-Step LLM Task with Zero Errors" (arXiv:2511.09030)
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
