import React, { useEffect, useRef, useState } from "react"
import { cn } from "@renderer/lib/utils"
import { AgentProgressUpdate, ACPDelegationProgress, ACPSubAgentMessage } from "../../../shared/types"
import { ChevronDown, ChevronUp, ChevronRight, X, AlertTriangle, Minimize2, Shield, Check, XCircle, Loader2, Clock, Copy, CheckCheck, GripHorizontal, Activity, Moon, Maximize2, RefreshCw, ExternalLink, Bot, OctagonX, Expand, Shrink, MessageSquare, Brain } from "lucide-react"
import { MarkdownRenderer } from "@renderer/components/markdown-renderer"
import { Button } from "./ui/button"
import { Badge } from "./ui/badge"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useAgentStore, useConversationStore, useMessageQueue, useIsQueuePaused } from "@renderer/stores"
import { AudioPlayer } from "@renderer/components/audio-player"
import { useConfigQuery } from "@renderer/lib/queries"
import { useTheme } from "@renderer/contexts/theme-context"
import { logUI, logExpand } from "@renderer/lib/debug"
import { TileFollowUpInput } from "./tile-follow-up-input"
import { OverlayFollowUpInput } from "./overlay-follow-up-input"
import { MessageQueuePanel } from "@renderer/components/message-queue-panel"
import { useResizable, TILE_DIMENSIONS } from "@renderer/hooks/use-resizable"
import { getToolResultsSummary } from "@speakmcp/shared"
import { ToolExecutionStats } from "./tool-execution-stats"
import { ACPSessionBadge } from "./acp-session-badge"
import { AgentSummaryView } from "./agent-summary-view"

// Module-level set to track sessions that have already auto-played TTS.
// This prevents double TTS playback when AgentProgress remounts (e.g., when
// switching between single-session and multi-session views in the panel).
// The set is keyed by `${sessionId}:${ttsText || messageContent}` to handle
// cases where the same session replays with different content.
const sessionsWithTTSPlayed = new Set<string>()

/**
 * Clear TTS tracking for a specific session. Call this when a session is dismissed
 * to allow TTS to play again if the session is somehow restored.
 */
export function clearSessionTTSTracking(sessionId: string): void {
  // Remove all entries that start with this sessionId
  for (const key of sessionsWithTTSPlayed) {
    if (key.startsWith(`${sessionId}:`)) {
      sessionsWithTTSPlayed.delete(key)
    }
  }
}

interface AgentProgressProps {
  progress: AgentProgressUpdate | null
  className?: string
  variant?: "default" | "overlay" | "tile"
  /** For tile variant: whether the tile is focused */
  isFocused?: boolean
  /** For tile variant: callback when tile is clicked */
  onFocus?: () => void
  /** For tile variant: callback to dismiss the tile */
  onDismiss?: () => void
  /** For tile variant: controlled collapsed state */
  isCollapsed?: boolean
  /** For tile variant: callback when collapsed state changes */
  onCollapsedChange?: (collapsed: boolean) => void
  /** For tile variant: callback when a follow-up message is sent */
  onFollowUpSent?: () => void
  /** For tile variant: callback to expand this tile to full view */
  onExpand?: () => void
  /** For tile variant: whether this tile is in expanded/full view mode */
  isExpanded?: boolean
}

// Enhanced conversation message component

