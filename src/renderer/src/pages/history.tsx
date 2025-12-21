import React, { useState, useMemo, useEffect } from "react"
import { useParams } from "react-router-dom"
import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card"
import { Badge } from "@renderer/components/ui/badge"
import { ScrollArea } from "@renderer/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog"
import {
  MessageCircle,
  Trash2,
  Search,
  Calendar,
  User,
  Bot,
  Eye,
  MoreVertical,
  ArrowLeft,
  FolderOpen,
  Mic,
} from "lucide-react"
import { cn } from "@renderer/lib/utils"
import {
  useHistoryQuery,
  useDeleteHistoryItemMutation,
  useDeleteAllHistoryMutation,
  useHistoryItemQuery,
  useRecordingHistoryQuery,
  useDeleteRecordingItemMutation,
} from "@renderer/lib/queries"
import { useConversationStore } from "@renderer/stores"
import { tipcClient } from "@renderer/lib/tipc-client"
import { ConversationDisplay } from "@renderer/components/conversation-display"
import { ConversationHistoryItem, RecordingHistoryItem } from "@shared/types"
import dayjs from "dayjs"
import { toast } from "sonner"

// Unified history item type for display
type UnifiedHistoryItem =
  | { type: "conversation"; data: ConversationHistoryItem }
  | { type: "recording"; data: RecordingHistoryItem }

