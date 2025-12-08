/**
 * Memory Settings Page
 *
 * Allows users to configure and manage the Letta-style memory system:
 * - Enable/disable memory
 * - View and edit core memory blocks (persona, human, task_context)
 * - Browse and manage archival memory
 * - Configure memory behavior
 */

import { useState, useCallback } from "react"
import { Control, ControlGroup, ControlLabel } from "@renderer/components/ui/control"
import { Switch } from "@renderer/components/ui/switch"
import { Button } from "@renderer/components/ui/button"
import { Textarea } from "@renderer/components/ui/textarea"
import { Input } from "@renderer/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
  DialogFooter,
} from "@renderer/components/ui/dialog"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@renderer/components/ui/accordion"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

// Types for memory data
interface MemoryBlock {
  id: string
  label: string
  description: string
  value: string
  limit: number
  readOnly: boolean
  updatedAt: number
  createdAt: number
}

interface ArchivalEntry {
  id: string
  content: string
  tags: string[]
  source: string
  importance: number
  createdAt: number
}

interface MemoryStats {
  coreMemoryBlocks: number
  coreMemoryTotalChars: number
  coreMemoryUsedPercent: number
  archivalMemoryEntries: number
  lastUpdated: number
}

export function Component() {
  const queryClient = useQueryClient()
  const [editingBlock, setEditingBlock] = useState<MemoryBlock | null>(null)
  const [editValue, setEditValue] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [newArchivalContent, setNewArchivalContent] = useState("")
  const [newArchivalTags, setNewArchivalTags] = useState("")
  const [showResetDialog, setShowResetDialog] = useState(false)

  // Fetch memory status
  const memoryStatusQuery = useQuery({
    queryKey: ["memoryStatus"],
    queryFn: () => tipcClient.getMemoryStatus(),
    refetchInterval: 5000, // Refresh every 5 seconds
  })

  // Fetch core memory blocks
  const coreMemoryQuery = useQuery({
    queryKey: ["coreMemory"],
    queryFn: () => tipcClient.getCoreMemory(),
  })

  // Fetch archival memory
  const archivalMemoryQuery = useQuery({
    queryKey: ["archivalMemory"],
    queryFn: () => tipcClient.getArchivalMemory({ limit: 50, offset: 0 }),
  })

  // Search archival memory
  const searchArchivalQuery = useQuery({
    queryKey: ["archivalSearch", searchQuery],
    queryFn: () => tipcClient.searchArchivalMemory({ query: searchQuery, limit: 10 }),
    enabled: searchQuery.length > 2,
  })

  // Mutations
  const setEnabledMutation = useMutation({
    mutationFn: (enabled: boolean) => tipcClient.setMemoryEnabled({ enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memoryStatus"] })
      queryClient.invalidateQueries({ queryKey: ["coreMemory"] })
    },
  })

  const updateBlockMutation = useMutation({
    mutationFn: (data: { label: string; value: string }) =>
      tipcClient.updateMemoryBlock(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coreMemory"] })
      queryClient.invalidateQueries({ queryKey: ["memoryStatus"] })
      setEditingBlock(null)
    },
  })

  const clearBlockMutation = useMutation({
    mutationFn: (label: string) => tipcClient.clearMemoryBlock({ label }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coreMemory"] })
      queryClient.invalidateQueries({ queryKey: ["memoryStatus"] })
    },
  })

  const addArchivalMutation = useMutation({
    mutationFn: (data: { content: string; tags?: string[]; importance?: number }) =>
      tipcClient.addArchivalMemory(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["archivalMemory"] })
      queryClient.invalidateQueries({ queryKey: ["memoryStatus"] })
      setNewArchivalContent("")
      setNewArchivalTags("")
    },
  })

  const deleteArchivalMutation = useMutation({
    mutationFn: (entryId: string) => tipcClient.deleteArchivalMemory({ entryId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["archivalMemory"] })
      queryClient.invalidateQueries({ queryKey: ["memoryStatus"] })
    },
  })

  const resetMemoryMutation = useMutation({
    mutationFn: () => tipcClient.resetMemory(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memoryStatus"] })
      queryClient.invalidateQueries({ queryKey: ["coreMemory"] })
      queryClient.invalidateQueries({ queryKey: ["archivalMemory"] })
      setShowResetDialog(false)
    },
  })

  const updateConfigMutation = useMutation({
    mutationFn: (data: {
      autoSave?: boolean
      includeInSystemPrompt?: boolean
      maxArchivalMemories?: number
    }) => tipcClient.updateMemoryConfig(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memoryStatus"] })
    },
  })

  const handleEditBlock = useCallback((block: MemoryBlock) => {
    setEditingBlock(block)
    setEditValue(block.value)
  }, [])

  const handleSaveBlock = useCallback(() => {
    if (editingBlock) {
      updateBlockMutation.mutate({
        label: editingBlock.label,
        value: editValue,
      })
    }
  }, [editingBlock, editValue, updateBlockMutation])

  const handleAddArchival = useCallback(() => {
    if (newArchivalContent.trim()) {
      const tags = newArchivalTags
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
      addArchivalMutation.mutate({
        content: newArchivalContent,
        tags,
        importance: 0.5,
      })
    }
  }, [newArchivalContent, newArchivalTags, addArchivalMutation])

  const isEnabled = memoryStatusQuery.data?.enabled ?? false
  const stats = memoryStatusQuery.data?.stats as MemoryStats | undefined
  const config = memoryStatusQuery.data?.config

  return (
    <div className="space-y-6 p-4">
      <div>
        <h1 className="text-xl font-bold">Memory</h1>
        <p className="text-sm text-muted-foreground">
          Configure the Letta-style memory system for persistent agent memory
        </p>
      </div>

      {/* Enable/Disable Toggle */}
      <ControlGroup>
        <Control>
          <ControlLabel
            label="Enable Memory System"
            description="Allow the agent to remember information across conversations using self-editing memory blocks"
          />
          <Switch
            checked={isEnabled}
            onCheckedChange={(checked) => setEnabledMutation.mutate(checked)}
          />
        </Control>
      </ControlGroup>

      {isEnabled && (
        <>
          {/* Memory Stats */}
          <div className="rounded-lg border p-4">
            <h3 className="mb-2 font-semibold">Memory Statistics</h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Core Memory Blocks:</span>{" "}
                <span className="font-medium">{stats?.coreMemoryBlocks ?? 0}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Core Memory Used:</span>{" "}
                <span className="font-medium">
                  {stats?.coreMemoryTotalChars ?? 0} chars (
                  {Math.round(stats?.coreMemoryUsedPercent ?? 0)}%)
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Archival Entries:</span>{" "}
                <span className="font-medium">{stats?.archivalMemoryEntries ?? 0}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Last Updated:</span>{" "}
                <span className="font-medium">
                  {stats?.lastUpdated
                    ? new Date(stats.lastUpdated).toLocaleString()
                    : "Never"}
                </span>
              </div>
            </div>
          </div>

          {/* Configuration Options */}
          <ControlGroup>
            <Control>
              <ControlLabel
                label="Include in System Prompt"
                description="Add core memory contents to the agent's context for every interaction"
              />
              <Switch
                checked={config?.includeInSystemPrompt ?? true}
                onCheckedChange={(checked) =>
                  updateConfigMutation.mutate({ includeInSystemPrompt: checked })
                }
              />
            </Control>
            <Control>
              <ControlLabel
                label="Auto-Save Memory"
                description="Automatically save memory changes to disk"
              />
              <Switch
                checked={config?.autoSave ?? true}
                onCheckedChange={(checked) =>
                  updateConfigMutation.mutate({ autoSave: checked })
                }
              />
            </Control>
          </ControlGroup>

          {/* Core Memory Blocks */}
          <div className="space-y-4">
            <h3 className="font-semibold">Core Memory Blocks</h3>
            <p className="text-sm text-muted-foreground">
              These blocks are always visible to the agent and can be edited by the agent
              or manually below.
            </p>

            <Accordion type="multiple" className="w-full">
              {(coreMemoryQuery.data || []).map((block: MemoryBlock) => (
                <AccordionItem key={block.id} value={block.label}>
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex w-full items-center justify-between pr-4">
                      <div className="flex items-center gap-2">
                        <span className="font-medium capitalize">{block.label}</span>
                        {block.readOnly && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                            Read-only
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {block.value.length}/{block.limit} chars
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="space-y-2 pt-2">
                      <p className="text-xs text-muted-foreground">{block.description}</p>
                      <div className="rounded bg-muted/50 p-3">
                        <pre className="whitespace-pre-wrap text-sm">
                          {block.value || "(empty)"}
                        </pre>
                      </div>
                      {!block.readOnly && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleEditBlock(block)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => clearBlockMutation.mutate(block.label)}
                          >
                            Clear
                          </Button>
                        </div>
                      )}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>

          {/* Edit Block Dialog */}
          <Dialog
            open={editingBlock !== null}
            onOpenChange={(open) => !open && setEditingBlock(null)}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit {editingBlock?.label} Memory</DialogTitle>
                <DialogDescription>{editingBlock?.description}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <Textarea
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  rows={8}
                  placeholder="Enter memory content..."
                  className="font-mono text-sm"
                />
                <div className="text-xs text-muted-foreground">
                  {editValue.length}/{editingBlock?.limit ?? 0} characters
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditingBlock(null)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveBlock}
                  disabled={
                    updateBlockMutation.isPending ||
                    editValue.length > (editingBlock?.limit ?? 0)
                  }
                >
                  {updateBlockMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Archival Memory */}
          <div className="space-y-4">
            <h3 className="font-semibold">Archival Memory</h3>
            <p className="text-sm text-muted-foreground">
              Long-term storage for facts and information that doesn't fit in core memory.
              The agent can search and retrieve these memories.
            </p>

            {/* Add new archival memory */}
            <div className="space-y-2 rounded-lg border p-4">
              <h4 className="text-sm font-medium">Add New Memory</h4>
              <Textarea
                value={newArchivalContent}
                onChange={(e) => setNewArchivalContent(e.target.value)}
                rows={3}
                placeholder="Enter information to store..."
                className="text-sm"
              />
              <Input
                value={newArchivalTags}
                onChange={(e) => setNewArchivalTags(e.target.value)}
                placeholder="Tags (comma-separated, e.g., preference, coding, project)"
                className="text-sm"
              />
              <Button
                size="sm"
                onClick={handleAddArchival}
                disabled={!newArchivalContent.trim() || addArchivalMutation.isPending}
              >
                {addArchivalMutation.isPending ? "Adding..." : "Add to Archival Memory"}
              </Button>
            </div>

            {/* Search archival memory */}
            <div className="space-y-2">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search archival memory..."
                className="text-sm"
              />
              {searchQuery.length > 2 && searchArchivalQuery.data && (
                <div className="rounded-lg border p-2">
                  <h4 className="mb-2 text-xs font-medium text-muted-foreground">
                    Search Results ({searchArchivalQuery.data.length})
                  </h4>
                  {searchArchivalQuery.data.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No matching memories found</p>
                  ) : (
                    <div className="space-y-2">
                      {searchArchivalQuery.data.map((result: { entry: ArchivalEntry; score: number }) => (
                        <div
                          key={result.entry.id}
                          className="rounded bg-muted/50 p-2 text-sm"
                        >
                          <div className="flex items-start justify-between">
                            <p className="flex-1">{result.entry.content}</p>
                            <span className="ml-2 text-xs text-muted-foreground">
                              {Math.round(result.score * 100)}% match
                            </span>
                          </div>
                          {result.entry.tags.length > 0 && (
                            <div className="mt-1 flex gap-1">
                              {result.entry.tags.map((tag) => (
                                <span
                                  key={tag}
                                  className="rounded bg-primary/10 px-1 py-0.5 text-xs"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Browse archival memory */}
            {archivalMemoryQuery.data && archivalMemoryQuery.data.total > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">
                  All Entries ({archivalMemoryQuery.data.total})
                </h4>
                <div className="max-h-64 space-y-2 overflow-y-auto">
                  {archivalMemoryQuery.data.entries.map((entry: ArchivalEntry) => (
                    <div
                      key={entry.id}
                      className="flex items-start justify-between rounded border p-2"
                    >
                      <div className="flex-1">
                        <p className="text-sm">{entry.content}</p>
                        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{new Date(entry.createdAt).toLocaleDateString()}</span>
                          {entry.tags.length > 0 && (
                            <span>
                              Tags:{" "}
                              {entry.tags.map((t) => (
                                <span key={t} className="mr-1 rounded bg-muted px-1">
                                  {t}
                                </span>
                              ))}
                            </span>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => deleteArchivalMutation.mutate(entry.id)}
                      >
                        Delete
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Danger Zone */}
          <div className="space-y-4 rounded-lg border border-destructive/50 p-4">
            <h3 className="font-semibold text-destructive">Danger Zone</h3>
            <p className="text-sm text-muted-foreground">
              Reset all memory to default values. This cannot be undone.
            </p>
            <Dialog open={showResetDialog} onOpenChange={setShowResetDialog}>
              <DialogTrigger asChild>
                <Button variant="destructive" size="sm">
                  Reset All Memory
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Reset Memory?</DialogTitle>
                  <DialogDescription>
                    This will permanently delete all core memory content and archival
                    memories. This action cannot be undone.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowResetDialog(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => resetMemoryMutation.mutate()}
                    disabled={resetMemoryMutation.isPending}
                  >
                    {resetMemoryMutation.isPending ? "Resetting..." : "Reset Memory"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </>
      )}
    </div>
  )
}
