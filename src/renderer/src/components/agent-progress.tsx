import React, { useEffect, useRef, useState } from "react"
import { cn } from "@renderer/lib/utils"
import { AgentProgressUpdate } from "../../../shared/types"
import { ChevronDown, ChevronUp, ChevronRight, X, AlertTriangle, Minimize2, Shield, Check, XCircle } from "lucide-react"
import { MarkdownRenderer } from "@renderer/components/markdown-renderer"
import { Button } from "./ui/button"
import { Badge } from "./ui/badge"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useAgentStore, useConversationStore } from "@renderer/stores"
import { AudioPlayer } from "@renderer/components/audio-player"
import { useConfigQuery } from "@renderer/lib/queries"
import { useTheme } from "@renderer/contexts/theme-context"
import { logUI, logExpand } from "@renderer/lib/debug"

interface AgentProgressProps {
  progress: AgentProgressUpdate | null
  className?: string
  variant?: "default" | "overlay"
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

  return (
    <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/30 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-100/50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800">
        <Shield className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
        <span className="text-xs font-medium text-amber-800 dark:text-amber-200">
          Tool Approval Required
        </span>
      </div>

      {/* Content */}
      <div className="px-3 py-2">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-amber-700 dark:text-amber-300">Tool:</span>
          <code className="text-xs font-mono font-medium text-amber-900 dark:text-amber-100 bg-amber-100 dark:bg-amber-900/50 px-1.5 py-0.5 rounded">
            {approval.toolName}
          </code>
        </div>

        {/* Expandable arguments */}
        <div className="mb-3">
          <button
            onClick={() => setShowArgs(!showArgs)}
            className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200"
          >
            <ChevronRight className={cn("h-3 w-3 transition-transform", showArgs && "rotate-90")} />
            {showArgs ? "Hide" : "View"} arguments
          </button>
          {showArgs && (
            <pre className="mt-1.5 p-2 text-xs bg-amber-100/70 dark:bg-amber-900/40 rounded overflow-x-auto max-h-32 text-amber-900 dark:text-amber-100">
              {JSON.stringify(approval.arguments, null, 2)}
            </pre>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950/30"
            onClick={onDeny}
            disabled={isResponding}
          >
            <XCircle className="h-3 w-3 mr-1" />
            Deny
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white"
            onClick={onApprove}
            disabled={isResponding}
          >
            <Check className="h-3 w-3 mr-1" />
            Approve
          </Button>
        </div>
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
  const [showKillConfirmation, setShowKillConfirmation] = useState(false)
  const [isKilling, setIsKilling] = useState(false)
  const { isDark } = useTheme()

  // Expansion state management - preserve across re-renders
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({})

  // Get current conversation ID for deep-linking and session focus control
  const currentConversationId = useConversationStore((s) => s.currentConversationId)
  const setFocusedSessionId = useAgentStore((s) => s.setFocusedSessionId)
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

    try {
      await tipcClient.snoozeAgentSession({ sessionId: progress.sessionId })
      // Unfocus this session so the overlay hides
      setFocusedSessionId(null)
      // Hide the panel window completely
      await tipcClient.hidePanelWindow({})
      logUI('🔴 [AgentProgress OVERLAY] Session snoozed, unfocused, and panel hidden')
    } catch (error) {
      console.error("Failed to snooze session:", error)
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
  const [isRespondingToApproval, setIsRespondingToApproval] = useState(false)

  const handleApproveToolCall = async () => {
    if (isRespondingToApproval || !progress?.pendingToolApproval?.approvalId) return

    setIsRespondingToApproval(true)
    try {
      await tipcClient.respondToToolApproval({
        approvalId: progress.pendingToolApproval.approvalId,
        approved: true,
      })
    } catch (error) {
      console.error("Failed to approve tool call:", error)
    } finally {
      setIsRespondingToApproval(false)
    }
  }

  const handleDenyToolCall = async () => {
    if (isRespondingToApproval || !progress?.pendingToolApproval?.approvalId) return

    setIsRespondingToApproval(true)
    try {
      await tipcClient.respondToToolApproval({
        approvalId: progress.pendingToolApproval.approvalId,
        approved: false,
      })
    } catch (error) {
      console.error("Failed to deny tool call:", error)
    } finally {
      setIsRespondingToApproval(false)
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

  // Helper function to generate a stable ID for tool executions based on content
  const generateToolExecutionId = (calls: Array<{ name: string; arguments: any }>) => {
    // Create a stable hash from tool call names and a subset of arguments
    const signature = calls.map(c => {
      const argsStr = c.arguments ? JSON.stringify(c.arguments) : ''
      return `${c.name}:${argsStr.substring(0, 50)}`
    }).join('|')
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
      // Unified execution bubble with stable ID
      const toolExecId = generateToolExecutionId(m.toolCalls)
      displayItems.push({
        kind: "tool_execution",
        id: `exec-${toolExecId}`,
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
      (sum, msg) => sum + (msg.content?.length ?? 0),
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

                const isExpanded = !!expandedItems[itemKey]

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
