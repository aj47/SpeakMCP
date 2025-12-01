import React, { useState, useRef } from "react"
import { cn } from "@renderer/lib/utils"
import { Button } from "@renderer/components/ui/button"
import { Send } from "lucide-react"
import { useMutation } from "@tanstack/react-query"
import { tipcClient } from "@renderer/lib/tipc-client"

interface TileFollowUpInputProps {
  sessionId: string
  conversationId?: string
  isSessionActive?: boolean
  className?: string
  /** Called when a message is successfully sent */
  onMessageSent?: () => void
}

/**
 * Compact text input for continuing a conversation within a session tile.
 */
export function TileFollowUpInput({
  sessionId,
  conversationId,
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
        // Start snoozed since we're in tile view (main window) - don't show panel
        await tipcClient.createMcpTextInput({ text: message, startSnoozed: true })
      } else {
        // Continue the existing conversation
        // Start snoozed since we're in tile view (main window) - don't show panel
        await tipcClient.createMcpTextInput({
          text: message,
          conversationId,
          startSnoozed: true,
        })
      }
    },
    onSuccess: () => {
      setText("")
      onMessageSent?.()
    },
  })

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault()
    const trimmed = text.trim()
    if (trimmed && !sendMutation.isPending && !isSessionActive) {
      sendMutation.mutate(trimmed)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  // Don't allow input while session is still active (agent is processing)
  const isDisabled = sendMutation.isPending || isSessionActive

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
        placeholder={isSessionActive ? "Waiting for agent..." : "Continue conversation..."}
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
    </form>
  )
}

