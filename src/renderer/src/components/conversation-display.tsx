import React from "react"
import { Card, CardContent } from "@renderer/components/ui/card"
import { Badge } from "@renderer/components/ui/badge"
import { ScrollArea } from "@renderer/components/ui/scroll-area"
import { User, Bot, Wrench } from "lucide-react"
import { cn } from "@renderer/lib/utils"
import { ConversationMessage } from "@shared/types"
import { useConversationState } from "@renderer/contexts/conversation-context"
import { AgentProgress } from "@renderer/components/agent-progress"
import { MarkdownRenderer } from "@renderer/components/markdown-renderer"
import { tipcClient } from "@renderer/lib/tipc-client"
import dayjs from "dayjs"

interface ConversationDisplayProps {
  messages: ConversationMessage[]
  className?: string
  maxHeight?: string
}

export function ConversationDisplay({
  messages,
  className,
  maxHeight = "400px",
}: ConversationDisplayProps) {
  const isFullHeight = maxHeight === "100%"
  const { agentProgress, isAgentProcessing } = useConversationState()

  if (messages.length === 0) {
    return (
      <Card className={cn("modern-panel-subtle modern-border", className)}>
        <CardContent className="p-6 text-center">
          <div className="modern-text-muted">
            No messages in this conversation yet.
          </div>
        </CardContent>
      </Card>
    )
  }

  if (isFullHeight) {
    // For full height, use direct overflow-y-auto approach like agent-progress
    return (
      <Card
        className={cn(
          "modern-panel-subtle modern-border flex h-full flex-col",
          className,
        )}
      >
        <div
          className="flex-1 space-y-4 overflow-y-auto scroll-smooth p-4"
          style={{ minHeight: 0 }} // Important for flex child to shrink
        >
          {messages.map((message, index) => (
            <ConversationMessageItem
              key={message.id}
              message={message}
              isLast={index === messages.length - 1}
            />
          ))}

          {/* Show agent progress at the bottom if processing */}
          {isAgentProcessing && agentProgress && (
            <div className="modern-panel-strong mt-4 rounded-lg p-4">
              <AgentProgress
                progress={agentProgress}
                variant="default"
                className="w-full"
              />
            </div>
          )}
        </div>
      </Card>
    )
  }

  // For fixed height, use ScrollArea
  return (
    <Card className={cn("modern-panel-subtle modern-border", className)}>
      <ScrollArea className="h-full" style={{ maxHeight }}>
        <CardContent className="space-y-4 p-4">
          {messages.map((message, index) => (
            <ConversationMessageItem
              key={message.id}
              message={message}
              isLast={index === messages.length - 1}
            />
          ))}

          {/* Show agent progress at the bottom if processing */}
          {isAgentProcessing && agentProgress && (
            <div className="modern-panel-strong mt-4 rounded-lg p-4">
              <AgentProgress
                progress={agentProgress}
                variant="default"
                className="w-full"
              />
            </div>
          )}
        </CardContent>
      </ScrollArea>
    </Card>
  )
}

interface ConversationMessageItemProps {
  message: ConversationMessage
  isLast?: boolean
}

