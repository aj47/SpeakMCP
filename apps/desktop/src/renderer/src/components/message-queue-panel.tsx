import React from "react"
import { cn } from "@renderer/lib/utils"
import { Button } from "@renderer/components/ui/button"
import { X, ListOrdered, Trash2 } from "lucide-react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { tipcClient } from "@renderer/lib/tipc-client"
import type { QueuedMessage } from "@shared/types"

interface MessageQueuePanelProps {
  conversationId: string
  className?: string
}

/**
 * Displays queued messages for a conversation with ability to remove them.
 */
export function MessageQueuePanel({
  conversationId,
  className,
}: MessageQueuePanelProps) {
  const queryClient = useQueryClient()

  const queueQuery = useQuery({
    queryKey: ["messageQueue", conversationId],
    queryFn: async () => {
      return tipcClient.getMessageQueue({ conversationId })
    },
    refetchInterval: 2000, // Poll every 2 seconds to stay in sync
  })

  const removeMutation = useMutation({
    mutationFn: async (messageId: string) => {
      await tipcClient.removeQueuedMessage({ conversationId, messageId })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messageQueue", conversationId] })
    },
  })

  const clearMutation = useMutation({
    mutationFn: async () => {
      await tipcClient.clearMessageQueue({ conversationId })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messageQueue", conversationId] })
    },
  })

  const queuedMessages = queueQuery.data ?? []

  if (queuedMessages.length === 0) {
    return null
  }

  return (
    <div
      className={cn(
        "border-t bg-amber-50/50 dark:bg-amber-950/30",
        className
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-amber-200/50 dark:border-amber-800/50">
        <ListOrdered className="h-3 w-3 text-amber-600 dark:text-amber-400" />
        <span className="flex-1 text-xs font-medium text-amber-700 dark:text-amber-300">
          Queued ({queuedMessages.length})
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-amber-600 dark:text-amber-400 hover:text-red-600 dark:hover:text-red-400"
          onClick={() => clearMutation.mutate()}
          disabled={clearMutation.isPending}
          title="Clear all queued messages"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {/* Queued messages list */}
      <div className="max-h-24 overflow-y-auto">
        {queuedMessages.map((message: QueuedMessage, index: number) => (
          <div
            key={message.id}
            className={cn(
              "flex items-center gap-2 px-2 py-1 text-xs",
              "hover:bg-amber-100/50 dark:hover:bg-amber-900/30",
              index < queuedMessages.length - 1 && "border-b border-amber-200/30 dark:border-amber-800/30"
            )}
          >
            <span className="text-amber-500 dark:text-amber-500 font-mono w-4 text-center">
              {index + 1}
            </span>
            <span className="flex-1 truncate text-amber-800 dark:text-amber-200">
              {message.text}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-4 w-4 text-amber-500 hover:text-red-500"
              onClick={() => removeMutation.mutate(message.id)}
              disabled={removeMutation.isPending}
              title="Remove from queue"
            >
              <X className="h-2.5 w-2.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}