export function Component() {
  const { id: routeHistoryItemId } = useParams<{ id: string }>()
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<
    string | null
  >(null)
  const [selectedItemType, setSelectedItemType] = useState<"conversation" | "recording">("conversation")
  const [viewMode, setViewMode] = useState<"list" | "detail">("list")
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState(false)

  const historyQuery = useHistoryQuery()
  const recordingHistoryQuery = useRecordingHistoryQuery()
  const deleteHistoryItemMutation = useDeleteHistoryItemMutation()
  const deleteRecordingItemMutation = useDeleteRecordingItemMutation()
  const deleteAllHistoryMutation = useDeleteAllHistoryMutation()
  const selectedHistoryItemQuery = useHistoryItemQuery(
    selectedItemType === "conversation" ? selectedHistoryItem : null
  )

  const continueConversation = useConversationStore((s) => s.continueConversation)

  // Debug logging
  useEffect(() => {
    console.log("[History Page] historyQuery state:", {
      isLoading: historyQuery.isLoading,
      isError: historyQuery.isError,
      error: historyQuery.error,
      dataLength: historyQuery.data?.length,
      data: historyQuery.data,
    })
    console.log("[History Page] recordingHistoryQuery state:", {
      isLoading: recordingHistoryQuery.isLoading,
      isError: recordingHistoryQuery.isError,
      error: recordingHistoryQuery.error,
      dataLength: recordingHistoryQuery.data?.length,
      data: recordingHistoryQuery.data,
    })
  }, [historyQuery.isLoading, historyQuery.isError, historyQuery.data, recordingHistoryQuery.isLoading, recordingHistoryQuery.isError, recordingHistoryQuery.data])

  // Handle route parameter for deep-linking to specific history item
  useEffect(() => {
    if (routeHistoryItemId) {
      setSelectedHistoryItem(routeHistoryItemId)
      setViewMode("detail")
    }
  }, [routeHistoryItemId])

  // Merge and filter both conversation and recording histories
  const filteredHistory = useMemo(() => {
    const unified: UnifiedHistoryItem[] = []

    // Add conversations
    if (historyQuery.data) {
      for (const item of historyQuery.data) {
        if (
          item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.preview.toLowerCase().includes(searchQuery.toLowerCase())
        ) {
          unified.push({ type: "conversation", data: item })
        }
      }
    }

    // Add recordings
    if (recordingHistoryQuery.data) {
      for (const item of recordingHistoryQuery.data) {
        if (item.transcript.toLowerCase().includes(searchQuery.toLowerCase())) {
          unified.push({ type: "recording", data: item })
        }
      }
    }

    console.log("[History Page] Unified filtered history:", {
      conversations: historyQuery.data?.length || 0,
      recordings: recordingHistoryQuery.data?.length || 0,
      filtered: unified.length,
    })

    return unified
  }, [historyQuery.data, recordingHistoryQuery.data, searchQuery])

  const groupedHistory = useMemo(() => {
    const groups = new Map<string, UnifiedHistoryItem[]>()
    const today = dayjs().format("YYYY-MM-DD")
    const yesterday = dayjs().subtract(1, "day").format("YYYY-MM-DD")

    for (const item of filteredHistory) {
      const timestamp = item.type === "conversation"
        ? item.data.updatedAt
        : item.data.createdAt
      const date = dayjs(timestamp).format("YYYY-MM-DD")
      let groupKey: string

      if (date === today) {
        groupKey = "Today"
      } else if (date === yesterday) {
        groupKey = "Yesterday"
      } else {
        groupKey = dayjs(timestamp).format("MMM D, YYYY")
      }

      const items = groups.get(groupKey) || []
      items.push(item)
      groups.set(groupKey, items)
    }

    return Array.from(groups.entries()).map(([date, items]) => ({
      date,
      items: items.sort((a, b) => {
        const aTime = a.type === "conversation" ? a.data.updatedAt : a.data.createdAt
        const bTime = b.type === "conversation" ? b.data.updatedAt : b.data.createdAt
        return bTime - aTime
      }),
    }))
  }, [filteredHistory])

  const handleDeleteHistoryItem = async (historyItemId: string, itemType: "conversation" | "recording") => {
    try {
      if (itemType === "conversation") {
        await deleteHistoryItemMutation.mutateAsync(historyItemId)
      } else {
        await deleteRecordingItemMutation.mutateAsync(historyItemId)
      }
      toast.success("History item deleted")
      if (selectedHistoryItem === historyItemId) {
        setSelectedHistoryItem(null)
        setViewMode("list")
      }
    } catch (error) {
      toast.error("Failed to delete history item")
    }
  }

  const handleDeleteAllHistory = async () => {
    try {
      await deleteAllHistoryMutation.mutateAsync()
      toast.success("All history deleted")
      setSelectedHistoryItem(null)
      setViewMode("list")
      setShowDeleteAllDialog(false)
    } catch (error) {
      toast.error("Failed to delete history")
    }
  }

  const handleSelectHistoryItem = (historyItemId: string, itemType: "conversation" | "recording") => {
    setSelectedHistoryItem(historyItemId)
    setSelectedItemType(itemType)
    setViewMode("detail")
  }

  const handleBackToList = () => {
    setViewMode("list")
    setSelectedHistoryItem(null)
  }

  const handleContinueConversation = (conversationId: string) => {
    continueConversation(conversationId)
    // Navigate to panel or show some indication that conversation is active
    toast.success("Conversation activated. Use Ctrl+T to continue.")
  }

  const handleOpenHistoryFolder = async () => {
    try {
      await tipcClient.openConversationsFolder()
      toast.success("History folder opened")
    } catch (error) {
      toast.error("Failed to open history folder")
    }
  }

  // Get selected recording data for detail view
  const selectedRecording = useMemo(() => {
    if (selectedItemType !== "recording" || !selectedHistoryItem) return null
    return recordingHistoryQuery.data?.find(r => r.id === selectedHistoryItem) || null
  }, [selectedItemType, selectedHistoryItem, recordingHistoryQuery.data])

  return (
    <>
      {viewMode === "list" ? (
        // List View
        <>
          <header className="app-drag-region flex h-12 shrink-0 items-center justify-between border-b bg-background px-4 text-sm">
            <span className="font-bold">History</span>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleOpenHistoryFolder}
                className="h-7 gap-1 px-2 py-0"
                title="Open history folder for debugging"
              >
                <FolderOpen className="h-4 w-4" />
                <span className="hidden sm:inline">Open Folder</span>
              </Button>
              <Button
                variant="ghost"
                className="h-7 gap-1 px-2 py-0 text-red-500 hover:text-red-500"
                onClick={() => setShowDeleteAllDialog(true)}
                disabled={deleteAllHistoryMutation.isPending}
              >
                <Trash2 className="h-4 w-4" />
                <span>Delete All</span>
              </Button>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search history..."
                  className="w-64 pl-8"
                />
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-hidden bg-background">
            {groupedHistory.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center p-8 text-center">
                <MessageCircle className="mb-4 h-12 w-12 text-muted-foreground" />
                <h3 className="mb-2 text-lg font-semibold">
                  {searchQuery
                    ? "No matching history"
                    : "No history yet"}
                </h3>
                <p className="text-muted-foreground">
                  {searchQuery
                    ? "Try adjusting your search terms"
                    : "Start a conversation using Ctrl+T or voice recording"}
                </p>
              </div>
            ) : (
              <ScrollArea className="h-full">
                <div className="space-y-6 p-4">
                  {groupedHistory.map(({ date, items }) => (
                    <div key={date}>
                      <h4 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
                        <Calendar className="h-4 w-4" />
                        {date}
                      </h4>
                      <div className="space-y-2">
                        {items.map((item) => (
                          item.type === "conversation" ? (
                            <HistoryCard
                              key={`conv-${item.data.id}`}
                              conversation={item.data}
                              isSelected={false}
                              onSelect={() =>
                                handleSelectHistoryItem(item.data.id, "conversation")
                              }
                              onDelete={() =>
                                handleDeleteHistoryItem(item.data.id, "conversation")
                              }
                              onContinue={() =>
                                handleContinueConversation(item.data.id)
                              }
                              isDeleting={deleteHistoryItemMutation.isPending}
                            />
                          ) : (
                            <RecordingCard
                              key={`rec-${item.data.id}`}
                              recording={item.data}
                              isSelected={false}
                              onSelect={() =>
                                handleSelectHistoryItem(item.data.id, "recording")
                              }
                              onDelete={() =>
                                handleDeleteHistoryItem(item.data.id, "recording")
                              }
                              isDeleting={deleteRecordingItemMutation.isPending}
                            />
                          )
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </>
      ) : (
        // Detail View
        <>
          <header className="app-drag-region flex h-12 shrink-0 items-center justify-between border-b bg-background px-4 text-sm">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBackToList}
                className="h-7 gap-1 px-2 py-0"
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Back</span>
              </Button>
              <span className="font-bold">
                {selectedItemType === "conversation"
                  ? (selectedHistoryItemQuery.data?.title || "Conversation")
                  : "Voice Recording"}
              </span>
            </div>

            {selectedItemType === "conversation" && (
              <Button
                onClick={() =>
                  selectedHistoryItem &&
                  handleContinueConversation(selectedHistoryItem)
                }
                className="h-7 gap-2 px-3 py-0"
                disabled={!selectedHistoryItem}
              >
                <MessageCircle className="h-4 w-4" />
                Continue
              </Button>
            )}
          </header>

          <div className="flex-1 overflow-hidden bg-muted/30">
            {selectedItemType === "recording" && selectedRecording ? (
              // Recording detail view
              <div className="flex h-full flex-col">
                <div className="border-b bg-background p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                      <Mic className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold">Voice Recording</h2>
                      <p className="text-sm text-muted-foreground">
                        {Math.round(selectedRecording.duration / 1000)}s duration •{" "}
                        {dayjs(selectedRecording.createdAt).format("MMM D, YYYY h:mm A")}
                      </p>
                    </div>
                  </div>
                </div>
                <ScrollArea className="flex-1 p-4">
                  <div className="rounded-lg border bg-background p-4">
                    <h3 className="mb-2 text-sm font-medium text-muted-foreground">Transcript</h3>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">
                      {selectedRecording.transcript || "No transcript available"}
                    </p>
                  </div>
                </ScrollArea>
              </div>
            ) : selectedItemType === "conversation" && selectedHistoryItemQuery.isError ? (
              <div className="flex h-full items-center justify-center p-8 text-center">
                <div>
                  <Eye className="mx-auto mb-4 h-12 w-12 text-destructive" />
                  <h3 className="mb-2 text-lg font-semibold">
                    Error loading conversation
                  </h3>
                  <p className="text-muted-foreground">
                    Failed to load conversation data. The file may be missing or corrupted.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleBackToList}
                    className="mt-4"
                  >
                    Back to list
                  </Button>
                </div>
              </div>
            ) : selectedItemType === "conversation" && selectedHistoryItem && selectedHistoryItemQuery.data && Array.isArray(selectedHistoryItemQuery.data.messages) ? (
              <div className="flex h-full flex-col">
                <div className="border-b bg-background p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold">
                        {selectedHistoryItemQuery.data.title}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {selectedHistoryItemQuery.data.messages.length}{" "}
                        messages • Last updated{" "}
                        {dayjs(selectedHistoryItemQuery.data.updatedAt).format(
                          "MMM D, YYYY h:mm A",
                        )}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex-1 overflow-hidden p-4">
                  <ConversationDisplay
                    messages={selectedHistoryItemQuery.data.messages}
                    maxHeight="100%"
                    className="h-full"
                  />
                </div>
              </div>
            ) : selectedItemType === "conversation" && selectedHistoryItem && selectedHistoryItemQuery.data && !Array.isArray(selectedHistoryItemQuery.data.messages) ? (
              <div className="flex h-full items-center justify-center p-8 text-center">
                <div>
                  <Eye className="mx-auto mb-4 h-12 w-12 text-destructive" />
                  <h3 className="mb-2 text-lg font-semibold">
                    Invalid conversation data
                  </h3>
                  <p className="text-muted-foreground">
                    This conversation data appears to be corrupted or incomplete.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleBackToList}
                    className="mt-4"
                  >
                    Back to list
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center p-8 text-center">
                <div>
                  <Eye className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                  <h3 className="mb-2 text-lg font-semibold">
                    Loading history...
                  </h3>
                  <p className="text-muted-foreground">
                    Please wait while we load the history details
                  </p>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Delete All Confirmation Dialog */}
      <Dialog open={showDeleteAllDialog} onOpenChange={setShowDeleteAllDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete All History</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete all history? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteAllDialog(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteAllHistory}
              disabled={deleteAllHistoryMutation.isPending}
            >
              {deleteAllHistoryMutation.isPending ? "Deleting..." : "Delete All"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

interface HistoryCardProps {
  conversation: ConversationHistoryItem
  isSelected: boolean
  onSelect: () => void
  onDelete: () => void
  onContinue: () => void
  isDeleting: boolean
}

function HistoryCard({
  conversation,
  isSelected,
  onSelect,
  onDelete,
  onContinue,
  isDeleting,
}: HistoryCardProps) {
  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover:shadow-md",
        isSelected && "ring-2 ring-primary",
      )}
      onClick={onSelect}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="mb-1 truncate font-medium">{conversation.title}</h3>
            <p className="mb-2 line-clamp-2 text-sm text-muted-foreground">
              {conversation.preview}
            </p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary" className="text-xs">
                {conversation.messageCount} messages
              </Badge>
              <span>•</span>
              <span>
                {dayjs(conversation.updatedAt).format("MMM D, h:mm A")}
              </span>
            </div>
          </div>
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="sm"
              onClick={onContinue}
              className="h-8 w-8 p-0"
              title="Continue conversation"
            >
              <MessageCircle className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              disabled={isDeleting}
              className="h-8 w-8 p-0 text-red-500 hover:text-red-600"
              title="Delete history item"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

interface RecordingCardProps {
  recording: RecordingHistoryItem
  isSelected: boolean
  onSelect: () => void
  onDelete: () => void
  isDeleting: boolean
}

function RecordingCard({
  recording,
  isSelected,
  onSelect,
  onDelete,
  isDeleting,
}: RecordingCardProps) {
  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover:shadow-md",
        isSelected && "ring-2 ring-primary",
      )}
      onClick={onSelect}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
              <Mic className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="mb-1 truncate font-medium">Voice Recording</h3>
              <p className="mb-2 line-clamp-2 text-sm text-muted-foreground">
                {recording.transcript || "No transcript"}
              </p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="text-xs">
                  <Mic className="mr-1 h-3 w-3" />
                  {Math.round(recording.duration / 1000)}s
                </Badge>
                <span>•</span>
                <span>
                  {dayjs(recording.createdAt).format("MMM D, h:mm A")}
                </span>
              </div>
            </div>
          </div>
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              disabled={isDeleting}
              className="h-8 w-8 p-0 text-red-500 hover:text-red-600"
              title="Delete recording"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