// Types for unified tool execution display items
type DisplayItem =
  | { kind: "message"; id: string; data: {
      role: "user" | "assistant" | "tool"
      content: string
      isComplete: boolean
      timestamp: number
      isThinking: boolean
      toolCalls?: Array<{ name: string; arguments: any }>
      toolResults?: Array<{ success: boolean; content: string; error?: string }>
    } }
  | { kind: "tool_execution"; id: string; data: {
      timestamp: number
      calls: Array<{ name: string; arguments: any }>
      results: Array<{ success: boolean; content: string; error?: string }>
    } }
  | { kind: "assistant_with_tools"; id: string; data: {
      thought: string
      timestamp: number
      isComplete: boolean
      calls: Array<{ name: string; arguments: any }>
      results: Array<{ success: boolean; content: string; error?: string }>
      executionStats?: {
        durationMs?: number
        totalTokens?: number
        model?: string
      }
    } }
  | { kind: "tool_approval"; id: string; data: {
      approvalId: string
      toolName: string
      arguments: any
    } }
  | { kind: "retry_status"; id: string; data: {
      isRetrying: boolean
      attempt: number
      maxAttempts?: number
      delaySeconds: number
      reason: string
      startedAt: number
    } }
  | { kind: "streaming"; id: string; data: {
      text: string
      isStreaming: boolean
    } }
  | { kind: "delegation"; id: string; data: ACPDelegationProgress }


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
  ttsText?: string
  isLast: boolean
  isComplete: boolean
  hasErrors: boolean
  wasStopped?: boolean
  isExpanded: boolean
  onToggleExpand: () => void
  /** Variant controls TTS auto-play - only 'overlay' variant auto-plays TTS to prevent double playback */
  variant?: "default" | "overlay" | "tile"
  /** Session ID for tracking TTS playback across remounts */
  sessionId?: string
}> = ({ message, ttsText, isLast, isComplete, hasErrors, wasStopped = false, isExpanded, onToggleExpand, variant = "default", sessionId }) => {
  const [audioData, setAudioData] = useState<ArrayBuffer | null>(null)
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false)
  const [ttsError, setTtsError] = useState<string | null>(null)
  const [isCopied, setIsCopied] = useState(false)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Track the ttsKey that's currently being generated, so we can clean it up on unmount
  const inFlightTtsKeyRef = useRef<string | null>(null)
  const configQuery = useConfigQuery()

  // Cleanup copy timeout and in-flight TTS key on unmount
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current)
      }
      // If we're unmounting while TTS generation is in-flight, remove the key
      // from the tracking set so future mounts can retry generation
      if (inFlightTtsKeyRef.current) {
        sessionsWithTTSPlayed.delete(inFlightTtsKeyRef.current)
        inFlightTtsKeyRef.current = null
      }
    }
  }, [])

  // Copy to clipboard handler
  const handleCopyResponse = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(message.content)
      setIsCopied(true)
      // Clear any existing timeout before setting a new one
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current)
      }
      copyTimeoutRef.current = setTimeout(() => setIsCopied(false), 2000)
    } catch (err) {
      console.error("Failed to copy response:", err)
    }
  }

  const displayResults = (message.toolResults || []).filter(
    (r) =>
      (r.error && r.error.trim().length > 0) ||
      (r.content && r.content.trim().length > 0),
  )
  const hasExtras =
    (message.toolCalls?.length ?? 0) > 0 ||
    displayResults.length > 0
  const shouldCollapse = (message.content?.length ?? 0) > 100 || hasExtras

  // TTS functionality
  const generateAudio = async (): Promise<ArrayBuffer> => {
    if (!configQuery.data?.ttsEnabled) {
      throw new Error("TTS is not enabled")
    }

    setIsGeneratingAudio(true)
    setTtsError(null)

    try {
      const result = await tipcClient.generateSpeech({
        text: ttsText || message.content,
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
          errorMessage = "Groq TTS model requires terms acceptance. Visit the Groq Playground with the model selected to accept terms."
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

  // Invalidate cached audio when the TTS source text changes (e.g. via a later progress merge)
  // so stale audio from a previous text is never played alongside the new text.
  const prevTtsTextRef = useRef(ttsText)
  useEffect(() => {
    if (prevTtsTextRef.current !== ttsText) {
      prevTtsTextRef.current = ttsText
      setAudioData(null)
    }
  }, [ttsText])

  // Check if TTS should be shown for this message
  const shouldShowTTS = message.role === "assistant" && isComplete && isLast && configQuery.data?.ttsEnabled

  // Auto-play TTS when assistant message completes (but NOT if agent was stopped by kill switch)
  //
  // TTS AUTO-PLAY STRATEGY (fixes #557 - double TTS playback):
  // - Only auto-play in "overlay" variant (panel window) to prevent double playback
  // - The panel window is the primary interaction point for agent sessions
  // - When a non-snoozed session is active, the panel window is automatically shown
  // - Snoozed sessions don't show the panel, and intentionally don't auto-play TTS
  //   (they run silently in background - user can unsnooze to see/hear them)
  // - The "default" variant (main window ConversationDisplay) and "tile" variant (session tiles)
  //   never auto-play TTS - they are for viewing/managing, not primary interaction
  // - Additionally, we track which sessions have already played TTS in a module-level set
  //   to prevent double playback when AgentProgress remounts (e.g., when switching between
  //   single-session and multi-session views in the panel)
  useEffect(() => {
    // Only auto-generate and play TTS in overlay variant to prevent double playback
    const shouldAutoPlay = variant === "overlay"
    if (!shouldAutoPlay || !shouldShowTTS || !configQuery.data?.ttsAutoPlay || audioData || isGeneratingAudio || ttsError || wasStopped) {
      return
    }

    // Create a key to track TTS playback for this specific session + content combination
    const ttsContent = ttsText || message.content
    const ttsKey = sessionId ? `${sessionId}:${ttsContent}` : null

    // If we have a session key and TTS has already played for this content, skip
    if (ttsKey && sessionsWithTTSPlayed.has(ttsKey)) {
      return
    }

    // Mark as playing before starting generation to prevent race conditions
    if (ttsKey) {
      sessionsWithTTSPlayed.add(ttsKey)
      // Track in-flight key so we can clean up on unmount
      inFlightTtsKeyRef.current = ttsKey
    }

    generateAudio()
      .then(() => {
        // Generation succeeded, clear the in-flight ref (key stays in set permanently)
        inFlightTtsKeyRef.current = null
      })
      .catch((error) => {
        // If generation fails, remove from the set so user can retry
        if (ttsKey) {
          sessionsWithTTSPlayed.delete(ttsKey)
        }
        inFlightTtsKeyRef.current = null
        // Error is already handled in generateAudio function
      })
  }, [shouldShowTTS, configQuery.data?.ttsAutoPlay, audioData, isGeneratingAudio, ttsError, wasStopped, variant, sessionId, ttsText, message.content])

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
      case "user": return <span className="i-mingcute-user-3-line h-3 w-3 text-blue-500" />
      case "assistant": return <span className="i-mingcute-android-2-line h-3 w-3 text-gray-500" />
      case "tool": return <span className="i-mingcute-tool-line h-3 w-3 text-orange-500" />
    }
  }

  const handleToggleExpand = () => {
    if (shouldCollapse) {
      onToggleExpand()
    }
  }

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent triggering the message click
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
          <MarkdownRenderer content={(message.content ?? "").trim()} />
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
                          ? "border-green-200/50 bg-green-50/30 text-green-800 dark:border-green-700/50 dark:bg-green-950/40 dark:text-green-200"
                          : "border-red-200/50 bg-red-50/30 text-red-800 dark:border-red-700/50 dark:bg-red-950/40 dark:text-red-200",
                      )}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className={cn(
                          "font-semibold flex items-center gap-1",
                          result.success ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                        )}>
                          {result.success ? (
                            <><Check className="h-3 w-3" /> Success</>
                          ) : (
                            <><XCircle className="h-3 w-3" /> Error</>
                          )}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] opacity-60 font-mono">
                            {(result.content?.length || 0).toLocaleString()} chars
                          </span>
                          <Badge variant="outline" className="text-xs">
                            Result {index + 1}
                          </Badge>
                        </div>
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
                text={ttsText || message.content}
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
                        href="https://console.groq.com/playground?model=canopylabs%2Forpheus-v1-english"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:no-underline"
                      >
                        Click here to open the Playground
                      </a>{" "}
                      and accept the terms when prompted.
                    </>
                  ) : (
                    ttsError
                  )}
                </div>
              )}
            </div>


          )}


        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Copy button for user prompts and final assistant response */}
          {(message.role === "user" || (message.role === "assistant" && isLast && isComplete)) && (
            <button
              onClick={handleCopyResponse}
              className="p-1 rounded hover:bg-muted/30 transition-colors"
              title={isCopied ? "Copied!" : message.role === "user" ? "Copy prompt" : "Copy response"}
              aria-label={isCopied ? "Copied!" : message.role === "user" ? "Copy prompt" : "Copy response"}
            >
              {isCopied ? (
                <CheckCheck className="h-3 w-3 text-green-500" />
              ) : (
                <Copy className="h-3 w-3 opacity-60 hover:opacity-100" />
              )}
            </button>
          )}
          {shouldCollapse && (
            <button
              onClick={handleChevronClick}
              className="p-1 rounded hover:bg-muted/30 transition-colors"
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
  const copy = async (text: string) => {
    try {
      await navigator.clipboard?.writeText(text)
    } catch {}
  }

  const handleToggleExpand = () => onToggleExpand()

  const handleCopy = (e: React.MouseEvent, text: string) => {
    e.stopPropagation()
    copy(text)
  }

  // Compact single-line per tool display
  return (
    <div className="space-y-0.5 text-xs">
      {execution.calls.map((call, idx) => {
        const result = execution.results[idx]
        const callIsPending = !result
        const callSuccess = result?.success
        const callResultSummary = result ? getToolResultsSummary([result]) : null
        const isToolExpanded = isExpanded

        return (
          <div key={idx}>
            {/* Single line tool header */}
            <div
              className={cn(
                "flex items-center gap-1.5 py-0.5 px-1.5 rounded text-[11px] cursor-pointer hover:bg-muted/30",
                callIsPending
                  ? "text-blue-600 dark:text-blue-400"
                  : callSuccess
                    ? "text-green-600 dark:text-green-400"
                    : "text-red-600 dark:text-red-400",
              )}
              onClick={handleToggleExpand}
            >
              <span className={cn(
                "i-mingcute-tool-line h-2.5 w-2.5 flex-shrink-0",
                callIsPending ? "text-blue-500" : callSuccess ? "text-green-500" : "text-red-500"
              )} />
              <span className="font-mono font-medium truncate">{call.name}</span>
              <span className="text-[10px]">
                {callIsPending ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                ) : callSuccess ? (
                  <Check className="h-2.5 w-2.5" />
                ) : (
                  <XCircle className="h-2.5 w-2.5" />
                )}
              </span>
              {!isToolExpanded && callResultSummary && (
                <span className="text-[10px] opacity-50 truncate flex-1">{callResultSummary}</span>
              )}
              <ChevronRight className={cn(
                "h-2.5 w-2.5 opacity-40 flex-shrink-0 transition-transform",
                isToolExpanded && "rotate-90"
              )} />
            </div>

            {/* Expanded details for this tool */}
            {isToolExpanded && (
              <div className="ml-4 mt-0.5 mb-1 border-l border-border/50 pl-2 space-y-1 text-[10px]">
                {call.arguments && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="font-medium opacity-70">Parameters</span>
                      <Button size="sm" variant="ghost" className="h-4 px-1 text-[9px]" onClick={(e) => handleCopy(e, JSON.stringify(call.arguments, null, 2))}>
                        <Copy className="h-2 w-2 mr-0.5" /> Copy
                      </Button>
                    </div>
                    <pre className="rounded bg-muted/40 p-1.5 overflow-auto whitespace-pre-wrap max-h-32 scrollbar-thin">
                      {JSON.stringify(call.arguments, null, 2)}
                    </pre>
                  </>
                )}
                {result && (
                  <>
                    <div className="flex items-center justify-between">
                      <span className={cn(
                        "font-medium",
                        result.success ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                      )}>
                        {result.success ? "Result" : "Error"}
                      </span>
                      <span className="opacity-50 text-[9px]">{(result.content?.length || 0).toLocaleString()} chars</span>
                    </div>
                    {result.error && (
                      <pre className="rounded p-1.5 overflow-auto whitespace-pre-wrap break-all max-h-32 scrollbar-thin bg-red-50/50 dark:bg-red-950/30 text-red-700 dark:text-red-300">
                        {result.error}
                      </pre>
                    )}
                    {result.content && (
                      <pre className={cn(
                        "rounded p-1.5 overflow-auto whitespace-pre-wrap break-all max-h-32 scrollbar-thin",
                        result.success ? "bg-green-50/50 dark:bg-green-950/30" : "bg-muted/40"
                      )}>
                        {result.content}
                      </pre>
                    )}
                    {!result.error && !result.content && (
                      <pre className="rounded p-1.5 overflow-auto whitespace-pre-wrap break-all max-h-32 scrollbar-thin bg-muted/40">
                        No content
                      </pre>
                    )}
                  </>
                )}
                {callIsPending && (
                  <div className="text-[10px] opacity-60 italic py-1">
                    Waiting for response...
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// Unified Assistant + Tool Execution component - combines thought and tool call as one message
const AssistantWithToolsBubble: React.FC<{
  data: {
    thought: string
    timestamp: number
    isComplete: boolean
    calls: Array<{ name: string; arguments: any }>
    results: Array<{ success: boolean; content: string; error?: string }>
    executionStats?: {
      durationMs?: number
      totalTokens?: number
      model?: string
    }
  }
  isExpanded: boolean
  onToggleExpand: () => void
}> = ({ data, isExpanded, onToggleExpand }) => {
  const [showToolDetails, setShowToolDetails] = useState(false)

  const isPending = data.results.length === 0
  const allSuccess = data.results.length > 0 && data.results.every(r => r.success)
  const hasThought = data.thought && data.thought.trim().length > 0
  const shouldCollapse = (data.thought?.length ?? 0) > 100 || data.calls.length > 0

  // Generate result summary for collapsed state
  const collapsedResultSummary = (() => {
    if (isExpanded || isPending) return null
    if (data.results.length === 0) return null
    const toolResults = data.results.map(r => ({
      success: r.success,
      content: r.content,
      error: r.error,
    }))
    return getToolResultsSummary(toolResults)
  })()

  const handleToggleExpand = () => {
    if (shouldCollapse) {
      onToggleExpand()
    }
  }

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onToggleExpand()
  }

  const handleToggleToolDetails = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowToolDetails(!showToolDetails)
  }

  // Tool names for display
  const toolNames = data.calls.map(c => c.name).join(', ')
  const toolCount = data.calls.length

  return (
    <div className={cn(
      "rounded text-xs transition-all duration-200",
      "border-l-2 border-gray-400 bg-gray-400/5",
      !isExpanded && shouldCollapse && "hover:bg-muted/20",
      shouldCollapse && "cursor-pointer"
    )}>
      {/* Thought content section */}
      <div
        className="flex items-start gap-2 px-2 py-1 text-left"
        onClick={handleToggleExpand}
      >
        <span className="i-mingcute-android-2-line h-3 w-3 text-gray-500 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          {hasThought && (
            <div className={cn(
              "leading-relaxed text-left",
              !isExpanded && shouldCollapse && "line-clamp-2"
            )}>
              <MarkdownRenderer content={data.thought.trim()} />
            </div>
          )}

          {/* Tool execution section - compact single line per tool */}
          <div className={cn(
            hasThought ? "mt-1" : "",
            "space-y-0.5"
          )}>
            {data.calls.map((call, idx) => {
              const result = data.results[idx]
              const callIsPending = !result
              const callSuccess = result?.success
              const callResultSummary = result ? getToolResultsSummary([result]) : null

              return (
                <div
                  key={idx}
                  className={cn(
                    "flex items-center gap-1.5 py-0.5 px-1 rounded text-[11px] cursor-pointer hover:bg-muted/30",
                    callIsPending
                      ? "text-blue-600 dark:text-blue-400"
                      : callSuccess
                        ? "text-green-600 dark:text-green-400"
                        : "text-red-600 dark:text-red-400",
                  )}
                  onClick={handleToggleToolDetails}
                >
                  <span className={cn(
                    "i-mingcute-tool-line h-2.5 w-2.5 flex-shrink-0",
                    callIsPending ? "text-blue-500" : callSuccess ? "text-green-500" : "text-red-500"
                  )} />
                  <span className="font-mono font-medium truncate">{call.name}</span>
                  <span className="text-[10px] opacity-60">
                    {callIsPending ? (
                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    ) : callSuccess ? (
                      <Check className="h-2.5 w-2.5" />
                    ) : (
                      <XCircle className="h-2.5 w-2.5" />
                    )}
                  </span>
                  {!showToolDetails && callResultSummary && (
                    <span className="text-[10px] opacity-50 truncate flex-1">{callResultSummary}</span>
                  )}
                  <ChevronRight className={cn(
                    "h-2.5 w-2.5 opacity-40 flex-shrink-0 transition-transform",
                    showToolDetails && "rotate-90"
                  )} />
                </div>
              )
            })}
          </div>

          {/* Expanded tool details */}
          {showToolDetails && (
            <div className="mt-1 space-y-1 ml-4 border-l border-border/50 pl-2">
              {data.calls.map((call, idx) => {
                const result = data.results[idx]
                return (
                  <div key={idx} className="text-[10px] space-y-1">
                    <div className="font-medium opacity-70">Parameters:</div>
                    {call.arguments && (
                      <pre className="rounded bg-muted/40 p-1.5 overflow-auto whitespace-pre-wrap max-h-32 scrollbar-thin text-[10px]">
                        {JSON.stringify(call.arguments, null, 2)}
                      </pre>
                    )}
                    {result && (
                      <>
                        <div className="font-medium opacity-70 flex items-center gap-1">
                          Result:
                          <span className={cn(
                            "text-[9px] font-semibold",
                            result.success ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                          )}>
                            {result.success ? "OK" : "ERR"}
                          </span>
                        </div>
                        {result.error && (
                          <pre className="rounded p-1.5 overflow-auto whitespace-pre-wrap break-all max-h-32 scrollbar-thin text-[10px] bg-red-50/50 dark:bg-red-950/30 text-red-700 dark:text-red-300">
                            {result.error}
                          </pre>
                        )}
                        {result.content && (
                          <pre className={cn(
                            "rounded p-1.5 overflow-auto whitespace-pre-wrap break-all max-h-32 scrollbar-thin text-[10px]",
                            result.success ? "bg-green-50/50 dark:bg-green-950/30" : "bg-muted/40"
                          )}>
                            {result.content}
                          </pre>
                        )}
                        {!result.error && !result.content && (
                          <pre className="rounded p-1.5 overflow-auto whitespace-pre-wrap break-all max-h-32 scrollbar-thin text-[10px] bg-muted/40">
                            No content
                          </pre>
                        )}
                      </>
                    )}
                  </div>
                )
              })}
              {data.executionStats && (
                <ToolExecutionStats stats={data.executionStats} compact />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Helper function to format tool arguments for preview
const formatArgumentsPreview = (args: any): string => {
  if (!args || typeof args !== 'object') return ''
  const entries = Object.entries(args)
  if (entries.length === 0) return ''

  // Take first 3 key parameters
  const preview = entries.slice(0, 3).map(([key, value]) => {
    let displayValue: string
    if (typeof value === 'string') {
      displayValue = value.length > 30 ? value.slice(0, 30) + '...' : value
    } else if (typeof value === 'object') {
      displayValue = Array.isArray(value) ? `[${value.length} items]` : '{...}'
    } else {
      displayValue = String(value)
    }
    return `${key}: ${displayValue}`
  }).join(', ')

  if (entries.length > 3) {
    return preview + ` (+${entries.length - 3} more)`
  }
  return preview
}

// Inline Tool Approval bubble - appears in the conversation flow
const ToolApprovalBubble: React.FC<{
  approval: {
    approvalId: string
    toolName: string
    arguments: any
  }
  onApprove: () => void
  onDeny: () => void
  isResponding: boolean
}> = ({ approval, onApprove, onDeny, isResponding }) => {
  const [showArgs, setShowArgs] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Keyboard shortcut handler for tool approval
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if already responding or if user is typing in an input
      if (isResponding) return
      const target = e.target as HTMLElement
      // Ignore when focus is on interactive elements to preserve standard keyboard navigation
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'BUTTON' ||
        target.tagName === 'A' ||
        target.isContentEditable
      ) {
        return
      }

      // Use e.code for more consistent Space detection across browsers/platforms
      // Space to approve (without modifiers)
      if (e.code === 'Space' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault()
        onApprove()
      }
      // Shift+Space to deny
      else if (e.code === 'Space' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault()
        onDeny()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isResponding, onApprove, onDeny])

  // Generate preview text for collapsed view hint
  const argsPreview = formatArgumentsPreview(approval.arguments)

  return (
    <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/30 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-100/50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800">
        <Shield className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
        <span className="text-xs font-medium text-amber-800 dark:text-amber-200">
          {isResponding ? "Processing..." : "Tool Approval Required"}
        </span>
        {isResponding && (
          <Loader2 className="h-3 w-3 text-amber-600 dark:text-amber-400 animate-spin ml-auto" />
        )}
      </div>

      {/* Content */}
      <div ref={containerRef} className={cn("px-3 py-2", isResponding && "opacity-60")}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-amber-700 dark:text-amber-300">Tool:</span>
          <code className="text-xs font-mono font-medium text-amber-900 dark:text-amber-100 bg-amber-100 dark:bg-amber-900/50 px-1.5 py-0.5 rounded">
            {approval.toolName}
          </code>
        </div>

        {/* Arguments preview - always visible */}
        {argsPreview && (
          <div className="mb-2 text-xs text-amber-700/80 dark:text-amber-300/80 font-mono truncate" title={argsPreview}>
            {argsPreview}
          </div>
        )}

        {/* Expandable arguments */}
        <div className="mb-3">
          <button
            onClick={() => setShowArgs(!showArgs)}
            className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200"
            disabled={isResponding}
          >
            <ChevronRight className={cn("h-3 w-3 transition-transform", showArgs && "rotate-90")} />
            {showArgs ? "Hide" : "View"} full arguments
          </button>
          {showArgs && (
            <pre className="mt-1.5 p-2 text-xs bg-amber-100/70 dark:bg-amber-900/40 rounded overflow-x-auto max-h-32 text-amber-900 dark:text-amber-100">
              {JSON.stringify(approval.arguments, null, 2)}
            </pre>
          )}
        </div>

        {/* Action buttons with hotkey hints */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950/30"
            onClick={onDeny}
            disabled={isResponding}
            title="Press Shift+Space to deny"
          >
            <XCircle className="h-3 w-3 mr-1" />
            Deny
            <kbd className="ml-1.5 px-1 py-0.5 text-[9px] font-mono bg-red-100 dark:bg-red-900/50 rounded">Shift+Space</kbd>
          </Button>
          <Button
            size="sm"
            className={cn(
              "h-7 text-xs text-white",
              isResponding
                ? "bg-green-500 cursor-not-allowed"
                : "bg-green-600 hover:bg-green-700"
            )}
            onClick={onApprove}
            disabled={isResponding}
            title="Press Space to approve"
          >
            {isResponding ? (
              <>
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Check className="h-3 w-3 mr-1" />
                Approve
                <kbd className="ml-1.5 px-1 py-0.5 text-[9px] font-mono bg-green-700 rounded">Space</kbd>
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

// Retry Status Banner - shows when LLM API is being retried (rate limits, network errors)
const RetryStatusBanner: React.FC<{
  retryInfo: {
    isRetrying: boolean
    attempt: number
    maxAttempts?: number
    delaySeconds: number
    reason: string
    startedAt: number
  }
}> = ({ retryInfo }) => {
  const [countdown, setCountdown] = useState(retryInfo.delaySeconds)

  // Update countdown timer
  useEffect(() => {
    if (!retryInfo.isRetrying) {
      setCountdown(0)
      return undefined
    }

    // Calculate remaining time based on startedAt
    const updateCountdown = () => {
      const elapsed = Math.floor((Date.now() - retryInfo.startedAt) / 1000)
      const remaining = Math.max(0, retryInfo.delaySeconds - elapsed)
      setCountdown(remaining)
    }

    updateCountdown()
    const interval = setInterval(updateCountdown, 1000)
    return () => clearInterval(interval)
  }, [retryInfo.isRetrying, retryInfo.startedAt, retryInfo.delaySeconds])

  if (!retryInfo.isRetrying) return null

  const attemptText = retryInfo.maxAttempts
    ? `Attempt ${retryInfo.attempt}/${retryInfo.maxAttempts}`
    : `Attempt ${retryInfo.attempt}`

  return (
    <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/30 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-100/50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800">
        <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
        <span className="text-xs font-medium text-amber-800 dark:text-amber-200">
          {retryInfo.reason}
        </span>
        <Loader2 className="h-3 w-3 text-amber-600 dark:text-amber-400 animate-spin ml-auto" />
      </div>

      {/* Content */}
      <div className="px-3 py-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-amber-700 dark:text-amber-300">
            {attemptText}
          </span>
          <span className="text-xs font-mono font-medium text-amber-900 dark:text-amber-100 bg-amber-100 dark:bg-amber-900/50 px-2 py-0.5 rounded">
            Retrying in {countdown}s
          </span>
        </div>
        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5">
          The agent will automatically retry when the API is available.
        </p>
      </div>
    </div>
  )
}

// Subagent Conversation Message - individual message in the collapsible conversation
const SubAgentConversationMessage: React.FC<{
  message: ACPSubAgentMessage
  agentName: string
  isExpanded: boolean
  onToggleExpand: () => void
}> = ({ message, agentName, isExpanded, onToggleExpand }) => {
  const [isCopied, setIsCopied] = useState(false)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current)
      }
    }
  }, [])

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(message.content)
      setIsCopied(true)
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current)
      }
      copyTimeoutRef.current = setTimeout(() => setIsCopied(false), 2000)
    } catch (err) {
      console.error("Failed to copy message:", err)
    }
  }

  const isLongContent = message.content.length > 300
  const shouldShowToggle = isLongContent

  const getRoleStyle = () => {
    switch (message.role) {
      case 'user':
        return "border-l-2 border-blue-400 bg-blue-50/50 dark:bg-blue-900/20"
      case 'assistant':
        return "border-l-2 border-purple-400 bg-purple-50/50 dark:bg-purple-900/20"
      case 'tool':
        return "border-l-2 border-amber-400 bg-amber-50/50 dark:bg-amber-900/20"
      default:
        return "border-l-2 border-gray-400 bg-gray-50/50 dark:bg-gray-900/20"
    }
  }

  const getRoleIcon = () => {
    switch (message.role) {
      case 'user': return "📤"
      case 'assistant': return "🤖"
      case 'tool': return "🔧"
      default: return "💬"
    }
  }

  const getRoleLabel = () => {
    switch (message.role) {
      case 'user': return "Task"
      case 'assistant': return agentName
      case 'tool': return message.toolName || "Tool"
      default: return "Message"
    }
  }

  return (
    <div className={cn("rounded-md text-xs transition-all", getRoleStyle())}>
      <div
        className={cn(
          "flex items-start gap-2 px-2 py-1.5",
          shouldShowToggle && "cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
        )}
        onClick={shouldShowToggle ? onToggleExpand : undefined}
      >
        <span className="opacity-60 mt-0.5 flex-shrink-0">{getRoleIcon()}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">
              {getRoleLabel()}
            </span>
            {message.timestamp && (
              <span className="text-[9px] text-gray-400 dark:text-gray-500">
                {new Date(message.timestamp).toLocaleTimeString()}
              </span>
            )}
          </div>
          <div className={cn(
            "whitespace-pre-wrap break-words text-gray-700 dark:text-gray-300",
            !isExpanded && isLongContent && "line-clamp-3"
          )}>
            {message.content}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={handleCopy}
            className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
            title={isCopied ? "Copied!" : "Copy message"}
          >
            {isCopied ? (
              <CheckCheck className="h-3 w-3 text-green-500" />
            ) : (
              <Copy className="h-3 w-3 opacity-50 hover:opacity-100" />
            )}
          </button>
          {shouldShowToggle && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleExpand() }}
              className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
            >
              {isExpanded ? (
                <ChevronUp className="h-3 w-3 opacity-60" />
              ) : (
                <ChevronDown className="h-3 w-3 opacity-60" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// Collapsible Subagent Conversation Panel
const SubAgentConversationPanel: React.FC<{
  conversation: ACPSubAgentMessage[]
  agentName: string
  isOpen: boolean
  onToggle: () => void
}> = ({ conversation, agentName, isOpen, onToggle }) => {
  const [expandedMessages, setExpandedMessages] = useState<Record<number, boolean>>({})
  const scrollRef = useRef<HTMLDivElement>(null)

  const toggleMessage = (index: number) => {
    setExpandedMessages(prev => ({
      ...prev,
      [index]: !prev[index]
    }))
  }

  const handleCopyAll = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const fullConversation = conversation.map(msg => {
      const role = msg.role === 'user' ? 'Task' : msg.role === 'assistant' ? agentName : (msg.toolName || 'Tool')
      return `[${role}]\n${msg.content}`
    }).join('\n\n---\n\n')
    try {
      await navigator.clipboard.writeText(fullConversation)
    } catch (err) {
      console.error("Failed to copy conversation:", err)
    }
  }

  return (
    <div className="mt-3 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      {/* Collapsible Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800/50 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        onClick={onToggle}
      >
        <Bot className="h-3.5 w-3.5 text-purple-500 dark:text-purple-400" />
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
          Subagent Conversation
        </span>
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
          {conversation.length} messages
        </Badge>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={handleCopyAll}
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            title="Copy entire conversation"
          >
            <Copy className="h-3 w-3 opacity-60 hover:opacity-100" />
          </button>
          {isOpen ? (
            <ChevronUp className="h-4 w-4 text-gray-500" />
          ) : (
            <ChevronDown className="h-4 w-4 text-gray-500" />
          )}
        </div>
      </div>

      {/* Collapsible Content */}
      {isOpen && (
        <div
          ref={scrollRef}
          className="max-h-[400px] overflow-y-auto p-2 space-y-2 bg-white/50 dark:bg-black/20"
        >
          {conversation.map((msg, idx) => (
            <SubAgentConversationMessage
              key={idx}
              message={msg}
              agentName={agentName}
              isExpanded={expandedMessages[idx] ?? false}
              onToggleExpand={() => toggleMessage(idx)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Delegation Bubble - shows status of delegated subagent tasks
// The entire component is collapsible, and conversations persist after completion
const DelegationBubble: React.FC<{
  delegation: ACPDelegationProgress
  isExpanded?: boolean
  onToggleExpand?: () => void
}> = ({ delegation, isExpanded = true, onToggleExpand }) => {
  const [isConversationOpen, setIsConversationOpen] = useState(false)
  const isRunning = delegation.status === 'running' || delegation.status === 'pending'
  const isCompleted = delegation.status === 'completed'
  const isFailed = delegation.status === 'failed'
  const isCancelled = delegation.status === 'cancelled'
  const hasConversation = delegation.conversation && delegation.conversation.length > 0

  // Track live elapsed time only while running
  const [liveElapsed, setLiveElapsed] = useState(0)
  
  useEffect(() => {
    // Only run timer while the delegation is actively running
    if (!isRunning) {
      return undefined
    }
    
    // Update immediately
    setLiveElapsed(Math.round((Date.now() - delegation.startTime) / 1000))
    
    // Update every second
    const interval = setInterval(() => {
      setLiveElapsed(Math.round((Date.now() - delegation.startTime) / 1000))
    }, 1000)
    
    return () => clearInterval(interval)
  }, [isRunning, delegation.startTime])

  // Calculate duration:
  // - If endTime exists (completed/failed), use it for accurate final duration
  // - If still running, use the live timer
  // - Fallback: shouldn't happen, but use endTime-based or 0
  const duration = delegation.endTime
    ? Math.round((delegation.endTime - delegation.startTime) / 1000)
    : isRunning
      ? liveElapsed
      : 0

  const statusColor = isCompleted
    ? 'border-green-300 dark:border-green-700 bg-green-50/50 dark:bg-green-950/30'
    : isFailed
    ? 'border-red-300 dark:border-red-700 bg-red-50/50 dark:bg-red-950/30'
    : isCancelled
    ? 'border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/30'
    : 'border-blue-300 dark:border-blue-700 bg-blue-50/50 dark:bg-blue-950/30'

  const headerColor = isCompleted
    ? 'bg-green-100/50 dark:bg-green-900/30 border-green-200 dark:border-green-800'
    : isFailed
    ? 'bg-red-100/50 dark:bg-red-900/30 border-red-200 dark:border-red-800'
    : isCancelled
    ? 'bg-amber-100/50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800'
    : 'bg-blue-100/50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800'

  const textColor = isCompleted
    ? 'text-green-800 dark:text-green-200'
    : isFailed
    ? 'text-red-800 dark:text-red-200'
    : isCancelled
    ? 'text-amber-800 dark:text-amber-200'
    : 'text-blue-800 dark:text-blue-200'

  const iconColor = isCompleted
    ? 'text-green-600 dark:text-green-400'
    : isFailed
    ? 'text-red-600 dark:text-red-400'
    : isCancelled
    ? 'text-amber-600 dark:text-amber-400'
    : 'text-blue-600 dark:text-blue-400'

  const handleHeaderClick = () => {
    onToggleExpand?.()
  }

  return (
    <div className={cn("rounded-lg border overflow-hidden", statusColor)}>
      {/* Header - clickable to collapse/expand entire bubble */}
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2 cursor-pointer hover:opacity-90 transition-opacity",
          isExpanded && "border-b",
          headerColor
        )}
        onClick={handleHeaderClick}
      >
        <Bot className={cn("h-3.5 w-3.5", iconColor)} />
        <span className={cn("text-xs font-medium", textColor)}>
          {delegation.agentName}
        </span>
        {hasConversation && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-gray-500 dark:text-gray-400">
            {delegation.conversation!.length} msgs
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-1">
          {isRunning && (
            <Loader2 className={cn("h-3 w-3 animate-spin", iconColor)} />
          )}
          {isCompleted && (
            <Check className={cn("h-3 w-3", iconColor)} />
          )}
          {isFailed && (
            <XCircle className={cn("h-3 w-3", iconColor)} />
          )}
          {isCancelled && (
            <OctagonX className={cn("h-3 w-3", iconColor)} />
          )}
          <span className="text-[10px] font-mono text-gray-500 dark:text-gray-400 ml-1">
            {duration}s
          </span>
          {/* Collapse/Expand chevron */}
          {isExpanded ? (
            <ChevronUp className="h-3.5 w-3.5 text-gray-400 ml-1" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-gray-400 ml-1" />
          )}
        </div>
      </div>

      {/* Collapsed preview - show task snippet when collapsed */}
      {!isExpanded && (
        <div className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 truncate">
          {delegation.task.length > 60
            ? `${delegation.task.substring(0, 60)}...`
            : delegation.task}
        </div>
      )}

      {/* Content - only shown when expanded */}
      {isExpanded && (
        <div className="px-3 py-2">
          <p className={cn("text-xs", textColor.replace('800', '700').replace('200', '300'))}>
            {delegation.task.length > 100
              ? `${delegation.task.substring(0, 100)}...`
              : delegation.task}
          </p>

          {/* Progress message */}
          {delegation.progressMessage && (
            <p className={cn("text-xs mt-1 italic", textColor.replace('800', '600').replace('200', '400'))}>
              {delegation.progressMessage}
            </p>
          )}

          {/* Collapsible conversation panel - persists after completion */}
          {hasConversation && (
            <SubAgentConversationPanel
              conversation={delegation.conversation!}
              agentName={delegation.agentName}
              isOpen={isConversationOpen}
              onToggle={() => setIsConversationOpen(!isConversationOpen)}
            />
          )}

          {/* Result summary (when conversation is collapsed) */}
          {!isConversationOpen && delegation.resultSummary && (
            <div className="mt-2 p-2 rounded bg-white/50 dark:bg-black/20">
              <p className="text-xs text-gray-700 dark:text-gray-300">
                {delegation.resultSummary.length > 150
                  ? `${delegation.resultSummary.substring(0, 150)}...`
                  : delegation.resultSummary}
              </p>
            </div>
          )}

          {/* Error message */}
          {delegation.error && (
            <div className="mt-2 p-2 rounded bg-red-100/50 dark:bg-red-900/30">
              <p className="text-xs text-red-700 dark:text-red-300">
                {delegation.error}
              </p>
            </div>
          )}

          {/* Status footer */}
          <div className="flex items-center justify-between mt-2">
            <span className={cn("text-xs", textColor.replace('800', '600').replace('200', '400'))}>
              {isRunning ? 'Running' : isCompleted ? 'Completed' : isCancelled ? 'Cancelled' : 'Failed'}
            </span>
            {hasConversation && !isConversationOpen && (
              <button
                onClick={(e) => { e.stopPropagation(); setIsConversationOpen(true) }}
                className="text-[10px] text-purple-600 dark:text-purple-400 hover:underline"
              >
                View conversation
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Streaming Content Bubble - shows real-time LLM response as it's being generated
const StreamingContentBubble: React.FC<{
  streamingContent: {
    text: string
    isStreaming: boolean
  }
}> = ({ streamingContent }) => {
  if (!streamingContent.text) return null

  return (
    <div className="rounded-lg border border-blue-300 dark:border-blue-700 bg-blue-50/50 dark:bg-blue-950/30 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-blue-100/50 dark:bg-blue-900/30 border-b border-blue-200 dark:border-blue-800">
        <Activity className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
        <span className="text-xs font-medium text-blue-800 dark:text-blue-200">
          {streamingContent.isStreaming ? "Generating response..." : "Response"}
        </span>
        {streamingContent.isStreaming && (
          <Loader2 className="h-3 w-3 text-blue-600 dark:text-blue-400 animate-spin ml-auto" />
        )}
      </div>

      {/* Content */}
      <div className="px-3 py-2">
        <div className="text-xs text-blue-900 dark:text-blue-100 whitespace-pre-wrap break-words">
          <MarkdownRenderer content={streamingContent.text} />
          {streamingContent.isStreaming && (
            <span className="inline-block w-1.5 h-3.5 bg-blue-600 dark:bg-blue-400 animate-pulse ml-0.5 align-text-bottom" />
          )}
        </div>
      </div>
    </div>
  )
}


export const AgentProgress: React.FC<AgentProgressProps> = ({
  progress,
  className,
  variant = "default",
  isFocused,
  onFocus,
  onDismiss,
  isCollapsed: controlledIsCollapsed,
  onCollapsedChange,
  onFollowUpSent,
  onExpand,
  isExpanded,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [isUserScrolling, setIsUserScrolling] = useState(false)
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true)
  const lastMessageCountRef = useRef(0)
  const lastContentLengthRef = useRef(0)
  const lastDisplayItemsCountRef = useRef(0)
  const lastSessionIdRef = useRef<string | undefined>(undefined)
  const [showKillConfirmation, setShowKillConfirmation] = useState(false)
  const [isKilling, setIsKilling] = useState(false)
  const { isDark } = useTheme()

  // Tile-specific state - support controlled mode
  const [internalIsCollapsed, setInternalIsCollapsed] = useState(false)
  const isCollapsed = controlledIsCollapsed ?? internalIsCollapsed

  // Use shared resize hook for tile variant
  const {
    height: tileHeight,
    isResizing,
    handleHeightResizeStart: handleResizeStart,
  } = useResizable({
    initialHeight: TILE_DIMENSIONS.height.default,
    minHeight: TILE_DIMENSIONS.height.min,
    maxHeight: TILE_DIMENSIONS.height.max,
  })

  // Handle tile collapse toggle
  const handleToggleCollapse = (e: React.MouseEvent) => {
    e.stopPropagation()
    const newCollapsed = !isCollapsed
    if (onCollapsedChange) {
      onCollapsedChange(newCollapsed)
    } else {
      setInternalIsCollapsed(newCollapsed)
    }
  }

  // Expansion state management - preserve across re-renders
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({})

  // Tab state for Chat/Summary view toggle (only relevant when dual-model is enabled)
  const [activeTab, setActiveTab] = useState<"chat" | "summary">("chat")

  // Get current conversation ID for deep-linking and session focus control
  const currentConversationId = useConversationStore((s) => s.currentConversationId)
  const setFocusedSessionId = useAgentStore((s) => s.setFocusedSessionId)
  const setSessionSnoozed = useAgentStore((s) => s.setSessionSnoozed)
  const agentProgressById = useAgentStore((s) => s.agentProgressById)

  // Get queued messages for this conversation (used in overlay variant)
  const queuedMessages = useMessageQueue(progress?.conversationId)
  const isQueuePaused = useIsQueuePaused(progress?.conversationId)
  const hasQueuedMessages = queuedMessages.length > 0

  // Helper to toggle expansion state for a specific item
  // Uses defaultExpanded fallback for items that haven't been explicitly toggled yet
  // (like tool executions which default to expanded)
  // By deriving the current state from prev inside the setter, this is resilient to
  // batched updates (e.g., double-clicks will correctly round-trip)
  const toggleItemExpansion = (itemKey: string, defaultExpanded: boolean) => {
    setExpandedItems(prev => {
      // Use prev[itemKey] if it exists (item was explicitly toggled before),
      // otherwise use the default expanded state for this item type
      const from = itemKey in prev ? prev[itemKey] : defaultExpanded
      const to = !from
      logExpand("AgentProgress", "toggle", { itemKey, from, to })
      return {
        ...prev,
        [itemKey]: to,
      }
    })
  }

  // Kill switch handler - stop only this session, with fallback to global emergency stop
  const handleKillSwitch = async () => {
    if (isKilling) return // Prevent double-clicks

    setIsKilling(true)
    try {
      if (progress?.sessionId) {
        await tipcClient.stopAgentSession({ sessionId: progress.sessionId })
      } else {
        // No session ID available, fall back to global emergency stop
        // so the kill switch always works regardless of state
        await tipcClient.emergencyStopAgent()
      }
      setShowKillConfirmation(false)
    } catch (error) {
      const stopPath = progress?.sessionId ? "stopAgentSession" : "emergencyStopAgent"
      console.error(`Failed to stop agent (via ${stopPath}):`, error)
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

  // Handle snooze/minimize
  const handleSnooze = async (e?: React.MouseEvent) => {
    e?.stopPropagation() // Prevent event bubbling
    if (!progress?.sessionId) return

    logUI('🔴 [AgentProgress OVERLAY] Minimize button clicked in OVERLAY (not sidebar):', {
      sessionId: progress.sessionId,
      currentlySnoozed: progress.isSnoozed
    })

    // Update local store first so UI reflects the change immediately
    setSessionSnoozed(progress.sessionId, true)

    try {
      // Snooze the session in backend
      await tipcClient.snoozeAgentSession({ sessionId: progress.sessionId })
    } catch (error) {
      // Rollback local state only when the API call fails to keep UI and backend in sync
      setSessionSnoozed(progress.sessionId, false)
      logUI('🔴 [AgentProgress OVERLAY] Failed to snooze, rolled back local state')
      console.error("Failed to snooze session:", error)
      return
    }

    // UI updates after successful API call - don't rollback if these fail
    try {
      // Unfocus this session so the overlay hides
      setFocusedSessionId(null)
      // Hide the panel window completely
      await tipcClient.hidePanelWindow({})
      logUI('🔴 [AgentProgress OVERLAY] Session snoozed, unfocused, and panel hidden')
    } catch (error) {
      // Log UI errors but don't rollback - the backend state is already updated
      logUI('🔴 [AgentProgress OVERLAY] Session snoozed but UI update failed')
      console.error("Failed to update UI after snooze:", error)
    }
  }

  // Close button handler for completed agent view
  const handleClose = async () => {
    try {
      const thisId = progress?.sessionId
      const hasOtherVisible = thisId
        ? Array.from(agentProgressById?.values() ?? []).some(p => p && p.sessionId !== thisId && !p.isSnoozed)
        : false

      if (thisId && hasOtherVisible) {
        // Session-scoped dismiss: remove only this session's progress and keep panel open
        await tipcClient.clearAgentSessionProgress({ sessionId: thisId })
      } else {
        // Last visible session: exit agent mode and hide panel
        await tipcClient.closeAgentModeAndHidePanelWindow()
      }
    } catch (error) {
      console.error("Failed to close agent session/panel:", error)
    }
  }

  // Tool approval handlers
  // Track the approval ID we're responding to, to handle race conditions
  const [respondingApprovalId, setRespondingApprovalId] = useState<string | null>(null)
  // Use a ref to synchronously block re-entrancy (prevents double-click race condition)
  const respondingApprovalIdRef = useRef<string | null>(null)

  // Derive isRespondingToApproval from whether we have a pending response for the current approval
  const isRespondingToApproval = respondingApprovalId === progress?.pendingToolApproval?.approvalId

  const handleApproveToolCall = async () => {
    const approvalId = progress?.pendingToolApproval?.approvalId
    console.log(`[Tool Approval UI] handleApproveToolCall called, approvalId=${approvalId}`)
    if (!approvalId) {
      console.log(`[Tool Approval UI] No approvalId found, returning early`)
      return
    }
    // Synchronous check to prevent double-click race condition
    if (respondingApprovalIdRef.current === approvalId) {
      console.log(`[Tool Approval UI] Already responding to this approval, skipping`)
      return
    }

    respondingApprovalIdRef.current = approvalId
    setRespondingApprovalId(approvalId)
    console.log(`[Tool Approval UI] Calling tipcClient.respondToToolApproval with approvalId=${approvalId}, approved=true`)
    try {
      const result = await tipcClient.respondToToolApproval({
        approvalId,
        approved: true,
      })
      console.log(`[Tool Approval UI] respondToToolApproval returned:`, result)
      // Don't reset respondingApprovalId on success - keep showing "Processing..."
      // The approval bubble will be removed when pendingToolApproval is cleared from progress
    } catch (error) {
      console.error("[Tool Approval UI] Failed to approve tool call:", error)
      // Only reset on error so user can retry
      respondingApprovalIdRef.current = null
      setRespondingApprovalId(null)
    }
  }

  const handleDenyToolCall = async () => {
    const approvalId = progress?.pendingToolApproval?.approvalId
    console.log(`[Tool Approval UI] handleDenyToolCall called, approvalId=${approvalId}`)
    if (!approvalId) {
      console.log(`[Tool Approval UI] No approvalId found for deny, returning early`)
      return
    }
    // Synchronous check to prevent double-click race condition
    if (respondingApprovalIdRef.current === approvalId) {
      console.log(`[Tool Approval UI] Already responding to this approval (deny), skipping`)
      return
    }

    respondingApprovalIdRef.current = approvalId
    setRespondingApprovalId(approvalId)
    console.log(`[Tool Approval UI] Calling tipcClient.respondToToolApproval with approvalId=${approvalId}, approved=false`)
    try {
      const result = await tipcClient.respondToToolApproval({
        approvalId,
        approved: false,
      })
      console.log(`[Tool Approval UI] respondToToolApproval (deny) returned:`, result)
      // Don't reset respondingApprovalId on success - keep showing "Processing..."
      // The approval bubble will be removed when pendingToolApproval is cleared from progress
    } catch (error) {
      console.error("[Tool Approval UI] Failed to deny tool call:", error)
      // Only reset on error so user can retry
      respondingApprovalIdRef.current = null
      setRespondingApprovalId(null)
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
    sessionStartIndex,
    contextInfo,
    modelInfo,
    profileName,
    acpSessionInfo,
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
    // Use only the portion of the conversation history that belongs to this session
    const startIndex =
      typeof sessionStartIndex === "number" && sessionStartIndex > 0
        ? Math.min(sessionStartIndex, conversationHistory.length)
        : 0
    const historyForSession =
      startIndex > 0 ? conversationHistory.slice(startIndex) : conversationHistory

    // Filter internal nudges from the visible history
    const isNudge = (c: string) =>
      c.includes("Please either take action using available tools") ||
      c.includes("You have relevant tools available for this request")

    messages = historyForSession
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

    // Add any in-progress thinking from current steps (only when not complete)
    const currentThinkingStep = !isComplete
      ? steps.find(
          (step) => step.type === "thinking" && step.status === "in_progress",
        )
      : undefined
    if (currentThinkingStep) {
      // Don't show assistant message from thinking step when streaming is active
      // to avoid duplicate content (streaming bubble already shows the text)
      const isStreaming = progress.streamingContent?.isStreaming

      if (
        !isStreaming &&
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
      } else if (!isStreaming) {
        // Skip adding a fake "thinking" message for verification steps
        // These steps don't have LLM content and would hide the actual LLM response
        const isVerificationStep = currentThinkingStep.title?.toLowerCase().includes("verifying")
        if (!isVerificationStep) {
          messages.push({
            role: "assistant",
            content: currentThinkingStep.description || "Agent is thinking...",
            isComplete: false,
            timestamp: currentThinkingStep.timestamp,
            isThinking: true,
          })
        }
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
        } else if (step.status === "in_progress" && !isComplete) {
          // Only show in-progress thinking when task is not complete
          // Skip verification steps as they would hide the actual LLM response
          const isVerificationStep = step.title?.toLowerCase().includes("verifying")
          if (!isVerificationStep) {
            messages.push({
              role: "assistant",
              content: step.description || "Agent is thinking...",
              isComplete: false,
              timestamp: step.timestamp,
              isThinking: true,
            })
          }
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

  // Helper function to generate a stable ID for tool executions based on content and timestamp
  const generateToolExecutionId = (calls: Array<{ name: string; arguments: any }>, timestamp: number) => {
    // Create a stable hash from tool call names, a subset of arguments, and timestamp for uniqueness
    const signature = calls.map(c => {
      const argsStr = c.arguments ? JSON.stringify(c.arguments) : ''
      return `${c.name}:${argsStr.substring(0, 50)}`
    }).join('|') + `@${timestamp}`
    // Simple hash function
    let hash = 0
    for (let i = 0; i < signature.length; i++) {
      const char = signature.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36)
  }

  // Stable string hash for IDs (32-bit -> base36)
  const hashString = (s: string) => {
    let h = 0
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h) + s.charCodeAt(i)
      h |= 0
    }
    return Math.abs(h).toString(36)
  }

  // Stable message id independent of streaming content; timestamp+role is sufficient
  const messageStableId = (m: { timestamp: number; role: string; content: string }) => {
    return `${m.timestamp}-${m.role}`
  }

  // Build unified display items that combine tool calls with subsequent results
  const displayItems: DisplayItem[] = []
  const roleCounters: Record<'user' | 'assistant' | 'tool', number> = { user: 0, assistant: 0, tool: 0 }
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
      const next = messages[i + 1]
      const results = next && next.role === "tool" && next.toolResults ? next.toolResults : []
      // Create unified assistant + tools item (combines thought and tool execution)
      const aIndex = ++roleCounters.assistant
      const execTimestamp = next?.timestamp ?? m.timestamp
      const toolExecId = generateToolExecutionId(m.toolCalls, execTimestamp)

      // Look for a matching step with executionStats (match by tool name from tool_call steps)
      // or find the most recent tool_call step with stats
      const toolCallNames = m.toolCalls.map(c => c.name)
      const matchingStep = steps?.find(
        step =>
          step.type === "tool_call" &&
          step.executionStats &&
          (step.title?.includes(toolCallNames[0]) || toolCallNames.some(name => step.title?.includes(name)))
      )

      displayItems.push({
        kind: "assistant_with_tools",
        id: `assistant-tools-${aIndex}-${toolExecId}`,
        data: {
          thought: m.content || "",
          timestamp: m.timestamp,
          isComplete: m.isComplete,
          calls: m.toolCalls,
          results,
          // Attach executionStats from the matching step if found
          executionStats: matchingStep?.executionStats ? {
            durationMs: matchingStep.executionStats.durationMs,
            totalTokens: matchingStep.executionStats.totalTokens,
            model: matchingStep.subagentId,
          } : undefined,
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
      const tIndex = ++roleCounters.tool
      displayItems.push({ kind: "tool_execution", id: `exec-standalone-${tIndex}` , data: { timestamp: m.timestamp, calls: [], results: m.toolResults } })
    } else {
      // Regular message (user/assistant/tool) with stable ordinal per role
      const idx = ++roleCounters[m.role]
      displayItems.push({ kind: "message", id: `msg-${m.role}-${idx}`, data: m })
    }
  }

  // NOTE: Tool approval is now rendered separately outside the scroll area for visibility
  // It is NOT added to displayItems anymore to ensure it stays visible regardless of scroll position

  // Add retry status to display items if present
  if (progress.retryInfo && progress.retryInfo.isRetrying) {
    displayItems.push({
      kind: "retry_status",
      id: `retry-${progress.retryInfo.startedAt}`,
      data: progress.retryInfo,
    })
  }

  // Add streaming content to display items if present and actively streaming
  if (progress.streamingContent && progress.streamingContent.isStreaming && progress.streamingContent.text) {
    displayItems.push({
      kind: "streaming",
      id: "streaming-content",
      data: progress.streamingContent,
    })
  }

  // Add delegation progress items from steps
  for (const step of progress.steps) {
    if (step.delegation) {
      displayItems.push({
        kind: "delegation",
        id: `delegation-${step.delegation.runId}`,
        data: step.delegation,
      })
    }
  }

  // Sort all display items by timestamp to ensure delegations appear in chronological order
  // Items without timestamps (tool_approval, streaming) will be handled separately
  const getItemTimestamp = (item: DisplayItem): number | null => {
    switch (item.kind) {
      case "message":
        return item.data.timestamp
      case "tool_execution":
        return item.data.timestamp
      case "assistant_with_tools":
        return item.data.timestamp
      case "delegation":
        return item.data.startTime
      case "retry_status":
        return item.data.startedAt
      case "tool_approval":
      case "streaming":
        // These represent current state and should stay at the end
        return null
    }
  }

  // Separate items with timestamps from "current state" items (approval, streaming)
  const timestampedItems = displayItems.filter(item => getItemTimestamp(item) !== null)
  const currentStateItems = displayItems.filter(item => getItemTimestamp(item) === null)

  // Sort timestamped items chronologically
  timestampedItems.sort((a, b) => {
    const tsA = getItemTimestamp(a) ?? 0
    const tsB = getItemTimestamp(b) ?? 0
    return tsA - tsB
  })

  // Replace displayItems with sorted items, keeping current state items at the end
  displayItems.length = 0
  displayItems.push(...timestampedItems, ...currentStateItems)

  // Determine the last assistant message among display items (by position, not timestamp)
  const lastAssistantDisplayIndex = (() => {
    for (let i = displayItems.length - 1; i >= 0; i--) {
      const it = displayItems[i]
      if (it.kind === "message" && it.data.role === "assistant") return i
    }
    return -1
  })()

  // Reset auto-scroll tracking refs when session changes
  // This prevents stale high-water marks from blocking auto-scroll after a clear/new session
  useEffect(() => {
    if (progress?.sessionId !== lastSessionIdRef.current) {
      lastSessionIdRef.current = progress?.sessionId
      lastMessageCountRef.current = 0
      lastContentLengthRef.current = 0
      lastDisplayItemsCountRef.current = 0
      // Also reset auto-scroll state for new sessions
      setShouldAutoScroll(true)
    }
  }, [progress?.sessionId])

  // Improved auto-scroll logic - tracks displayItems for comprehensive change detection
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return

    const scrollToBottom = () => {
      scrollContainer.scrollTop = scrollContainer.scrollHeight
    }

    // Calculate total content length for streaming detection (including streaming content)
    const totalContentLength = messages.reduce(
      (sum, msg) => sum + (msg.content?.length ?? 0),
      0,
    ) + (progress.streamingContent?.text?.length ?? 0)

    // Check if new messages were added, content changed (streaming), or displayItems changed
    // displayItems includes tool executions, tool approvals, retry status, and streaming content
    const hasNewMessages = messages.length > lastMessageCountRef.current
    const hasContentChanged = totalContentLength > lastContentLengthRef.current
    const hasNewDisplayItems = displayItems.length > lastDisplayItemsCountRef.current

    // Also detect when counts decrease (e.g., streaming item removed) and reset refs
    // This ensures auto-scroll works correctly when items are removed and new ones added
    const hasMessagesDecreased = messages.length < lastMessageCountRef.current
    const hasDisplayItemsDecreased = displayItems.length < lastDisplayItemsCountRef.current

    if (hasMessagesDecreased || hasDisplayItemsDecreased) {
      // Reset refs when counts decrease to avoid high-water mark issues
      lastMessageCountRef.current = messages.length
      lastContentLengthRef.current = totalContentLength
      lastDisplayItemsCountRef.current = displayItems.length
    }

    if (hasNewMessages || hasContentChanged || hasNewDisplayItems) {
      lastMessageCountRef.current = messages.length
      lastContentLengthRef.current = totalContentLength
      lastDisplayItemsCountRef.current = displayItems.length

      // Only auto-scroll if we should (user hasn't manually scrolled up)
      if (shouldAutoScroll) {
        // Use requestAnimationFrame to ensure DOM is updated
        requestAnimationFrame(() => {
          scrollToBottom()
        })
      }
    }
  }, [messages.length, shouldAutoScroll, messages, progress.streamingContent?.text, displayItems.length, displayItems])

  // Initial scroll to bottom on mount and when first display item appears
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
  }, [displayItems.length > 0])

  // Make panel focusable when agent completes (overlay variant only)
  // This enables the continue conversation input to receive focus and be interactable
  useEffect(() => {
    if (variant === "overlay" && isComplete) {
      tipcClient.setPanelFocusable({ focusable: true })
    }
  }, [variant, isComplete])

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

  // Get status indicator for tile variant
  const getStatusIndicator = () => {
    const hasPendingApproval = !!progress.pendingToolApproval
    const isSnoozed = progress.isSnoozed
    if (hasPendingApproval) {
      return <Shield className="h-4 w-4 text-amber-500 animate-pulse" />
    }
    if (isSnoozed) {
      return <Moon className="h-4 w-4 text-muted-foreground" />
    }
    if (!isComplete) {
      return <Activity className="h-4 w-4 text-blue-500 animate-pulse" />
    }
    if (hasErrors || wasStopped) {
      return <XCircle className="h-4 w-4 text-red-500" />
    }
    return <Check className="h-4 w-4 text-green-500" />
  }

  // Get title for tile variant
  const getTitle = () => {
    if (progress.conversationTitle) {
      return progress.conversationTitle
    }
    const firstUserMsg = conversationHistory?.find(m => m.role === "user")
    if (firstUserMsg?.content) {
      const content = typeof firstUserMsg.content === "string" ? firstUserMsg.content : JSON.stringify(firstUserMsg.content)
      return content.length > 50 ? content.substring(0, 50) + "..." : content
    }
    return `Session ${progress.sessionId?.substring(0, 8) || "..."}`
  }

  const containerClasses = cn(
    "progress-panel flex flex-col w-full rounded-xl overflow-hidden",
    variant === "tile"
      ? cn(
          "transition-all duration-200 cursor-pointer",
          progress.pendingToolApproval
            ? "border-amber-500 bg-amber-50/30 dark:bg-amber-950/20 ring-1 ring-amber-500/30"
            : isFocused
            ? "border-blue-500 bg-blue-50/30 dark:bg-blue-950/20 ring-1 ring-blue-500/30"
            : "border-border bg-card hover:border-border/80 hover:bg-card/80",
          isResizing && "select-none"
        )
      : variant === "overlay"
      ? "bg-background/80 backdrop-blur-sm border border-border/50 h-full"
      : "bg-muted/20 backdrop-blur-sm border border-border/40 h-full",
    isDark ? "dark" : ""
  )

  // Tile variant rendering
  if (variant === "tile") {
    const hasPendingApproval = !!progress.pendingToolApproval
    const isSnoozed = progress.isSnoozed
    // Check if this is a real session (not a synthetic pending tile)
    // Synthetic pending tiles have sessionId like "pending-..." and calling focusAgentSession
    // with these IDs would fail. Only show panel-related buttons for real sessions.
    const isRealSession = progress?.sessionId && !progress.sessionId.startsWith("pending-")

    return (
      <div
        onClick={onFocus}
        className={cn(containerClasses, "relative min-h-0 border h-full group/tile", className)}
        dir="ltr"
        style={{
          WebkitAppRegion: "no-drag"
        } as React.CSSProperties}
      >
        {/* Tile Header - clickable to toggle collapse */}
        <div
          className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30 flex-shrink-0 cursor-pointer"
          onClick={handleToggleCollapse}
        >
          {getStatusIndicator()}
          <span className="flex-1 truncate font-medium text-sm">
            {getTitle()}
          </span>
          {hasPendingApproval && (
            <Badge variant="outline" className="text-amber-600 border-amber-500 text-xs">
              Approval
            </Badge>
          )}
          <div className="flex items-center gap-1">
            {/* Collapse/Expand toggle */}
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleToggleCollapse} title={isCollapsed ? "Expand panel" : "Collapse panel"}>
              {isCollapsed ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
            </Button>
            {/* Expand to full window / Shrink back */}
            {onExpand && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={(e) => {
                  e.stopPropagation()
                  onExpand()
                }}
                title={isExpanded ? "Back to grid" : "Expand to fill window"}
              >
                {isExpanded ? <Shrink className="h-3 w-3" /> : <Expand className="h-3 w-3" />}
              </Button>
            )}
            {!isComplete && !isSnoozed && (
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); handleSnooze(e); }} title="Minimize">
                <Minimize2 className="h-3 w-3" />
              </Button>
            )}
            {/* Show in panel button - for active sessions that are not snoozed */}
            {!isComplete && !isSnoozed && isRealSession && (
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={async (e) => {
                e.stopPropagation()
                if (!progress?.sessionId) return
                try {
                  await tipcClient.focusAgentSession({ sessionId: progress.sessionId })
                  await tipcClient.setPanelMode({ mode: "agent" })
                  await tipcClient.showPanelWindow({})
                } catch (error) {
                  console.error("Failed to show panel window:", error)
                }
              }} title="Show in floating panel">
                <ExternalLink className="h-3 w-3" />
              </Button>
            )}
            {isSnoozed && (
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={async (e) => {
                e.stopPropagation()
                if (!progress?.sessionId) return

                // Update local store first so panel shows content immediately
                setSessionSnoozed(progress.sessionId, false)
                // Focus this session in state
                setFocusedSessionId(progress.sessionId)

                try {
                  // Unsnooze the session in backend
                  await tipcClient.unsnoozeAgentSession({ sessionId: progress.sessionId })
                } catch (error) {
                  // Rollback local state only when the API call fails to keep UI and backend in sync
                  setSessionSnoozed(progress.sessionId, true)
                  setFocusedSessionId(null)
                  console.error("Failed to unsnooze session:", error)
                  return
                }

                // UI updates after successful API call - don't rollback if these fail
                try {
                  await tipcClient.focusAgentSession({ sessionId: progress.sessionId })
                  // Show the floating panel with this session
                  await tipcClient.setPanelMode({ mode: "agent" })
                  await tipcClient.showPanelWindow({})
                } catch (error) {
                  // Log UI errors but don't rollback - the backend state is already updated
                  console.error("Failed to update UI after unsnooze:", error)
                }
              }} title="Maximize - show in floating panel">
                <Maximize2 className="h-3 w-3" />
              </Button>
            )}
            {/* Show in panel button for completed sessions (not for synthetic pending tiles) */}
            {isComplete && isRealSession && (
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={async (e) => {
                e.stopPropagation()
                if (!progress?.sessionId) return
                try {
                  await tipcClient.focusAgentSession({ sessionId: progress.sessionId })
                  await tipcClient.setPanelMode({ mode: "agent" })
                  await tipcClient.showPanelWindow({})
                } catch (error) {
                  console.error("Failed to show panel window:", error)
                }
              }} title="Show in floating panel">
                <ExternalLink className="h-3 w-3" />
              </Button>
            )}
            {/* Combined close button: stops agent if running, dismisses if complete */}
            {!isComplete ? (
              <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-destructive/20 hover:text-destructive" onClick={(e) => { e.stopPropagation(); handleKillConfirmation(); }} title="Stop agent">
                <OctagonX className="h-3 w-3" />
              </Button>
            ) : onDismiss ? (
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); onDismiss(); }} title="Dismiss">
                <X className="h-3 w-3" />
              </Button>
            ) : null}
          </div>
        </div>

        {/* Collapsible content */}
        {!isCollapsed && (
          <>
            {/* Tab toggle for Chat/Summary view - only show when summaries exist */}
            {(progress.stepSummaries?.length ?? 0) > 0 && (
              <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border/30 bg-muted/5" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setActiveTab("chat"); }}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors",
                    activeTab === "chat"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <MessageSquare className="h-3 w-3" />
                  Chat
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setActiveTab("summary"); }}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors",
                    activeTab === "summary"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Brain className="h-3 w-3" />
                  Summary
                  <Badge variant="secondary" className="ml-1 text-[10px] px-1 py-0 h-4">
                    {progress.stepSummaries?.length ?? 0}
                  </Badge>
                </button>
              </div>
            )}

            {/* Message Stream (Chat Tab) */}
            <div className={cn("relative flex-1 min-h-0", activeTab !== "chat" && (progress.stepSummaries?.length ?? 0) > 0 && "hidden")} onClick={(e) => e.stopPropagation()}>
              <div
                ref={scrollContainerRef}
                onScroll={handleScroll}
                className="h-full overflow-y-auto scrollbar-hide-until-hover"
              >
                {displayItems.length > 0 ? (
                  <div className="space-y-1 p-2">
                    {displayItems.map((item, index) => {
                      const itemKey = item.id
                      // Final assistant message should be expanded by default when agent is complete
                      // Tool executions should be collapsed by default to reduce visual clutter
                      // unless user has explicitly toggled them (itemKey exists in expandedItems)
                      const isFinalAssistantMessage = item.kind === "message" && index === lastAssistantDisplayIndex && isComplete
                      const isExpanded = itemKey in expandedItems
                        ? expandedItems[itemKey]
                        : isFinalAssistantMessage // Only final assistant message expanded by default
                      const isLastAssistant = item.kind === "message" && item.data.role === "assistant" && index === lastAssistantDisplayIndex

                      if (item.kind === "message") {
                        return (
                          <CompactMessage
                            key={itemKey}
                            message={item.data}
                            ttsText={isLastAssistant ? progress.spokenContent : undefined}
                            isLast={isLastAssistant}
                            isComplete={isComplete}
                            hasErrors={hasErrors}
                            wasStopped={wasStopped}
                            isExpanded={isExpanded}
                            onToggleExpand={() => toggleItemExpansion(itemKey, isExpanded)}
                            variant="tile"
                            sessionId={progress.sessionId}
                          />
                        )
                      } else if (item.kind === "assistant_with_tools") {
                        return (
                          <AssistantWithToolsBubble
                            key={itemKey}
                            data={item.data}
                            isExpanded={isExpanded}
                            onToggleExpand={() => toggleItemExpansion(itemKey, isExpanded)}
                          />
                        )
                      } else if (item.kind === "tool_approval") {
                        return (
                          <ToolApprovalBubble
                            key={itemKey}
                            approval={item.data}
                            onApprove={handleApproveToolCall}
                            onDeny={handleDenyToolCall}
                            isResponding={isRespondingToApproval}
                          />
                        )
                      } else if (item.kind === "retry_status") {
                        return <RetryStatusBanner key={itemKey} retryInfo={item.data} />
                      } else if (item.kind === "streaming") {
                        return <StreamingContentBubble key={itemKey} streamingContent={item.data} />
                      } else if (item.kind === "delegation") {
                        const delegationExpanded = expandedItems[itemKey] ?? true
                        return (
                          <DelegationBubble
                            key={itemKey}
                            delegation={item.data}
                            isExpanded={delegationExpanded}
                            onToggleExpand={() => toggleItemExpansion(itemKey, true)}
                          />
                        )
                      } else {
                        return (
                          <ToolExecutionBubble
                            key={itemKey}
                            execution={item.data}
                            isExpanded={isExpanded}
                            onToggleExpand={() => toggleItemExpansion(itemKey, isExpanded)}
                          />
                        )
                      }
                    })}
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    Initializing...
                  </div>
                )}
              </div>
            </div>

            {/* Tool Approval - Fixed position outside scroll area */}
            {progress.pendingToolApproval && (
              <div className="flex-shrink-0">
                <ToolApprovalBubble
                  approval={progress.pendingToolApproval}
                  onApprove={handleApproveToolCall}
                  onDeny={handleDenyToolCall}
                  isResponding={isRespondingToApproval}
                />
              </div>
            )}

            {/* Summary View Tab */}
            {activeTab === "summary" && (progress.stepSummaries?.length ?? 0) > 0 && (
              <div className="relative flex-1 min-h-0 overflow-y-auto p-3" onClick={(e) => e.stopPropagation()}>
                <AgentSummaryView
                  progress={progress}
                  conversationId={progress.conversationId}
                />
              </div>
            )}

            {/* Footer with status info */}
            <div className="px-3 py-2 border-t bg-muted/20 text-xs text-muted-foreground flex-shrink-0 flex items-center gap-2">
              {profileName && (
                <span className="text-[10px] truncate max-w-[80px] text-primary/70" title={`Profile: ${profileName}`}>
                  {profileName}
                </span>
              )}
              {(profileName && (modelInfo || acpSessionInfo) && !isComplete) && (
                <span className="text-muted-foreground/50">•</span>
              )}
              {/* ACP Session info for tile variant */}
              {acpSessionInfo && (
                <ACPSessionBadge info={acpSessionInfo} />
              )}
              {/* Model info - only show for non-ACP sessions */}
              {!isComplete && modelInfo && !acpSessionInfo && (
                <span className="text-[10px] truncate max-w-[100px]" title={`${modelInfo.provider}: ${modelInfo.model}`}>
                  {modelInfo.provider}/{modelInfo.model.split('/').pop()?.substring(0, 15)}
                </span>
              )}
              {!isComplete && contextInfo && contextInfo.maxTokens > 0 && (
                <div
                  className="flex items-center gap-1"
                  title={`Context: ${Math.round(contextInfo.estTokens / 1000)}k / ${Math.round(contextInfo.maxTokens / 1000)}k tokens (${Math.min(100, Math.round((contextInfo.estTokens / contextInfo.maxTokens) * 100))}%)`}
                >
                  <div className="w-8 h-1 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full transition-all duration-300 ease-out rounded-full",
                        contextInfo.estTokens / contextInfo.maxTokens > 0.9
                          ? "bg-red-500"
                          : contextInfo.estTokens / contextInfo.maxTokens > 0.7
                          ? "bg-amber-500"
                          : "bg-emerald-500"
                      )}
                      style={{
                        width: `${Math.min(100, (contextInfo.estTokens / contextInfo.maxTokens) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              )}
              {!isComplete && (
                <span>Step {currentIteration}/{isFinite(maxIterations) ? maxIterations : "∞"}</span>
              )}
              {isComplete && (
                <span>{wasStopped ? "Stopped" : hasErrors ? "Failed" : "Complete"}</span>
              )}
            </div>
          </>
        )}

        {/* Message Queue Panel - shows queued messages in tile */}
        {hasQueuedMessages && progress.conversationId && (
          <div className="px-3 py-2 border-t flex-shrink-0">
            <MessageQueuePanel
              conversationId={progress.conversationId}
              messages={queuedMessages}
              compact={isCollapsed}
              isPaused={isQueuePaused}
            />
          </div>
        )}

        {/* Follow-up input - always visible for quick continuation */}
        <TileFollowUpInput
          conversationId={progress.conversationId}
          sessionId={progress.sessionId}
          isSessionActive={!isComplete}
          className="flex-shrink-0"
          onMessageSent={onFollowUpSent}
        />

        {/* Kill Switch Confirmation Dialog */}
        {showKillConfirmation && (
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-background border border-border rounded-lg p-4 max-w-sm mx-4 shadow-lg">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                <h3 className="text-sm font-medium">Stop Agent Execution</h3>
              </div>
              <p className="text-xs text-muted-foreground mb-4">
                Are you sure you want to stop this session?
              </p>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" size="sm" onClick={handleCancelKill} disabled={isKilling}>Cancel</Button>
                <Button variant="destructive" size="sm" onClick={handleKillSwitch} disabled={isKilling}>
                  {isKilling ? "Stopping..." : "Stop Agent"}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // Default/Overlay variant rendering
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
          {/* Profile name */}
          {profileName && (
            <span className="text-[10px] text-primary/70 truncate max-w-[80px]" title={`Profile: ${profileName}`}>
              {profileName}
            </span>
          )}
          {/* ACP Session info (agent and model from ACP) */}
          {acpSessionInfo && (
            <ACPSessionBadge info={acpSessionInfo} />
          )}
          {/* Model and provider info - only show for non-ACP sessions */}
          {!isComplete && modelInfo && !acpSessionInfo && (
            <span className="text-[10px] text-muted-foreground/70 truncate max-w-[120px]" title={`${modelInfo.provider}: ${modelInfo.model}`}>
              {modelInfo.provider}/{modelInfo.model.split('/').pop()?.substring(0, 20)}
            </span>
          )}
          {/* Context fill indicator */}
          {!isComplete && contextInfo && contextInfo.maxTokens > 0 && (
            <div
              className="flex items-center gap-1.5"
              title={`Context: ${Math.round(contextInfo.estTokens / 1000)}k / ${Math.round(contextInfo.maxTokens / 1000)}k tokens (${Math.min(100, Math.round((contextInfo.estTokens / contextInfo.maxTokens) * 100))}%)`}
            >
              <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full transition-all duration-300 ease-out rounded-full",
                    contextInfo.estTokens / contextInfo.maxTokens > 0.9
                      ? "bg-red-500"
                      : contextInfo.estTokens / contextInfo.maxTokens > 0.7
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                  )}
                  style={{
                    width: `${Math.min(100, (contextInfo.estTokens / contextInfo.maxTokens) * 100)}%`,
                  }}
                />
              </div>
              <span className="text-[10px] text-muted-foreground/70 tabular-nums">
                {Math.min(100, Math.round((contextInfo.estTokens / contextInfo.maxTokens) * 100))}%
              </span>
            </div>
          )}
          {!isComplete && (
            <span className="text-xs text-muted-foreground">
              {`${currentIteration}/${isFinite(maxIterations) ? maxIterations : "∞"}`}
            </span>
          )}
          {!isComplete && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground hover:bg-muted"
              onClick={handleSnooze}
              title="Minimize - run in background without showing progress"
            >
              <Minimize2 className="h-3 w-3" />
            </Button>
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
              <OctagonX className="h-3 w-3" />
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

      {/* Tab toggle for Chat/Summary view - only show when summaries exist */}
      {(progress.stepSummaries?.length ?? 0) > 0 && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border/30 bg-muted/5" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setActiveTab("chat"); }}
            className={cn(
              "flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors",
              activeTab === "chat"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <MessageSquare className="h-3 w-3" />
            Chat
          </button>
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setActiveTab("summary"); }}
            className={cn(
              "flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors",
              activeTab === "summary"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Brain className="h-3 w-3" />
            Summary
            <Badge variant="secondary" className="ml-1 text-[10px] px-1 py-0 h-4">
              {progress.stepSummaries?.length ?? 0}
            </Badge>
          </button>
        </div>
      )}

      {/* Message Stream - Left-aligned content (Chat Tab) */}
      <div className={cn("relative flex-1 min-h-0", activeTab !== "chat" && (progress.stepSummaries?.length ?? 0) > 0 && "hidden")}>
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto"
        >
          {displayItems.length > 0 ? (
            <div className="space-y-1 p-2">
              {displayItems.map((item, index) => {
                const itemKey = item.id || (item.kind === "message"
                  ? `msg-${messageStableId(item.data as any)}`
                  : item.kind === "tool_approval"
                  ? `approval-${(item.data as any).approvalId}`
                  : `exec-${(item as any).data?.id || (item as any).data?.timestamp}`)

                // Final assistant message should be expanded by default when agent is complete
                // Tool executions should be collapsed by default to reduce visual clutter
                // unless user has explicitly toggled it (itemKey exists in expandedItems)
                const isFinalAssistantMessage = item.kind === "message" && index === lastAssistantDisplayIndex && isComplete
                const isExpanded = itemKey in expandedItems
                  ? expandedItems[itemKey]
                  : isFinalAssistantMessage // Only final assistant message expanded by default

                if (item.kind === "message") {
                  const isLastAssistant = index === lastAssistantDisplayIndex
                  return (
                    <CompactMessage
                      key={itemKey}
                      message={item.data}
                      ttsText={isLastAssistant ? progress.spokenContent : undefined}
                      isLast={isLastAssistant}
                      isComplete={isComplete}
                      hasErrors={hasErrors}
                      wasStopped={wasStopped}
                      isExpanded={isExpanded}
                      onToggleExpand={() => toggleItemExpansion(itemKey, isExpanded)}
                      variant={variant}
                      sessionId={progress.sessionId}
                    />
                  )
                } else if (item.kind === "assistant_with_tools") {
                  return (
                    <AssistantWithToolsBubble
                      key={itemKey}
                      data={item.data}
                      isExpanded={isExpanded}
                      onToggleExpand={() => toggleItemExpansion(itemKey, isExpanded)}
                    />
                  )
                } else if (item.kind === "tool_approval") {
                  return (
                    <ToolApprovalBubble
                      key={itemKey}
                      approval={item.data}
                      onApprove={handleApproveToolCall}
                      onDeny={handleDenyToolCall}
                      isResponding={isRespondingToApproval}
                    />
                  )
                } else if (item.kind === "retry_status") {
                  return (
                    <RetryStatusBanner
                      key={itemKey}
                      retryInfo={item.data}
                    />
                  )
                } else if (item.kind === "streaming") {
                  return (
                    <StreamingContentBubble
                      key={itemKey}
                      streamingContent={item.data}
                    />
                  )
                } else if (item.kind === "delegation") {
                  const delegationExpanded = expandedItems[itemKey] ?? true
                  return (
                    <DelegationBubble
                      key={itemKey}
                      delegation={item.data}
                      isExpanded={delegationExpanded}
                      onToggleExpand={() => toggleItemExpansion(itemKey, true)}
                    />
                  )
                } else {
                  return (
                    <ToolExecutionBubble
                      key={itemKey}
                      execution={item.data}
                      isExpanded={isExpanded}
                      onToggleExpand={() => toggleItemExpansion(itemKey, isExpanded)}
                    />
                  )
                }
              })}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Initializing...
            </div>
          )}
        </div>
      </div>

      {/* Tool Approval - Fixed position outside scroll area for overlay variant */}
      {progress.pendingToolApproval && (
        <div className="flex-shrink-0 mx-2 mb-2">
          <ToolApprovalBubble
            approval={progress.pendingToolApproval}
            onApprove={handleApproveToolCall}
            onDeny={handleDenyToolCall}
            isResponding={isRespondingToApproval}
          />
        </div>
      )}

      {/* Summary View Tab */}
      {activeTab === "summary" && (progress.stepSummaries?.length ?? 0) > 0 && (
        <div className="relative flex-1 min-h-0 overflow-y-auto p-3" onClick={(e) => e.stopPropagation()}>
          <AgentSummaryView
            progress={progress}
            conversationId={progress.conversationId}
          />
        </div>
      )}

      {/* Message Queue Panel - shows queued messages in overlay */}
      {hasQueuedMessages && progress.conversationId && (
        <div className="px-3 py-2 border-t flex-shrink-0">
          <MessageQueuePanel
            conversationId={progress.conversationId}
            messages={queuedMessages}
            compact={false}
            isPaused={isQueuePaused}
          />
        </div>
      )}

      {/* Follow-up input - for continuing conversation in the floating panel */}
      <OverlayFollowUpInput
        conversationId={progress.conversationId}
        sessionId={progress.sessionId}
        isSessionActive={!isComplete}
        className="flex-shrink-0"
      />

      {/* Default variant: Original slim full-width progress bar */}
      {variant !== "overlay" && !isComplete && (
        <div className="h-0.5 w-full bg-muted/50">
          <div
            className={`h-full bg-primary transition-all duration-500 ease-out${!isFinite(maxIterations) ? " animate-pulse w-full" : ""}`}
            style={isFinite(maxIterations) ? {
              width: `${Math.min(100, (currentIteration / maxIterations) * 100)}%`,
            } : undefined}
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
              Are you sure you want to stop this session? Other sessions will continue running.
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
