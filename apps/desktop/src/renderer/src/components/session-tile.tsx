import React, { useState, useCallback, useRef, useEffect } from "react"
import { cn } from "@renderer/lib/utils"
import { AgentProgressUpdate } from "@shared/types"
import { ScrollArea } from "@renderer/components/ui/scroll-area"
import {
  Activity,
  CheckCircle2,
  XCircle,
  Moon,
  X,
  Minimize2,
  Maximize2,
  RefreshCw,
  Shield,
  ChevronUp,
  ChevronDown,
  GripHorizontal,
  Copy,
  CheckCheck,
  OctagonX,
} from "lucide-react"
import { Button } from "@renderer/components/ui/button"
import { Badge } from "@renderer/components/ui/badge"
import { MarkdownRenderer } from "@renderer/components/markdown-renderer"
import { MessageQueuePanel } from "@renderer/components/message-queue-panel"
import { useMessageQueue } from "@renderer/stores"

const MIN_HEIGHT = 120
const MAX_HEIGHT = 600
const DEFAULT_HEIGHT = 280

interface SessionTileProps {
  session: {
    id: string
    conversationId?: string
    conversationTitle?: string
    status: "active" | "completed" | "error" | "stopped"
    startTime: number
    endTime?: number
    currentIteration?: number
    maxIterations?: number
    lastActivity?: string
    errorMessage?: string
    isSnoozed?: boolean
  }
  progress?: AgentProgressUpdate | null
  isFocused?: boolean
  onFocus?: () => void
  onStop?: () => void
  onSnooze?: () => void
  onUnsnooze?: () => void
  onRetry?: () => void
  onDismiss?: () => void
  className?: string
}

