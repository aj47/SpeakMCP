import React, { useEffect, useRef, useState } from "react"
import { cn } from "@renderer/lib/utils"
import { AgentProgressUpdate } from "../../../shared/types"
import { ChevronDown, ChevronUp, ChevronRight, X, AlertTriangle, Minimize2, GripHorizontal, Moon, Maximize2, RefreshCw, ExternalLink, OctagonX } from "lucide-react"
import { Button } from "./ui/button"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useAgentStore, useConversationStore, useMessageQueue } from "@renderer/stores"
import { useTheme } from "@renderer/contexts/theme-context"
import { logUI, logExpand } from "@renderer/lib/debug"
import { TileFollowUpInput } from "./tile-follow-up-input"
import { OverlayFollowUpInput } from "./overlay-follow-up-input"
import { MessageQueuePanel } from "@renderer/components/message-queue-panel"
import { useResizable, TILE_DIMENSIONS } from "@renderer/hooks/use-resizable"
import {
  CompactMessage,
  ToolExecutionBubble,
  AssistantWithToolsBubble,
  ToolApprovalBubble,
  RetryStatusBanner,
  StreamingContentBubble
} from "./agent-progress"

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
  | { kind: "assistant_with_tools"; id: string; data: {
      thought: string
      timestamp: number
      isComplete: boolean
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

  // Get queued messages for this conversation (used in overlay variant)
  const queuedMessages = useMessageQueue(progress?.conversationId)
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
    contextInfo,
    modelInfo,
    profileName,
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
      displayItems.push({
        kind: "assistant_with_tools",
        id: `assistant-tools-${aIndex}-${toolExecId}`,
        data: {
          thought: m.content || "",
          timestamp: m.timestamp,
          isComplete: m.isComplete,
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
            {/* Message Stream */}
            <div className="relative flex-1 min-h-0" onClick={(e) => e.stopPropagation()}>
              <div
                ref={scrollContainerRef}
                onScroll={handleScroll}
                className="h-full overflow-y-auto scrollbar-hide-until-hover"
              >
                {displayItems.length > 0 ? (
                  <div className="space-y-1 p-2">
                    {displayItems.map((item, index) => {
                      const itemKey = item.id
                      // Tool executions should be collapsed by default to reduce visual clutter
                      // unless user has explicitly toggled them (itemKey exists in expandedItems)
                      const isExpanded = itemKey in expandedItems
                        ? expandedItems[itemKey]
                        : false // Tool executions collapsed by default
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
                            onToggleExpand={() => toggleItemExpansion(itemKey, isExpanded)}
                            variant="tile"
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

            {/* Footer with status info */}
            <div className="px-3 py-2 border-t bg-muted/20 text-xs text-muted-foreground flex-shrink-0 flex items-center gap-2">
              {profileName && (
                <span className="text-[10px] truncate max-w-[80px] text-primary/70" title={`Profile: ${profileName}`}>
                  {profileName}
                </span>
              )}
              {profileName && modelInfo && !isComplete && (
                <span className="text-muted-foreground/50">•</span>
              )}
              {!isComplete && modelInfo && (
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
                <span>Step {currentIteration}/{maxIterations}</span>
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
        {/* Esc hint - subtle text in the middle, only in overlay variant where Esc actually closes */}
        {variant === "overlay" && (
          <span className="text-[10px] text-muted-foreground/60 hidden sm:inline">
            Press Esc to close panel
          </span>
        )}
        <div className="flex items-center gap-3">
          {/* Profile name */}
          {profileName && (
            <span className="text-[10px] text-primary/70 truncate max-w-[80px]" title={`Profile: ${profileName}`}>
              {profileName}
            </span>
          )}
          {/* Model and provider info */}
          {!isComplete && modelInfo && (
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
                // Tool executions should be collapsed by default to reduce visual clutter
                // unless user has explicitly toggled it (itemKey exists in expandedItems)
                const isFinalAssistantMessage = item.kind === "message" && index === lastAssistantDisplayIndex && isComplete
                const isExpanded = itemKey in expandedItems
                  ? expandedItems[itemKey]
                  : isFinalAssistantMessage // Only final assistant message expanded by default

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
                      onToggleExpand={() => toggleItemExpansion(itemKey, isExpanded)}
                      variant={variant}
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

      {/* Message Queue Panel - shows queued messages in overlay */}
      {hasQueuedMessages && progress.conversationId && (
        <div className="px-3 py-2 border-t flex-shrink-0">
          <MessageQueuePanel
            conversationId={progress.conversationId}
            messages={queuedMessages}
            compact={false}
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

      {/* Overlay variant: Esc hint and progress bar in styled footer */}
      {variant === "overlay" && (
        <div className="flex items-center justify-between px-3 py-1 bg-muted/10 border-t border-border/20 flex-shrink-0">
          <span className="text-[10px] text-muted-foreground/50">Press Esc to close</span>
          {!isComplete && (
            <div className="flex-1 ml-3 h-0.5 bg-muted/50 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-500 ease-out"
                style={{
                  width: `${Math.min(100, (currentIteration / maxIterations) * 100)}%`,
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Default variant: Original slim full-width progress bar */}
      {variant !== "overlay" && !isComplete && (
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
