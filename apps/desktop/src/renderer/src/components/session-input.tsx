import React, { useState, useRef } from "react"
import { cn } from "@renderer/lib/utils"
import { Button } from "@renderer/components/ui/button"
import { Textarea } from "@renderer/components/ui/textarea"
import { Mic, Send, X, Plus } from "lucide-react"
import { tipcClient } from "@renderer/lib/tipc-client"

interface SessionInputProps {
  onTextSubmit: (text: string) => void
  onVoiceStart: () => void
  isRecording?: boolean
  isProcessing?: boolean
  className?: string
  showTextInput?: boolean
  onShowTextInputChange?: (show: boolean) => void
}

export function SessionInput({
  onTextSubmit,
  onVoiceStart,
  isRecording = false,
  isProcessing = false,
  className,
  showTextInput: controlledShowTextInput,
  onShowTextInputChange,
}: SessionInputProps) {
  const [internalShowTextInput, setInternalShowTextInput] = useState(false)

  const showTextInput = controlledShowTextInput ?? internalShowTextInput
  const setShowTextInput = (show: boolean) => {
    setInternalShowTextInput(show)
    onShowTextInputChange?.(show)
  }
  const [text, setText] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = () => {
    if (text.trim() && !isProcessing) {
      onTextSubmit(text.trim())
      setText("")
      setShowTextInput(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === "Escape") {
      e.preventDefault()
      setText("")
      setShowTextInput(false)
    }
  }

  const handleShowTextInput = () => {
    setShowTextInput(true)
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  const handleVoiceClick = async () => {
    onVoiceStart()
  }

  if (showTextInput) {
    return (
      <div className={cn("flex items-center gap-2 p-3 bg-card border-b", className)}>
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your message... (Enter to send, Shift+Enter for new line, Esc to cancel)"
          className="min-h-[60px] max-h-[120px] flex-1 resize-none"
          disabled={isProcessing}
          autoFocus
        />
        <div className="flex flex-col gap-1">
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!text.trim() || isProcessing}
            className="h-8"
          >
            <Send className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setText("")
              setShowTextInput(false)
            }}
            disabled={isProcessing}
            className="h-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className={cn("flex items-center justify-between gap-3 p-3 bg-card border-b", className)}>
      <div className="flex items-center gap-2">
        <Button
          onClick={handleShowTextInput}
          disabled={isProcessing || isRecording}
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          <span>New Text</span>
        </Button>
        <Button
          variant={isRecording ? "destructive" : "secondary"}
          onClick={handleVoiceClick}
          disabled={isProcessing}
          className="gap-2"
        >
          <Mic className={cn("h-4 w-4", isRecording && "animate-pulse")} />
          <span>{isRecording ? "Recording..." : "Voice"}</span>
        </Button>
      </div>
      <div className="text-sm text-muted-foreground">
        Start a new agent session
      </div>
    </div>
  )
}

