import React from "react"
import { cn } from "~/lib/utils"
import { AgentProgressUpdate } from "../../../shared/types"

interface AgentProgressProps {
  progress: AgentProgressUpdate | null
  className?: string
  variant?: "default" | "overlay"
}

// Simple conversation message component
const ConversationMessage: React.FC<{ content: string; isComplete?: boolean }> = ({ content, isComplete = false }) => {
  if (!content || content.trim().length === 0) return null

  return (
    <div className={cn(
      "p-3 rounded-lg liquid-glass-subtle glass-border",
      isComplete ? "bg-green-500/5 border-green-500/20" : "bg-primary/5 border-primary/20"
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

  // Extract all LLM content from thinking steps
  const llmMessages = steps
    .filter(step => step.type === "thinking" && step.llmContent && step.llmContent.trim().length > 0)
    .map(step => step.llmContent!)

  // Add final content if available and different from last thinking step
  if (finalContent && finalContent.trim().length > 0) {
    const lastMessage = llmMessages[llmMessages.length - 1]
    if (!lastMessage || lastMessage !== finalContent) {
      llmMessages.push(finalContent)
    }
  }

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
              key={index}
              content={message}
              isComplete={isComplete && index === llmMessages.length - 1}
            />
          ))
        ) : (
          <div className="text-sm text-muted-foreground text-center py-4">
            {isComplete ? "Task completed" : "Agent is working..."}
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
