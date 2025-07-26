import { useConfigQuery } from "@renderer/lib/query-client"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { Label } from "@renderer/components/ui/label"
import { Switch } from "@renderer/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@renderer/components/ui/select"
import { Textarea } from "@renderer/components/ui/textarea"
import { Save } from "lucide-react"
import { useState, useEffect } from "react"

import { CHAT_PROVIDERS } from "@shared/index"
import { Config, MCPConfig } from "@shared/types"
import { MCPConfigManager } from "@renderer/components/mcp-config-manager"
import { MCPToolManager } from "@renderer/components/mcp-tool-manager"

export function Component() {
  const configQuery = useConfigQuery()
  const queryClient = useQueryClient()

  const saveConfigMutation = useMutation({
    mutationFn: async (config: Config) => {
      await tipcClient.saveConfig({ config })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config"] })
    },
  })

  const config = configQuery.data || {}

  // Local state for additional guidelines to allow editing without auto-save
  const [additionalGuidelines, setAdditionalGuidelines] = useState("")
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  // Initialize local state when config loads
  useEffect(() => {
    if (config.mcpToolsSystemPrompt !== undefined) {
      setAdditionalGuidelines(config.mcpToolsSystemPrompt)
      setHasUnsavedChanges(false)
    }
  }, [config.mcpToolsSystemPrompt])

  const updateConfig = (updates: Partial<Config>) => {
    const newConfig = { ...config, ...updates }
    saveConfigMutation.mutate(newConfig)
  }

  const updateMcpConfig = (mcpConfig: MCPConfig) => {
    updateConfig({ mcpConfig })
  }

  const saveAdditionalGuidelines = () => {
    updateConfig({ mcpToolsSystemPrompt: additionalGuidelines })
    setHasUnsavedChanges(false)
  }

  const revertChanges = () => {
    setAdditionalGuidelines(config.mcpToolsSystemPrompt || "")
    setHasUnsavedChanges(false)
  }

  const handleGuidelinesChange = (value: string) => {
    setAdditionalGuidelines(value)
    setHasUnsavedChanges(value !== (config.mcpToolsSystemPrompt || ""))
  }

  const defaultAdditionalGuidelines = `CUSTOM GUIDELINES:
- Prioritize user privacy and security
- Provide clear explanations of actions taken
- Ask for confirmation before destructive operations

DOMAIN-SPECIFIC RULES:
- For file operations: Always backup important files
- For system commands: Use safe, non-destructive commands when possible
- For API calls: Respect rate limits and handle errors gracefully`

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="space-y-2">
          <h3 className="text-lg font-semibold">MCP Tool Calling</h3>
          <p className="text-sm text-muted-foreground">
            Enable voice-activated tool execution using Model Context Protocol (MCP).
            This allows you to perform actions like creating files, sending notifications, and more through voice commands.
          </p>
        </div>

        <div className="space-y-4">
          <div className="flex items-center space-x-2">
            <Switch
              id="mcp-enabled"
              checked={config.mcpToolsEnabled || false}
              onCheckedChange={(checked) => updateConfig({ mcpToolsEnabled: checked })}
            />
            <Label htmlFor="mcp-enabled">Enable MCP Tool Calling</Label>
          </div>

          {config.mcpToolsEnabled && (
            <>
              <div className="space-y-2">
                <Label htmlFor="mcp-shortcut">Shortcut</Label>
                <Select
                  value={config.mcpToolsShortcut || "hold-ctrl-alt"}
                  onValueChange={(value: "hold-ctrl-alt" | "ctrl-alt-slash") =>
                    updateConfig({ mcpToolsShortcut: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hold-ctrl-alt">Hold Ctrl+Alt</SelectItem>
                    <SelectItem value="ctrl-alt-slash">Ctrl+Alt+/</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Choose how to activate MCP tool calling mode
                </p>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="mcp-agent-mode"
                  checked={config.mcpAgentModeEnabled || false}
                  onCheckedChange={(checked) => updateConfig({ mcpAgentModeEnabled: checked })}
                />
                <Label htmlFor="mcp-agent-mode">Enable Agent Mode</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                When enabled, the agent can see tool results and make follow-up tool calls until the task is complete
              </p>

              {config.mcpAgentModeEnabled && (
                <div className="space-y-2">
                  <Label htmlFor="mcp-max-iterations">Max Iterations</Label>
                  <Input
                    id="mcp-max-iterations"
                    type="number"
                    min="1"
                    max="50"
                    step="1"
                    value={config.mcpMaxIterations || 50}
                    onChange={(e) => updateConfig({ mcpMaxIterations: parseInt(e.target.value) || 10 })}
                    className="w-32"
                  />
                  <p className="text-xs text-muted-foreground">
                    Maximum number of iterations the agent can perform before stopping. Higher values allow more complex tasks but may take longer.
                  </p>
                </div>
              )}

              {!config.mcpAgentModeEnabled && (
                <>
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="mcp-auto-paste"
                      checked={config.mcpAutoPasteEnabled !== false}
                      onCheckedChange={(checked) => updateConfig({ mcpAutoPasteEnabled: checked })}
                    />
                    <Label htmlFor="mcp-auto-paste">Auto-paste Results</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Automatically paste the final result to the active input field. Disable if you prefer to manually paste from clipboard.
                  </p>

                  {config.mcpAutoPasteEnabled !== false && (
                    <div className="space-y-2">
                      <Label htmlFor="mcp-paste-delay">Auto-paste Delay (ms)</Label>
                      <Input
                        id="mcp-paste-delay"
                        type="number"
                        min="0"
                        max="10000"
                        step="100"
                        value={config.mcpAutoPasteDelay || 1000}
                        onChange={(e) => updateConfig({ mcpAutoPasteDelay: parseInt(e.target.value) || 1000 })}
                        className="w-32"
                      />
                      <p className="text-xs text-muted-foreground">
                        Delay before pasting to allow you to return focus to the desired input field. Recommended: 1000ms (1 second).
                      </p>
                    </div>
                  )}
                </>
              )}

              {config.mcpAgentModeEnabled && (
                <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <p className="text-sm text-blue-800 dark:text-blue-200">
                    <strong>Agent Mode:</strong> Results are displayed in a floating GUI. Press <kbd className="px-1.5 py-0.5 text-xs bg-blue-100 dark:bg-blue-900 rounded">ESC</kbd> to close the results window.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="mcp-provider">LLM Provider</Label>
                <Select
                  value={config.mcpToolsProviderId || "openai"}
                  onValueChange={(value) => updateConfig({ mcpToolsProviderId: value as any })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHAT_PROVIDERS.map((provider) => (
                      <SelectItem key={provider.value} value={provider.value}>
                        {provider.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Choose which LLM provider to use for tool calling decisions. Configure models in the Providers tab.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="mcp-additional-guidelines">Additional Guidelines</Label>
                <Textarea
                  id="mcp-additional-guidelines"
                  value={additionalGuidelines}
                  onChange={(e) => handleGuidelinesChange(e.target.value)}
                  rows={8}
                  className="font-mono text-sm"
                  placeholder={defaultAdditionalGuidelines}
                />
                <p className="text-xs text-muted-foreground">
                  Optional additional rules and guidelines for the AI agent. The base system prompt with tool usage instructions is automatically included.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setAdditionalGuidelines(defaultAdditionalGuidelines)
                      setHasUnsavedChanges(defaultAdditionalGuidelines !== (config.mcpToolsSystemPrompt || ""))
                    }}
                  >
                    Use Example Guidelines
                  </Button>
                  {hasUnsavedChanges && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={revertChanges}
                      disabled={saveConfigMutation.isPending}
                    >
                      Revert Changes
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={saveAdditionalGuidelines}
                    disabled={!hasUnsavedChanges || saveConfigMutation.isPending}
                    className="gap-1"
                  >
                    <Save className="h-3 w-3" />
                    {saveConfigMutation.isPending ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
                {hasUnsavedChanges && (
                  <p className="text-xs text-amber-600">
                    You have unsaved changes. Click "Save Changes" to apply them.
                  </p>
                )}
              </div>

              <div className="rounded-lg border p-4 space-y-2">
                <h4 className="font-medium">MCP Tools</h4>
                <div className="text-sm text-muted-foreground">
                  <p>Tools are provided by MCP (Model Context Protocol) servers that you configure.</p>
                  <p className="mt-2">Configure MCP servers below to add tools for file operations, API integrations, and more.</p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* MCP Server Configuration Section */}
        {config.mcpToolsEnabled && (
          <div className="mt-8 pt-6 border-t space-y-8">
            <MCPConfigManager
              config={config.mcpConfig || { mcpServers: {} }}
              onConfigChange={updateMcpConfig}
            />

            {/* MCP Tool Management Section */}
            <div className="pt-6 border-t">
              <MCPToolManager />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
