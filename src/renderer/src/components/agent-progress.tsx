import React, { useEffect, useRef, useState } from "react"
import { cn } from "@renderer/lib/utils"
import { AgentProgressUpdate } from "../../../shared/types"
import { ChevronDown, ChevronUp, ChevronRight, ExternalLink } from "lucide-react"
import { MarkdownRenderer } from "@renderer/components/markdown-renderer"
import { Button } from "./ui/button"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useConversation } from "@renderer/contexts/conversation-context"
import { AudioPlayer } from "@renderer/components/audio-player"
import { useConfigQuery } from "@renderer/lib/queries"
import { useTheme } from "@renderer/contexts/theme-context"

interface AgentProgressProps {
  progress: AgentProgressUpdate | null
  className?: string
  variant?: "default" | "overlay"
}

// Enhanced conversation message component


// Compact message component for space efficiency
const CompactMessage: React.FC<{
  message: {
    role: "user" | "assistant" | "tool"
    content: string
    isComplete?: boolean
    isThinking?: boolean
    toolCalls?: Array<{ name: string; arguments: any }>
    toolResults?: Array<{ success: boolean; content: string; error?: string }>
    timestamp: number
  }
  isLast: boolean
  isComplete: boolean
  hasErrors: boolean
}> = ({ message, isLast, isComplete, hasErrors }) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const [audioData, setAudioData] = useState<ArrayBuffer | null>(null)
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false)
  const [ttsError, setTtsError] = useState<string | null>(null)
  const configQuery = useConfigQuery()

  const hasExtras = message.toolCalls || message.toolResults
  const shouldCollapse = message.content.length > 100 || hasExtras

  // TTS functionality
  const generateAudio = async (): Promise<ArrayBuffer> => {
    if (!configQuery.data?.ttsEnabled) {
      throw new Error("TTS is not enabled")
    }

    setIsGeneratingAudio(true)
    setTtsError(null)

    try {
      const result = await tipcClient.generateSpeech({
        text: message.content,
      })
      setAudioData(result.audio)
      return result.audio
    } catch (error) {
      console.error("[TTS UI] Failed to generate TTS audio:", error)

      // Set user-friendly error message
      let errorMessage = "Failed to generate audio"
      if (error instanceof Error) {
        if (error.message.includes("API key")) {
          errorMessage = "TTS API key not configured"
        } else if (error.message.includes("terms acceptance")) {
          errorMessage = "Groq TTS model requires terms acceptance. Please visit the Groq console to accept terms for the PlayAI TTS model."
        } else if (error.message.includes("rate limit")) {
          errorMessage = "Rate limit exceeded. Please try again later"
        } else if (error.message.includes("network") || error.message.includes("fetch")) {
          errorMessage = "Network error. Please check your connection"
        } else if (error.message.includes("validation")) {
          errorMessage = "Text content is not suitable for TTS"
        } else {
          errorMessage = `TTS error: ${error.message}`
        }
      }

      setTtsError(errorMessage)
      throw error
    } finally {
      setIsGeneratingAudio(false)
    }
  }

  // Check if TTS should be shown for this message
  const shouldShowTTS = message.role === "assistant" && isComplete && isLast && configQuery.data?.ttsEnabled

  // Auto-play TTS when assistant message completes
  useEffect(() => {
    if (shouldShowTTS && configQuery.data?.ttsAutoPlay && !audioData && !isGeneratingAudio && !ttsError) {
      generateAudio().catch((error) => {
        // Error is already handled in generateAudio function
      })
    }
  }, [shouldShowTTS, configQuery.data?.ttsAutoPlay, audioData, isGeneratingAudio, ttsError])

  const getRoleStyle = () => {
    switch (message.role) {
      case "user":
        return "border-l-2 border-blue-400 bg-blue-400/5"
      case "assistant":
        return isComplete && isLast && !hasErrors
          ? "border-l-2 border-green-400 bg-green-400/5"
          : "border-l-2 border-gray-400 bg-gray-400/5"
      case "tool":
        return "border-l-2 border-orange-400 bg-orange-400/5"
    }
  }

  const getRoleIcon = () => {
    switch (message.role) {
      case "user": return "👤"
      case "assistant": return "🤖"
      case "tool": return "🔧"
    }
  }

  const handleToggleExpand = () => {
    if (shouldCollapse) {
      setIsExpanded(!isExpanded)
    }
  }

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent triggering the message click
    setIsExpanded(!isExpanded)
  }

  return (
    <div className={cn(
      "rounded text-xs transition-all duration-200",
      getRoleStyle(),
      !isExpanded && shouldCollapse && "hover:bg-muted/20",
      shouldCollapse && "cursor-pointer"
    )}>
      <div
        className="flex items-start gap-2 px-2 py-1 text-left"
        onClick={handleToggleExpand}
      >
        <span className="opacity-60 mt-0.5 flex-shrink-0">{getRoleIcon()}</span>
        <div className="flex-1 min-w-0">
          <div className={cn(
            "leading-relaxed text-left",
            !isExpanded && shouldCollapse && "line-clamp-2"
          )}>
            <MarkdownRenderer content={message.content.trim()} />
          </div>
          {hasExtras && isExpanded && (
            <div className="mt-1 space-y-1 text-left">
              {message.toolCalls && (
                <div className="text-xs opacity-70">
                  Tools: {message.toolCalls.map(c => c.name).join(", ")}
                </div>
              )}
              {message.toolResults && (
                <div className="text-xs opacity-70">
                  Results: {message.toolResults.length}
                </div>
              )}
            </div>
          )}

          {/* TTS Audio Player - only show for completed assistant messages */}
          {shouldShowTTS && (
            <div className="mt-2">
              <AudioPlayer
                audioData={audioData || undefined}
                text={message.content}
                onGenerateAudio={generateAudio}
                isGenerating={isGeneratingAudio}
                error={ttsError}
                compact={true}
                autoPlay={configQuery.data?.ttsAutoPlay ?? true}
              />
              {ttsError && (
                <div className="mt-1 rounded-md bg-red-50 p-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300">
                  <span className="font-medium">Audio generation failed:</span>{" "}
                  {ttsError.includes("terms acceptance") ? (
                    <>
                      Groq TTS model requires terms acceptance.{" "}
                      <a
                        href="https://console.groq.com/playground?model=playai-tts"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:no-underline"
                      >
                        Click here to accept terms
                      </a>{" "}
                      for the PlayAI TTS model.
                    </>
                  ) : (
                    ttsError
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        {shouldCollapse && (
          <button
            onClick={handleChevronClick}
            className="p-1 rounded hover:bg-muted/30 transition-colors flex-shrink-0"
          >
            {isExpanded ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </button>
        )}
      </div>
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
  const { isDark } = useTheme()

  // Get current conversation ID for deep-linking
  const { currentConversationId } = useConversation()

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

  const containerClasses = cn(
    "progress-panel flex flex-col w-full h-full rounded-xl overflow-hidden",
    variant === "overlay"
      ? "bg-background/80 backdrop-blur-sm border border-border/50"
      : "bg-muted/20 backdrop-blur-sm border border-border/40",
    isDark ? "dark" : ""
  )

  return (
    <div
      className={cn(containerClasses, "min-h-0", className)}
      dir="ltr"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      {/* Unified Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/30 bg-muted/10 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">
            {isComplete ? (hasErrors ? "Failed" : "Complete") : "Processing"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {isComplete ? "Done" : `${currentIteration}/${maxIterations}`}
          </span>
          {isComplete && finalContent && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const url = currentConversationId
                  ? `/conversations/${currentConversationId}`
                  : "/conversations"
                tipcClient.showMainWindow({ url })
              }}
              className="h-6 px-2 text-xs"
            >
              <ExternalLink className="h-3 w-3" />
              Details
            </Button>
          )}
          {isComplete && (
            <span className="text-xs text-muted-foreground">ESC</span>
          )}
        </div>
      </div>

      {/* Message Stream - Left-aligned content */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto"
        >
          {messages.length > 0 ? (
            <div className="space-y-1 p-2">
              {messages.map((message, index) => (
                <CompactMessage
                  key={`${message.timestamp}-${index}`}
                  message={message}
                  isLast={index === messages.length - 1}
                  isComplete={isComplete}
                  hasErrors={hasErrors}
                />
              ))}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Initializing...
            </div>
          )}
        </div>

        {/* Auto-scroll indicator */}
        {isUserScrolling && !isComplete && (
          <div className="absolute bottom-2 right-2 animate-pulse rounded-full bg-primary/80 px-2 py-1 text-xs text-primary-foreground shadow-lg">
            Resume auto-scroll
          </div>
        )}
      </div>

      {/* Slim Progress Bar */}
      {!isComplete && (
        <div className="h-0.5 w-full bg-muted/50">
          <div
            className="h-full bg-primary transition-all duration-500 ease-out"
            style={{
              width: `${Math.min(100, (currentIteration / maxIterations) * 100)}%`,
            }}
          />
        </div>
      )}
    </div>
  )
}
