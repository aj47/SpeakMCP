import React, { useState, useRef } from "react"
import { cn } from "@renderer/lib/utils"
import { Button } from "@renderer/components/ui/button"
import { Send, Mic } from "lucide-react"
import { useMutation } from "@tanstack/react-query"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useConfigQuery } from "@renderer/lib/queries"

interface OverlayFollowUpInputProps {
  conversationId?: string
  sessionId?: string
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
  sessionId,
  isSessionActive = false,
  className,
  onMessageSent,
}: OverlayFollowUpInputProps) {
  const [text, setText] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const configQuery = useConfigQuery()

  // Message queuing is enabled by default, but we need the config to be loaded
  // to know the user's preference. If config is still loading, treat as disabled
  // to prevent race condition where disabled users can briefly submit.
  const isConfigLoaded = configQuery.isSuccess
  const isQueueEnabled = isConfigLoaded ? (configQuery.data?.mcpMessageQueueEnabled ?? true) : false

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
    // Allow submission if:
    // 1. Not already pending
    // 2. Either session is not active OR queue is enabled
    if (trimmed && !sendMutation.isPending && (!isSessionActive || isQueueEnabled)) {
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
    const realSessionId = sessionId?.startsWith('pending-') ? undefined : sessionId
    await tipcClient.triggerMcpRecording({ conversationId, sessionId: realSessionId })
  }

  // When queue is enabled, allow input even when session is active
  // When queue is disabled, don't allow input while session is active
  const isDisabled = sendMutation.isPending || (isSessionActive && !isQueueEnabled)

  // Show appropriate placeholder based on state
  const getPlaceholder = () => {
    if (isSessionActive && isQueueEnabled) {
      return "Queue message..."
    }
    if (isSessionActive) {
      return "Waiting for agent..."
    }
    return "Continue conversation..."
  }

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
        className="h-7 w-7 flex-shrink-0"
        disabled={!text.trim() || isDisabled}
        title={isSessionActive && isQueueEnabled ? "Queue message" : "Send message"}
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

