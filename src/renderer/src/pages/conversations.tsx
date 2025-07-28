import React, { useState, useMemo } from "react"
import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@renderer/components/ui/card"
import { Badge } from "@renderer/components/ui/badge"
import { ScrollArea } from "@renderer/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
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
  ArrowLeft
} from "lucide-react"
import { cn } from "@renderer/lib/utils"
import {
  useConversationHistoryQuery,
  useDeleteConversationMutation,
  useDeleteAllConversationsMutation,
  useConversationQuery
} from "@renderer/lib/query-client"
import { useConversationActions } from "@renderer/contexts/conversation-context"
import { ConversationDisplay } from "@renderer/components/conversation-display"
import { ConversationHistoryItem } from "@shared/types"
import dayjs from "dayjs"
import { toast } from "sonner"

export function Component() {
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'list' | 'detail'>('list')

  const conversationHistoryQuery = useConversationHistoryQuery()
  const deleteConversationMutation = useDeleteConversationMutation()
  const deleteAllConversationsMutation = useDeleteAllConversationsMutation()
  const selectedConversationQuery = useConversationQuery(selectedConversation)

  const { continueConversation } = useConversationActions()

  const filteredConversations = useMemo(() => {
    if (!conversationHistoryQuery.data) return []

    return conversationHistoryQuery.data.filter(conversation =>
      conversation.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      conversation.preview.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [conversationHistoryQuery.data, searchQuery])

  const groupedConversations = useMemo(() => {
    const groups = new Map<string, ConversationHistoryItem[]>()
    const today = dayjs().format("YYYY-MM-DD")
    const yesterday = dayjs().subtract(1, "day").format("YYYY-MM-DD")

    for (const conversation of filteredConversations) {
      const date = dayjs(conversation.updatedAt).format("YYYY-MM-DD")
      let groupKey: string

      if (date === today) {
        groupKey = "Today"
      } else if (date === yesterday) {
        groupKey = "Yesterday"
      } else {
        groupKey = dayjs(conversation.updatedAt).format("MMM D, YYYY")
      }

      const items = groups.get(groupKey) || []
      items.push(conversation)
      groups.set(groupKey, items)
    }

    return Array.from(groups.entries()).map(([date, items]) => ({
      date,
      items: items.sort((a, b) => b.updatedAt - a.updatedAt)
    }))
  }, [filteredConversations])

  const handleDeleteConversation = async (conversationId: string) => {
    try {
      await deleteConversationMutation.mutateAsync(conversationId)
      toast.success("Conversation deleted")
      if (selectedConversation === conversationId) {
        setSelectedConversation(null)
        setViewMode('list')
      }
    } catch (error) {
      toast.error("Failed to delete conversation")
    }
  }

  const handleDeleteAllConversations = async () => {
    if (!window.confirm("Are you sure you want to delete all conversations? This action cannot be undone.")) {
      return
    }

    try {
      await deleteAllConversationsMutation.mutateAsync()
      toast.success("All conversations deleted")
      setSelectedConversation(null)
      setViewMode('list')
    } catch (error) {
      toast.error("Failed to delete conversations")
    }
  }

  const handleSelectConversation = (conversationId: string) => {
    setSelectedConversation(conversationId)
    setViewMode('detail')
  }

  const handleBackToList = () => {
    setViewMode('list')
    setSelectedConversation(null)
  }

  const handleContinueConversation = (conversationId: string) => {
    continueConversation(conversationId)
    // Navigate to panel or show some indication that conversation is active
    toast.success("Conversation activated. Use Ctrl+T to continue.")
  }

  return (
    <>
      {viewMode === 'list' ? (
        // List View
        <>
          <header className="app-drag-region flex h-12 shrink-0 items-center justify-between bg-background border-b px-4 text-sm">
            <span className="font-bold">Conversations</span>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                className="h-7 gap-1 px-2 py-0 text-red-500 hover:text-red-500"
                onClick={handleDeleteAllConversations}
                disabled={deleteAllConversationsMutation.isPending}
              >
                <Trash2 className="h-4 w-4" />
                <span>Delete All</span>
              </Button>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search conversations..."
                  className="pl-8 w-64"
                />
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-hidden bg-background">
            {groupedConversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <MessageCircle className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">
                  {searchQuery ? "No matching conversations" : "No conversations yet"}
                </h3>
                <p className="text-muted-foreground">
                  {searchQuery
                    ? "Try adjusting your search terms"
                    : "Start a conversation using Ctrl+T or voice recording"
                  }
                </p>
              </div>
            ) : (
              <ScrollArea className="h-full">
                <div className="p-4 space-y-6">
                  {groupedConversations.map(({ date, items }) => (
                    <div key={date}>
                      <h4 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                        <Calendar className="h-4 w-4" />
                        {date}
                      </h4>
                      <div className="space-y-2">
                        {items.map((conversation) => (
                          <ConversationCard
                            key={conversation.id}
                            conversation={conversation}
                            isSelected={false}
                            onSelect={() => handleSelectConversation(conversation.id)}
                            onDelete={() => handleDeleteConversation(conversation.id)}
                            onContinue={() => handleContinueConversation(conversation.id)}
                            isDeleting={deleteConversationMutation.isPending}
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
          <header className="app-drag-region flex h-12 shrink-0 items-center justify-between bg-background border-b px-4 text-sm">
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
                {selectedConversationQuery.data?.title || "Conversation"}
              </span>
            </div>

            <Button
              onClick={() => selectedConversation && handleContinueConversation(selectedConversation)}
              className="gap-2 h-7 px-3 py-0"
              disabled={!selectedConversation}
            >
              <MessageCircle className="h-4 w-4" />
              Continue
            </Button>
          </header>

          <div className="flex-1 overflow-hidden bg-muted/30">
            {selectedConversation && selectedConversationQuery.data ? (
              <div className="h-full flex flex-col">
                <div className="border-b bg-background p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold">
                        {selectedConversationQuery.data.title}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {selectedConversationQuery.data.messages.length} messages •
                        Last updated {dayjs(selectedConversationQuery.data.updatedAt).format("MMM D, YYYY h:mm A")}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex-1 overflow-hidden p-4">
                  <ConversationDisplay
                    messages={selectedConversationQuery.data.messages}
                    maxHeight="100%"
                    className="h-full"
                  />
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-center p-8">
                <div>
                  <Eye className="h-12 w-12 text-muted-foreground mb-4 mx-auto" />
                  <h3 className="text-lg font-semibold mb-2">Loading conversation...</h3>
                  <p className="text-muted-foreground">
                    Please wait while we load the conversation details
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

interface ConversationCardProps {
  conversation: ConversationHistoryItem
  isSelected: boolean
  onSelect: () => void
  onDelete: () => void
  onContinue: () => void
  isDeleting: boolean
}

function ConversationCard({
  conversation,
  isSelected,
  onSelect,
  onDelete,
  onContinue,
  isDeleting
}: ConversationCardProps) {
  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover:shadow-md",
        isSelected && "ring-2 ring-primary"
      )}
      onClick={onSelect}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-medium truncate mb-1">
              {conversation.title}
            </h3>
            <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
              {conversation.preview}
            </p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="secondary" className="text-xs">
                {conversation.messageCount} messages
              </Badge>
              <span>•</span>
              <span>{dayjs(conversation.updatedAt).format("MMM D, h:mm A")}</span>
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
              title="Delete conversation"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
