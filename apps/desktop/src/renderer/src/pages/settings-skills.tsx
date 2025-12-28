import { useState } from "react"
import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { Label } from "@renderer/components/ui/label"
import { Textarea } from "@renderer/components/ui/textarea"
import { Switch } from "@renderer/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AgentSkill } from "@shared/types"
import { toast } from "sonner"
import { Plus, Pencil, Trash2, Download, Upload, FolderOpen, RefreshCw, Sparkles } from "lucide-react"

export function Component() {
  const queryClient = useQueryClient()
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [editingSkill, setEditingSkill] = useState<AgentSkill | null>(null)
  const [newSkillName, setNewSkillName] = useState("")
  const [newSkillDescription, setNewSkillDescription] = useState("")
  const [newSkillInstructions, setNewSkillInstructions] = useState("")

  const skillsQuery = useQuery({
    queryKey: ["skills"],
    queryFn: async () => {
      return await tipcClient.getSkills()
    },
  })

  const skills = skillsQuery.data || []

  const createSkillMutation = useMutation({
    mutationFn: async ({ name, description, instructions }: { name: string; description: string; instructions: string }) => {
      return await tipcClient.createSkill({ name, description, instructions })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] })
      setIsCreateDialogOpen(false)
      resetNewSkillForm()
      toast.success("Skill created successfully")
    },
    onError: (error: Error) => {
      toast.error(`Failed to create skill: ${error.message}`)
    },
  })

  const updateSkillMutation = useMutation({
    mutationFn: async ({ id, name, description, instructions }: { id: string; name?: string; description?: string; instructions?: string }) => {
      return await tipcClient.updateSkill({ id, name, description, instructions })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] })
      setIsEditDialogOpen(false)
      setEditingSkill(null)
      toast.success("Skill updated successfully")
    },
    onError: (error: Error) => {
      toast.error(`Failed to update skill: ${error.message}`)
    },
  })

  const deleteSkillMutation = useMutation({
    mutationFn: async (id: string) => {
      return await tipcClient.deleteSkill({ id })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] })
      toast.success("Skill deleted successfully")
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete skill: ${error.message}`)
    },
  })

  const toggleSkillMutation = useMutation({
    mutationFn: async (id: string) => {
      return await tipcClient.toggleSkill({ id })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] })
    },
    onError: (error: Error) => {
      toast.error(`Failed to toggle skill: ${error.message}`)
    },
  })

  const importSkillMutation = useMutation({
    mutationFn: async () => {
      return await tipcClient.importSkillFile()
    },
    onSuccess: (skill: AgentSkill | null) => {
      if (skill) {
        queryClient.invalidateQueries({ queryKey: ["skills"] })
        toast.success(`Skill "${skill.name}" imported successfully`)
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to import skill: ${error.message}`)
    },
  })

  const exportSkillMutation = useMutation({
    mutationFn: async (id: string) => {
      return await tipcClient.saveSkillFile({ id })
    },
    onSuccess: (success: boolean) => {
      if (success) {
        toast.success("Skill exported successfully")
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to export skill: ${error.message}`)
    },
  })

  const openSkillsFolderMutation = useMutation({
    mutationFn: async () => {
      return await tipcClient.openSkillsFolder()
    },
  })

  const scanSkillsFolderMutation = useMutation({
    mutationFn: async () => {
      return await tipcClient.scanSkillsFolder()
    },
    onSuccess: (importedSkills: AgentSkill[]) => {
      queryClient.invalidateQueries({ queryKey: ["skills"] })
      if (importedSkills.length > 0) {
        toast.success(`Imported ${importedSkills.length} skill(s) from folder`)
      } else {
        toast.info("No new skills found in folder")
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to scan skills folder: ${error.message}`)
    },
  })

  const resetNewSkillForm = () => {
    setNewSkillName("")
    setNewSkillDescription("")
    setNewSkillInstructions("")
  }

  const handleCreateSkill = () => {
    if (!newSkillName.trim()) {
      toast.error("Skill name is required")
      return
    }
    if (!newSkillInstructions.trim()) {
      toast.error("Skill instructions are required")
      return
    }
    createSkillMutation.mutate({
      name: newSkillName,
      description: newSkillDescription,
      instructions: newSkillInstructions,
    })
  }

  const handleUpdateSkill = () => {
    if (!editingSkill) return
    updateSkillMutation.mutate({
      id: editingSkill.id,
      name: editingSkill.name,
      description: editingSkill.description,
      instructions: editingSkill.instructions,
    })
  }

  const handleDeleteSkill = (skill: AgentSkill) => {
    if (confirm(`Are you sure you want to delete the skill "${skill.name}"?`)) {
      deleteSkillMutation.mutate(skill.id)
    }
  }

  const handleEditSkill = (skill: AgentSkill) => {
    setEditingSkill({ ...skill })
    setIsEditDialogOpen(true)
  }

  return (
    <div className="modern-panel h-full min-w-0 overflow-y-auto overflow-x-hidden px-6 py-4">
      <div className="min-w-0 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Agent Skills</h2>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => openSkillsFolderMutation.mutate()}
            >
              <FolderOpen className="h-3 w-3 mr-1" />
              Open Folder
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => scanSkillsFolderMutation.mutate()}
              disabled={scanSkillsFolderMutation.isPending}
            >
              <RefreshCw className={`h-3 w-3 mr-1 ${scanSkillsFolderMutation.isPending ? 'animate-spin' : ''}`} />
              Scan Folder
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => importSkillMutation.mutate()}
              disabled={importSkillMutation.isPending}
            >
              <Upload className="h-3 w-3 mr-1" />
              Import
            </Button>
            <Button
              size="sm"
              onClick={() => setIsCreateDialogOpen(true)}
            >
              <Plus className="h-3 w-3 mr-1" />
              New Skill
            </Button>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          Skills are specialized instructions that improve AI performance on specific tasks.
          Enable skills to include their instructions in the system prompt.
        </p>

        {/* Skills List */}
        <div className="space-y-3">
          {skills.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Sparkles className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No skills yet. Create your first skill or import one.</p>
            </div>
          ) : (
            skills.map((skill) => (
              <div
                key={skill.id}
                className="flex items-start justify-between p-4 rounded-lg border bg-card"
              >
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <Switch
                    checked={skill.enabled}
                    onCheckedChange={() => toggleSkillMutation.mutate(skill.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium">{skill.name}</h3>
                    {skill.description && (
                      <p className="text-sm text-muted-foreground mt-1">{skill.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">
                      {skill.instructions.length} characters • {skill.source || "local"}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1 ml-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleEditSkill(skill)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => exportSkillMutation.mutate(skill.id)}
                  >
                    <Download className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteSkill(skill)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Create Skill Dialog */}
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create New Skill</DialogTitle>
              <DialogDescription>
                Create a skill with specialized instructions for the AI agent.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="skill-name">Name</Label>
                <Input
                  id="skill-name"
                  value={newSkillName}
                  onChange={(e) => setNewSkillName(e.target.value)}
                  placeholder="e.g., Code Review Expert"
                />
              </div>
              <div>
                <Label htmlFor="skill-description">Description</Label>
                <Input
                  id="skill-description"
                  value={newSkillDescription}
                  onChange={(e) => setNewSkillDescription(e.target.value)}
                  placeholder="Brief description of what this skill does"
                />
              </div>
              <div>
                <Label htmlFor="skill-instructions">Instructions</Label>
                <Textarea
                  id="skill-instructions"
                  value={newSkillInstructions}
                  onChange={(e) => setNewSkillInstructions(e.target.value)}
                  rows={12}
                  className="font-mono text-sm"
                  placeholder="Enter the instructions for this skill in markdown format..."
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateSkill} disabled={createSkillMutation.isPending}>
                {createSkillMutation.isPending ? "Creating..." : "Create Skill"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Skill Dialog */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Edit Skill</DialogTitle>
              <DialogDescription>
                Update the skill name, description, and instructions.
              </DialogDescription>
            </DialogHeader>
            {editingSkill && (
              <div className="space-y-4">
                <div>
                  <Label htmlFor="edit-skill-name">Name</Label>
                  <Input
                    id="edit-skill-name"
                    value={editingSkill.name}
                    onChange={(e) =>
                      setEditingSkill({ ...editingSkill, name: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="edit-skill-description">Description</Label>
                  <Input
                    id="edit-skill-description"
                    value={editingSkill.description}
                    onChange={(e) =>
                      setEditingSkill({ ...editingSkill, description: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="edit-skill-instructions">Instructions</Label>
                  <Textarea
                    id="edit-skill-instructions"
                    value={editingSkill.instructions}
                    onChange={(e) =>
                      setEditingSkill({ ...editingSkill, instructions: e.target.value })
                    }
                    rows={12}
                    className="font-mono text-sm"
                  />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleUpdateSkill} disabled={updateSkillMutation.isPending}>
                {updateSkillMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}

