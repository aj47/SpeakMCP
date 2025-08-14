import { useConfigQuery } from "@renderer/lib/query-client"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { Label } from "@renderer/components/ui/label"
import { Switch } from "@renderer/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import { Textarea } from "@renderer/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@renderer/components/ui/tooltip"
import { Save, Info } from "lucide-react"
import { useState, useEffect } from "react"

import { CHAT_PROVIDERS } from "@shared/index"
import { Config } from "@shared/types"

// Helper component for labels with tooltips
const LabelWithTooltip = ({
  htmlFor,
  children,
  tooltip,
  className
}: {
  htmlFor?: string
  children: React.ReactNode
  tooltip?: string
  className?: string
}) => {
  if (!tooltip) {
    return <Label htmlFor={htmlFor} className={className}>{children}</Label>
  }

  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={htmlFor} className={className}>{children}</Label>
      <TooltipProvider delayDuration={0} disableHoverableContent>
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help hover:text-foreground transition-colors" />
          </TooltipTrigger>
          <TooltipContent
            side="right"
            align="start"
            collisionPadding={20}
            avoidCollisions={true}
            sideOffset={8}
            className="z-[99999] max-w-xs"
          >
            <p>{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  )
}

import { KeyRecorder } from "@renderer/components/key-recorder"

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
    <div className="modern-panel h-full overflow-auto px-6 py-4">
      <header className="modern-card modern-border mb-5 rounded-lg p-4">
        <h2 className="text-2xl font-bold">Agents</h2>
      </header>

      <div className="space-y-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <h3 className="text-lg font-semibold">MCP Tool Calling</h3>
            <p className="text-sm text-muted-foreground">
              Enable voice-activated tool execution using Model Context Protocol
              (MCP). This allows you to perform actions like creating files,
              sending notifications, and more through voice commands.
            </p>
          </div>

          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <Switch
                id="mcp-enabled"
                checked={config.mcpToolsEnabled || false}
                onCheckedChange={(checked) =>
                  updateConfig({ mcpToolsEnabled: checked })
                }
              />
              <Label htmlFor="mcp-enabled">Enable MCP Tool Calling</Label>
            </div>

            {config.mcpToolsEnabled && (
              <>
                <div className="space-y-2">
                  <LabelWithTooltip htmlFor="mcp-shortcut" tooltip="Choose how to activate MCP tool calling mode">Shortcut</LabelWithTooltip>
                  <Select
                    value={config.mcpToolsShortcut || "hold-ctrl-alt"}
                    onValueChange={(
                      value: "hold-ctrl-alt" | "ctrl-alt-slash" | "custom",
                    ) => updateConfig({ mcpToolsShortcut: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hold-ctrl-alt">
                        Hold Ctrl+Alt
                      </SelectItem>
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

                <div className="flex items-center space-x-2">
                  <Switch
                    id="mcp-agent-mode"
                    checked={config.mcpAgentModeEnabled || false}
                    onCheckedChange={(checked) =>
                      updateConfig({ mcpAgentModeEnabled: checked })
                    }
                  />
                  <LabelWithTooltip htmlFor="mcp-agent-mode" tooltip="When enabled, the agent can see tool results and make follow-up tool calls until the task is complete">Enable Agent Mode</LabelWithTooltip>
                </div>


                <div className="flex items-center space-x-2">
                  <Switch
                    id="mcp-require-approval"
                    checked={!!config.mcpRequireApprovalBeforeToolCall}
                    onCheckedChange={(checked) =>
                      updateConfig({
                        mcpRequireApprovalBeforeToolCall: checked,
                      })
                    }
                  />
                  <LabelWithTooltip htmlFor="mcp-require-approval" tooltip="Adds a confirmation dialog before any tool executes. Recommended for safety, especially in production environments.">
                    Require approval before each tool call
                  </LabelWithTooltip>
                </div>


                {config.mcpAgentModeEnabled && (
                  <>
                    <div className="space-y-2">
                      <LabelWithTooltip htmlFor="mcp-max-iterations" tooltip="Maximum number of iterations the agent can perform before stopping. Higher values allow more complex tasks but may take longer.">Max Iterations</LabelWithTooltip>
                      <Input
                        id="mcp-max-iterations"
                        type="number"
                        min="1"
                        max="50"
                        step="1"
                        value={config.mcpMaxIterations || 50}
                        onChange={(e) =>
                          updateConfig({
                            mcpMaxIterations: parseInt(e.target.value) || 10,
                          })
                        }
                        className="w-32"
                      />

                    </div>

                    <div className="space-y-4 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/20">
                      <div className="flex items-center space-x-2">
                        <Switch
                          id="agent-kill-switch"
                          checked={config.agentKillSwitchEnabled !== false}
                          onCheckedChange={(checked) =>
                            updateConfig({ agentKillSwitchEnabled: checked })
                          }
                        />
                        <LabelWithTooltip
                          htmlFor="agent-kill-switch"
                          className="font-medium text-red-800 dark:text-red-200"
                          tooltip="Provides a global hotkey to immediately stop agent mode and kill all agent-created processes"
                        >
                          Enable Emergency Kill Switch
                        </LabelWithTooltip>
                      </div>
                      <p className="text-xs text-red-700 dark:text-red-300">
                        Provides a global hotkey to immediately stop agent mode
                        and kill all agent-created processes.
                      </p>

                      {config.agentKillSwitchEnabled !== false && (
                        <div className="space-y-2">
                          <Label
                            htmlFor="kill-switch-hotkey"
                            className="text-red-800 dark:text-red-200"
                          >
                            Kill Switch Hotkey
                          </Label>
                          <select
                            id="kill-switch-hotkey"
                            value={
                              config.agentKillSwitchHotkey ||
                              "ctrl-shift-escape"
                            }
                            onChange={(e) =>
                              updateConfig({
                                agentKillSwitchHotkey: e.target.value as any,
                              })
                            }
                            className="w-full rounded-md border bg-background p-2"
                          >
                            <option value="ctrl-shift-escape">
                              Ctrl + Shift + Escape
                            </option>
                            <option value="ctrl-alt-q">Ctrl + Alt + Q</option>
                            <option value="ctrl-shift-q">
                              Ctrl + Shift + Q
                            </option>
                            <option value="custom">Custom</option>
                          </select>

                          {config.agentKillSwitchHotkey === "custom" && (
                            <KeyRecorder
                              value={config.customAgentKillSwitchHotkey || ""}
                              onChange={(keyCombo) => {
                                updateConfig({
                                  customAgentKillSwitchHotkey: keyCombo,
                                })
                              }}
                              placeholder="Click to record custom kill switch hotkey"
                            />
                          )}


                        </div>
                      )}
                    </div>
                  </>
                )}

                {!config.mcpAgentModeEnabled && (
                  <>
                    <div className="flex items-center space-x-2">
                      <Switch
                        id="mcp-auto-paste"
                        checked={config.mcpAutoPasteEnabled !== false}
                        onCheckedChange={(checked) =>
                          updateConfig({ mcpAutoPasteEnabled: checked })
                        }
                      />
                      <Label htmlFor="mcp-auto-paste">Auto-paste Results</Label>
                    </div>


                    {config.mcpAutoPasteEnabled !== false && (
                      <div className="space-y-2">
                        <LabelWithTooltip htmlFor="mcp-paste-delay" tooltip="Delay before pasting to allow you to return focus to the desired input field. Recommended: 1000ms (1 second).">
                          Auto-paste Delay (ms)
                        </LabelWithTooltip>
                        <Input
                          id="mcp-paste-delay"
                          type="number"
                          min="0"
                          max="10000"
                          step="100"
                          value={config.mcpAutoPasteDelay || 1000}
                          onChange={(e) =>
                            updateConfig({
                              mcpAutoPasteDelay:
                                parseInt(e.target.value) || 1000,
                            })
                          }
                          className="w-32"
                        />

                      </div>
                    )}
                  </>
                )}

                {config.mcpAgentModeEnabled && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/20">
                    <p className="text-sm text-blue-800 dark:text-blue-200">
                      <strong>Agent Mode:</strong> Results are displayed in a
                      floating GUI. Press{" "}
                      <kbd className="rounded bg-blue-100 px-1.5 py-0.5 text-xs dark:bg-blue-900">
                        ESC
                      </kbd>{" "}
                      to close the results window.
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="mcp-provider">Current LLM Provider</Label>
                  <div className="flex items-center justify-between rounded-md border bg-muted/50 p-3">
                    <span className="text-sm">
                      {CHAT_PROVIDERS.find(
                        (p) =>
                          p.value === (config.mcpToolsProviderId || "openai"),
                      )?.label || "OpenAI"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Configure in Providers tab
                    </span>
                  </div>

                </div>

                <div className="space-y-2">
                  <LabelWithTooltip htmlFor="mcp-additional-guidelines" tooltip="Optional additional rules and guidelines for the AI agent. The base system prompt with tool usage instructions is automatically included.">
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
                        setHasUnsavedChanges(
                          defaultAdditionalGuidelines !==
                            (config.mcpToolsSystemPrompt || ""),
                        )
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
                      disabled={
                        !hasUnsavedChanges || saveConfigMutation.isPending
                      }
                      className="gap-1"
                    >
                      <Save className="h-3 w-3" />
                      {saveConfigMutation.isPending
                        ? "Saving..."
                        : "Save Changes"}
                    </Button>
                  </div>
                  {hasUnsavedChanges && (
                    <p className="text-xs text-amber-600">
                      You have unsaved changes. Click "Save Changes" to apply
                      them.
                    </p>
                  )}
                </div>


              </>
            )}
          </div>


        </div>
      </div>
    </div>
  )
}
