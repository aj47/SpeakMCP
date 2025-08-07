import React, { useState, useRef, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog"
import { Textarea } from "@renderer/components/ui/textarea"
import { Button } from "@renderer/components/ui/button"
import { cn } from "@renderer/lib/utils"
import { AgentProgress } from "./agent-progress"
import { AgentProgressUpdate } from "../../../shared/types"

interface TextInputDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (text: string) => void
  isProcessing?: boolean
  agentProgress?: AgentProgressUpdate | null
}

export function TextInputDialog({
  open,
  onOpenChange,
  onSubmit,
  isProcessing = false,
  agentProgress,
}: TextInputDialogProps) {
  const [text, setText] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-focus when dialog opens
  useEffect(() => {
    if (open && textareaRef.current) {
      // Small delay to ensure dialog is fully rendered
      setTimeout(() => {
        textareaRef.current?.focus()
      }, 100)
    }
  }, [open])

  // Clear text when dialog closes
  useEffect(() => {
    if (!open) {
      setText("")
    }
  }, [open])

  const handleSubmit = () => {
    if (text.trim() && !isProcessing) {
      onSubmit(text.trim())
      setText("")
      onOpenChange(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === "Escape") {
      e.preventDefault()
      onOpenChange(false)
    }
    // Shift+Enter allows new lines (default textarea behavior)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="liquid-glass-strong sm:max-w-md"
        aria-describedby="text-input-description"
      >
        <DialogHeader>
          <DialogTitle className="glass-text-strong">
            Type Your Message
          </DialogTitle>
          <DialogDescription
            id="text-input-description"
            className="glass-text-muted"
          >
            Enter your message below. Press Enter to submit, Shift+Enter for new
            line, or Escape to cancel.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {isProcessing && agentProgress ? (
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
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your message here..."
                className={cn(
                  "liquid-glass-input glass-text-strong min-h-[120px] resize-none",
                  "focus:border-ring focus:ring-1 focus:ring-ring",
                )}
                disabled={isProcessing}
                aria-label="Message input"
                aria-describedby="text-input-description"
              />

              <div className="flex justify-end space-x-2">
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={isProcessing}
                  className="liquid-glass-input glass-text-strong hover:liquid-glass-strong"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={!text.trim() || isProcessing}
                  className="liquid-glass-strong glass-text-strong hover:opacity-90"
                >
                  {isProcessing ? "Processing..." : "Send"}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
