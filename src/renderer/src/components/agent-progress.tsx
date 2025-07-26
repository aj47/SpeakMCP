import React from "react"
import { cn } from "~/lib/utils"
import { AgentProgressUpdate } from "../../../shared/types"

interface AgentProgressProps {
  progress: AgentProgressUpdate | null
  className?: string
  variant?: "default" | "overlay"
}

// Enhanced conversation message component
const ConversationMessage: React.FC<{ content: string; isComplete?: boolean; isThinking?: boolean }> = ({
  content,
  isComplete = false,
  isThinking = false
}) => {
  if (!content || content.trim().length === 0) return null

  return (
    <div className={cn(
      "p-3 rounded-lg liquid-glass-subtle glass-border transition-all duration-300",
      isComplete
        ? "bg-green-500/5 border-green-500/20"
        : isThinking
          ? "bg-blue-500/5 border-blue-500/20 animate-pulse"
          : "bg-primary/5 border-primary/20"
    )}>
      <div className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
        {content.trim()}
      </div>
    </div>
  )
}

export const AgentProgress: React.FC<AgentProgressProps> = ({ progress, className, variant = "default" }) => {
  if (!progress) {
    return null
  }

  const { currentIteration, maxIterations, steps, isComplete, finalContent } = progress

  // Extract all LLM content from thinking steps and organize chronologically
  const llmMessages: Array<{ content: string; isComplete: boolean; timestamp: number; isThinking: boolean }> = []

  // Add thinking step content (both completed and in-progress)
  steps
    .filter(step => step.type === "thinking")
    .forEach(step => {
      if (step.llmContent && step.llmContent.trim().length > 0) {
        // Has actual LLM content
        llmMessages.push({
          content: step.llmContent,
          isComplete: step.status === "completed",
          timestamp: step.timestamp,
          isThinking: false
        })
      } else if (step.status === "in_progress") {
        // Show thinking indicator for in-progress steps without content yet
        llmMessages.push({
          content: step.description || "Agent is thinking...",
          isComplete: false,
          timestamp: step.timestamp,
          isThinking: true
        })
      }
    })

  // Add final content if available and different from last thinking step
  if (finalContent && finalContent.trim().length > 0) {
    const lastMessage = llmMessages[llmMessages.length - 1]
    if (!lastMessage || lastMessage.content !== finalContent) {
      llmMessages.push({
        content: finalContent,
        isComplete: true,
        timestamp: Date.now(),
        isThinking: false
      })
    }
  }

  // Sort by timestamp to ensure chronological order
  llmMessages.sort((a, b) => a.timestamp - b.timestamp)

  // Check for errors
  const hasErrors = steps.some(step => step.status === "error" || step.toolResult?.error)

  const containerClasses = variant === "overlay"
    ? "flex flex-col gap-3 p-3 w-full rounded-xl liquid-glass-strong glass-text-strong"
    : "flex flex-col gap-3 p-4 liquid-glass-modal glass-border glass-shadow rounded-xl w-full glass-text-strong"

  return (
    <div className={cn(
      containerClasses,
      "max-h-[80vh] overflow-y-auto",
      className
    )}>
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className={cn(
            "w-2.5 h-2.5 rounded-full",
            isComplete
              ? hasErrors ? "bg-destructive" : "bg-green-500"
              : "bg-primary animate-pulse"
          )} />
          <span className="text-sm font-semibold text-foreground">
            {isComplete
              ? hasErrors ? "Task Failed" : "Task Complete"
              : "Agent Working"
            }
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xs text-muted-foreground font-medium">
            {isComplete ? "✓ Done" : `${currentIteration}/${maxIterations}`}
          </div>
          {isComplete && (
            <div className="text-xs text-muted-foreground opacity-75">
              • Press ESC to close
            </div>
          )}
        </div>
      </div>

      {/* Conversation History */}
      <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto">
        {llmMessages.length > 0 ? (
          llmMessages.map((message, index) => (
            <ConversationMessage
              key={`${message.timestamp}-${index}`}
              content={message.content}
              isComplete={message.isComplete && (isComplete || index === llmMessages.length - 1)}
              isThinking={message.isThinking}
            />
          ))
        ) : (
          <div className="text-sm text-muted-foreground text-center py-4">
            {isComplete ? "Task completed" : "Initializing agent..."}
          </div>
        )}
      </div>

      {/* Progress Bar - Show only when not complete */}
      {!isComplete && (
        <div className="w-full bg-muted rounded-full h-1.5 mt-auto flex-shrink-0">
          <div
            className="h-1.5 rounded-full transition-all duration-500 ease-out bg-primary"
            style={{
              width: `${Math.min(100, (currentIteration / maxIterations) * 100)}%`
            }}
          />
        </div>
      )}
    </div>
  )
}
