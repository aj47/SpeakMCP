import React, { useState, useRef } from "react"
import { cn } from "@renderer/lib/utils"
import { Button } from "@renderer/components/ui/button"
import { Send, Mic, OctagonX } from "lucide-react"
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
  /** Called when stop button is clicked (optional - will call stopAgentSession directly if not provided) */
  onStopSession?: () => void | Promise<void>
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
  onStopSession,
}: OverlayFollowUpInputProps) {
  const [isStoppingSession, setIsStoppingSession] = useState(false)
  const [text, setText] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const configQuery = useConfigQuery()

  // Message queuing is enabled by default. While config is loading, treat as enabled
  // to allow users to type. The backend will handle queuing appropriately.
  const isQueueEnabled = configQuery.data?.mcpMessageQueueEnabled ?? true

  // Make panel focusable when user wants to interact with the input
  // The panel is non-focusable by default in agent mode to avoid stealing focus
  // We pass andFocus=true so the window is also focused, which is required on macOS
  // for windows shown with showInactive() to receive input events
  const handleInputInteraction = async () => {
    try {
      await tipcClient.setPanelFocusable({ focusable: true, andFocus: true })
      // After making focusable and focused, ensure the input has focus
      setTimeout(() => {
        inputRef.current?.focus()
      }, 50)
    } catch (e) {
      // Ignore errors - input might still work
    }
  }

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
    // Make panel focusable and focused first to ensure click events are received
    // This is required on macOS for windows shown with showInactive()
    try {
      await tipcClient.setPanelFocusable({ focusable: true, andFocus: true })
    } catch {
      // Ignore errors - recording might still work
    }
    // Pass conversationId and sessionId directly through IPC to continue in the same session
    // This is more reliable than using Zustand store which has timing issues
    // Don't pass fake "pending-*" sessionIds - let the backend find the real session by conversationId
    const realSessionId = sessionId?.startsWith('pending-') ? undefined : sessionId
    await tipcClient.triggerMcpRecording({ conversationId, sessionId: realSessionId })
  }

  // Handle stop session - kill switch functionality
  const handleStopSession = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isStoppingSession || !sessionId) return

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

    // Don't try to stop fake "pending-*" sessions
    if (sessionId.startsWith('pending-')) return

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
        onClick={handleInputInteraction}
        onFocus={handleInputInteraction}
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
        onMouseDown={handleInputInteraction}
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
        disabled={isVoiceDisabled}
        onMouseDown={handleInputInteraction}
        onClick={handleVoiceClick}
        title={isSessionActive && isQueueEnabled ? "Record voice message (will be queued)" : isSessionActive ? "Voice unavailable while agent is processing" : "Continue with voice"}
      >
        <Mic className="h-3.5 w-3.5" />
      </Button>
      {/* Kill switch - stop agent button (only show when session is active) */}
      {isSessionActive && sessionId && !sessionId.startsWith('pending-') && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className={cn(
            "h-7 w-7 flex-shrink-0",
            "text-red-500 hover:text-red-600",
            "hover:bg-red-100 dark:hover:bg-red-950/30"
          )}
          disabled={isStoppingSession}
          onMouseDown={handleInputInteraction}
          onClick={handleStopSession}
          title="Stop agent execution"
        >
          <OctagonX className={cn(
            "h-3.5 w-3.5",
            isStoppingSession && "animate-pulse"
          )} />
        </Button>
      )}
    </form>
  )
}

