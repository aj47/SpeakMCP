import React, { useEffect, useRef, useState } from "react"
import { cn } from "@renderer/lib/utils"
import { AgentProgressUpdate, EnhancedErrorInfo } from "../../../shared/types"
import { ChevronDown, ChevronUp, ChevronRight, X, AlertTriangle, Minimize2, Shield, Check, XCircle, Loader2, Clock, Copy, CheckCheck, GripHorizontal, Activity, Moon, Maximize2, RefreshCw, Wifi, WifiOff, Key, Server, Settings, Lightbulb } from "lucide-react"
import { MarkdownRenderer } from "@renderer/components/markdown-renderer"
import { Button } from "./ui/button"
import { Badge } from "./ui/badge"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useAgentStore, useConversationStore } from "@renderer/stores"
import { AudioPlayer } from "@renderer/components/audio-player"
import { useConfigQuery } from "@renderer/lib/queries"
import { useTheme } from "@renderer/contexts/theme-context"
import { logUI, logExpand } from "@renderer/lib/debug"
import { TileFollowUpInput } from "./tile-follow-up-input"
import { OverlayFollowUpInput } from "./overlay-follow-up-input"
import { useResizable, TILE_DIMENSIONS } from "@renderer/hooks/use-resizable"
import { getToolResultsSummary } from "@speakmcp/shared"

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
  | { kind: "enhanced_error"; id: string; data: EnhancedErrorInfo }


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
  const [isCopied, setIsCopied] = useState(false)
  const configQuery = useConfigQuery()

  // Copy to clipboard handler
  const handleCopyResponse = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(message.content)
      setIsCopied(true)
      setTimeout(() => setIsCopied(false), 2000)
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
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Copy button for final assistant response */}
          {message.role === "assistant" && isLast && isComplete && (
            <button
              onClick={handleCopyResponse}
              className="p-1 rounded hover:bg-muted/30 transition-colors"
              title={isCopied ? "Copied!" : "Copy response"}
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
  const [showInputs, setShowInputs] = useState(false)
  const [showOutputs, setShowOutputs] = useState(false)

  // Collapsed by default; expand to show details
  useEffect(() => {
    if (isExpanded) {
      setShowInputs(true)
      setShowOutputs(true)
    } else {
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

  const handleToggleExpand = () => onToggleExpand()
  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onToggleExpand()
  }

  // Handle hide/show buttons with event propagation stopped
  const handleToggleInputs = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowInputs((v) => !v)
  }

  const handleToggleOutputs = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowOutputs((v) => !v)
  }

  const handleCopy = (e: React.MouseEvent, text: string) => {
    e.stopPropagation()
    copy(text)
  }


  // Generate preview for collapsed state - prioritize showing results when available
  const collapsedInputPreview = (() => {
    if (isExpanded) return null
    // Create a summary of the first tool call's parameters
    const firstCall = execution.calls[0]
    if (!firstCall?.arguments) return null
    return formatArgumentsPreview(firstCall.arguments)
  })()

  // Generate result summary for collapsed state
  const collapsedResultSummary = (() => {
    if (isExpanded || isPending) return null
    if (execution.results.length === 0) return null
    // Convert to the expected ToolResult format
    const toolResults = execution.results.map(r => ({
      success: r.success,
      content: r.content,
      error: r.error,
    }))
    return getToolResultsSummary(toolResults)
  })()

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
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="font-mono font-semibold truncate">{headerTitle}</span>
          {!isExpanded && (
            <Badge variant="outline" className="text-[10px] flex-shrink-0">
              {isPending ? "Pending..." : allSuccess ? "✓" : "✗"}
            </Badge>
          )}
          {isExpanded && (
            <Badge variant="outline" className="text-[10px]">
              {isPending ? "Pending..." : allSuccess ? "Success" : "With errors"}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
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

      {/* Collapsed preview - show result summary when available, otherwise show input parameters */}
      {!isExpanded && (collapsedResultSummary || collapsedInputPreview) && (
        <div className="px-1 pb-1 text-[10px] opacity-80 truncate" title={collapsedResultSummary || collapsedInputPreview || ''}>
          {collapsedResultSummary ? (
            <span className="font-medium">{collapsedResultSummary}</span>
          ) : (
            <span className="font-mono opacity-70">{collapsedInputPreview}</span>
          )}
        </div>
      )}

      {isExpanded && (
        <>
          {/* Inputs */}
          <div className="rounded-md bg-blue-50/40 dark:bg-blue-900/10 border border-blue-200/40 dark:border-blue-800/40 p-2 mb-2">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold opacity-80">Call Parameters</div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" className="h-6 px-2" onClick={handleToggleInputs}>
                  {showInputs ? "Hide" : "Show"}
                </Button>
                <Button size="sm" variant="ghost" className="h-6 px-2" onClick={(e) => handleCopy(e, JSON.stringify(execution.calls, null, 2))}>
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
                  <Button size="sm" variant="ghost" className="h-6 px-2" onClick={handleToggleOutputs}>
                    {showOutputs ? "Hide" : "Show"}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 px-2" onClick={(e) => handleCopy(e, JSON.stringify(execution.results, null, 2))}>
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

// Enhanced Error Bubble - shows detailed error information with troubleshooting hints
const EnhancedErrorBubble: React.FC<{
  errorInfo: EnhancedErrorInfo
  onRetry?: () => void
  onOpenSettings?: () => void
}> = ({ errorInfo, onRetry, onOpenSettings }) => {
  const [showDetails, setShowDetails] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)

  // Get icon based on error type
  const getErrorIcon = () => {
    switch (errorInfo.type) {
      case 'network':
        return <WifiOff className="h-5 w-5" />
      case 'auth':
        return <Key className="h-5 w-5" />
      case 'rate_limit':
        return <Clock className="h-5 w-5" />
      case 'server':
        return <Server className="h-5 w-5" />
      case 'config':
        return <Settings className="h-5 w-5" />
      default:
        return <XCircle className="h-5 w-5" />
    }
  }

  // Format time ago
  const getTimeAgo = () => {
    if (!errorInfo.lastAttemptAt) return null
    const seconds = Math.floor((Date.now() - errorInfo.lastAttemptAt) / 1000)
    if (seconds < 60) return `${seconds} seconds ago`
    const minutes = Math.floor(seconds / 60)
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
  }

  // Copy error details to clipboard
  const handleCopyDetails = async () => {
    const details = [
      `Error: ${errorInfo.title}`,
      `Message: ${errorInfo.message}`,
      errorInfo.statusCode ? `Status Code: ${errorInfo.statusCode}` : null,
      errorInfo.endpoint ? `Endpoint: ${errorInfo.endpoint}` : null,
      errorInfo.retryAttempts ? `Attempts: ${errorInfo.retryAttempts}` : null,
      errorInfo.technicalDetails ? `\nTechnical Details:\n${errorInfo.technicalDetails}` : null,
    ].filter(Boolean).join('\n')

    try {
      await navigator.clipboard.writeText(details)
      setCopied(true)
      setCopyFailed(false)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy to clipboard:', err)
      setCopyFailed(true)
      setTimeout(() => setCopyFailed(false), 2000)
    }
  }

  // Handle quick action clicks
  const handleAction = (action: string) => {
    switch (action) {
      case 'retry':
        onRetry?.()
        break
      case 'open_settings':
        onOpenSettings?.()
        break
      case 'copy_details':
        handleCopyDetails()
        break
    }
  }

  return (
    <div className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50/50 dark:bg-red-950/30 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-red-100/50 dark:bg-red-900/30 border-b border-red-200 dark:border-red-800">
        <div className="text-red-600 dark:text-red-400">
          {getErrorIcon()}
        </div>
        <span className="text-sm font-medium text-red-800 dark:text-red-200">
          {errorInfo.title}
        </span>
      </div>

      {/* Message */}
      <div className="px-3 py-2 border-b border-red-200 dark:border-red-800">
        <p className="text-xs text-red-900 dark:text-red-100">
          {errorInfo.message}
        </p>
        {errorInfo.retryAttempts && (
          <p className="text-xs text-red-600 dark:text-red-400 mt-1">
            Failed after {errorInfo.retryAttempts} attempt{errorInfo.retryAttempts > 1 ? 's' : ''}
            {getTimeAgo() && ` • Last attempt: ${getTimeAgo()}`}
          </p>
        )}
      </div>

      {/* Troubleshooting Hints */}
      {errorInfo.troubleshootingHints && errorInfo.troubleshootingHints.length > 0 && (
        <div className="px-3 py-2 border-b border-red-200 dark:border-red-800 bg-amber-50/50 dark:bg-amber-950/20">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Lightbulb className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
            <span className="text-xs font-medium text-amber-800 dark:text-amber-200">
              Troubleshooting
            </span>
          </div>
          <ul className="space-y-1">
            {errorInfo.troubleshootingHints.map((hint, index) => (
              <li key={index} className="text-xs text-amber-900 dark:text-amber-100 flex items-start gap-1.5">
                <span className="text-amber-500 mt-0.5">•</span>
                <span>{hint}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Quick Actions */}
      {errorInfo.quickActions && errorInfo.quickActions.length > 0 && (
        <div className="px-3 py-2 flex flex-wrap gap-2 border-b border-red-200 dark:border-red-800">
          {errorInfo.quickActions.map((action, index) => (
            <Button
              key={index}
              variant="outline"
              size="sm"
              className={cn(
                "h-7 text-xs",
                action.action === 'retry' && "border-green-300 text-green-700 hover:bg-green-50 dark:border-green-700 dark:text-green-300 dark:hover:bg-green-950",
                action.action === 'open_settings' && "border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-700 dark:text-blue-300 dark:hover:bg-blue-950",
                action.action === 'copy_details' && "border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-950"
              )}
              onClick={() => handleAction(action.action)}
            >
              {action.action === 'retry' && <RefreshCw className="h-3 w-3 mr-1" />}
              {action.action === 'open_settings' && <Settings className="h-3 w-3 mr-1" />}
              {action.action === 'copy_details' && (copied ? <CheckCheck className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />)}
              {action.action === 'copy_details' && copied ? 'Copied!' : action.action === 'copy_details' && copyFailed ? 'Copy failed' : action.label}
            </Button>
          ))}
        </div>
      )}

      {/* Technical Details (Expandable) */}
      {errorInfo.technicalDetails && (
        <div className="px-3 py-2">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200 transition-colors"
          >
            {showDetails ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Technical Details
          </button>
          {showDetails && (
            <div className="mt-2 p-2 bg-red-100/50 dark:bg-red-900/30 rounded text-xs font-mono text-red-800 dark:text-red-200 whitespace-pre-wrap break-all">
              {errorInfo.statusCode && <div>Status: {errorInfo.statusCode}</div>}
              {errorInfo.endpoint && <div>Endpoint: {errorInfo.endpoint}</div>}
              {errorInfo.retryAttempts && <div>Attempts: {errorInfo.retryAttempts}{errorInfo.maxRetryAttempts ? ` / ${errorInfo.maxRetryAttempts}` : ''}</div>}
              {errorInfo.technicalDetails && <div className="mt-1 border-t border-red-200 dark:border-red-700 pt-1">{errorInfo.technicalDetails}</div>}
            </div>
          )}
        </div>
      )}
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

  // Get current conversation ID for deep-linking and session focus control
  const currentConversationId = useConversationStore((s) => s.currentConversationId)
  const setFocusedSessionId = useAgentStore((s) => s.setFocusedSessionId)
  const setSessionSnoozed = useAgentStore((s) => s.setSessionSnoozed)
  const agentProgressById = useAgentStore((s) => s.agentProgressById)

  // Helper to toggle expansion state for a specific item
  const toggleItemExpansion = (itemKey: string) => {
    setExpandedItems(prev => {
      const from = !!prev[itemKey]
      const to = !from
      logExpand("AgentProgress", "toggle", { itemKey, from, to })
      return {
        ...prev,
        [itemKey]: to,
      }
    })
  }

  // Kill switch handler - stop only this session
  const handleKillSwitch = async () => {
    if (isKilling || !progress?.sessionId) return // Prevent double-clicks

    setIsKilling(true)
    try {
      await tipcClient.stopAgentSession({ sessionId: progress.sessionId })
      setShowKillConfirmation(false)
    } catch (error) {
      console.error("Failed to stop agent session:", error)
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
    if (!approvalId) return
    // Synchronous check to prevent double-click race condition
    if (respondingApprovalIdRef.current === approvalId) return

    respondingApprovalIdRef.current = approvalId
    setRespondingApprovalId(approvalId)
    try {
      await tipcClient.respondToToolApproval({
        approvalId,
        approved: true,
      })
      // Don't reset respondingApprovalId on success - keep showing "Processing..."
      // The approval bubble will be removed when pendingToolApproval is cleared from progress
    } catch (error) {
      console.error("Failed to approve tool call:", error)
      // Only reset on error so user can retry
      respondingApprovalIdRef.current = null
      setRespondingApprovalId(null)
    }
  }

  const handleDenyToolCall = async () => {
    const approvalId = progress?.pendingToolApproval?.approvalId
    if (!approvalId) return
    // Synchronous check to prevent double-click race condition
    if (respondingApprovalIdRef.current === approvalId) return

    respondingApprovalIdRef.current = approvalId
    setRespondingApprovalId(approvalId)
    try {
      await tipcClient.respondToToolApproval({
        approvalId,
        approved: false,
      })
      // Don't reset respondingApprovalId on success - keep showing "Processing..."
      // The approval bubble will be removed when pendingToolApproval is cleared from progress
    } catch (error) {
      console.error("Failed to deny tool call:", error)
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
        } else if (step.status === "in_progress" && !isComplete) {
          // Only show in-progress thinking when task is not complete
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
      // Show assistant message without extras (stable key by role ordinal)
      const aIndex = ++roleCounters.assistant
      displayItems.push({ kind: "message", id: `msg-assistant-${aIndex}`, data: { ...m, toolCalls: undefined, toolResults: undefined } })
      // Unified execution bubble with stable ID (include timestamp for uniqueness)
      const execTimestamp = next?.timestamp ?? m.timestamp
      const toolExecId = generateToolExecutionId(m.toolCalls, execTimestamp)
      displayItems.push({
        kind: "tool_execution",
        id: `exec-${toolExecId}`,
        data: {
          timestamp: execTimestamp,
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
      const tIndex = ++roleCounters.tool
      displayItems.push({ kind: "tool_execution", id: `exec-standalone-${tIndex}` , data: { timestamp: m.timestamp, calls: [], results: m.toolResults } })
    } else {
      // Regular message (user/assistant/tool) with stable ordinal per role
      const idx = ++roleCounters[m.role]
      displayItems.push({ kind: "message", id: `msg-${m.role}-${idx}`, data: m })
    }
  }

  // Add pending tool approval to display items if present
  if (progress.pendingToolApproval) {
    displayItems.push({
      kind: "tool_approval",
      id: `approval-${progress.pendingToolApproval.approvalId}`,
      data: progress.pendingToolApproval,
    })
  }

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

  // Add enhanced error info to display items if present
  if (progress.errorInfo) {
    displayItems.push({
      kind: "enhanced_error",
      id: `error-${progress.errorInfo.lastAttemptAt || Date.now()}`,
      data: progress.errorInfo,
    })
  }

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

    return (
      <div
        onClick={onFocus}
        className={cn(containerClasses, "relative min-h-0 border h-full group/tile", className)}
        dir="ltr"
        style={{
          WebkitAppRegion: "no-drag"
        } as React.CSSProperties}
      >
        {/* Tile Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30 flex-shrink-0">
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
            {!isComplete && !isSnoozed && (
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); handleSnooze(e); }} title="Minimize">
                <Minimize2 className="h-3 w-3" />
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
            {!isComplete && (
              <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-destructive/20 hover:text-destructive" onClick={(e) => { e.stopPropagation(); handleKillConfirmation(); }} title="Stop">
                <X className="h-3 w-3" />
              </Button>
            )}
            {onDismiss && (
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); onDismiss(); }} title="Dismiss">
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>

        {/* Collapsible content */}
        {!isCollapsed && (
          <>
            {/* Message Stream */}
            <div className="relative flex-1 min-h-0">
              <div
                ref={scrollContainerRef}
                onScroll={handleScroll}
                className="h-full overflow-y-auto scrollbar-hide-until-hover"
              >
                {displayItems.length > 0 ? (
                  <div className="space-y-1 p-2">
                    {displayItems.map((item, index) => {
                      const itemKey = item.id
                      const isExpanded = expandedItems[itemKey] ?? false
                      const isLastAssistant = item.kind === "message" && item.data.role === "assistant" && index === lastAssistantDisplayIndex

                      if (item.kind === "message") {
                        return (
                          <CompactMessage
                            key={itemKey}
                            message={item.data}
                            isLast={isLastAssistant}
                            isComplete={isComplete}
                            hasErrors={hasErrors}
                            wasStopped={wasStopped}
                            isExpanded={isExpanded}
                            onToggleExpand={() => toggleItemExpansion(itemKey)}
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
                      } else if (item.kind === "enhanced_error") {
                        return (
                          <EnhancedErrorBubble
                            key={itemKey}
                            errorInfo={item.data}
                            onRetry={() => {
                              // Trigger a retry by re-sending the last user message
                              const lastUserMessage = progress.conversationHistory?.findLast(m => m.role === 'user')
                              if (lastUserMessage) {
                                tipcClient.processWithAgentMode.mutate({
                                  text: lastUserMessage.content,
                                  conversationId: progress.conversationId,
                                })
                              }
                            }}
                            onOpenSettings={() => {
                              tipcClient.openSettingsWindow.mutate()
                            }}
                          />
                        )
                      } else {
                        return (
                          <ToolExecutionBubble
                            key={itemKey}
                            execution={item.data}
                            isExpanded={isExpanded}
                            onToggleExpand={() => toggleItemExpansion(itemKey)}
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

            {/* Footer with status info */}
            <div className="px-3 py-2 border-t bg-muted/20 text-xs text-muted-foreground flex-shrink-0">
              {!isComplete && (
                <span>Step {currentIteration}/{maxIterations}</span>
              )}
              {isComplete && (
                <span>{wasStopped ? "Stopped" : hasErrors ? "Failed" : "Complete"}</span>
              )}
            </div>
          </>
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
          {!isComplete && (
            <span className="text-xs text-muted-foreground">
              {`${currentIteration}/${maxIterations}`}
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
                const itemKey = item.id || (item.kind === "message"
                  ? `msg-${messageStableId(item.data as any)}`
                  : item.kind === "tool_approval"
                  ? `approval-${(item.data as any).approvalId}`
                  : `exec-${(item as any).data?.id || (item as any).data?.timestamp}`)

                // Final assistant message should be expanded by default when agent is complete
                // unless user has explicitly toggled it (itemKey exists in expandedItems)
                const isFinalAssistantMessage = item.kind === "message" && index === lastAssistantDisplayIndex && isComplete
                const isExpanded = itemKey in expandedItems
                  ? expandedItems[itemKey]
                  : isFinalAssistantMessage

                if (item.kind === "message") {
                  return (
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
                } else if (item.kind === "enhanced_error") {
                  return (
                    <EnhancedErrorBubble
                      key={itemKey}
                      errorInfo={item.data}
                      onRetry={() => {
                        // Trigger a retry by re-sending the last user message
                        const lastUserMessage = progress.conversationHistory?.findLast(m => m.role === 'user')
                        if (lastUserMessage) {
                          tipcClient.processWithAgentMode.mutate({
                            text: lastUserMessage.content,
                            conversationId: progress.conversationId,
                          })
                        }
                      }}
                      onOpenSettings={() => {
                        tipcClient.openSettingsWindow.mutate()
                      }}
                    />
                  )
                } else {
                  return (
                    <ToolExecutionBubble
                      key={itemKey}
                      execution={item.data}
                      isExpanded={isExpanded}
                      onToggleExpand={() => toggleItemExpansion(itemKey)}
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

      {/* Follow-up input - for continuing conversation in the floating panel */}
      <OverlayFollowUpInput
        conversationId={progress.conversationId}
        sessionId={progress.sessionId}
        isSessionActive={!isComplete}
        className="flex-shrink-0"
      />

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
