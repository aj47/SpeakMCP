import React, { useState, useRef } from "react"
import { cn } from "@renderer/lib/utils"
import { Button } from "@renderer/components/ui/button"
import { Send, Mic } from "lucide-react"
import { useMutation } from "@tanstack/react-query"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useConversationStore } from "@renderer/stores"

interface OverlayFollowUpInputProps {
  conversationId?: string
  isSessionActive?: boolean
  className?: string
  /** Called when a message is successfully sent */
  onMessageSent?: () => void
}

/**
 * Input component for continuing a conversation in the floating overlay panel.
 * Includes text input, submit button, and voice button for multiple input modalities.
 */
export function OverlayFollowUpInput({
  conversationId,
  isSessionActive = false,
  className,
  onMessageSent,
}: OverlayFollowUpInputProps) {
  const [text, setText] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const { continueConversation } = useConversationStore()

  const sendMutation = useMutation({
    mutationFn: async (message: string) => {
      if (!conversationId) {
        // Start a new conversation if none exists
        await tipcClient.createMcpTextInput({ text: message })
      } else {
        // Continue the existing conversation
        await tipcClient.createMcpTextInput({
          text: message,
          conversationId,
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

  const handleVoiceClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    // Set conversation context before triggering recording so voice follows up in the same thread
    if (conversationId) {
      continueConversation(conversationId)
    }
    // Trigger MCP recording - this will show the panel and start recording
    await tipcClient.triggerMcpRecording({})
  }

  // Don't allow input while session is still active (agent is processing)
  const isDisabled = sendMutation.isPending || isSessionActive

  return (
    <form 
      onSubmit={handleSubmit}
      className={cn(
        "flex items-center gap-2 px-3 py-2 border-t bg-muted/30 backdrop-blur-sm",
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
        className="h-7 w-7 flex-shrink-0"
        disabled={!text.trim() || isDisabled}
        title="Send message"
      >
        <Send className={cn(
          "h-3.5 w-3.5",
          sendMutation.isPending && "animate-pulse"
        )} />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className={cn(
          "h-7 w-7 flex-shrink-0",
          "hover:bg-red-100 dark:hover:bg-red-900/30",
          "hover:text-red-600 dark:hover:text-red-400"
        )}
        disabled={isDisabled}
        onClick={handleVoiceClick}
        title="Continue with voice"
      >
        <Mic className="h-3.5 w-3.5" />
      </Button>
    </form>
  )
}

