import React, { useState, useRef, useEffect } from "react"
import { cn } from "@renderer/lib/utils"
import { Textarea } from "@renderer/components/ui/textarea"
import { Button } from "@renderer/components/ui/button"
import { Mic, Send, X, Square } from "lucide-react"

interface SessionInputProps {
  onSubmit: (text: string) => void
  onVoiceStart?: () => void
  onVoiceStop?: () => void
  isRecording?: boolean
  isProcessing?: boolean
  placeholder?: string
  className?: string
}

export function SessionInput({
  onSubmit,
  onVoiceStart,
  onVoiceStop,
  isRecording = false,
  isProcessing = false,
  placeholder = "Type your message...",
  className,
}: SessionInputProps) {
  const [text, setText] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-focus on mount
  useEffect(() => {
    if (textareaRef.current && !isProcessing && !isRecording) {
      textareaRef.current.focus()
    }
  }, [isProcessing, isRecording])

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
      setText("")
    }
  }

  const handleVoiceClick = () => {
    if (isRecording) {
      onVoiceStop?.()
    } else {
      onVoiceStart?.()
    }
  }

  // Recording UI
  if (isRecording) {
    return (
      <div className={cn("flex items-center gap-3 rounded-lg border bg-background p-3", className)}>
        {/* Recording indicator */}
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 animate-pulse rounded-full bg-red-500" />
          <span className="text-sm text-muted-foreground">Recording...</span>
        </div>

        {/* Waveform placeholder */}
        <div className="flex flex-1 items-center justify-center gap-1">
          {[...Array(12)].map((_, i) => (
            <div
              key={i}
              className="w-1 animate-pulse rounded-full bg-primary/40"
              style={{
                height: `${Math.random() * 16 + 8}px`,
                animationDelay: `${i * 0.1}s`,
              }}
            />
          ))}
        </div>

        {/* Cancel and Submit buttons */}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onVoiceStop?.()} title="Cancel">
            <X className="h-4 w-4" />
          </Button>
          <Button size="sm" onClick={() => onVoiceStop?.()} title="Submit recording">
            <Square className="h-4 w-4" />
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className={cn("flex items-end gap-2 rounded-lg border bg-background p-2", className)}>
      <Textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="min-h-[40px] max-h-[120px] flex-1 resize-none border-0 bg-transparent p-2 focus-visible:ring-0"
        disabled={isProcessing}
        rows={1}
      />
      <div className="flex items-center gap-1 pb-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleVoiceClick}
          disabled={isProcessing}
          title="Start voice recording"
        >
          <Mic className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          onClick={handleSubmit}
          disabled={!text.trim() || isProcessing}
          title="Send message (Enter)"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

