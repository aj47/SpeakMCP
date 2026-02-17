import { tipcClient } from "@renderer/lib/tipc-client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Profile } from "@shared/types"
import { toast } from "sonner"
import { useNavigate } from "react-router-dom"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./ui/select"

const EDIT_PROFILES_VALUE = "__edit_profiles__"

export function SidebarProfileSelector() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  // Fetch profiles
  const profilesQuery = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      return await tipcClient.getProfiles()
    },
  })

  // Fetch current profile
  const currentProfileQuery = useQuery({
    queryKey: ["current-profile"],
    queryFn: async () => {
      return await tipcClient.getCurrentProfile()
    },
  })

  const profiles = profilesQuery.data || []
  const currentProfile = currentProfileQuery.data

  // Set current profile mutation with enhanced toast
  const setCurrentProfileMutation = useMutation({
    mutationFn: async (id: string) => {
      return await tipcClient.setCurrentProfile({ id })
    },
    onSuccess: (newProfile: Profile) => {
      queryClient.invalidateQueries({ queryKey: ["current-profile"] })
      queryClient.invalidateQueries({ queryKey: ["config"] })
      queryClient.invalidateQueries({ queryKey: ["mcp-server-status"] })
      queryClient.invalidateQueries({ queryKey: ["mcp-initialization-status"] })

      // Build a summary of what the profile includes
      const details: string[] = []
      if (newProfile.modelConfig?.mcpToolsProviderId) {
        details.push(`Provider: ${newProfile.modelConfig.mcpToolsProviderId}`)
      }
      if (newProfile.mcpServerConfig?.disabledServers?.length) {
        details.push(`${newProfile.mcpServerConfig.disabledServers.length} servers disabled`)
      }
      if (newProfile.mcpServerConfig?.disabledTools?.length) {
        details.push(`${newProfile.mcpServerConfig.disabledTools.length} tools disabled`)
      }

      const summary = details.length > 0 ? ` (${details.join(", ")})` : ""
      toast.success(`Switched to "${newProfile.name}"${summary}`)
    },
    onError: (error: Error) => {
      toast.error(`Failed to switch profile: ${error.message}`)
    },
  })

  const handleValueChange = (value: string) => {
    if (value === EDIT_PROFILES_VALUE) {
      navigate("/settings/tools")
    } else {
      setCurrentProfileMutation.mutate(value)
    }
  }

  return (
    <Select
      value={currentProfile?.id || ""}
      onValueChange={handleValueChange}
    >
      <SelectTrigger className="h-8 text-xs">
        <span className="i-mingcute-user-3-line mr-1.5 h-3.5 w-3.5 shrink-0" />
        <SelectValue placeholder="Select profile" />
      </SelectTrigger>
      <SelectContent>
        {profiles.map((profile) => (
          <SelectItem key={profile.id} value={profile.id}>
            {profile.name}
            {profile.isDefault && " (Default)"}
          </SelectItem>
        ))}
        <SelectSeparator />
        <SelectItem
          value={EDIT_PROFILES_VALUE}
          className="text-muted-foreground"
        >
          <span className="i-mingcute-settings-3-line mr-1.5 h-3.5 w-3.5 shrink-0" />
          Edit Profiles
        </SelectItem>
      </SelectContent>
    </Select>
  )
}

