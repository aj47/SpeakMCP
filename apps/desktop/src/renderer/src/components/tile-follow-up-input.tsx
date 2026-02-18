import React, { useState, useRef } from "react"
import { cn } from "@renderer/lib/utils"
import { Button } from "@renderer/components/ui/button"
import { Send, Mic, OctagonX } from "lucide-react"
import { useMutation } from "@tanstack/react-query"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useConfigQuery } from "@renderer/lib/queries"
import { PredefinedPromptsMenu } from "./predefined-prompts-menu"

interface TileFollowUpInputProps {
  conversationId?: string
  sessionId?: string
  isSessionActive?: boolean
  className?: string
  /** Called when a message is successfully sent */
  onMessageSent?: () => void
  /** Called when stop button is clicked (optional - will call stopAgentSession directly if not provided) */
  onStopSession?: () => void | Promise<void>
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
  onStopSession,
}: TileFollowUpInputProps) {
  const [text, setText] = useState("")
  const [isStoppingSession, setIsStoppingSession] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const configQuery = useConfigQuery()

  // Message queuing is enabled by default. While config is loading, treat as enabled
  // to allow users to type. The backend will handle queuing appropriately.
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
    // Mark as fromTile so the floating panel doesn't show - session continues in the tile
    const realSessionId = sessionId?.startsWith('pending-') ? undefined : sessionId
    await tipcClient.triggerMcpRecording({ conversationId, sessionId: realSessionId, fromTile: true })
  }

  // Handle stop session - kill switch functionality
  const handleStopSession = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isStoppingSession) return

    // Use custom handler if provided, otherwise call stopAgentSession directly
    if (onStopSession) {
      setIsStoppingSession(true)
      try {
        await onStopSession()
      } catch (error) {
        console.error("Failed to stop agent session via callback:", error)
      } finally {
        setIsStoppingSession(false)
      }
      return
    }

    // For undefined or fake "pending-*" sessions, fall back to global emergency stop
    // so the kill switch always works regardless of session state
    if (!sessionId || sessionId.startsWith('pending-')) {
      setIsStoppingSession(true)
      try {
        await tipcClient.emergencyStopAgent()
      } catch (error) {
        console.error("Failed to emergency stop agent:", error)
      } finally {
        setIsStoppingSession(false)
      }
      return
    }

    setIsStoppingSession(true)
    try {
      await tipcClient.stopAgentSession({ sessionId })
    } catch (error) {
      console.error("Failed to stop agent session:", error)
    } finally {
      setIsStoppingSession(false)
    }
  }

  // When queue is enabled, allow TEXT input even when session is active
  // When queue is disabled, don't allow input while session is active
  const isDisabled = sendMutation.isPending || (isSessionActive && !isQueueEnabled)

  // When queue is enabled, allow voice recording even when session is active
  // The transcript will be queued after transcription completes
  // When queue is disabled, don't allow voice input while session is active
  const isVoiceDisabled = sendMutation.isPending || (isSessionActive && !isQueueEnabled)

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
        placeholder={getPlaceholder()}
        className={cn(
          "flex-1 text-sm bg-transparent border-0 outline-none",
          "placeholder:text-muted-foreground/60",
          "focus:ring-0"
        )}
        disabled={isDisabled}
      />
      <PredefinedPromptsMenu
        onSelectPrompt={(content) => setText(content)}
        disabled={isDisabled}
        className="h-6 w-6"
      />
      <Button
        type="submit"
        size="icon"
        variant="ghost"
        className="h-6 w-6 flex-shrink-0"
        disabled={!text.trim() || isDisabled}
        title={isSessionActive && isQueueEnabled ? "Queue message" : "Send follow-up message"}
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
        disabled={isVoiceDisabled}
        onClick={handleVoiceClick}
        title={isSessionActive && isQueueEnabled ? "Record voice message (will be queued)" : isSessionActive ? "Voice unavailable while agent is processing" : "Continue with voice"}
      >
        <Mic className="h-3 w-3" />
      </Button>
      {/* Kill switch - stop agent button (only show when session is active) */}
      {isSessionActive && sessionId && !sessionId.startsWith('pending-') && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className={cn(
            "h-6 w-6 flex-shrink-0",
            "text-red-500 hover:text-red-600",
            "hover:bg-red-100 dark:hover:bg-red-950/30"
          )}
          disabled={isStoppingSession}
          onClick={handleStopSession}
          title="Stop agent execution"
        >
          <OctagonX className={cn(
            "h-3 w-3",
            isStoppingSession && "animate-pulse"
          )} />
        </Button>
      )}
    </form>
  )
}

