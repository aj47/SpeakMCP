import React, { useState } from "react"
import { Button } from "@renderer/components/ui/button"
import { Textarea } from "@renderer/components/ui/textarea"
import { Card, CardContent } from "@renderer/components/ui/card"
import { MessageCircle, Send, X } from "lucide-react"
import { cn } from "@renderer/lib/utils"
import {
  useConversation,
  useConversationActions,
  useConversationState,
} from "@renderer/contexts/conversation-context"
import { AgentProgress } from "@renderer/components/agent-progress"

interface ContinueConversationProps {
  onSubmit: (message: string) => void
  isProcessing?: boolean
  className?: string
}

export function ContinueConversation({
  onSubmit,
  isProcessing = false,
  className,
}: ContinueConversationProps) {
  const [message, setMessage] = useState("")
  const [isExpanded, setIsExpanded] = useState(false)
  const { showContinueButton, agentProgress, isAgentProcessing } =
    useConversationState()
  const { setShowContinueButton, setIsWaitingForResponse } =
    useConversationActions()

  if (!showContinueButton) {
    return null
  }

  const handleSubmit = () => {
    if (message.trim() && !isProcessing) {
      onSubmit(message.trim())
      setMessage("")
      setIsExpanded(false)
      setShowContinueButton(false)
      setIsWaitingForResponse(true)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === "Escape") {
      e.preventDefault()
      setIsExpanded(false)
      setMessage("")
    }
  }

  const handleCancel = () => {
    setIsExpanded(false)
    setMessage("")
  }

  if (!isExpanded) {
    return (
      <div className={cn("flex justify-center", className)}>
        <Button
          onClick={() => setIsExpanded(true)}
          variant="default"
          size="sm"
          className="liquid-glass-interactive glass-border glass-shine gap-2"
          disabled={isProcessing}
        >
          <MessageCircle className="h-4 w-4" />
          Continue Conversation
        </Button>
      </div>
    )
  }

  return (
    <Card className={cn("liquid-glass-strong glass-border", className)}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div className="glass-text-strong flex items-center gap-2 text-sm">
            <MessageCircle className="h-4 w-4" />
            Continue the conversation
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCancel}
            className="glass-text-muted hover:glass-text-strong h-6 w-6 p-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-2">
          {/* Show agent progress if processing */}
          {isAgentProcessing && agentProgress ? (
            <div className="flex min-h-[200px] items-center justify-center">
              <AgentProgress
                progress={agentProgress}
                variant="default"
                className="w-full"
              />
            </div>
          ) : (
            <>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your follow-up message..."
                className={cn(
                  "liquid-glass-input glass-text-strong min-h-[80px] resize-none border-0",
                  "bg-transparent focus:border-ring focus:ring-1 focus:ring-ring",
                  "placeholder:glass-text-muted",
                )}
                disabled={isProcessing}
                autoFocus
              />

              <div className="flex items-center justify-between">
                <div className="glass-text-muted text-xs">
                  Enter to send • Shift+Enter for new line • Esc to cancel
                </div>

                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCancel}
                    disabled={isProcessing}
                    className="glass-text-muted hover:glass-text-strong"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSubmit}
                    size="sm"
                    disabled={!message.trim() || isProcessing}
                    className="liquid-glass-interactive glass-border glass-shine gap-2"
                  >
                    <Send className="h-4 w-4" />
                    Send
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// Compact version for smaller spaces
export function ContinueConversationCompact({
  onSubmit,
  isProcessing = false,
  className,
}: ContinueConversationProps) {
  const [message, setMessage] = useState("")
  const { showContinueButton, agentProgress, isAgentProcessing } =
    useConversationState()
  const { setShowContinueButton, setIsWaitingForResponse } =
    useConversationActions()

  if (!showContinueButton) {
    return null
  }

  const handleSubmit = () => {
    if (message.trim() && !isProcessing) {
      onSubmit(message.trim())
      setMessage("")
      setShowContinueButton(false)
      setIsWaitingForResponse(true)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  // Show agent progress if processing
  if (isAgentProcessing && agentProgress) {
    return (
      <div
        className={cn(
          "liquid-glass-subtle flex min-h-[120px] items-center justify-center rounded-lg",
          className,
        )}
      >
        <AgentProgress
          progress={agentProgress}
          variant="overlay"
          className="mx-4 w-full"
        />
      </div>
    )
  }

  return (
    <div className={cn("flex items-end gap-2", className)}>
      <div className="flex-1">
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Continue conversation..."
          className={cn(
            "liquid-glass-input glass-text-strong min-h-[40px] resize-none border-0",
            "bg-transparent focus:border-ring focus:ring-1 focus:ring-ring",
            "placeholder:glass-text-muted",
          )}
          disabled={isProcessing}
          rows={1}
        />
      </div>
      <Button
        onClick={handleSubmit}
        size="sm"
        disabled={!message.trim() || isProcessing}
        className="liquid-glass-interactive glass-border glass-shine"
      >
        <Send className="h-4 w-4" />
      </Button>
    </div>
  )
}

// Hook for managing continue conversation state
export function useContinueConversation() {
  const { showContinueButton, isWaitingForResponse } = useConversationState()
  const { setShowContinueButton, setIsWaitingForResponse } =
    useConversationActions()

  return {
    showContinueButton,
    isWaitingForResponse,
    hideContinueButton: () => setShowContinueButton(false),
    showContinueButtonAgain: () => setShowContinueButton(true),
    setWaitingForResponse: setIsWaitingForResponse,
  }
}
