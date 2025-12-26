import { useState, useEffect } from "react"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import { Textarea } from "./ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Profile } from "@shared/types"
import { toast } from "sonner"
import { Plus, Pencil, Trash2, Download, Upload, RefreshCw } from "lucide-react"

interface ProfileManagerProps {
  currentGuidelines: string
  onGuidelinesChange: (guidelines: string) => void
  onProfileChange?: (profile: Profile) => void
}

export function ProfileManager({
  currentGuidelines,
  onGuidelinesChange,
  onProfileChange,
}: ProfileManagerProps) {
  const queryClient = useQueryClient()
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null)
  const [newProfileName, setNewProfileName] = useState("")
  const [newProfileGuidelines, setNewProfileGuidelines] = useState("")

  const profilesQuery = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      return await tipcClient.getProfiles()
    },
  })

  const currentProfileQuery = useQuery({
    queryKey: ["current-profile"],
    queryFn: async () => {
      return await tipcClient.getCurrentProfile()
    },
  })

  const profiles = profilesQuery.data || []
  const currentProfile = currentProfileQuery.data

  const createProfileMutation = useMutation({
    mutationFn: async ({ name, guidelines }: { name: string; guidelines: string }) => {
      return await tipcClient.createProfile({ name, guidelines })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profiles"] })
      setIsCreateDialogOpen(false)
      setNewProfileName("")
      setNewProfileGuidelines("")
      toast.success("Profile created successfully")
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
      toast.success("Profile deleted successfully")
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete profile: ${error.message}`)
    },
  })

  // Set current profile mutation
  const setCurrentProfileMutation = useMutation({
    mutationFn: async (id: string) => {
      return await tipcClient.setCurrentProfile({ id })
    },
    onSuccess: (profile: Profile) => {
      queryClient.invalidateQueries({ queryKey: ["current-profile"] })
      queryClient.invalidateQueries({ queryKey: ["config"] })
      onGuidelinesChange(profile.guidelines)
      if (onProfileChange) {
        onProfileChange(profile)
      }
      toast.success(`Switched to profile: ${profile.name}`)
    },
    onError: (error: Error) => {
      toast.error(`Failed to switch profile: ${error.message}`)
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
      name: newProfileName,
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

  const handleDeleteProfile = (profile: Profile) => {
    if (profile.isDefault) {
      toast.error("Cannot delete default profiles")
      return
    }
    if (confirm(`Are you sure you want to delete the profile "${profile.name}"?`)) {
      deleteProfileMutation.mutate(profile.id)
    }
  }

  const handleEditProfile = (profile: Profile) => {
    if (profile.isDefault) {
      toast.error("Cannot edit default profiles")
      return
    }
    setEditingProfile({ ...profile })
    setIsEditDialogOpen(true)
  }

  const handleSaveCurrentAsNew = () => {
    setNewProfileGuidelines(currentGuidelines)
    setIsCreateDialogOpen(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label>Profile</Label>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => importProfileMutation.mutate()}
            disabled={importProfileMutation.isPending}
          >
            <Upload className="h-3 w-3 mr-1" />
            Import
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSaveCurrentAsNew}
          >
            <Plus className="h-3 w-3 mr-1" />
            Save As New
          </Button>
        </div>
      </div>

      <Select
        value={currentProfile?.id || ""}
        onValueChange={(value) => setCurrentProfileMutation.mutate(value)}
      >
        <SelectTrigger>
          <SelectValue placeholder="Select a profile" />
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

      {currentProfile && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleEditProfile(currentProfile)}
            disabled={currentProfile.isDefault}
          >
            <Pencil className="h-3 w-3 mr-1" />
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportProfileMutation.mutate(currentProfile.id)}
            disabled={exportProfileMutation.isPending}
          >
            <Download className="h-3 w-3 mr-1" />
            Export
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleDeleteProfile(currentProfile)}
            disabled={currentProfile.isDefault}
          >
            <Trash2 className="h-3 w-3 mr-1" />
            Delete
          </Button>
        </div>
      )}

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
              <Label htmlFor="profile-name">Profile Name</Label>
              <Input
                id="profile-name"
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
                placeholder="e.g., My Custom Profile"
              />
            </div>
            <div>
              <Label htmlFor="profile-guidelines">Guidelines</Label>
              <Textarea
                id="profile-guidelines"
                value={newProfileGuidelines}
                onChange={(e) => setNewProfileGuidelines(e.target.value)}
                rows={8}
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
    </div>
  )
}

