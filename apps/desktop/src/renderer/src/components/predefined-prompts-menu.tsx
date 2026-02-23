import React, { useState } from "react"
import { cn } from "@renderer/lib/utils"
import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { Textarea } from "@renderer/components/ui/textarea"
import { Label } from "@renderer/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog"
import { BookMarked, Plus, Pencil, Trash2, Sparkles } from "lucide-react"
import { useConfigQuery, useSaveConfigMutation } from "@renderer/lib/queries"
import { PredefinedPrompt } from "../../../shared/types"
import { useQuery } from "@tanstack/react-query"
import { tipcClient } from "@renderer/lib/tipc-client"

interface PredefinedPromptsMenuProps {
  onSelectPrompt: (content: string) => void
  className?: string
  disabled?: boolean
  buttonSize?: "default" | "sm" | "icon"
}

export function PredefinedPromptsMenu({
  onSelectPrompt,
  className,
  disabled = false,
  buttonSize = "icon",
}: PredefinedPromptsMenuProps) {
  // Map buttonSize prop to actual Button size - always use "icon" variant for icon-only buttons
  const actualButtonSize = "icon" as const
  const configQuery = useConfigQuery()
  const saveConfig = useSaveConfigMutation()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState<PredefinedPrompt | null>(null)
  const [promptName, setPromptName] = useState("")
  const [promptContent, setPromptContent] = useState("")

  const prompts = configQuery.data?.predefinedPrompts || []

  const skillsQuery = useQuery({
    queryKey: ["skills"],
    queryFn: () => tipcClient.getSkills(),
  })
  const enabledSkills = (skillsQuery.data ?? []).filter(
    (skill) => skill.enabled
  )

  const handleSelectPrompt = (prompt: PredefinedPrompt) => {
    onSelectPrompt(prompt.content)
  }

  const handleAddNew = () => {
    setEditingPrompt(null)
    setPromptName("")
    setPromptContent("")
    setIsDialogOpen(true)
  }

  const handleEdit = (e: React.MouseEvent | Event, prompt: PredefinedPrompt) => {
    e.preventDefault()
    e.stopPropagation()
    setEditingPrompt(prompt)
    setPromptName(prompt.name)
    setPromptContent(prompt.content)
    setIsDialogOpen(true)
  }

  const handleDelete = (e: React.MouseEvent | Event, prompt: PredefinedPrompt) => {
    e.preventDefault()
    e.stopPropagation()
    if (!configQuery.data) return
    const updatedPrompts = prompts.filter((p) => p.id !== prompt.id)
    saveConfig.mutate({
      config: {
        ...configQuery.data,
        predefinedPrompts: updatedPrompts,
      },
    })
  }

  const handleSave = () => {
    if (!promptName.trim() || !promptContent.trim()) return
    if (!configQuery.data) return

    const now = Date.now()
    let updatedPrompts: PredefinedPrompt[]

    if (editingPrompt) {
      updatedPrompts = prompts.map((p) =>
        p.id === editingPrompt.id
          ? { ...p, name: promptName.trim(), content: promptContent.trim(), updatedAt: now }
          : p
      )
    } else {
      const newPrompt: PredefinedPrompt = {
        id: `prompt-${now}-${Math.random().toString(36).substr(2, 9)}`,
        name: promptName.trim(),
        content: promptContent.trim(),
        createdAt: now,
        updatedAt: now,
      }
      updatedPrompts = [...prompts, newPrompt]
    }

    saveConfig.mutate({
      config: {
        ...configQuery.data,
        predefinedPrompts: updatedPrompts,
      },
    })
    setIsDialogOpen(false)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size={actualButtonSize}
            variant="ghost"
            className={cn("flex-shrink-0", className)}
            disabled={disabled}
            title="Predefined prompts"
          >
            <BookMarked className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64 max-h-80 overflow-y-auto">
          <DropdownMenuLabel>Predefined Prompts</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {prompts.length === 0 ? (
            <div className="px-2 py-3 text-sm text-muted-foreground text-center">
              No saved prompts yet
            </div>
          ) : (
            prompts.map((prompt) => (
              <DropdownMenuItem
                key={prompt.id}
                className="flex items-center justify-between gap-2 cursor-pointer"
                onSelect={() => handleSelectPrompt(prompt)}
              >
                <span className="truncate flex-1">{prompt.name}</span>
                <div
                  className="flex items-center gap-1 flex-shrink-0"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5"
                    onClick={(e) => handleEdit(e, prompt)}
                    title="Edit"
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 text-destructive hover:text-destructive"
                    onClick={(e) => handleDelete(e, prompt)}
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={handleAddNew} className="cursor-pointer">
            <Plus className="h-4 w-4 mr-2" />
            Add new prompt
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Skills</DropdownMenuLabel>
          {enabledSkills.length === 0 ? (
            <div className="px-2 py-3 text-sm text-muted-foreground text-center">
              No skills enabled
            </div>
          ) : (
            enabledSkills.map((skill) => (
              <DropdownMenuItem
                key={skill.id}
                className="flex items-center gap-2 cursor-pointer"
                onSelect={() => onSelectPrompt(skill.instructions)}
              >
                <Sparkles className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">{skill.name}</span>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingPrompt ? "Edit Prompt" : "Add New Prompt"}</DialogTitle>
            <DialogDescription>
              Save a frequently used prompt for quick access.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="prompt-name">Name</Label>
              <Input
                id="prompt-name"
                value={promptName}
                onChange={(e) => setPromptName(e.target.value)}
                placeholder="e.g., Code Review Request"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prompt-content">Prompt Content</Label>
              <Textarea
                id="prompt-content"
                value={promptContent}
                onChange={(e) => setPromptContent(e.target.value)}
                placeholder="Enter your prompt text..."
                className="min-h-[120px] resize-y"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!promptName.trim() || !promptContent.trim()}>
              {editingPrompt ? "Save Changes" : "Add Prompt"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

