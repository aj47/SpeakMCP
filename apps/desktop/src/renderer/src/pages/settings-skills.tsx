import { useState, useEffect } from "react"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu"
import { tipcClient, rendererHandlers } from "@renderer/lib/tipc-client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AgentSkill } from "@shared/types"
import { toast } from "sonner"
import { Plus, Pencil, Trash2, Download, Upload, FolderOpen, RefreshCw, Sparkles, Loader2, ChevronDown, FolderUp, Github } from "lucide-react"


export function Component() {
  const queryClient = useQueryClient()
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [editingSkill, setEditingSkill] = useState<AgentSkill | null>(null)
  const [newSkillName, setNewSkillName] = useState("")
  const [newSkillDescription, setNewSkillDescription] = useState("")
  const [newSkillInstructions, setNewSkillInstructions] = useState("")
  const [isGitHubDialogOpen, setIsGitHubDialogOpen] = useState(false)
  const [gitHubRepoInput, setGitHubRepoInput] = useState("")

  const skillsQuery = useQuery({
    queryKey: ["skills"],
    queryFn: async () => {
      return await tipcClient.getSkills()
    },
  })

  const agentsFoldersQuery = useQuery({
    queryKey: ["agentsFolders"],
    queryFn: async () => {
      return await tipcClient.getAgentsFolders()
    },
    staleTime: Infinity,
  })

  const skills = skillsQuery.data || []

  // Listen for skills folder changes from the main process (file watcher)
  useEffect(() => {
    const unsubscribe = rendererHandlers.skillsFolderChanged.listen(async () => {
      try {
        // Auto-scan and refresh skills when folder changes
        const importedSkills = await tipcClient.scanSkillsFolder()
        queryClient.invalidateQueries({ queryKey: ["skills"] })
        if (importedSkills && importedSkills.length > 0) {
          toast.success(`Auto-imported ${importedSkills.length} skill(s)`)
        }
      } catch (error) {
        console.error("Failed to auto-refresh skills:", error)
        toast.error("Failed to auto-refresh skills")
      }
    })
    return () => unsubscribe()
  }, [queryClient])

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

  // Import a single skill folder containing SKILL.md
  const importSkillFolderMutation = useMutation({
    mutationFn: async () => {
      return await tipcClient.importSkillFolder()
    },
    onSuccess: (skill: AgentSkill | null) => {
      if (skill) {
        queryClient.invalidateQueries({ queryKey: ["skills"] })
        toast.success(`Skill "${skill.name}" imported successfully`)
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to import skill folder: ${error.message}`)
    },
  })

  // Bulk import all skill folders from a parent directory
  const importSkillsFromParentFolderMutation = useMutation({
    mutationFn: async () => {
      return await tipcClient.importSkillsFromParentFolder()
    },
    onSuccess: (result: { imported: AgentSkill[]; skipped: string[]; errors: Array<{ folder: string; error: string }> } | null) => {
      if (result) {
        queryClient.invalidateQueries({ queryKey: ["skills"] })

        const messages: string[] = []
        if (result.imported.length > 0) {
          messages.push(`Imported ${result.imported.length} skill(s)`)
        }
        if (result.skipped.length > 0) {
          messages.push(`${result.skipped.length} already imported`)
        }
        if (result.errors.length > 0) {
          messages.push(`${result.errors.length} failed`)
        }
        if (result.imported.length > 0) {
          toast.success(messages.join(", "))
        } else if (result.skipped.length > 0) {
          toast.info(messages.join(", "))
        } else if (result.errors.length > 0) {
          toast.error(`Failed to import skills: ${result.errors.map(e => e.folder).join(", ")}`)
        } else {
          toast.info("No skill folders found")
        }
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to import skills: ${error.message}`)
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
    onSuccess: (result) => {
      if (!result?.success) {
        toast.error(result?.error || "Failed to open skills folder")
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to open skills folder: ${error.message}`)
    },
  })

  const openWorkspaceSkillsFolderMutation = useMutation({
    mutationFn: async () => {
      return await tipcClient.openWorkspaceSkillsFolder()
    },
    onSuccess: (result) => {
      if (!result?.success) {
        toast.error(result?.error || "Failed to open workspace skills folder")
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to open workspace skills folder: ${error.message}`)
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

  // Import skill from GitHub repository
  const importSkillFromGitHubMutation = useMutation({
    mutationFn: async (repoIdentifier: string) => {
      return await tipcClient.importSkillFromGitHub({ repoIdentifier })
    },
    onSuccess: (result) => {
      if (result) {
        queryClient.invalidateQueries({ queryKey: ["skills"] })
        if (result.imported.length > 0) {
          toast.success(`Imported ${result.imported.length} skill(s) from GitHub: ${result.imported.map(s => s.name).join(", ")}`)
        } else if (result.errors.length > 0) {
          toast.error(`Failed to import: ${result.errors.join("; ")}`)
        } else {
          toast.info("No skills found in repository")
        }
        setIsGitHubDialogOpen(false)
        setGitHubRepoInput("")
      }
    },
    onError: (error: Error) => {
      toast.error(`Failed to import from GitHub: ${error.message}`)
    },
  })

  const handleImportFromGitHub = () => {
    if (!gitHubRepoInput.trim()) {
      toast.error("Please enter a GitHub repository (e.g., owner/repo)")
      return
    }
    importSkillFromGitHubMutation.mutate(gitHubRepoInput.trim())
  }

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

  const skillsFileTemplate = `---
kind: skill
id: my-skill
name: My Skill
description: A short description
enabled: true
---

Write your skill instructions here.
`

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
              className="gap-1.5"
              onClick={() => openSkillsFolderMutation.mutate()}
            >
              <FolderOpen className="h-3 w-3" />
              Open Folder
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => openWorkspaceSkillsFolderMutation.mutate()}
              disabled={!agentsFoldersQuery.data?.workspace?.skillsDir || openWorkspaceSkillsFolderMutation.isPending}
            >
              <FolderUp className="h-3 w-3" />
              Workspace
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => scanSkillsFolderMutation.mutate()}
              disabled={scanSkillsFolderMutation.isPending}
            >
              <RefreshCw className={`h-3 w-3 ${scanSkillsFolderMutation.isPending ? 'animate-spin' : ''}`} />
              Scan Folder
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={importSkillMutation.isPending || importSkillFolderMutation.isPending || importSkillsFromParentFolderMutation.isPending || importSkillFromGitHubMutation.isPending}
                >
                  <Upload className="h-3 w-3" />
                  Import
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setIsGitHubDialogOpen(true)}>
                  <Github />
                  Import from GitHub
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => importSkillMutation.mutate()}>
                  <Upload />
                  Import SKILL.md File
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => importSkillFolderMutation.mutate()}>
                  <FolderOpen />
                  Import Skill Folder
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => importSkillsFromParentFolderMutation.mutate()}>
                  <FolderUp />
                  Bulk Import from Folder
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => setIsCreateDialogOpen(true)}
            >
              <Plus className="h-3 w-3" />
              New Skill
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground">
            Skills are specialized instructions that improve AI performance on specific tasks.
            Enable skills to include their instructions in the system prompt.
          </p>
        </div>

        <details className="rounded-lg border bg-card">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium">
            Modular config (.agents) file template
          </summary>
          <div className="px-4 pb-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              You can hand-author skills in <span className="font-mono">.agents/skills/&lt;id&gt;/skill.md</span>. Frontmatter
              uses simple <span className="font-mono">key: value</span> lines (not YAML). If a workspace <span className="font-mono">.agents</span>
              folder exists, it can override the global layer by skill <span className="font-mono">id</span>.
            </p>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">
                Global: <span className="font-mono break-all">{agentsFoldersQuery.data?.global?.skillsDir ?? "~/.agents/skills"}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                Workspace:{" "}
                <span className="font-mono break-all">
                  {agentsFoldersQuery.data?.workspace?.skillsDir ?? "Not detected"}
                  {agentsFoldersQuery.data?.workspace?.skillsDir && agentsFoldersQuery.data?.workspaceSource
                    ? ` (${agentsFoldersQuery.data.workspaceSource})`
                    : ""}
                </span>
              </div>
            </div>
            <div className="rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap">{skillsFileTemplate}</div>
          </div>
        </details>

        {/* Skills List */}
        <div className="space-y-1">
          {skillsQuery.isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              <Loader2 className="h-8 w-8 mx-auto mb-4 animate-spin" />
              <p>Loading skills...</p>
            </div>
          ) : skillsQuery.isError ? (
            <div className="text-center py-8 text-destructive">
              <Sparkles className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Failed to load skills. Please try again.</p>
            </div>
          ) : skills.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Sparkles className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No skills yet. Create your first skill or import one.</p>
            </div>
          ) : (
            skills.map((skill) => (
              <div
                key={skill.id}
                className="flex items-center justify-between px-3 py-2 rounded-lg border bg-card"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className="font-medium truncate">{skill.name}</span>
                </div>
                <div className="flex gap-1 ml-2 shrink-0">
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

        {/* GitHub Import Dialog */}
        <Dialog open={isGitHubDialogOpen} onOpenChange={setIsGitHubDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Import Skill from GitHub</DialogTitle>
              <DialogDescription>
                Enter a GitHub repository to import skills from. Supports formats like "owner/repo" or full GitHub URLs.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="github-repo">Repository</Label>
                <Input
                  id="github-repo"
                  value={gitHubRepoInput}
                  onChange={(e) => setGitHubRepoInput(e.target.value)}
                  placeholder="e.g., SawyerHood/dev-browser"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleImportFromGitHub()
                    }
                  }}
                />
                <p className="text-xs text-muted-foreground mt-2">
                  Examples: owner/repo, owner/repo/skills/my-skill, or https://github.com/owner/repo
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => {
                setIsGitHubDialogOpen(false)
                setGitHubRepoInput("")
              }}>
                Cancel
              </Button>
              <Button className="gap-1.5" onClick={handleImportFromGitHub} disabled={importSkillFromGitHubMutation.isPending}>
                {importSkillFromGitHubMutation.isPending ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <Github className="h-3 w-3" />
                    Import
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}

