import React, { useState, useRef, useEffect } from "react"
import { Textarea } from "@renderer/components/ui/textarea"
import { cn } from "@renderer/lib/utils"
import { AgentProgress } from "./agent-progress"
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
      <div className="flex h-full w-full items-center justify-center liquid-glass-strong rounded-xl glass-text-strong">
        {agentProgress ? (
          <div className="w-full mx-4">
            <AgentProgress progress={agentProgress} variant="overlay" />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent"></div>
            <span className="text-sm">Processing...</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full w-full flex-col liquid-glass-strong rounded-xl glass-text-strong p-3 gap-3">
      <div className="flex-1 flex flex-col gap-2">
        <div className="text-xs glass-text-muted">
          Type your message • Enter to send • Shift+Enter for new line • Esc to cancel
        </div>
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your message here..."
          className={cn(
            "flex-1 min-h-0 resize-none liquid-glass-input glass-text-strong border-0",
            "focus:border-ring focus:ring-1 focus:ring-ring bg-transparent",
            "placeholder:glass-text-muted"
          )}
          disabled={isProcessing}
          aria-label="Message input"
        />
      </div>

      <div className="flex justify-between items-center text-xs glass-text-muted">
        <div>
          {text.length > 0 && (
            <span>{text.length} character{text.length !== 1 ? 's' : ''}</span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={isProcessing}
            className="px-2 py-1 rounded hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!text.trim() || isProcessing}
            className={cn(
              "px-2 py-1 rounded transition-colors",
              text.trim() && !isProcessing
                ? "bg-blue-500/20 hover:bg-blue-500/30 text-blue-300"
                : "opacity-50 cursor-not-allowed"
            )}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
