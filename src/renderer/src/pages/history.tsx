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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
} from "lucide-react"
import { cn } from "@renderer/lib/utils"
import {
  useHistoryQuery,
  useDeleteHistoryItemMutation,
  useDeleteAllHistoryMutation,
  useHistoryItemQuery,
} from "@renderer/lib/query-client"
import { useConversationActions } from "@renderer/contexts/conversation-context"
import { tipcClient } from "@renderer/lib/tipc-client"
import { ConversationDisplay } from "@renderer/components/conversation-display"
import { ConversationHistoryItem } from "@shared/types"
import dayjs from "dayjs"
import { toast } from "sonner"

export function Component() {
  const { id: routeHistoryItemId } = useParams<{ id: string }>()
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<
    string | null
  >(null)
  const [viewMode, setViewMode] = useState<"list" | "detail">("list")
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState(false)

  const historyQuery = useHistoryQuery()
  const deleteHistoryItemMutation = useDeleteHistoryItemMutation()
  const deleteAllHistoryMutation = useDeleteAllHistoryMutation()
  const selectedHistoryItemQuery = useHistoryItemQuery(selectedHistoryItem)

  const { continueConversation } = useConversationActions()

  // Debug logging
  useEffect(() => {
    console.log("[History Page] historyQuery state:", {
      isLoading: historyQuery.isLoading,
      isError: historyQuery.isError,
      error: historyQuery.error,
      dataLength: historyQuery.data?.length,
      data: historyQuery.data,
    })
  }, [historyQuery.isLoading, historyQuery.isError, historyQuery.data])

  // Handle route parameter for deep-linking to specific history item
  useEffect(() => {
    if (routeHistoryItemId) {
      setSelectedHistoryItem(routeHistoryItemId)
      setViewMode("detail")
    }
  }, [routeHistoryItemId])

  const filteredHistory = useMemo(() => {
    console.log("[History Page] Computing filteredHistory:", {
      hasData: !!historyQuery.data,
      dataLength: historyQuery.data?.length,
      searchQuery,
    })

    if (!historyQuery.data) return []

    const filtered = historyQuery.data.filter(
      (historyItem) =>
        historyItem.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        historyItem.preview.toLowerCase().includes(searchQuery.toLowerCase()),
    )

    console.log("[History Page] Filtered history:", {
      originalLength: historyQuery.data.length,
      filteredLength: filtered.length,
    })

    return filtered
  }, [historyQuery.data, searchQuery])

  const groupedHistory = useMemo(() => {
    console.log("[History Page] Computing groupedHistory from filteredHistory:", {
      filteredLength: filteredHistory.length,
    })

    const groups = new Map<string, ConversationHistoryItem[]>()
    const today = dayjs().format("YYYY-MM-DD")
    const yesterday = dayjs().subtract(1, "day").format("YYYY-MM-DD")

    for (const historyItem of filteredHistory) {
      const date = dayjs(historyItem.updatedAt).format("YYYY-MM-DD")
      let groupKey: string

      if (date === today) {
        groupKey = "Today"
      } else if (date === yesterday) {
        groupKey = "Yesterday"
      } else {
        groupKey = dayjs(historyItem.updatedAt).format("MMM D, YYYY")
      }

      const items = groups.get(groupKey) || []
      items.push(historyItem)
      groups.set(groupKey, items)
    }

    return Array.from(groups.entries()).map(([date, items]) => ({
      date,
      items: items.sort((a, b) => b.updatedAt - a.updatedAt),
    }))
  }, [filteredHistory])

  const handleDeleteHistoryItem = async (historyItemId: string) => {
    try {
      await deleteHistoryItemMutation.mutateAsync(historyItemId)
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
    if (
      !window.confirm(
        "Are you sure you want to delete all history? This action cannot be undone.",
      )
    ) {
      return
    }

    try {
      await deleteAllHistoryMutation.mutateAsync()
      toast.success("All history deleted")
      setSelectedHistoryItem(null)
      setViewMode("list")
    } catch (error) {
      toast.error("Failed to delete history")
    }
  }

  const handleSelectHistoryItem = (historyItemId: string) => {
    setSelectedHistoryItem(historyItemId)
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
                        {items.map((historyItem) => (
                          <HistoryCard
                            key={historyItem.id}
                            conversation={historyItem}
                            isSelected={false}
                            onSelect={() =>
                              handleSelectHistoryItem(historyItem.id)
                            }
                            onDelete={() =>
                              handleDeleteHistoryItem(historyItem.id)
                            }
                            onContinue={() =>
                              handleContinueConversation(historyItem.id)
                            }
                            isDeleting={deleteHistoryItemMutation.isPending}
                          />
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
                {selectedHistoryItemQuery.data?.title || "History Item"}
              </span>
            </div>

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
          </header>

          <div className="flex-1 overflow-hidden bg-muted/30">
            {selectedHistoryItemQuery.isError ? (
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
            ) : selectedHistoryItem && selectedHistoryItemQuery.data && Array.isArray(selectedHistoryItemQuery.data.messages) ? (
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
            ) : selectedHistoryItem && selectedHistoryItemQuery.data && !Array.isArray(selectedHistoryItemQuery.data.messages) ? (
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