function ConversationMessageItem({
  message,
  isLast,
}: ConversationMessageItemProps) {
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    console.log("[DEBUG][COPY_MESSAGE] Context menu triggered for message:", {
      messageId: message.id,
      role: message.role,
      contentLength: message.content.length,
      contentPreview:
        message.content.substring(0, 50) +
        (message.content.length > 50 ? "..." : ""),
      coordinates: { x: e.clientX, y: e.clientY },
    })

    tipcClient.showContextMenu({
      x: e.clientX,
      y: e.clientY,
      messageContext: {
        content: message.content,
        role: message.role,
        messageId: message.id,
      },
    })
  }

  const getRoleIcon = (role: string) => {
    switch (role) {
      case "user":
        return <User className="h-4 w-4" />
      case "assistant":
        return <Bot className="h-4 w-4" />
      case "tool":
        return <Wrench className="h-4 w-4" />
      default:
        return null
    }
  }

  const getRoleColor = (role: string) => {
    switch (role) {
      case "user":
        return "bg-blue-500/10 text-blue-600 dark:text-blue-400"
      case "assistant":
        return "bg-green-500/10 text-green-600 dark:text-green-400"
      case "tool":
        return "bg-orange-500/10 text-orange-600 dark:text-orange-400"
      default:
        return "bg-gray-500/10 text-gray-600 dark:text-gray-400"
    }
  }

  const formatTimestamp = (timestamp: number) => {
    const now = Date.now()
    const diff = now - timestamp

    if (diff < 60000) {
      // Less than 1 minute
      return "Just now"
    } else if (diff < 3600000) {
      // Less than 1 hour
      return `${Math.floor(diff / 60000)}m ago`
    } else if (diff < 86400000) {
      // Less than 1 day
      return dayjs(timestamp).format("HH:mm")
    } else {
      return dayjs(timestamp).format("MMM D, HH:mm")
    }
  }

  return (
    <div
      className={cn(
        "flex cursor-pointer gap-3 rounded-lg p-3 transition-colors",
        isLast ? "modern-interactive" : "hover:modern-panel-subtle",
      )}
      onContextMenu={handleContextMenu}
    >
      <div className="flex-shrink-0">
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full",
            getRoleColor(message.role),
          )}
        >
          {getRoleIcon(message.role)}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2 flex-wrap">
          <Badge variant="secondary" className="text-xs capitalize">
            {message.role}
          </Badge>
          <span className="modern-text-muted text-xs">
            {formatTimestamp(message.timestamp)}
          </span>
          {(message.toolCalls || message.toolResults) && (
            <>
              <span className="modern-text-muted text-xs">•</span>
              <div className="flex items-center gap-1">
                {message.toolCalls && message.toolCalls.length > 0 && (
                  <Badge variant="outline" className="text-xs">
                    {message.toolCalls.length} tool call{message.toolCalls.length > 1 ? 's' : ''}
                  </Badge>
                )}
                {message.toolResults && message.toolResults.length > 0 && (
                  <Badge variant="outline" className="text-xs">
                    {message.toolResults.length} result{message.toolResults.length > 1 ? 's' : ''}
                  </Badge>
                )}
              </div>
            </>
          )}
        </div>

        <div className="modern-text-strong">
          <MarkdownRenderer content={message.content} />
        </div>

        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-3 space-y-2">
            <div className="modern-text-muted text-xs font-semibold">Tool Calls ({message.toolCalls.length}):</div>
            {message.toolCalls.map((toolCall, index) => (
              <div
                key={index}
                className="modern-panel-subtle rounded-lg border p-3 text-xs"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono font-semibold text-primary">
                    {toolCall.name}
                  </span>
                  <Badge variant="outline" className="text-xs">
                    Tool {index + 1}
                  </Badge>
                </div>
                {toolCall.arguments && (
                  <div>
                    <div className="mb-1 text-xs font-medium text-muted-foreground">
                      Parameters:
                    </div>
                    <pre className="modern-panel rounded bg-muted/50 p-2 overflow-x-auto text-xs">
                      {JSON.stringify(toolCall.arguments, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {message.toolResults && message.toolResults.length > 0 && (
          <div className="mt-3 space-y-2">
            <div className="modern-text-muted text-xs font-semibold">Tool Results ({message.toolResults.length}):</div>
            {message.toolResults.map((result, index) => (
              <div
                key={index}
                className={cn(
                  "rounded-lg border p-3 text-xs",
                  result.success
                    ? "border-green-200 bg-green-50/50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300"
                    : "border-red-200 bg-red-50/50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300",
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <Badge
                    variant={result.success ? "default" : "destructive"}
                    className={cn(
                      "text-xs",
                      result.success
                        ? "bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100"
                        : "bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-100"
                    )}
                  >
                    {result.success ? "✅ Success" : "❌ Error"}
                  </Badge>
                  <span className="text-muted-foreground text-xs">
                    Result {index + 1}
                  </span>
                </div>

                <div className="space-y-2">
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">
                      Content:
                    </div>
                    <pre className="modern-panel rounded bg-muted/30 p-2 overflow-x-auto text-xs whitespace-pre-wrap break-all">
                      {result.content || "No content returned"}
                    </pre>
                  </div>

                  {result.error && (
                    <div>
                      <div className="text-xs font-medium text-destructive mb-1">
                        Error Details:
                      </div>
                      <pre className="modern-panel rounded bg-destructive/10 p-2 overflow-x-auto text-xs whitespace-pre-wrap break-all">
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
    </div>
  )
}

// Compact version for smaller displays
export function ConversationDisplayCompact({
  messages,
  className,
  maxHeight = "200px",
}: ConversationDisplayProps) {
  if (messages.length === 0) {
    return (
      <div
        className={cn("modern-text-muted p-4 text-center text-sm", className)}
      >
        No conversation history
      </div>
    )
  }

  return (
    <ScrollArea className={cn("w-full", className)} style={{ maxHeight }}>
      <div className="space-y-2 p-2">
        {messages.slice(-5).map(
          (
            message, // Show only last 5 messages
          ) => (
            <div key={message.id} className="flex gap-2 text-sm">
              <div
                className={cn(
                  "flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full",
                  getRoleColorCompact(message.role),
                )}
              >
                {getRoleIconCompact(message.role)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="modern-text-strong truncate">
                  {message.content}
                </div>
              </div>
            </div>
          ),
        )}
      </div>
    </ScrollArea>
  )
}

function getRoleIconCompact(role: string) {
  switch (role) {
    case "user":
      return <User className="h-3 w-3" />
    case "assistant":
      return <Bot className="h-3 w-3" />
    case "tool":
      return <Wrench className="h-3 w-3" />
    default:
      return null
  }
}

function getRoleColorCompact(role: string) {
  switch (role) {
    case "user":
      return "bg-blue-500/20 text-blue-600 dark:text-blue-400"
    case "assistant":
      return "bg-green-500/20 text-green-600 dark:text-green-400"
    case "tool":
      return "bg-orange-500/20 text-orange-600 dark:text-orange-400"
    default:
      return "bg-gray-500/20 text-gray-600 dark:text-gray-400"
  }
}
