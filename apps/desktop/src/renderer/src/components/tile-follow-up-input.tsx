import React, { useState, useRef } from "react"
import { cn } from "@renderer/lib/utils"
import { Button } from "@renderer/components/ui/button"
import { Send, Mic, ListPlus } from "lucide-react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useConfigQuery } from "@renderer/lib/queries"

interface TileFollowUpInputProps {
  conversationId?: string
  sessionId?: string
  isSessionActive?: boolean
  className?: string
  /** Called when a message is successfully sent */
  onMessageSent?: () => void
  /** Called when a message is queued */
  onMessageQueued?: () => void
}

/**
 * Compact text input for continuing a conversation within a session tile.
 * When session is active and message queue is enabled, messages are queued instead of blocked.
 */
export function TileFollowUpInput({
  conversationId,
  sessionId,
  isSessionActive = false,
  className,
  onMessageSent,
  onMessageQueued,
}: TileFollowUpInputProps) {
  const [text, setText] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const configQuery = useConfigQuery()
  const isQueueEnabled = configQuery.data?.mcpMessageQueueEnabled ?? true

  const sendMutation = useMutation({
    mutationFn: async (message: string) => {
      if (!conversationId) {
        // Start a new conversation if none exists
        // Mark as fromTile so the floating panel doesn't show - session continues in the tile
        await tipcClient.createMcpTextInput({ text: message, fromTile: true })
      } else {
        // Continue the existing conversation
        // Mark as fromTile so the floating panel doesn't show - session continues in the tile
        await tipcClient.createMcpTextInput({
          text: message,
          conversationId,
          fromTile: true,
        })
      }
    },
    onSuccess: () => {
      setText("")
      onMessageSent?.()
    },
  })

  const queueMutation = useMutation({
    mutationFn: async (message: string) => {
      if (!conversationId) {
        throw new Error("Cannot queue message without a conversation")
      }
      await tipcClient.queueMessage({ conversationId, text: message })
    },
    onSuccess: () => {
      setText("")
      // Invalidate the message queue query to refresh the UI
      queryClient.invalidateQueries({ queryKey: ["messageQueue", conversationId] })
      onMessageQueued?.()
    },
  })

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || sendMutation.isPending || queueMutation.isPending) return

    if (isSessionActive && isQueueEnabled && conversationId) {
      // Queue the message when session is active
      queueMutation.mutate(trimmed)
    } else if (!isSessionActive) {
      // Send directly when session is not active
      sendMutation.mutate(trimmed)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleVoiceClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    // Pass conversationId and sessionId directly through IPC to continue in the same session
    // This is more reliable than using Zustand store which has timing issues
    // Don't pass fake "pending-*" sessionIds - let the backend find the real session by conversationId
    // Mark as fromTile so the floating panel doesn't show - session continues in the tile
    const realSessionId = sessionId?.startsWith('pending-') ? undefined : sessionId
    await tipcClient.triggerMcpRecording({ conversationId, sessionId: realSessionId, fromTile: true })
  }

  const isPending = sendMutation.isPending || queueMutation.isPending
  // Allow input when queue is enabled, even if session is active
  const isDisabled = isPending || (isSessionActive && (!isQueueEnabled || !conversationId))
  const willQueue = isSessionActive && isQueueEnabled && conversationId

  const getPlaceholder = () => {
    if (isSessionActive) {
      if (isQueueEnabled && conversationId) {
        return "Type to queue message..."
      }
      return "Waiting for agent..."
    }
    return "Continue conversation..."
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 border-t bg-muted/20",
        willQueue && "bg-amber-50/30 dark:bg-amber-950/20",
        className
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={getPlaceholder()}
        className={cn(
          "flex-1 text-sm bg-transparent border-0 outline-none",
          "placeholder:text-muted-foreground/60",
          "focus:ring-0"
        )}
        disabled={isDisabled}
      />
      <Button
        type="submit"
        size="icon"
        variant="ghost"
        className={cn(
          "h-6 w-6 flex-shrink-0",
          willQueue && "text-amber-600 dark:text-amber-400"
        )}
        disabled={!text.trim() || isDisabled}
        title={willQueue ? "Queue message" : "Send follow-up message"}
      >
        {willQueue ? (
          <ListPlus className={cn(
            "h-3 w-3",
            queueMutation.isPending && "animate-pulse"
          )} />
        ) : (
          <Send className={cn(
            "h-3 w-3",
            sendMutation.isPending && "animate-pulse"
          )} />
        )}
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className={cn(
          "h-6 w-6 flex-shrink-0",
          "hover:bg-red-100 dark:hover:bg-red-900/30",
          "hover:text-red-600 dark:hover:text-red-400"
        )}
        disabled={isDisabled}
        onClick={handleVoiceClick}
        title="Continue with voice"
      >
        <Mic className="h-3 w-3" />
      </Button>
    </form>
  )
}

