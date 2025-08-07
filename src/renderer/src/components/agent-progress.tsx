import React, { useEffect, useRef, useState } from "react"
import { cn } from "@renderer/lib/utils"
import { AgentProgressUpdate } from "../../../shared/types"
import { ChevronDown, ChevronRight } from "lucide-react"
import { MarkdownRenderer } from "@renderer/components/markdown-renderer"

interface AgentProgressProps {
  progress: AgentProgressUpdate | null
  className?: string
  variant?: "default" | "overlay"
}

// Enhanced conversation message component
const ConversationMessage: React.FC<{
  role: "user" | "assistant" | "tool"
  content: string
  isComplete?: boolean
  isThinking?: boolean
  toolCalls?: Array<{ name: string; arguments: any }>
  toolResults?: Array<{ success: boolean; content: string; error?: string }>
  defaultCollapsed?: boolean
}> = ({
  role,
  content,
  isComplete = false,
  isThinking = false,
  toolCalls,
  toolResults,
  defaultCollapsed = false,
}) => {
  // Show collapse button if content likely spans multiple lines or has tool calls/results
  const shouldShowCollapse =
    content.length > 80 ||
    content.includes("\n") ||
    (toolCalls && toolCalls.length > 0) ||
    (toolResults && toolResults.length > 0)

  const [isCollapsed, setIsCollapsed] = useState(
    defaultCollapsed && shouldShowCollapse,
  )

  if (!content || content.trim().length === 0) return null

  const getRoleStyles = () => {
    switch (role) {
      case "user":
        return "bg-blue-500/10 border-blue-500/30 text-blue-100"
      case "assistant":
        return isComplete
          ? "bg-green-500/10 border-green-500/30 text-green-100"
          : isThinking
            ? "bg-blue-500/10 border-blue-500/30 animate-pulse text-blue-100"
            : "bg-primary/10 border-primary/30 text-foreground"
      case "tool":
        return "bg-orange-500/10 border-orange-500/30 text-orange-100"
      default:
        return "bg-primary/10 border-primary/30 text-foreground"
    }
  }

  const getRoleLabel = () => {
    switch (role) {
      case "user":
        return "You"
      case "assistant":
        return "Assistant"
      case "tool":
        return "Tool Result"
      default:
        return role
    }
  }

  return (
    <div
      className={cn(
        "liquid-glass-subtle glass-border rounded-lg p-3 transition-all duration-300",
        getRoleStyles(),
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <div
          className={cn(
            "h-2 w-2 rounded-full",
            role === "user"
              ? "bg-blue-500"
              : role === "assistant"
                ? "bg-green-500"
                : "bg-orange-500",
          )}
        />
        <span className="text-xs font-semibold opacity-80">
          {getRoleLabel()}
        </span>
        {shouldShowCollapse && (
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                setIsCollapsed(!isCollapsed)
              }
            }}
            className="ml-auto rounded p-1 transition-colors hover:bg-white/10 focus:bg-white/10 focus:outline-none focus:ring-1 focus:ring-white/20"
            aria-label={isCollapsed ? "Expand message" : "Collapse message"}
            aria-expanded={!isCollapsed}
          >
            {isCollapsed ? (
              <ChevronRight className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </button>
        )}
      </div>
      <div
        className={cn(
          "cursor-text select-text text-sm leading-relaxed",
          isCollapsed ? "line-clamp-1" : "",
        )}
        role="region"
        aria-label={`${getRoleLabel()} message content`}
        aria-expanded={!isCollapsed}
      >
        {isCollapsed ? (
          <div className="truncate">{content.trim()}</div>
        ) : (
          <MarkdownRenderer content={content.trim()} />
        )}
      </div>
      {!isCollapsed && toolCalls && toolCalls.length > 0 && (
        <div className="mt-2 border-t border-white/10 pt-2">
          <div className="mb-1 text-xs opacity-70">Tool Calls:</div>
          {toolCalls.map((call, index) => (
            <div
              key={index}
              className="cursor-text select-text font-mono text-xs opacity-80"
            >
              {call.name}({Object.keys(call.arguments).length > 0 ? "..." : ""})
            </div>
          ))}
        </div>
      )}
      {!isCollapsed && toolResults && toolResults.length > 0 && (
        <div className="mt-2 border-t border-white/10 pt-2">
          {toolResults.map((result, index) => (
            <div
              key={index}
              className={cn(
                "cursor-text select-text whitespace-pre-wrap rounded p-2 text-xs",
                result.success ? "bg-green-500/20" : "bg-red-500/20",
              )}
            >
              {result.error || result.content.substring(0, 300)}
              {result.content.length > 300 && "..."}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export const AgentProgress: React.FC<AgentProgressProps> = ({
  progress,
  className,
  variant = "default",
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [isUserScrolling, setIsUserScrolling] = useState(false)
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true)
  const lastMessageCountRef = useRef(0)
  const lastContentLengthRef = useRef(0)

  if (!progress) {
    return null
  }

  const {
    currentIteration,
    maxIterations,
    steps,
    isComplete,
    finalContent,
    conversationHistory,
  } = progress

  // Use conversation history if available, otherwise fall back to extracting from steps
  let messages: Array<{
    role: "user" | "assistant" | "tool"
    content: string
    isComplete: boolean
    timestamp: number
    isThinking: boolean
    toolCalls?: Array<{ name: string; arguments: any }>
    toolResults?: Array<{ success: boolean; content: string; error?: string }>
  }> = []

  if (conversationHistory && conversationHistory.length > 0) {
    // Use the complete conversation history
    messages = conversationHistory.map((entry) => ({
      role: entry.role,
      content: entry.content,
      isComplete: true,
      timestamp: entry.timestamp || Date.now(),
      isThinking: false,
      toolCalls: entry.toolCalls,
      toolResults: entry.toolResults,
    }))

    // Add any in-progress thinking from current steps
    const currentThinkingStep = steps.find(
      (step) => step.type === "thinking" && step.status === "in_progress",
    )
    if (currentThinkingStep) {
      if (
        currentThinkingStep.llmContent &&
        currentThinkingStep.llmContent.trim().length > 0
      ) {
        messages.push({
          role: "assistant",
          content: currentThinkingStep.llmContent,
          isComplete: false,
          timestamp: currentThinkingStep.timestamp,
          isThinking: false,
        })
      } else {
        messages.push({
          role: "assistant",
          content: currentThinkingStep.description || "Agent is thinking...",
          isComplete: false,
          timestamp: currentThinkingStep.timestamp,
          isThinking: true,
        })
      }
    }
  } else {
    // Fallback to old behavior - extract from thinking steps
    steps
      .filter((step) => step.type === "thinking")
      .forEach((step) => {
        if (step.llmContent && step.llmContent.trim().length > 0) {
          messages.push({
            role: "assistant",
            content: step.llmContent,
            isComplete: step.status === "completed",
            timestamp: step.timestamp,
            isThinking: false,
          })
        } else if (step.status === "in_progress") {
          messages.push({
            role: "assistant",
            content: step.description || "Agent is thinking...",
            isComplete: false,
            timestamp: step.timestamp,
            isThinking: true,
          })
        }
      })

    // Add final content if available and different from last thinking step
    if (finalContent && finalContent.trim().length > 0) {
      const lastMessage = messages[messages.length - 1]
      if (!lastMessage || lastMessage.content !== finalContent) {
        messages.push({
          role: "assistant",
          content: finalContent,
          isComplete: true,
          timestamp: Date.now(),
          isThinking: false,
        })
      }
    }
  }

  // Sort by timestamp to ensure chronological order
  messages.sort((a, b) => a.timestamp - b.timestamp)

  // Improved auto-scroll logic
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return

    const scrollToBottom = () => {
      scrollContainer.scrollTop = scrollContainer.scrollHeight
    }

    // Calculate total content length for streaming detection
    const totalContentLength = messages.reduce(
      (sum, msg) => sum + msg.content.length,
      0,
    )

    // Check if new messages were added or content changed (streaming)
    const hasNewMessages = messages.length > lastMessageCountRef.current
    const hasContentChanged = totalContentLength > lastContentLengthRef.current

    if (hasNewMessages || hasContentChanged) {
      lastMessageCountRef.current = messages.length
      lastContentLengthRef.current = totalContentLength

      // Only auto-scroll if we should (user hasn't manually scrolled up)
      if (shouldAutoScroll) {
        // Use requestAnimationFrame to ensure DOM is updated
        requestAnimationFrame(() => {
          scrollToBottom()
        })
      }
    }
  }, [messages.length, shouldAutoScroll, messages])

  // Initial scroll to bottom on mount and when first message appears
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return

    const scrollToBottom = () => {
      scrollContainer.scrollTop = scrollContainer.scrollHeight
    }

    // Multiple attempts to ensure scrolling works with dynamic content
    const scrollAttempts = [0, 50, 100, 200]
    scrollAttempts.forEach((delay) => {
      setTimeout(() => {
        requestAnimationFrame(scrollToBottom)
      }, delay)
    })
  }, [messages.length > 0])

  // Handle scroll events to detect user interaction
  const handleScroll = () => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return

    const { scrollTop, scrollHeight, clientHeight } = scrollContainer
    const isAtBottom = Math.abs(scrollHeight - clientHeight - scrollTop) < 5 // 5px tolerance

    // If user scrolled to bottom, resume auto-scroll
    if (isAtBottom && !shouldAutoScroll) {
      setShouldAutoScroll(true)
      setIsUserScrolling(false)
    }
    // If user scrolled up from bottom, stop auto-scroll
    else if (!isAtBottom && shouldAutoScroll) {
      setShouldAutoScroll(false)
      setIsUserScrolling(true)
    }
  }

  // Check for errors
  const hasErrors = steps.some(
    (step) => step.status === "error" || step.toolResult?.error,
  )

  const containerClasses =
    variant === "overlay"
      ? "flex flex-col gap-2 p-2 w-full h-full rounded-xl liquid-glass-strong glass-text-strong"
      : "flex flex-col gap-2 p-3 liquid-glass-modal glass-border glass-shadow rounded-xl w-full h-full glass-text-strong"

  return (
    <div className={cn(containerClasses, "min-h-0 overflow-hidden", className)}>
      {/* Header - Compact */}
      <div className="flex flex-shrink-0 items-center justify-between pb-1">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "h-2 w-2 rounded-full",
              isComplete
                ? hasErrors
                  ? "bg-destructive"
                  : "bg-green-500"
                : "animate-pulse bg-primary",
            )}
          />
          <span className="text-xs font-semibold text-foreground">
            {isComplete ? (hasErrors ? "Failed" : "Complete") : "Working"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xs font-medium text-muted-foreground">
            {isComplete ? "✓" : `${currentIteration}/${maxIterations}`}
          </div>
          {isComplete && (
            <div className="text-xs text-muted-foreground opacity-75">ESC</div>
          )}
        </div>
      </div>

      {/* Conversation History */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex h-full flex-col gap-2 overflow-y-auto scroll-smooth"
        >
          {messages.length > 0 ? (
            messages.map((message, index) => (
              <ConversationMessage
                key={`${message.timestamp}-${index}`}
                role={message.role}
                content={message.content}
                isComplete={
                  message.isComplete &&
                  (isComplete || index === messages.length - 1)
                }
                isThinking={message.isThinking}
                toolCalls={message.toolCalls}
                toolResults={message.toolResults}
                defaultCollapsed={
                  // Expand the final message when complete (especially for summaries)
                  // or when there are errors
                  isComplete && index === messages.length - 1
                    ? false
                    : hasErrors && index === messages.length - 1
                      ? false
                      : true
                }
              />
            ))
          ) : (
            <div className="py-4 text-center text-sm text-muted-foreground">
              {isComplete ? "Task completed" : "Initializing agent..."}
            </div>
          )}
        </div>

        {/* Auto-scroll indicator */}
        {isUserScrolling && !isComplete && (
          <div className="absolute bottom-2 right-2 animate-pulse rounded-full bg-primary/80 px-2 py-1 text-xs text-primary-foreground shadow-lg">
            Scroll to bottom to resume auto-scroll
          </div>
        )}
      </div>

      {/* Progress Bar - Show only when not complete */}
      {!isComplete && (
        <div
          className="mt-1 h-1 w-full flex-shrink-0 rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={currentIteration}
          aria-valuemin={0}
          aria-valuemax={maxIterations}
          aria-label="Agent progress"
        >
          <div
            className="h-1 rounded-full bg-primary transition-all duration-500 ease-out"
            style={{
              width: `${Math.min(100, (currentIteration / maxIterations) * 100)}%`,
            }}
          />
        </div>
      )}
    </div>
  )
}
