import React, { useState, useRef } from "react"
import { cn } from "@renderer/lib/utils"
import { Button } from "@renderer/components/ui/button"
import { Send, Mic } from "lucide-react"
import { useMutation } from "@tanstack/react-query"
import { tipcClient } from "@renderer/lib/tipc-client"
import { toast } from "sonner"

interface TileFollowUpInputProps {
  conversationId?: string
  sessionId?: string
  isSessionActive?: boolean
  className?: string
  /** Called when a message is successfully sent */
  onMessageSent?: () => void
}

/**
 * Compact text input for continuing a conversation within a session tile.
 */
export function TileFollowUpInput({
  conversationId,
  sessionId,
  isSessionActive = false,
  className,
  onMessageSent,
}: TileFollowUpInputProps) {
  const [text, setText] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const sendMutation = useMutation({
    mutationFn: async (message: string) => {
      if (!conversationId) {
        // Start a new conversation if none exists
        // Mark as fromTile so the floating panel doesn't show - session continues in the tile
        return await tipcClient.createMcpTextInput({ text: message, fromTile: true })
      } else {
        // Continue the existing conversation
        // Mark as fromTile so the floating panel doesn't show - session continues in the tile
        return await tipcClient.createMcpTextInput({
          text: message,
          conversationId,
          fromTile: true,
        })
      }
    },
    onSuccess: (result) => {
      // Don't clear input if message was blocked due to active session
      if (result && 'blocked' in result && result.blocked) {
        toast.warning("Please wait for the current task to complete")
        return
      }
      setText("")
      onMessageSent?.()
    },
  })

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    const trimmed = text.trim()
    // Allow sending - backend will block if session is already processing
    if (trimmed && !sendMutation.isPending) {
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

  // Allow typing even while session is active - backend blocks duplicate processing
  const isDisabled = sendMutation.isPending

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        "flex items-center gap-2 px-2 py-1.5 border-t bg-muted/20",
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
        placeholder={isSessionActive ? "Processing... type to draft" : "Continue conversation..."}
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
        className="h-6 w-6 flex-shrink-0"
        disabled={!text.trim() || isDisabled}
        title="Send follow-up message"
      >
        <Send className={cn(
          "h-3 w-3",
          sendMutation.isPending && "animate-pulse"
        )} />
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

