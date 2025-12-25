import { useState } from "react"
import { useNavigate } from "react-router-dom"

import { tipcClient } from "@renderer/lib/tipc-client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Profile } from "@shared/types"
import { toast } from "sonner"
import { Plus, Pencil, Trash2, Download, Upload, Settings } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu"
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

export function SidebarProfileSelector() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null)
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

  // Update profile mutation
  const updateProfileMutation = useMutation({
    mutationFn: async ({ id, name, guidelines }: { id: string; name?: string; guidelines?: string }) => {
      return await tipcClient.updateProfile({ id, name, guidelines })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profiles"] })
      queryClient.invalidateQueries({ queryKey: ["current-profile"] })
      // Also invalidate config since backend syncs guidelines to mcpToolsSystemPrompt when editing current profile
      queryClient.invalidateQueries({ queryKey: ["config"] })
      setIsEditDialogOpen(false)
      setEditingProfile(null)
      toast.success("Profile updated successfully")
    },
    onError: (error: Error) => {
      toast.error(`Failed to update profile: ${error.message}`)
    },
  })

  // Delete profile mutation
  const deleteProfileMutation = useMutation({
    mutationFn: async (id: string) => {
      return await tipcClient.deleteProfile({ id })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profiles"] })
      queryClient.invalidateQueries({ queryKey: ["current-profile"] })
      setIsDeleteDialogOpen(false)
      toast.success("Profile deleted successfully")
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete profile: ${error.message}`)
    },
  })

  // Export profile mutation
  const exportProfileMutation = useMutation({
    mutationFn: async (id: string) => {
      return await tipcClient.saveProfileFile({ id })
    },
    onSuccess: (success: boolean) => {
      if (success) {
        toast.success("Profile exported (MCP credentials excluded for security)")
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to export profile: ${error.message}`)
    },
  })

  // Import profile mutation
  const importProfileMutation = useMutation({
    mutationFn: async () => {
      return await tipcClient.loadProfileFile()
    },
    onSuccess: (profile: Profile | null) => {
      if (profile) {
        queryClient.invalidateQueries({ queryKey: ["profiles"] })
        toast.success(`Profile "${profile.name}" imported (you may need to configure MCP credentials)`)
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to import profile: ${error.message}`)
    },
  })

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

  const handleUpdateProfile = () => {
    if (!editingProfile) return
    updateProfileMutation.mutate({
      id: editingProfile.id,
      name: editingProfile.name,
      guidelines: editingProfile.guidelines,
    })
  }

  const handleEditClick = () => {
    if (!currentProfile || currentProfile.isDefault) {
      toast.error("Cannot edit default profiles")
      return
    }
    setEditingProfile({ ...currentProfile })
    setIsEditDialogOpen(true)
  }

  const handleDeleteClick = () => {
    if (!currentProfile || currentProfile.isDefault) {
      toast.error("Cannot delete default profiles")
      return
    }
    setIsDeleteDialogOpen(true)
  }

  const handleConfirmDelete = () => {
    if (currentProfile) {
      deleteProfileMutation.mutate(currentProfile.id)
    }
  }

  const handleExportClick = () => {
    if (currentProfile) {
      exportProfileMutation.mutate(currentProfile.id)
    }
  }

  const handleImportClick = () => {
    importProfileMutation.mutate()
  }

  const handleCreateClick = () => {
    setNewProfileName("")
    setNewProfileGuidelines("")
    setIsCreateDialogOpen(true)
  }

  return (
    <>
      <div className="flex items-center gap-1">
        <Select
          value={currentProfile?.id || ""}
          onValueChange={(value) => setCurrentProfileMutation.mutate(value)}
        >
          <SelectTrigger className="h-8 text-xs flex-1">
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

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
              <Settings className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => navigate("/settings/tools")}>
              <Settings className="h-4 w-4" />
              Profile Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />

            <DropdownMenuItem
              onClick={handleEditClick}
              disabled={!currentProfile || currentProfile.isDefault}
            >
              <Pencil className="h-4 w-4" />
              Edit Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleCreateClick}>
              <Plus className="h-4 w-4" />
              Create New Profile
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleExportClick} disabled={!currentProfile}>
              <Download className="h-4 w-4" />
              Export Profile
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleImportClick}
              disabled={importProfileMutation.isPending}
            >
              <Upload className="h-4 w-4" />
              Import Profile
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={handleDeleteClick}
              disabled={!currentProfile || currentProfile.isDefault}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              Delete Profile
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

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

      {/* Edit Profile Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Profile</DialogTitle>
            <DialogDescription>
              Update the profile name and guidelines.
            </DialogDescription>
          </DialogHeader>
          {editingProfile && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="edit-profile-name">Profile Name</Label>
                <Input
                  id="edit-profile-name"
                  value={editingProfile.name}
                  onChange={(e) =>
                    setEditingProfile({ ...editingProfile, name: e.target.value })
                  }
                />
              </div>
              <div>
                <Label htmlFor="edit-profile-guidelines">Guidelines</Label>
                <Textarea
                  id="edit-profile-guidelines"
                  value={editingProfile.guidelines}
                  onChange={(e) =>
                    setEditingProfile({ ...editingProfile, guidelines: e.target.value })
                  }
                  rows={8}
                  className="font-mono text-sm"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateProfile} disabled={updateProfileMutation.isPending}>
              {updateProfileMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Profile</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the profile "{currentProfile?.name}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={deleteProfileMutation.isPending}
            >
              {deleteProfileMutation.isPending ? "Deleting..." : "Delete Profile"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

