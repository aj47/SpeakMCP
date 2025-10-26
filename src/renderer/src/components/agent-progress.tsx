import React, { useEffect, useRef, useState } from "react"
import { cn } from "@renderer/lib/utils"
import { AgentProgressUpdate } from "../../../shared/types"
import { ChevronDown, ChevronUp, ChevronRight, X, AlertTriangle } from "lucide-react"
import { MarkdownRenderer } from "@renderer/components/markdown-renderer"
import { Button } from "./ui/button"
import { Badge } from "./ui/badge"
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

// Types for unified tool execution display items
type DisplayItem =
  | { kind: "message"; data: {
      role: "user" | "assistant" | "tool"
      content: string
      isComplete: boolean
      timestamp: number
      isThinking: boolean
      toolCalls?: Array<{ name: string; arguments: any }>
      toolResults?: Array<{ success: boolean; content: string; error?: string }>
    } }
  | { kind: "tool_execution"; data: {
      timestamp: number
      calls: Array<{ name: string; arguments: any }>
      results: Array<{ success: boolean; content: string; error?: string }>
    } }


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
  wasStopped?: boolean
  isExpanded: boolean
  onToggleExpand: () => void
}> = ({ message, isLast, isComplete, hasErrors, wasStopped = false, isExpanded, onToggleExpand }) => {
  const [audioData, setAudioData] = useState<ArrayBuffer | null>(null)
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false)
  const [ttsError, setTtsError] = useState<string | null>(null)
  const configQuery = useConfigQuery()

  const displayResults = (message.toolResults || []).filter(
    (r) =>
      (r.error && r.error.trim().length > 0) ||
      (r.content && r.content.trim().length > 0),
  )
  const hasExtras =
    (message.toolCalls?.length ?? 0) > 0 ||
    displayResults.length > 0
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

  // Auto-play TTS when assistant message completes (but NOT if agent was stopped by kill switch)
  useEffect(() => {
    if (shouldShowTTS && configQuery.data?.ttsAutoPlay && !audioData && !isGeneratingAudio && !ttsError && !wasStopped) {
      generateAudio().catch((error) => {
        // Error is already handled in generateAudio function
      })
    }
  }, [shouldShowTTS, configQuery.data?.ttsAutoPlay, audioData, isGeneratingAudio, ttsError, wasStopped])

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
      console.log("[CompactMessage] Toggle expand - message role:", message.role, "timestamp:", message.timestamp, "current isExpanded:", isExpanded)
      onToggleExpand()
    }
  }

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent triggering the message click
    console.log("[CompactMessage] Chevron clicked - message role:", message.role, "timestamp:", message.timestamp, "current isExpanded:", isExpanded)
    onToggleExpand()
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
            <div className="mt-2 space-y-2 text-left">
              {message.toolCalls && message.toolCalls.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold opacity-70">Tool Calls ({message.toolCalls.length}):</div>
                  {message.toolCalls.map((toolCall, index) => (
                    <div
                      key={index}
                      className="rounded-lg border border-border/30 bg-muted/20 p-2 text-xs"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono font-semibold text-primary">
                          {toolCall.name}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          Tool {index + 1}
                        </Badge>
                      </div>
                      {toolCall.arguments && (
                        <div>
                          <div className="mb-1 text-xs font-medium opacity-70">
                            Parameters:
                          </div>
                          <pre className="rounded bg-muted/50 p-2 overflow-auto text-xs whitespace-pre-wrap max-h-80 scrollbar-thin">
                            {JSON.stringify(toolCall.arguments, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {displayResults.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold opacity-70">Tool Results ({displayResults.length}):</div>
                  {displayResults.map((result, index) => (
                    <div
                      key={index}
                      className={cn(
                        "rounded-lg border p-2 text-xs",
                        result.success
                          ? "border-green-200/50 bg-green-50/30 text-green-700 dark:border-green-800/50 dark:bg-green-900/20 dark:text-green-300"
                          : "border-red-200/50 bg-red-50/30 text-red-700 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-300",
                      )}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold">
                          {result.success ? "✅ Success" : "❌ Error"}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          Result {index + 1}
                        </Badge>
                      </div>

                      <div className="space-y-2">
                        <div>
                          <div className="text-xs font-medium opacity-70 mb-1">
                            Content:
                          </div>
                          <pre className="rounded bg-muted/30 p-2 overflow-auto text-xs whitespace-pre-wrap break-all max-h-80 scrollbar-thin">
                            {result.content || "No content returned"}
                          </pre>
                        </div>

                        {result.error && (
                          <div>
                            <div className="text-xs font-medium text-destructive mb-1">
                              Error Details:
                            </div>
                            <pre className="rounded bg-destructive/10 p-2 overflow-auto text-xs whitespace-pre-wrap break-all max-h-60 scrollbar-thin">
                              {result.error}
                            </pre>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
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

// Unified Tool Execution bubble combining call + response
const ToolExecutionBubble: React.FC<{
  execution: {
    timestamp: number
    calls: Array<{ name: string; arguments: any }>
    results: Array<{ success: boolean; content: string; error?: string }>
  }
  isExpanded: boolean
  onToggleExpand: () => void
}> = ({ execution, isExpanded, onToggleExpand }) => {
  const [showInputs, setShowInputs] = useState(false)
  const [showOutputs, setShowOutputs] = useState(false)

  // Collapsed by default; expand to show details
  useEffect(() => {
    console.log("[ToolExecutionBubble] isExpanded changed:", isExpanded, "execution timestamp:", execution.timestamp)
    if (isExpanded) {
      console.log("[ToolExecutionBubble] Expanding - showing inputs and outputs")
      setShowInputs(true)
      setShowOutputs(true)
    } else {
      console.log("[ToolExecutionBubble] Collapsing - hiding inputs and outputs")
      setShowInputs(false)
      setShowOutputs(false)
    }
  }, [isExpanded, execution])

  const isPending = execution.results.length === 0
  const allSuccess = execution.results.length > 0 && execution.results.every((r) => r.success)
  const hasErrors = execution.results.length > 0 && execution.results.some((r) => !r.success)
  const headerTitle = execution.calls.map((c) => c.name).join(", ") || "Tool Execution"

  const copy = async (text: string) => {
    try {
      await navigator.clipboard?.writeText(text)
    } catch {}
  }

  const handleToggleExpand = () => {
    console.log("[ToolExecutionBubble] Toggle expand clicked - timestamp:", execution.timestamp, "current isExpanded:", isExpanded)
    onToggleExpand()
  }
  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    console.log("[ToolExecutionBubble] Chevron clicked - timestamp:", execution.timestamp, "current isExpanded:", isExpanded)
    onToggleExpand()
  }


  return (
    <div
      className={cn(
        "rounded-lg border p-2 text-xs",
        isPending
          ? "border-blue-200/50 bg-blue-50/30 text-blue-700 dark:border-blue-800/50 dark:bg-blue-900/20 dark:text-blue-300"
          : allSuccess
            ? "border-green-200/50 bg-green-50/30 text-green-700 dark:border-green-800/50 dark:bg-green-900/20 dark:text-green-300"
            : "border-red-200/50 bg-red-50/30 text-red-700 dark:border-red-800/50 dark:bg-red-900/20 dark:text-red-300",
      )}
    >
      <div
        className="mb-1 flex items-center justify-between px-1 py-1 cursor-pointer hover:bg-muted/20 rounded"
        onClick={handleToggleExpand}
        aria-expanded={isExpanded}
      >
        <div className="flex items-center gap-2">
          <span className="font-mono font-semibold">{headerTitle}</span>
          {isExpanded && (
            <Badge variant="outline" className="text-[10px]">
              {isPending ? "Pending..." : allSuccess ? "Success" : "With errors"}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isExpanded && (
            <span className="opacity-60 text-[10px]">{new Date(execution.timestamp).toLocaleTimeString()}</span>
          )}
          <button
            onClick={handleChevronClick}
            className="p-1 rounded hover:bg-muted/30 transition-colors"
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <>
          {/* Inputs */}
          <div className="rounded-md bg-blue-50/40 dark:bg-blue-900/10 border border-blue-200/40 dark:border-blue-800/40 p-2 mb-2">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold opacity-80">Call Parameters</div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setShowInputs((v) => !v)}>
                  {showInputs ? "Hide" : "Show"}
                </Button>
                <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => copy(JSON.stringify(execution.calls, null, 2))}>
                  Copy
                </Button>
              </div>
            </div>
            {showInputs && (
              <div className="mt-1 space-y-2">
                {execution.calls.map((c, idx) => (
                  <div key={idx} className="rounded bg-muted/50 p-2 overflow-auto whitespace-pre-wrap max-h-80 scrollbar-thin">
                    <div className="mb-1 text-[11px] font-medium opacity-70">{c.name}</div>
                    <pre>{JSON.stringify(c.arguments ?? {}, null, 2)}</pre>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Outputs */}
          <div
            className="rounded-md border p-2"
            style={{
              borderColor: isPending ? "rgb(191 219 254 / 0.5)" : allSuccess ? "rgb(187 247 208 / 0.5)" : "rgb(254 202 202 / 0.5)",
              backgroundColor: isPending ? "rgb(239 246 255 / 0.3)" : allSuccess ? "rgb(240 253 244 / 0.3)" : "rgb(254 242 242 / 0.3)",
            } as React.CSSProperties}
          >
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold opacity-80">Response</div>
              {!isPending && (
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setShowOutputs((v) => !v)}>
                    {showOutputs ? "Hide" : "Show"}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => copy(JSON.stringify(execution.results, null, 2))}>
                    Copy
                  </Button>
                </div>
              )}
            </div>
            {isPending ? (
              <div className="mt-2 text-center py-2 text-[11px] opacity-60 italic">
                Waiting for response...
              </div>
            ) : showOutputs && (
              <div className="mt-1 space-y-2">
                {execution.results.map((r, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      "rounded border p-2 text-xs",
                      r.success ? "border-green-200/50 bg-green-50/30" : "border-red-200/50 bg-red-50/30",
                    )}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-semibold">{r.success ? "✅ Success" : "❌ Error"}</span>
                      <Badge variant="outline" className="text-[10px]">{`Result ${idx + 1}`}</Badge>
                    </div>
                    <div className="space-y-2">
                      <div>
                        <div className="text-[11px] font-medium opacity-70 mb-1">Content:</div>
                        <pre className="rounded bg-muted/30 p-2 overflow-auto whitespace-pre-wrap break-all max-h-80 scrollbar-thin">
                          {r.content || "No content returned"}
                        </pre>
                      </div>
                      {r.error && (
                        <div>
                          <div className="text-[11px] font-medium text-destructive mb-1">Error Details:</div>
                          <pre className="rounded bg-destructive/10 p-2 overflow-auto whitespace-pre-wrap break-all max-h-60 scrollbar-thin">
                            {r.error}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
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
  const [showKillConfirmation, setShowKillConfirmation] = useState(false)
  const [isKilling, setIsKilling] = useState(false)
  const { isDark } = useTheme()

  // Expansion state management - preserve across re-renders
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({})

  // Get current conversation ID for deep-linking
  const { currentConversationId } = useConversation()

  // Helper to toggle expansion state for a specific item
  const toggleItemExpansion = (itemKey: string) => {
    setExpandedItems(prev => {
      const newState = !prev[itemKey]
      console.log("[AgentProgress] toggleItemExpansion - itemKey:", itemKey, "newState:", newState, "previousState:", prev[itemKey])
      console.log("[AgentProgress] All expanded items:", { ...prev, [itemKey]: newState })
      return {
        ...prev,
        [itemKey]: newState
      }
    })
  }

  // Kill switch handler
  const handleKillSwitch = async () => {
    if (isKilling) return // Prevent double-clicks

    setIsKilling(true)
    try {
      await tipcClient.emergencyStopAgent()
      setShowKillConfirmation(false)
    } catch (error) {
      console.error("Failed to stop agent:", error)
    } finally {
      setIsKilling(false)
    }
  }

  // Handle confirmation dialog
  const handleKillConfirmation = () => {
    setShowKillConfirmation(true)
  }

  const handleCancelKill = () => {
    setShowKillConfirmation(false)
  }

  // Close button handler for completed agent view
  const handleClose = async () => {
    try {
      await tipcClient.closeAgentModeAndHidePanelWindow()
    } catch (error) {
      console.error("Failed to close agent mode:", error)
    }
  }

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

  // Detect if agent was stopped by kill switch
  const wasStopped = finalContent?.includes("emergency kill switch") ||
                    steps?.some(step => step.title === "Agent stopped" ||
                               step.description?.includes("emergency kill switch"))

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
    // Use the complete conversation history (filter internal nudges)
    const isNudge = (c: string) =>
      c.includes("Please either take action using available tools") ||
      c.includes("You have relevant tools available for this request")

    messages = conversationHistory
      .filter((entry) => !(entry.role === "user" && isNudge(entry.content)))
      .map((entry) => ({
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

  // Build unified display items that combine tool calls with subsequent results
  const displayItems: DisplayItem[] = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      const next = messages[i + 1]
      const results = next && next.role === "tool" && next.toolResults ? next.toolResults : []
      // Show assistant message without extras
      displayItems.push({ kind: "message", data: { ...m, toolCalls: undefined, toolResults: undefined } })
      // Unified execution bubble
      displayItems.push({
        kind: "tool_execution",
        data: {
          timestamp: next?.timestamp ?? m.timestamp,
          calls: m.toolCalls,
          results,
        },
      })
      if (next && next.role === "tool" && next.toolResults) {
        i++ // skip the tool result message, already included
      }
    } else if (
      m.role === "tool" &&
      m.toolResults &&
      !(i > 0 && messages[i - 1].role === "assistant" && (messages[i - 1].toolCalls?.length ?? 0) > 0)
    ) {
      // Standalone tool result without a preceding assistant call in sequence
      displayItems.push({ kind: "tool_execution", data: { timestamp: m.timestamp, calls: [], results: m.toolResults } })
    } else {
      displayItems.push({ kind: "message", data: m })
    }
  }

  // Determine the last assistant message among display items (by position, not timestamp)
  const lastAssistantDisplayIndex = (() => {
    for (let i = displayItems.length - 1; i >= 0; i--) {
      const it = displayItems[i]
      if (it.kind === "message" && it.data.role === "assistant") return i
    }
    return -1
  })()


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
      console.log("[AgentProgress] New messages detected - count:", messages.length, "previous count:", lastMessageCountRef.current, "expandedItems:", expandedItems)
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
  }, [messages.length, shouldAutoScroll, messages, expandedItems])

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
          <span className={cn(
            "text-xs font-medium",
            wasStopped && "text-red-600 dark:text-red-400"
          )}>
            {isComplete ?
              (wasStopped ? "Stopped" : hasErrors ? "Failed" : "Complete") :
              "Processing"
            }
          </span>
          {wasStopped && (
            <Badge variant="destructive" className="text-xs px-1.5 py-0.5">
              Terminated
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3">
          {!isComplete && (
            <span className="text-xs text-muted-foreground">
              {`${currentIteration}/${maxIterations}`}
            </span>
          )}
          {!isComplete ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
              onClick={handleKillConfirmation}
              disabled={isKilling}
              title="Stop agent execution"
            >
              <X className="h-3 w-3" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground hover:bg-muted"
              onClick={handleClose}
              title="Close"
            >
              <X className="h-3 w-3" />
            </Button>
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
          {displayItems.length > 0 ? (
            <div className="space-y-1 p-2">
              {displayItems.map((item, index) => {
                const itemKey = item.kind === "message"
                  ? `msg-${item.data.timestamp}-${index}`
                  : `exec-${item.data.timestamp}-${index}`

                const isExpanded = !!expandedItems[itemKey]
                console.log("[AgentProgress] Rendering item:", itemKey, "kind:", item.kind, "isExpanded:", isExpanded)

                return item.kind === "message" ? (
                  <CompactMessage
                    key={itemKey}
                    message={item.data}
                    isLast={index === lastAssistantDisplayIndex}
                    isComplete={isComplete}
                    hasErrors={hasErrors}
                    wasStopped={wasStopped}
                    isExpanded={isExpanded}
                    onToggleExpand={() => toggleItemExpansion(itemKey)}
                  />
                ) : (
                  <ToolExecutionBubble
                    key={itemKey}
                    execution={item.data}
                    isExpanded={isExpanded}
                    onToggleExpand={() => toggleItemExpansion(itemKey)}
                  />
                )
              })}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Initializing...
            </div>
          )}
        </div>

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

      {/* Kill Switch Confirmation Dialog */}
      {showKillConfirmation && (
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-background border border-border rounded-lg p-4 max-w-sm mx-4 shadow-lg">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              <h3 className="text-sm font-medium">Stop Agent Execution</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Are you sure you want to stop the agent? This will immediately terminate all running processes and cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancelKill}
                disabled={isKilling}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleKillSwitch}
                disabled={isKilling}
              >
                {isKilling ? "Stopping..." : "Stop Agent"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
