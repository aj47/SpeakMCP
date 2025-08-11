import React, { useState, useRef, useEffect } from "react"
import { Textarea } from "@renderer/components/ui/textarea"
import { cn } from "@renderer/lib/utils"
import { AgentProcessingView } from "./agent-processing-view"
import { AgentProgressUpdate } from "../../../shared/types"

interface TextInputPanelProps {
  onSubmit: (text: string) => void
  onCancel: () => void
  isProcessing?: boolean
  agentProgress?: AgentProgressUpdate | null
}

export function TextInputPanel({
  onSubmit,
  onCancel,
  isProcessing = false,
  agentProgress,
}: TextInputPanelProps) {
  const [text, setText] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-focus when component mounts
  useEffect(() => {
    if (textareaRef.current) {
      // Small delay to ensure component is fully rendered
      setTimeout(() => {
        textareaRef.current?.focus()
      }, 100)
    }
  }, [])

  const handleSubmit = () => {
    if (text.trim() && !isProcessing) {
      onSubmit(text.trim())
      setText("")
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === "Escape") {
      e.preventDefault()
      onCancel()
    }
    // Shift+Enter allows new lines (default textarea behavior)
  }

  if (isProcessing) {
    return (
      <div className="liquid-glass-strong glass-text-strong flex h-full w-full items-center justify-center rounded-xl">
        {agentProgress ? (
          <AgentProcessingView
            agentProgress={agentProgress}
            isProcessing={isProcessing}
            variant="overlay"
            showBackgroundSpinner={true}
            className="mx-4 w-full"
          />
        ) : (
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
            <span className="text-sm">Processing...</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="liquid-glass-strong glass-text-strong flex h-full w-full flex-col gap-3 rounded-xl p-3">
      {/* Show agent progress if available */}
      {isProcessing && agentProgress ? (
        <AgentProcessingView
          agentProgress={agentProgress}
          isProcessing={isProcessing}
          variant="default"
          showBackgroundSpinner={true}
          className="flex-1"
        />
      ) : (
        <div className="flex flex-1 flex-col gap-2">
          <div className="glass-text-muted text-xs">
            Type your message • Enter to send • Shift+Enter for new line • Esc
            to cancel
          </div>
          <Textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message here..."
            className={cn(
              "liquid-glass-input glass-text-strong min-h-0 flex-1 resize-none border-0",
              "bg-transparent focus:border-ring focus:ring-1 focus:ring-ring",
              "placeholder:glass-text-muted",
            )}
            disabled={isProcessing}
            aria-label="Message input"
          />
        </div>
      )}

      <div className="glass-text-muted flex items-center justify-between text-xs">
        <div>
          {text.length > 0 && (
            <span>
              {text.length} character{text.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={isProcessing}
            className="rounded px-2 py-1 transition-colors hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!text.trim() || isProcessing}
            className={cn(
              "rounded px-2 py-1 transition-colors",
              text.trim() && !isProcessing
                ? "bg-blue-500/20 text-blue-300 hover:bg-blue-500/30"
                : "cursor-not-allowed opacity-50",
            )}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
