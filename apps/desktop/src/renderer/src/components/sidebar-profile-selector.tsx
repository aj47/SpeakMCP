import { useState } from "react"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Profile } from "@shared/types"
import { toast } from "sonner"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import { Textarea } from "./ui/textarea"

const CREATE_NEW_PROFILE_VALUE = "__create_new__"

export function SidebarProfileSelector() {
  const queryClient = useQueryClient()
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [newProfileName, setNewProfileName] = useState("")
  const [newProfileGuidelines, setNewProfileGuidelines] = useState("")

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

  // Create profile mutation
  const createProfileMutation = useMutation({
    mutationFn: async ({ name, guidelines }: { name: string; guidelines: string }) => {
      return await tipcClient.createProfile({ name, guidelines })
    },
    onSuccess: (newProfile: Profile) => {
      queryClient.invalidateQueries({ queryKey: ["profiles"] })
      queryClient.invalidateQueries({ queryKey: ["current-profile"] })
      setIsCreateDialogOpen(false)
      setNewProfileName("")
      setNewProfileGuidelines("")
      toast.success(`Profile "${newProfile.name}" created successfully`)
      // Automatically switch to the new profile
      setCurrentProfileMutation.mutate(newProfile.id)
    },
    onError: (error: Error) => {
      toast.error(`Failed to create profile: ${error.message}`)
    },
  })

  const handleValueChange = (value: string) => {
    if (value === CREATE_NEW_PROFILE_VALUE) {
      setIsCreateDialogOpen(true)
    } else {
      setCurrentProfileMutation.mutate(value)
    }
  }

  const handleCreateProfile = () => {
    if (!newProfileName.trim()) {
      toast.error("Profile name is required")
      return
    }
    createProfileMutation.mutate({
      name: newProfileName.trim(),
      guidelines: newProfileGuidelines,
    })
  }

  return (
    <>
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
          <SelectItem value={CREATE_NEW_PROFILE_VALUE}>
            <span className="flex items-center gap-1.5">
              <span className="i-mingcute-add-line h-3.5 w-3.5" />
              Create New Profile
            </span>
          </SelectItem>
        </SelectContent>
      </Select>

      {/* Create Profile Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Profile</DialogTitle>
            <DialogDescription>
              Create a new profile with custom guidelines for your AI agent.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="sidebar-profile-name">Profile Name</Label>
              <Input
                id="sidebar-profile-name"
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                placeholder="e.g., My Custom Profile"
              />
            </div>
            <div>
              <Label htmlFor="sidebar-profile-guidelines">Guidelines (optional)</Label>
              <Textarea
                id="sidebar-profile-guidelines"
                value={newProfileGuidelines}
                onChange={(e) => setNewProfileGuidelines(e.target.value)}
                rows={6}
                className="font-mono text-sm"
                placeholder="Enter custom guidelines..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateProfile} disabled={createProfileMutation.isPending}>
              {createProfileMutation.isPending ? "Creating..." : "Create Profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

