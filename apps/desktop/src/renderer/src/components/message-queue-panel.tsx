import React, { useState, useEffect } from "react"
import { cn } from "@renderer/lib/utils"
import { X, Clock, Trash2, Pencil, Check, ChevronDown, ChevronUp, AlertCircle, RefreshCw, Loader2, Play, Pause } from "lucide-react"
import { Button } from "@renderer/components/ui/button"
import { QueuedMessage } from "@shared/types"
import { useMutation } from "@tanstack/react-query"
import { tipcClient } from "@renderer/lib/tipc-client"

interface MessageQueuePanelProps {
  conversationId: string
  messages: QueuedMessage[]
  className?: string
  compact?: boolean
  isPaused?: boolean
}

/**
 * Individual message item with expand/edit capabilities
 */
function QueuedMessageItem({
  message,
  conversationId,
}: {
  message: QueuedMessage
  conversationId: string
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editText, setEditText] = useState(message.text)

  // Sync editText with message.text when it changes via IPC (only when not editing)
  useEffect(() => {
    if (!isEditing) {
      setEditText(message.text)
    }
  }, [message.text, isEditing])

  // Exit edit mode when the message starts processing to prevent editing text that no longer matches what's being processed
  useEffect(() => {
    if (message.status === 'processing') {
      setIsEditing(false)
      setEditText(message.text)
    }
  }, [message.status, message.text])

  const removeMutation = useMutation({
    mutationFn: async () => {
      await tipcClient.removeFromMessageQueue({ conversationId, messageId: message.id })
    },
  })

  const updateMutation = useMutation({
    mutationFn: async (newText: string) => {
      const success = await tipcClient.updateQueuedMessageText({
        conversationId,
        messageId: message.id,
        text: newText,
      })
      // Throw if backend rejected the update (e.g., message is processing or already added to history)
      if (!success) {
        throw new Error("Failed to update message")
      }
      return success
    },
    onSuccess: () => {
      setIsEditing(false)
    },
    onError: () => {
      // Restore original text on failure
      setEditText(message.text)
    },
  })

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }

  const handleSaveEdit = () => {
    const trimmed = editText.trim()
    if (trimmed && trimmed !== message.text) {
      updateMutation.mutate(trimmed)
    } else {
      setIsEditing(false)
      setEditText(message.text)
    }
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setEditText(message.text)
  }

  const isLongMessage = message.text.length > 100
  const isFailed = message.status === "failed"
  const isProcessing = message.status === "processing"
  const isAddedToHistory = message.addedToHistory === true

  // Mutation to retry a failed message by resetting its status to pending
  const retryMutation = useMutation({
    mutationFn: async () => {
      // Retry the failed message - resets status to pending and triggers queue processing if idle
      await tipcClient.retryQueuedMessage({
        conversationId,
        messageId: message.id,
      })
    },
  })

  return (
    <div
      className={cn(
        "px-3 py-2 group",
        isFailed ? "bg-destructive/10 hover:bg-destructive/15" :
        isProcessing ? "bg-amber-100/50 dark:bg-amber-900/20" : "hover:bg-amber-100/30 dark:hover:bg-amber-900/10",
        "transition-colors"
      )}
    >
      {isEditing ? (
        // Edit mode
        <div className="space-y-2">
          <textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            className="w-full min-h-[60px] p-2 text-sm rounded border bg-background resize-y"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                handleCancelEdit()
              } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                handleSaveEdit()
              }
            }}
          />
          <div className="flex items-center gap-2 justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={handleCancelEdit}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              className="h-6 text-xs"
              onClick={handleSaveEdit}
              disabled={updateMutation.isPending || !editText.trim()}
            >
              <Check className="h-3 w-3 mr-1" />
              Save
            </Button>
          </div>
        </div>
      ) : (
        // View mode
        <div className="flex items-start gap-2">
          {isFailed && (
            <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
          )}
          {isProcessing && (
            <Loader2 className="h-4 w-4 text-primary flex-shrink-0 mt-0.5 animate-spin" />
          )}
          <div className="flex-1 min-w-0">
            <p
              className={cn(
                "text-sm",
                isFailed && "text-destructive",
                isProcessing && "text-primary",
                !isExpanded && isLongMessage && "line-clamp-2"
              )}
            >
              {message.text}
            </p>
            {isFailed && message.errorMessage && (
              <p className="text-xs text-destructive/80 mt-1">
                Error: {message.errorMessage}
              </p>
            )}
            <div className="flex items-center gap-2 mt-1">
              <span className={cn(
                "text-xs",
                isFailed ? "text-destructive/70" :
                isProcessing ? "text-amber-600 dark:text-amber-400" : "text-amber-600/70 dark:text-amber-400/70"
              )}>
                {formatTime(message.createdAt)} • {isFailed ? "Failed - blocking queue" : isProcessing ? "Processing..." : "Queued"}
              </span>
              {isLongMessage && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-4 px-1 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setIsExpanded(!isExpanded)}
                >
                  {isExpanded ? (
                    <>
                      <ChevronUp className="h-3 w-3 mr-0.5" />
                      Less
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3 w-3 mr-0.5" />
                      More
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
          {/* Hide action buttons when processing */}
          {!isProcessing && (
            <div className={cn(
              "flex items-center gap-1 flex-shrink-0 transition-opacity",
              isFailed ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            )}>
              {isFailed && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => retryMutation.mutate()}
                  disabled={retryMutation.isPending}
                  title="Retry message"
                >
                  <RefreshCw className={cn("h-3 w-3", retryMutation.isPending && "animate-spin")} />
                </Button>
              )}
              {/* Disable edit for messages already added to conversation history to prevent inconsistency */}
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setIsEditing(true)}
                disabled={isAddedToHistory}
                title={isAddedToHistory ? "Cannot edit - already added to conversation" : "Edit message"}
              >
                <Pencil className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => removeMutation.mutate()}
                disabled={removeMutation.isPending}
                title="Remove from queue"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Panel component for displaying and managing queued messages.
 * Shows pending messages with options to view full text, edit, and remove them.
 * When queue is paused (e.g., after kill switch), shows a play button to resume.
 */
export function MessageQueuePanel({
  conversationId,
  messages,
  className,
  compact = false,
  isPaused = false,
}: MessageQueuePanelProps) {
  const [isListCollapsed, setIsListCollapsed] = useState(false)
  const messageListId = `message-queue-list-${conversationId}`

  // Reset collapse state when switching to a different conversation.
  useEffect(() => {
    setIsListCollapsed(false)
  }, [conversationId])

  const clearMutation = useMutation({
    mutationFn: async () => {
      await tipcClient.clearMessageQueue({ conversationId })
    },
  })

  const resumeMutation = useMutation({
    mutationFn: async () => {
      await tipcClient.resumeMessageQueue({ conversationId })
    },
  })

  // Check if any message is currently being processed
  // Disable Clear All when processing to prevent confusing UX where user thinks
  // they cancelled a running prompt while it actually continues running
  const hasProcessingMessage = messages.some((m) => m.status === "processing")

  if (messages.length === 0) {
    return null
  }

  if (compact) {
    return (
      <div className={cn(
        "flex items-center gap-2 px-2 py-1.5 text-xs rounded-md",
        isPaused
          ? "bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800"
          : "bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800",
        className
      )}>
        {isPaused ? (
          <Pause className="h-3 w-3 text-orange-600 dark:text-orange-400" />
        ) : (
          <Clock className="h-3 w-3 text-amber-600 dark:text-amber-400" />
        )}
        <span className={cn(
          isPaused ? "text-orange-700 dark:text-orange-300" : "text-amber-700 dark:text-amber-300"
        )}>
          {messages.length} queued{isPaused ? " (paused)" : ""}
        </span>
        {isPaused && (
          <Button
            variant="ghost"
            size="icon"
            className="h-4 w-4 text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-200 hover:bg-green-100 dark:hover:bg-green-900/30"
            onClick={() => resumeMutation.mutate()}
            disabled={resumeMutation.isPending}
            title="Resume queue execution"
          >
            <Play className="h-3 w-3" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-4 w-4",
            isPaused ? "ml-0" : "ml-auto",
            isPaused
              ? "text-orange-600 dark:text-orange-400 hover:text-orange-800 dark:hover:text-orange-200"
              : "text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200"
          )}
          onClick={() => clearMutation.mutate()}
          disabled={clearMutation.isPending || hasProcessingMessage}
          title={hasProcessingMessage ? "Cannot clear while processing" : "Clear queue"}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "rounded-md border overflow-hidden",
        isPaused
          ? "border-orange-300 dark:border-orange-700 bg-orange-50/50 dark:bg-orange-950/30"
          : "border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/30",
        className
      )}
    >
      {/* Header */}
      <div className={cn(
        "flex items-center justify-between px-3 py-2",
        !isListCollapsed && "border-b",
        isPaused
          ? "border-orange-200 dark:border-orange-800 bg-orange-100/50 dark:bg-orange-900/30"
          : "border-amber-200 dark:border-amber-800 bg-amber-100/50 dark:bg-amber-900/30"
      )}>
        <div className="flex items-center gap-2">
          {isPaused ? (
            <Pause className="h-4 w-4 text-orange-600 dark:text-orange-400" />
          ) : (
            <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          )}
          <span className={cn(
            "text-sm font-medium",
            isPaused ? "text-orange-800 dark:text-orange-200" : "text-amber-800 dark:text-amber-200"
          )}>
            {isPaused ? "Queue Paused" : "Queued Messages"} ({messages.length})
          </span>
        </div>
        <div className="flex items-center gap-1">
          {isPaused && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs text-green-700 dark:text-green-300 hover:text-green-900 dark:hover:text-green-100 hover:bg-green-200/50 dark:hover:bg-green-800/50"
              onClick={() => resumeMutation.mutate()}
              disabled={resumeMutation.isPending}
              title="Resume queue execution"
            >
              <Play className="h-3 w-3 mr-1" />
              Resume
            </Button>
          )}
          {!isListCollapsed && (
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                "h-6 text-xs",
                isPaused
                  ? "text-orange-700 dark:text-orange-300 hover:text-orange-900 dark:hover:text-orange-100 hover:bg-orange-200/50 dark:hover:bg-orange-800/50"
                  : "text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 hover:bg-amber-200/50 dark:hover:bg-amber-800/50"
              )}
              onClick={() => clearMutation.mutate()}
              disabled={clearMutation.isPending || hasProcessingMessage}
              title={hasProcessingMessage ? "Cannot clear while processing" : undefined}
            >
              Clear All
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-6 w-6",
              isPaused
                ? "text-orange-700 dark:text-orange-300 hover:text-orange-900 dark:hover:text-orange-100 hover:bg-orange-200/50 dark:hover:bg-orange-800/50"
                : "text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 hover:bg-amber-200/50 dark:hover:bg-amber-800/50"
            )}
            onClick={() => setIsListCollapsed((prev) => !prev)}
            aria-expanded={!isListCollapsed}
            aria-controls={messageListId}
            aria-label={isListCollapsed ? "Expand queue" : "Collapse queue"}
            title={isListCollapsed ? "Expand queue" : "Collapse queue"}
          >
            {isListCollapsed ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronUp className="h-3 w-3" />
            )}
          </Button>
        </div>
      </div>

      {/* Paused notice */}
      {isPaused && !isListCollapsed && (
        <div className="px-3 py-2 text-xs text-orange-700 dark:text-orange-300 bg-orange-100/30 dark:bg-orange-900/20 border-b border-orange-200 dark:border-orange-800">
          Queue was stopped. Click Resume to continue processing queued messages.
        </div>
      )}

      {/* Message List */}
      {!isListCollapsed && (
        <div id={messageListId} className="divide-y max-h-60 overflow-y-auto">
          {messages.map((msg) => (
            <QueuedMessageItem
              key={msg.id}
              message={msg}
              conversationId={conversationId}
            />
          ))}
        </div>
      )}
    </div>
  )
}
