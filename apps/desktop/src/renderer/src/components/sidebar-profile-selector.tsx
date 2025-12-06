import { tipcClient } from "@renderer/lib/tipc-client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Profile } from "@shared/types"
import { toast } from "sonner"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select"

export function SidebarProfileSelector() {
  const queryClient = useQueryClient()

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

  return (
    <Select
      value={currentProfile?.id || ""}
      onValueChange={(value) => setCurrentProfileMutation.mutate(value)}
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
      </SelectContent>
    </Select>
  )
}

