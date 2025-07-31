import { useConfigQuery } from "@renderer/lib/query-client"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { Label } from "@renderer/components/ui/label"
import { Switch } from "@renderer/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@renderer/components/ui/select"
import { Textarea } from "@renderer/components/ui/textarea"
import { Save, HelpCircle } from "lucide-react"
import { useState, useEffect } from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@renderer/components/ui/tooltip"


import { Config, MCPConfig } from "@shared/types"
import { MCPConfigManager } from "@renderer/components/mcp-config-manager"
import { MCPToolManager } from "@renderer/components/mcp-tool-manager"
import { KeyRecorder } from "@renderer/components/key-recorder"

// Helper component for labels with tooltips
function LabelWithTooltip({ htmlFor, children, tooltip }: { htmlFor?: string; children: React.ReactNode; tooltip: string }) {
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={htmlFor}>{children}</Label>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <HelpCircle className="h-4 w-4 text-muted-foreground cursor-help" />
          </TooltipTrigger>
          <TooltipContent>
            <p className="max-w-xs">{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  )
}

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

  // When agent mode is toggled, ensure MCP tools are enabled if agent mode is on
  const handleAgentModeToggle = (checked: boolean) => {
    const updates: Partial<Config> = { mcpAgentModeEnabled: checked }

    // If enabling agent mode, also enable MCP tools
    if (checked) {
      updates.mcpToolsEnabled = true
    }

    updateConfig(updates)
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
    <div className="h-full overflow-auto px-6 py-4 liquid-glass-panel">
      <header className="mb-5 liquid-glass-card glass-border rounded-lg p-4 glass-shadow">
        <h2 className="text-2xl font-bold">Agents</h2>
      </header>

      <div className="space-y-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <h3 className="text-lg font-semibold">Agent Mode</h3>
          </div>

          <div className="space-y-4">
          <div className="flex items-center space-x-2">
            <Switch
              id="mcp-agent-mode"
              checked={config.mcpAgentModeEnabled || false}
              onCheckedChange={handleAgentModeToggle}
            />
            <LabelWithTooltip
              htmlFor="mcp-agent-mode"
              tooltip="Enable voice-activated agent mode with tool execution using Model Context Protocol (MCP). The agent can see tool results and make follow-up tool calls until the task is complete."
            >
              Enable Agent Mode
            </LabelWithTooltip>
          </div>

          {(config.mcpAgentModeEnabled || config.mcpToolsEnabled) && (
            <>
              <div className="space-y-2">
                <LabelWithTooltip
                  htmlFor="mcp-shortcut"
                  tooltip="Choose how to activate MCP tool calling mode"
                >
                  Shortcut
                </LabelWithTooltip>
                <Select
                  value={config.mcpToolsShortcut || "hold-ctrl-alt"}
                  onValueChange={(value: "hold-ctrl-alt" | "ctrl-alt-slash" | "custom") =>
                    updateConfig({ mcpToolsShortcut: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hold-ctrl-alt">Hold Ctrl+Alt</SelectItem>
                    <SelectItem value="ctrl-alt-slash">Ctrl+Alt+/</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>

                {config.mcpToolsShortcut === "custom" && (
                  <KeyRecorder
                    value={config.customMcpToolsShortcut || ""}
                    onChange={(keyCombo) => {
                      updateConfig({ customMcpToolsShortcut: keyCombo })
                    }}
                    placeholder="Click to record custom MCP tools shortcut"
                  />
                )}
              </div>



              {config.mcpAgentModeEnabled && (
                <>
                  <div className="space-y-2">
                    <LabelWithTooltip
                      htmlFor="mcp-max-iterations"
                      tooltip="Maximum number of iterations the agent can perform before stopping. Higher values allow more complex tasks but may take longer."
                    >
                      Max Iterations
                    </LabelWithTooltip>
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
                  </div>

                  <div className="space-y-4 p-4 border rounded-lg bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800">
                    <div className="flex items-center space-x-2">
                      <Switch
                        id="agent-kill-switch"
                        checked={config.agentKillSwitchEnabled !== false}
                        onCheckedChange={(checked) => updateConfig({ agentKillSwitchEnabled: checked })}
                      />
                      <div className="flex items-center gap-2">
                        <Label htmlFor="agent-kill-switch" className="text-red-800 dark:text-red-200 font-medium">
                          Enable Emergency Kill Switch
                        </Label>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <HelpCircle className="h-4 w-4 text-red-600 dark:text-red-400 cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="max-w-xs">Provides a global hotkey to immediately stop agent mode and kill all agent-created processes.</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </div>

                    {config.agentKillSwitchEnabled !== false && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Label htmlFor="kill-switch-hotkey" className="text-red-800 dark:text-red-200">
                            Kill Switch Hotkey
                          </Label>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <HelpCircle className="h-4 w-4 text-red-600 dark:text-red-400 cursor-help" />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="max-w-xs">Press this key combination to immediately stop the agent and kill all processes.</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                        <select
                          id="kill-switch-hotkey"
                          value={config.agentKillSwitchHotkey || "ctrl-shift-escape"}
                          onChange={(e) => updateConfig({ agentKillSwitchHotkey: e.target.value as any })}
                          className="w-full p-2 border rounded-md bg-background"
                        >
                          <option value="ctrl-shift-escape">Ctrl + Shift + Escape</option>
                          <option value="ctrl-alt-q">Ctrl + Alt + Q</option>
                          <option value="ctrl-shift-q">Ctrl + Shift + Q</option>
                          <option value="custom">Custom</option>
                        </select>

                        {config.agentKillSwitchHotkey === "custom" && (
                          <KeyRecorder
                            value={config.customAgentKillSwitchHotkey || ""}
                            onChange={(keyCombo) => {
                              updateConfig({ customAgentKillSwitchHotkey: keyCombo })
                            }}
                            placeholder="Click to record custom kill switch hotkey"
                          />
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}

              {!config.mcpAgentModeEnabled && config.mcpToolsEnabled && (
                <>
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="mcp-auto-paste"
                      checked={config.mcpAutoPasteEnabled !== false}
                      onCheckedChange={(checked) => updateConfig({ mcpAutoPasteEnabled: checked })}
                    />
                    <LabelWithTooltip
                      htmlFor="mcp-auto-paste"
                      tooltip="Automatically paste the final result to the active input field. Disable if you prefer to manually paste from clipboard."
                    >
                      Auto-paste Results
                    </LabelWithTooltip>
                  </div>

                  {config.mcpAutoPasteEnabled !== false && (
                    <div className="space-y-2">
                      <LabelWithTooltip
                        htmlFor="mcp-paste-delay"
                        tooltip="Delay before pasting to allow you to return focus to the desired input field. Recommended: 1000ms (1 second)."
                      >
                        Auto-paste Delay (ms)
                      </LabelWithTooltip>
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
                    </div>
                  )}
                </>
              )}





              <div className="space-y-2">
                <LabelWithTooltip
                  htmlFor="mcp-additional-guidelines"
                  tooltip="Optional additional rules and guidelines for the AI agent. The base system prompt with tool usage instructions is automatically included."
                >
                  Additional Guidelines
                </LabelWithTooltip>
                <Textarea
                  id="mcp-additional-guidelines"
                  value={additionalGuidelines}
                  onChange={(e) => handleGuidelinesChange(e.target.value)}
                  rows={8}
                  className="font-mono text-sm"
                  placeholder={defaultAdditionalGuidelines}
                />
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


            </>
          )}
        </div>


        {/* Server Configuration Section */}
        {(config.mcpAgentModeEnabled || config.mcpToolsEnabled) && (
          <div className="space-y-4">
            <MCPConfigManager
              config={config.mcpConfig || { mcpServers: {} }}
              onConfigChange={updateMcpConfig}
            />
          </div>
        )}

        {/* Tool Management Section */}
        {(config.mcpAgentModeEnabled || config.mcpToolsEnabled) && (
          <div className="space-y-4">
            <MCPToolManager />
          </div>
        )}
        </div>
      </div>
    </div>
  )
}