export function SessionTile({
  session,
  progress,
  isFocused,
  onFocus,
  onStop,
  onSnooze,
  onUnsnooze,
  onRetry,
  onDismiss,
  className,
}: SessionTileProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [tileHeight, setTileHeight] = useState(DEFAULT_HEIGHT)
  const [isResizing, setIsResizing] = useState(false)
  // Use stable message ID (timestamp+role) instead of array index to track copied message
  // This prevents the checkmark from appearing on the wrong message if messages are inserted/removed
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Generate stable message ID from timestamp and role
  const getMessageId = (message: { role: string; timestamp?: number }, index: number) => {
    return `${message.timestamp || index}-${message.role}`
  }

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current)
      }
    }
  }, [])

  // Get queued messages for this conversation
  const queuedMessages = useMessageQueue(session.conversationId)

  // Copy message to clipboard
  const handleCopyMessage = async (e: React.MouseEvent, content: string, messageId: string) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(content)
      setCopiedMessageId(messageId)
      // Clear any existing timeout before setting a new one
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current)
      }
      copyTimeoutRef.current = setTimeout(() => setCopiedMessageId(null), 2000)
    } catch (err) {
      console.error("Failed to copy message:", err)
    }
  }

  const isActive = session.status === "active"
  const isComplete = session.status === "completed"
  const hasError = session.status === "error"
  const isStopped = session.status === "stopped"
  const isSnoozed = session.isSnoozed
  const hasPendingApproval = !!progress?.pendingToolApproval
  const hasQueuedMessages = queuedMessages.length > 0

  const handleToggleCollapse = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsCollapsed(!isCollapsed)
  }

  // Resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(true)
    const startY = e.clientY
    const startHeight = tileHeight

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientY - startY
      const newHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startHeight + delta))
      setTileHeight(newHeight)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
  }, [tileHeight])

  // Get status icon and color
  const getStatusIndicator = () => {
    if (hasPendingApproval) {
      return <Shield className="h-4 w-4 text-amber-500 animate-pulse" />
    }
    if (isSnoozed) {
      return <Moon className="h-4 w-4 text-muted-foreground" />
    }
    if (isActive) {
      return <Activity className="h-4 w-4 text-blue-500 animate-pulse" />
    }
    if (isComplete) {
      return <CheckCircle2 className="h-4 w-4 text-green-500" />
    }
    if (hasError || isStopped) {
      return <XCircle className="h-4 w-4 text-red-500" />
    }
    return <Activity className="h-4 w-4 text-muted-foreground" />
  }

  // Get title - prefer conversationTitle, fall back to progress data
  const getTitle = () => {
    if (session.conversationTitle) {
      return session.conversationTitle
    }
    if (progress?.conversationTitle) {
      return progress.conversationTitle
    }
    // Extract from first user message in conversation
    const firstUserMsg = progress?.conversationHistory?.find(m => m.role === "user")
    if (firstUserMsg?.content) {
      return firstUserMsg.content.length > 50
        ? firstUserMsg.content.substring(0, 50) + "..."
        : firstUserMsg.content
    }
    return `Session ${session.id.substring(0, 8)}`
  }

  // Get conversation messages to display, integrating session error message chronologically
  const messages = React.useMemo(() => {
    const baseMessages = progress?.conversationHistory || []

    // If there's a session error message, integrate it into the messages at the correct chronological position
    if (session.errorMessage && session.endTime) {
      const errorEntry = {
        role: "error" as const,
        content: session.errorMessage,
        timestamp: session.endTime,
      }

      // Find the correct position to insert the error based on timestamp
      const messagesWithError = [...baseMessages]
      let insertIndex = messagesWithError.length // Default to end

      for (let i = 0; i < messagesWithError.length; i++) {
        const msgTimestamp = messagesWithError[i].timestamp || 0
        if (msgTimestamp > session.endTime) {
          insertIndex = i
          break
        }
      }

      messagesWithError.splice(insertIndex, 0, errorEntry)
      return messagesWithError
    }

    return baseMessages
  }, [progress?.conversationHistory, session.errorMessage, session.endTime])

  return (
    <div
      onClick={onFocus}
      className={cn(
        "flex flex-col rounded-lg border overflow-hidden transition-all duration-200 cursor-pointer",
        hasPendingApproval
          ? "border-amber-500 bg-amber-50/30 dark:bg-amber-950/20 ring-1 ring-amber-500/30"
          : isFocused
          ? "border-blue-500 bg-blue-50/30 dark:bg-blue-950/20 ring-1 ring-blue-500/30"
          : "border-border bg-card hover:border-border/80 hover:bg-card/80",
        isResizing && "select-none",
        className
      )}
      style={{ height: isCollapsed ? "auto" : tileHeight }}
    >
      {/* Header */}
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
          {isActive && !isSnoozed && onSnooze && (
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); onSnooze(); }} title="Minimize">
              <Minimize2 className="h-3 w-3" />
            </Button>
          )}
          {isSnoozed && onUnsnooze && (
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); onUnsnooze(); }} title="Restore">
              <Maximize2 className="h-3 w-3" />
            </Button>
          )}
          {isActive && onStop && (
            <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-destructive/20 hover:text-destructive" onClick={(e) => { e.stopPropagation(); onStop(); }} title="Stop">
              <OctagonX className="h-3 w-3" />
            </Button>
          )}
          {(hasError || isStopped) && onRetry && (
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); onRetry(); }} title="Retry">
              <RefreshCw className="h-3 w-3" />
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
          {/* Conversation content - scrollable */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="p-3 space-y-3" onClick={(e) => e.stopPropagation()}>
              {messages.length === 0 ? (
                <div className="text-center text-muted-foreground text-sm py-4">
                  {isActive ? "Starting..." : "No messages"}
                </div>
              ) : (
                messages.map((message, index) => {
                  const messageId = getMessageId(message, index)
                  const isCopied = copiedMessageId === messageId

                  // Render error messages with special styling
                  if (message.role === "error") {
                    return (
                      <div key={messageId} className="rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3">
                        <div className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">
                          Error
                        </div>
                        <div className="text-sm text-red-700 dark:text-red-300">
                          {typeof message.content === "string" ? message.content : JSON.stringify(message.content)}
                        </div>
                      </div>
                    )
                  }

                  return (
                    <div
                      key={messageId}
                      className={cn(
                        "text-sm",
                        message.role === "user"
                          ? "pl-0"
                          : message.role === "assistant"
                          ? "pl-3 border-l-2 border-blue-500/30"
                          : "pl-3 border-l-2 border-muted"
                      )}
                    >
                      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                        <span className="capitalize">{message.role}</span>
                        {message.role === "user" && typeof message.content === "string" && (
                          <button
                            onClick={(e) => handleCopyMessage(e, message.content as string, messageId)}
                            className="p-1 rounded hover:bg-muted/30 transition-colors"
                            title={isCopied ? "Copied!" : "Copy prompt"}
                            aria-label={isCopied ? "Copied!" : "Copy prompt"}
                          >
                            {isCopied ? (
                              <CheckCheck className="h-3 w-3 text-green-500" />
                            ) : (
                              <Copy className="h-3 w-3 opacity-60 hover:opacity-100" />
                            )}
                          </button>
                        )}
                      </div>
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      {typeof message.content === "string" ? (
                        <MarkdownRenderer content={message.content} />
                      ) : (
                        <span>{JSON.stringify(message.content)}</span>
                      )}
                    </div>
                  </div>
                  )
                })
              )}

              {/* Pending tool approval */}
              {hasPendingApproval && progress?.pendingToolApproval && (
                <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3">
                  <div className="text-xs font-medium text-amber-600 dark:text-amber-400 mb-1">
                    Tool Approval Required
                  </div>
                  <div className="text-sm text-amber-700 dark:text-amber-300">
                    <strong>{progress.pendingToolApproval.toolName}</strong>
                    <pre className="mt-1 text-xs bg-amber-100/50 dark:bg-amber-900/30 p-2 rounded overflow-x-auto">
                      {JSON.stringify(progress.pendingToolApproval.arguments, null, 2)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Message Queue Panel */}
          {hasQueuedMessages && session.conversationId && (
            <div className="px-3 py-2 border-t flex-shrink-0">
              <MessageQueuePanel
                conversationId={session.conversationId}
                messages={queuedMessages}
                compact={isCollapsed}
              />
            </div>
          )}

          {/* Footer with status info */}
          <div className="px-3 py-2 border-t bg-muted/20 text-xs text-muted-foreground flex-shrink-0 flex items-center gap-2">
            {progress?.profileName && (
              <span className="text-[10px] truncate max-w-[80px] text-primary/70" title={`Profile: ${progress.profileName}`}>
                {progress.profileName}
              </span>
            )}
            {progress?.profileName && isActive && progress?.modelInfo && (
              <span className="text-muted-foreground/50">•</span>
            )}
            {isActive && progress?.modelInfo && (
              <span className="text-[10px] truncate max-w-[100px]" title={`${progress.modelInfo.provider}: ${progress.modelInfo.model}`}>
                {progress.modelInfo.provider}/{progress.modelInfo.model.split('/').pop()?.substring(0, 15)}
              </span>
            )}
            {session.currentIteration && session.maxIterations && (
              <span>
                Step {session.currentIteration}/{session.maxIterations}
              </span>
            )}
            {session.lastActivity && (
              <span className="ml-2 truncate">{session.lastActivity}</span>
            )}
            {hasQueuedMessages && (
              <span className="ml-2 text-blue-500">
                • {queuedMessages.length} queued
              </span>
            )}
          </div>

          {/* Resize handle */}
          <div
            className="h-2 cursor-ns-resize flex items-center justify-center bg-muted/30 hover:bg-muted/50 transition-colors flex-shrink-0"
            onMouseDown={handleResizeStart}
          >
            <GripHorizontal className="h-3 w-3 text-muted-foreground/50" />
          </div>
        </>
      )}
    </div>
  )
}

