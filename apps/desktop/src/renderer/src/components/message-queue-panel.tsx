import React from "react"
import { cn } from "@renderer/lib/utils"
import { X, Clock, Trash2, GripVertical } from "lucide-react"
import { Button } from "@renderer/components/ui/button"
import { QueuedMessage } from "@shared/types"
import { useMutation } from "@tanstack/react-query"
import { tipcClient } from "@renderer/lib/tipc-client"

interface MessageQueuePanelProps {
  conversationId: string
  messages: QueuedMessage[]
  className?: string
  compact?: boolean
}

/**
 * Panel component for displaying and managing queued messages.
 * Shows pending messages with options to remove them.
 */
export function MessageQueuePanel({
  conversationId,
  messages,
  className,
  compact = false,
}: MessageQueuePanelProps) {
  const removeMutation = useMutation({
    mutationFn: async (messageId: string) => {
      await tipcClient.removeFromMessageQueue({ conversationId, messageId })
    },
  })

  const clearMutation = useMutation({
    mutationFn: async () => {
      await tipcClient.clearMessageQueue({ conversationId })
    },
  })

  if (messages.length === 0) {
    return null
  }

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }

  const truncateText = (text: string, maxLength: number) => {
    if (text.length <= maxLength) return text
    return text.slice(0, maxLength) + "..."
  }

  if (compact) {
    return (
      <div className={cn("flex items-center gap-2 px-2 py-1 text-xs", className)}>
        <Clock className="h-3 w-3 text-muted-foreground" />
        <span className="text-muted-foreground">
          {messages.length} queued message{messages.length > 1 ? "s" : ""}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-4 w-4 ml-auto"
          onClick={() => clearMutation.mutate()}
          disabled={clearMutation.isPending}
          title="Clear queue"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "rounded-md border bg-muted/30 overflow-hidden",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">
            Queued Messages ({messages.length})
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs"
          onClick={() => clearMutation.mutate()}
          disabled={clearMutation.isPending}
        >
          Clear All
        </Button>
      </div>

      {/* Message List */}
      <div className="divide-y max-h-40 overflow-y-auto">
        {messages.map((msg, index) => (
          <div
            key={msg.id}
            className={cn(
              "flex items-start gap-2 px-3 py-2 group",
              "hover:bg-muted/50 transition-colors"
            )}
          >
            <GripVertical className="h-4 w-4 mt-0.5 text-muted-foreground/50 opacity-0 group-hover:opacity-100 cursor-grab" />
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">{truncateText(msg.text, 100)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {formatTime(msg.createdAt)} • #{index + 1} in queue
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 flex-shrink-0 opacity-0 group-hover:opacity-100"
              onClick={() => removeMutation.mutate(msg.id)}
              disabled={removeMutation.isPending}
              title="Remove from queue"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}

