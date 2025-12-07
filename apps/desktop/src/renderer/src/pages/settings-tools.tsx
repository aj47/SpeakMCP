import { useConfigQuery } from "@renderer/lib/query-client"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { Label } from "@renderer/components/ui/label"
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
import { ProfileManager } from "@renderer/components/profile-manager"
import { ProfileBadge } from "@renderer/components/profile-badge"

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

      <div className="space-y-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <h3 className="text-lg font-semibold">Profile</h3>
          </div>

          <div className="space-y-4">
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

            <div className="space-y-2">
              <LabelWithTooltip htmlFor="mcp-max-iterations" tooltip="Maximum number of iterations the agent can perform before stopping. Higher values allow more complex tasks but may take longer.">Max Iterations</LabelWithTooltip>
              <Input
                id="mcp-max-iterations"
                type="number"
                min="1"
                max="50"
                step="1"
                value={config.mcpMaxIterations ?? 10}
                onChange={(e) =>
                  updateConfig({
                    mcpMaxIterations: parseInt(e.target.value) || 1,
                  })
                }
                className="w-32"
              />
            </div>

            <div className="space-y-4">
              <div className="rounded-lg border p-4 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold mb-1">Profile Management</h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    Profiles store your guidelines, MCP server/tool settings, and model preferences.
                    Switching profiles will load all these settings.
                  </p>
                </div>
                <ProfileManager
                  currentGuidelines={additionalGuidelines}
                  onGuidelinesChange={(guidelines) => {
                    setAdditionalGuidelines(guidelines)
                    setHasUnsavedChanges(guidelines !== (config.mcpToolsSystemPrompt || ""))
                  }}
                />
              </div>

              <div className="flex items-center gap-2">
                <LabelWithTooltip htmlFor="mcp-additional-guidelines" tooltip="Optional additional rules and guidelines for the AI agent. The base system prompt with tool usage instructions is automatically included.">
                  Additional Guidelines
                </LabelWithTooltip>
                <ProfileBadge />
              </div>
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
          </div>
        </div>
      </div>
    </div>
  )
}
