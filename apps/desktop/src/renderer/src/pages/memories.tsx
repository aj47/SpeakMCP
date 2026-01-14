import { useState, useEffect } from "react"
import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { Badge } from "@renderer/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog"
import { Textarea } from "@renderer/components/ui/textarea"
import { Label } from "@renderer/components/ui/label"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AgentMemory } from "@shared/types"
import { toast } from "sonner"
import {
  Search,
  Trash2,
  Brain,
  Calendar,
  Tag,
  ChevronDown,
  ChevronRight,
  Loader2,
  AlertCircle,
  FileText,
  Pencil,
  X,
  User,
  CheckSquare,
  Square,
  MinusSquare,
} from "lucide-react"
import { cn } from "@renderer/lib/utils"

const importanceColors = {
  low: "bg-slate-500/20 text-slate-600 dark:text-slate-400",
  medium: "bg-blue-500/20 text-blue-600 dark:text-blue-400",
  high: "bg-orange-500/20 text-orange-600 dark:text-orange-400",
  critical: "bg-red-500/20 text-red-600 dark:text-red-400",
}

function MemoryCard({
  memory,
  onDelete,
  onEdit,
  isSelected,
  onToggleSelect,
}: {
  memory: AgentMemory
  onDelete: (id: string) => void
  onEdit: (memory: AgentMemory) => void
  isSelected: boolean
  onToggleSelect: (id: string) => void
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  
  const formattedDate = new Date(memory.createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

  return (
    <div className={cn(
      "rounded-lg border bg-card transition-all duration-200 hover:bg-accent/5",
      memory.importance === "critical" && "border-red-500/50",
      memory.importance === "high" && "border-orange-500/50",
      isSelected && "ring-2 ring-primary/50",
    )}>
      {/* Header */}
      <div
        className="flex items-start gap-3 p-4 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <button
          className="mt-0.5 text-muted-foreground hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation()
            onToggleSelect(memory.id)
          }}
        >
          {isSelected ? (
            <CheckSquare className="h-4 w-4 text-primary" />
          ) : (
            <Square className="h-4 w-4" />
          )}
        </button>
        <button className="mt-0.5 text-muted-foreground hover:text-foreground">
          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-medium text-sm truncate">{memory.title}</h3>
            <Badge className={cn("text-[10px] px-1.5 py-0", importanceColors[memory.importance])}>
              {memory.importance}
            </Badge>
          </div>
          
          <p className="text-xs text-muted-foreground line-clamp-2">{memory.content}</p>
          
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {formattedDate}
            </span>
            {memory.conversationTitle && (
              <span className="flex items-center gap-1 truncate max-w-[200px]">
                <FileText className="h-3 w-3" />
                {memory.conversationTitle}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={(e) => {
              e.stopPropagation()
              onEdit(memory)
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation()
              onDelete(memory.id)
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-0 ml-7 space-y-3 border-t">
          {/* Full Content */}
          <div className="mt-3">
            <h4 className="text-xs font-semibold text-muted-foreground mb-2">Summary</h4>
            <p className="text-sm whitespace-pre-wrap">{memory.content}</p>
          </div>

          {/* Key Findings */}
          {memory.keyFindings.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
                <Brain className="h-3 w-3" />
                Key Findings
              </h4>
              <ul className="space-y-1">
                {memory.keyFindings.map((finding, i) => (
                  <li key={i} className="text-sm flex items-start gap-2">
                    <span className="text-primary mt-1">•</span>
                    {finding}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Tags */}
          {memory.tags.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
                <Tag className="h-3 w-3" />
                Tags
              </h4>
              <div className="flex flex-wrap gap-1">
                {memory.tags.map((tag, i) => (
                  <Badge key={i} variant="secondary" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* User Notes */}
          {memory.userNotes && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground mb-2">Notes</h4>
              <p className="text-sm text-muted-foreground italic">{memory.userNotes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function Component() {
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState("")
  const [importanceFilter, setImportanceFilter] = useState<string>("all")
  const [editingMemory, setEditingMemory] = useState<AgentMemory | null>(null)
  const [editNotes, setEditNotes] = useState("")
  const [editTags, setEditTags] = useState("")
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)
  const [deleteAllConfirm, setDeleteAllConfirm] = useState(false)

  // Clear selection when filters change to avoid deleting non-visible items
  useEffect(() => {
    setSelectedIds(new Set())
  }, [searchQuery, importanceFilter])

  // Get current profile for display
  const currentProfileQuery = useQuery({
    queryKey: ["current-profile"],
    queryFn: async () => {
      return await tipcClient.getCurrentProfile()
    },
  })
  const currentProfile = currentProfileQuery.data

  // Get memories for the current profile (automatically filtered by profile on the backend)
  const memoriesQuery = useQuery({
    queryKey: ["memories", "currentProfile", currentProfile?.id],
    queryFn: async () => {
      return await tipcClient.getMemoriesForCurrentProfile()
    },
  })

  // Search also uses the current profile filter on the backend
  const searchMutation = useMutation({
    mutationFn: async (query: string) => {
      if (!query.trim()) return null
      return await tipcClient.searchMemories({ query })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await tipcClient.deleteMemory({ id })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] })
      toast.success("Memory deleted")
      setDeleteConfirmId(null)
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete: ${error.message}`)
    },
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<AgentMemory> }) => {
      return await tipcClient.updateMemory({ id, updates })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] })
      toast.success("Memory updated")
      setEditingMemory(null)
    },
    onError: (error: Error) => {
      toast.error(`Failed to update: ${error.message}`)
    },
  })

  const deleteMultipleMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      return await tipcClient.deleteMultipleMemories({ ids })
    },
    onSuccess: (deletedCount) => {
      queryClient.invalidateQueries({ queryKey: ["memories"] })
      toast.success(`Deleted ${deletedCount} memories`)
      setSelectedIds(new Set())
      setBulkDeleteConfirm(false)
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete: ${error.message}`)
    },
  })

  const deleteAllMutation = useMutation({
    mutationFn: async () => {
      return await tipcClient.deleteAllMemories()
    },
    onSuccess: (deletedCount) => {
      queryClient.invalidateQueries({ queryKey: ["memories"] })
      toast.success(`Deleted ${deletedCount} memories`)
      setSelectedIds(new Set())
      setDeleteAllConfirm(false)
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete: ${error.message}`)
    },
  })

  const memories = memoriesQuery.data || []
  const searchResults = searchMutation.data
  const displayMemories = searchResults ?? memories

  // Filter by importance
  const filteredMemories = importanceFilter === "all"
    ? displayMemories
    : displayMemories.filter(m => m.importance === importanceFilter)

  const handleSearch = (query: string) => {
    setSearchQuery(query)
    if (query.trim()) {
      searchMutation.mutate(query)
    } else {
      searchMutation.reset()
    }
  }

  const handleEdit = (memory: AgentMemory) => {
    setEditingMemory(memory)
    setEditNotes(memory.userNotes || "")
    setEditTags(memory.tags.join(", "))
  }

  const handleSaveEdit = () => {
    if (!editingMemory) return
    updateMutation.mutate({
      id: editingMemory.id,
      updates: {
        userNotes: editNotes || undefined,
        tags: editTags.split(",").map(t => t.trim()).filter(Boolean),
        updatedAt: Date.now(),
      },
    })
  }

  const handleToggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  // Calculate how many of the currently visible (filtered) memories are selected
  const filteredIds = new Set(filteredMemories.map(m => m.id))
  const visibleSelectedCount = [...selectedIds].filter(id => filteredIds.has(id)).length

  const handleSelectAll = () => {
    if (visibleSelectedCount === filteredMemories.length && filteredMemories.length > 0) {
      // Deselect only the visible ones, keep any non-visible selections
      setSelectedIds(prev => {
        const next = new Set(prev)
        filteredMemories.forEach(m => next.delete(m.id))
        return next
      })
    } else {
      // Add all visible to selection (keeps existing non-visible selections)
      setSelectedIds(prev => new Set([...prev, ...filteredMemories.map(m => m.id)]))
    }
  }

  // Stats
  const criticalCount = memories.filter(m => m.importance === "critical").length
  const highCount = memories.filter(m => m.importance === "high").length
  const allSelected = filteredMemories.length > 0 && visibleSelectedCount === filteredMemories.length
  const someSelected = visibleSelectedCount > 0 && visibleSelectedCount < filteredMemories.length

  return (
    <div className="modern-panel h-full overflow-auto px-6 py-4">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">Memories</h1>
            {currentProfile && (
              <Badge variant="outline" className="text-xs flex items-center gap-1">
                <User className="h-3 w-3" />
                {currentProfile.name}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Saved insights and findings from agent sessions for this profile
          </p>
        </div>

        {/* Stats */}
        {memories.length > 0 && (
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">{memories.length} memories</span>
            {criticalCount > 0 && (
              <Badge className={cn("text-xs", importanceColors.critical)}>
                {criticalCount} critical
              </Badge>
            )}
            {highCount > 0 && (
              <Badge className={cn("text-xs", importanceColors.high)}>
                {highCount} high importance
              </Badge>
            )}
          </div>
        )}

        {/* Search and Filters */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search memories..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-9"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
                onClick={() => handleSearch("")}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {["all", "critical", "high", "medium", "low"].map((level) => (
              <Button
                key={level}
                variant={importanceFilter === level ? "default" : "outline"}
                size="sm"
                onClick={() => setImportanceFilter(level)}
                className="capitalize"
              >
                {level}
              </Button>
            ))}
          </div>
        </div>

        {/* Bulk Actions Bar */}
        {filteredMemories.length > 0 && (
          <div className="flex items-center gap-3 py-2 px-3 bg-muted/50 rounded-lg">
            <button
              className="text-muted-foreground hover:text-foreground"
              onClick={handleSelectAll}
            >
              {allSelected ? (
                <CheckSquare className="h-4 w-4 text-primary" />
              ) : someSelected ? (
                <MinusSquare className="h-4 w-4 text-primary" />
              ) : (
                <Square className="h-4 w-4" />
              )}
            </button>
            <span className="text-sm text-muted-foreground">
              {selectedIds.size > 0 ? `${selectedIds.size} selected` : "Select all"}
            </span>
            <div className="flex-1" />
            {selectedIds.size > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setBulkDeleteConfirm(true)}
                disabled={deleteMultipleMutation.isPending}
              >
                {deleteMultipleMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-2" />
                )}
                Delete Selected ({selectedIds.size})
              </Button>
            )}
            {memories.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeleteAllConfirm(true)}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete All
              </Button>
            )}
          </div>
        )}

        {/* Memory List */}
        {memoriesQuery.isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredMemories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Brain className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium">No memories yet</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-md">
              {searchQuery
                ? "No memories match your search. Try a different query."
                : "Save summaries from agent sessions to build your knowledge base."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredMemories.map((memory) => (
              <MemoryCard
                key={memory.id}
                memory={memory}
                onDelete={(id) => setDeleteConfirmId(id)}
                onEdit={handleEdit}
                isSelected={selectedIds.has(memory.id)}
                onToggleSelect={handleToggleSelect}
              />
            ))}
          </div>
        )}
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editingMemory} onOpenChange={() => setEditingMemory(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Memory</DialogTitle>
            <DialogDescription>
              Add notes or update tags for this memory.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Add your notes..."
                rows={4}
              />
            </div>
            <div className="space-y-2">
              <Label>Tags (comma-separated)</Label>
              <Input
                value={editTags}
                onChange={(e) => setEditTags(e.target.value)}
                placeholder="tag1, tag2, tag3"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingMemory(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} disabled={updateMutation.isPending}>
              {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              Delete Memory
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this memory? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmId && deleteMutation.mutate(deleteConfirmId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirmation Dialog */}
      <Dialog open={bulkDeleteConfirm} onOpenChange={setBulkDeleteConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              Delete {selectedIds.size} Memories
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete {selectedIds.size} selected memories? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMultipleMutation.mutate(Array.from(selectedIds))}
              disabled={deleteMultipleMutation.isPending}
            >
              {deleteMultipleMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Delete {selectedIds.size} Memories
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete All Confirmation Dialog */}
      <Dialog open={deleteAllConfirm} onOpenChange={setDeleteAllConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-destructive" />
              Delete All Memories
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to delete ALL {memories.length} memories? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteAllConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteAllMutation.mutate()}
              disabled={deleteAllMutation.isPending}
            >
              {deleteAllMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Delete All Memories
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

