import React from "react"
import { Card, CardContent } from "@renderer/components/ui/card"
import { Badge } from "@renderer/components/ui/badge"
import { ScrollArea } from "@renderer/components/ui/scroll-area"
import { User, Bot, Wrench } from "lucide-react"
import { cn } from "@renderer/lib/utils"
import { ConversationMessage } from "@shared/types"
import { useConversationState } from "@renderer/contexts/conversation-context"
import { AgentProgress } from "@renderer/components/agent-progress"
import dayjs from "dayjs"

interface ConversationDisplayProps {
  messages: ConversationMessage[]
  className?: string
  maxHeight?: string
}

export function ConversationDisplay({
  messages,
  className,
  maxHeight = "400px"
}: ConversationDisplayProps) {
  const isFullHeight = maxHeight === "100%"
  const { agentProgress, isAgentProcessing } = useConversationState()

  if (messages.length === 0) {
    return (
      <Card className={cn("liquid-glass-subtle glass-border", className)}>
        <CardContent className="p-6 text-center">
          <div className="glass-text-muted">
            No messages in this conversation yet.
          </div>
        </CardContent>
      </Card>
    )
  }

  if (isFullHeight) {
    // For full height, use direct overflow-y-auto approach like agent-progress
    return (
      <Card className={cn("liquid-glass-subtle glass-border h-full flex flex-col", className)}>
        <div
          className="flex-1 overflow-y-auto scroll-smooth p-4 space-y-4"
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
            <div className="mt-4 p-4 liquid-glass-strong rounded-lg">
              <AgentProgress progress={agentProgress} variant="default" className="w-full" />
            </div>
          )}
        </div>
      </Card>
    )
  }

  // For fixed height, use ScrollArea
  return (
    <Card className={cn("liquid-glass-subtle glass-border", className)}>
      <ScrollArea className="h-full" style={{ maxHeight }}>
        <CardContent className="p-4 space-y-4">
          {messages.map((message, index) => (
            <ConversationMessageItem
              key={message.id}
              message={message}
              isLast={index === messages.length - 1}
            />
          ))}

          {/* Show agent progress at the bottom if processing */}
          {isAgentProcessing && agentProgress && (
            <div className="mt-4 p-4 liquid-glass-strong rounded-lg">
              <AgentProgress progress={agentProgress} variant="default" className="w-full" />
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

function ConversationMessageItem({ message, isLast }: ConversationMessageItemProps) {
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

    if (diff < 60000) { // Less than 1 minute
      return "Just now"
    } else if (diff < 3600000) { // Less than 1 hour
      return `${Math.floor(diff / 60000)}m ago`
    } else if (diff < 86400000) { // Less than 1 day
      return dayjs(timestamp).format("HH:mm")
    } else {
      return dayjs(timestamp).format("MMM D, HH:mm")
    }
  }

  return (
    <div className={cn(
      "flex gap-3 p-3 rounded-lg transition-colors",
      isLast ? "liquid-glass-interactive" : "hover:liquid-glass-subtle"
    )}>
      <div className="flex-shrink-0">
        <div className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center",
          getRoleColor(message.role)
        )}>
          {getRoleIcon(message.role)}
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <Badge variant="secondary" className="text-xs capitalize">
            {message.role}
          </Badge>
          <span className="text-xs glass-text-muted">
            {formatTimestamp(message.timestamp)}
          </span>
        </div>

        <div className="glass-text-strong whitespace-pre-wrap break-words">
          {message.content}
        </div>

        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2 space-y-1">
            <div className="text-xs glass-text-muted">Tool Calls:</div>
            {message.toolCalls.map((toolCall, index) => (
              <div key={index} className="text-xs liquid-glass-subtle rounded p-2">
                <span className="font-mono">{toolCall.name}</span>
                {toolCall.arguments && (
                  <pre className="mt-1 text-xs glass-text-muted overflow-x-auto">
                    {JSON.stringify(toolCall.arguments, null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}

        {message.toolResults && message.toolResults.length > 0 && (
          <div className="mt-2 space-y-1">
            <div className="text-xs glass-text-muted">Tool Results:</div>
            {message.toolResults.map((result, index) => (
              <div key={index} className={cn(
                "text-xs rounded p-2",
                result.success
                  ? "bg-green-500/10 text-green-600 dark:text-green-400"
                  : "bg-red-500/10 text-red-600 dark:text-red-400"
              )}>
                <div className="font-medium">
                  {result.success ? "Success" : "Error"}
                </div>
                <div className="mt-1 whitespace-pre-wrap">
                  {result.content}
                </div>
                {result.error && (
                  <div className="mt-1 text-red-500 text-xs">
                    Error: {result.error}
                  </div>
                )}
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
  maxHeight = "200px"
}: ConversationDisplayProps) {
  if (messages.length === 0) {
    return (
      <div className={cn("glass-text-muted text-sm text-center p-4", className)}>
        No conversation history
      </div>
    )
  }

  return (
    <ScrollArea className={cn("w-full", className)} style={{ maxHeight }}>
      <div className="space-y-2 p-2">
        {messages.slice(-5).map((message) => ( // Show only last 5 messages
          <div key={message.id} className="flex gap-2 text-sm">
            <div className={cn(
              "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0",
              getRoleColorCompact(message.role)
            )}>
              {getRoleIconCompact(message.role)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="glass-text-strong truncate">
                {message.content}
              </div>
            </div>
          </div>
        ))}
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
