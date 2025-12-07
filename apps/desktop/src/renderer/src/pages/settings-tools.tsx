import { useConfigQuery } from "@renderer/lib/query-client"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@renderer/components/ui/button"
import { Label } from "@renderer/components/ui/label"
import { Textarea } from "@renderer/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@renderer/components/ui/tooltip"
import { Save, Info } from "lucide-react"
import { toast } from "sonner"
import { useState, useEffect } from "react"
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

  // Fetch current profile to sync guidelines with profile
  const currentProfileQuery = useQuery({
    queryKey: ["current-profile"],
    queryFn: async () => {
      return await tipcClient.getCurrentProfile()
    },
  })

  // Mutation to update profile guidelines
  const updateProfileMutation = useMutation({
    mutationFn: async ({ id, guidelines }: { id: string; guidelines: string }) => {
      return await tipcClient.updateProfile({ id, guidelines })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profiles"] })
      queryClient.invalidateQueries({ queryKey: ["current-profile"] })
    },
  })

  const config = configQuery.data || {}
  const currentProfile = currentProfileQuery.data

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

  // Fire-and-forget config update for toggles/switches (no await needed)
  const updateConfig = (updates: Partial<Config>) => {
    const newConfig = { ...config, ...updates }
    saveConfigMutation.mutate(newConfig)
  }

  // Combined saving state for the guidelines save operation
  // Also check if profile query is still loading to prevent saving before profile data is available
  const isSavingGuidelines = saveConfigMutation.isPending || updateProfileMutation.isPending
  const isProfileLoading = currentProfileQuery.isLoading

  const saveAdditionalGuidelines = async () => {
    try {
      // Save to config
      const newConfig = { ...config, mcpToolsSystemPrompt: additionalGuidelines }
      await saveConfigMutation.mutateAsync(newConfig)

      // Also update the current profile's guidelines if it's a non-default profile
      // This ensures the profile stays in sync with the saved guidelines
      if (currentProfile && !currentProfile.isDefault) {
        await updateProfileMutation.mutateAsync({
          id: currentProfile.id,
          guidelines: additionalGuidelines,
        })
      }

      // Only clear unsaved changes if both operations succeeded
      setHasUnsavedChanges(false)
    } catch (error) {
      // If either mutation fails, keep hasUnsavedChanges true so user can retry
      toast.error("Failed to save guidelines. Please try again.")
      console.error("Failed to save guidelines:", error)
    }
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
            <h3 className="text-lg font-semibold">Agent Settings</h3>
          </div>

          <div className="space-y-4">
            <div className="space-y-4">
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
                    disabled={isSavingGuidelines}
                  >
                    Revert Changes
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={saveAdditionalGuidelines}
                  disabled={
                    !hasUnsavedChanges || isSavingGuidelines || isProfileLoading
                  }
                  className="gap-1"
                >
                  <Save className="h-3 w-3" />
                  {isSavingGuidelines
                    ? "Saving..."
                    : isProfileLoading
                      ? "Loading..."
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
