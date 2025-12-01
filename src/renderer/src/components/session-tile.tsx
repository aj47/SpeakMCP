import React, { useRef, useState } from "react"
import { cn } from "@renderer/lib/utils"
import { AgentProgressUpdate } from "../../../shared/types"
import { useAgentStore } from "@renderer/stores"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useTheme } from "@renderer/contexts/theme-context"
import { MarkdownRenderer } from "@renderer/components/markdown-renderer"
import { Square, X, Minimize2, Loader2 } from "lucide-react"
import { Button } from "./ui/button"

interface SessionTileProps {
  sessionId: string
  progress: AgentProgressUpdate
  onFocus?: () => void
  onSnooze?: () => void
  onStop?: () => void
  className?: string
}

type SessionStatus = "active" | "complete" | "error" | "snoozed"

const getSessionStatus = (progress: AgentProgressUpdate): SessionStatus => {
  if (progress.isSnoozed) return "snoozed"
  if (progress.steps?.some(s => s.status === "error")) return "error"
  if (progress.isComplete) return "complete"
  return "active"
}

const statusConfig: Record<SessionStatus, { icon: string; border: string; pulse?: boolean }> = {
  active: { icon: "🟢", border: "border-blue-500", pulse: true },
  complete: { icon: "✅", border: "border-green-500" },
  error: { icon: "🔴", border: "border-red-500" },
  snoozed: { icon: "💤", border: "border-muted" },
}

export const SessionTile: React.FC<SessionTileProps> = ({
  sessionId,
  progress,
  onFocus,
  onSnooze,
  onStop,
  className,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [continueText, setContinueText] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const { isDark } = useTheme()
  const clearSessionProgress = useAgentStore((s) => s.clearSessionProgress)

  const status = getSessionStatus(progress)
  const config = statusConfig[status]
  const title = progress.conversationTitle || progress.conversationHistory?.[0]?.content?.slice(0, 50) || "Session"
  const isActive = status === "active"

  const handleStop = async () => {
    onStop?.()
    try {
      await tipcClient.stopAgentSession({ sessionId })
    } catch (e) {
      console.error("Failed to stop session:", e)
    }
  }

  const handleSnooze = async () => {
    onSnooze?.()
    try {
      await tipcClient.snoozeAgentSession({ sessionId })
    } catch (e) {
      console.error("Failed to snooze session:", e)
    }
  }

  const handleDismiss = () => {
    clearSessionProgress(sessionId)
  }

  const handleContinue = async () => {
    if (!continueText.trim() || isSubmitting) return
    setIsSubmitting(true)
    try {
      // TODO: Wire up to tipcClient.continueAgentSession when the backend endpoint is implemented
      // For now, we can use processTextInput to start a new agent mode request
      // await tipcClient.continueAgentSession({ sessionId, userMessage: continueText.trim() })
      console.log("Continue session (not yet implemented):", sessionId, continueText.trim())
      setContinueText("")
    } catch (e) {
      console.error("Failed to continue session:", e)
    } finally {
      setIsSubmitting(false)
    }
  }

  const messages = progress.conversationHistory || []

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border-2 bg-background/80 backdrop-blur-sm overflow-hidden",
        config.border,
        config.pulse && "animate-pulse",
        isDark ? "dark" : "",
        className
      )}
      onClick={onFocus}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/30 bg-muted/10">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-sm">{config.icon}</span>
          <span className="text-xs font-medium truncate">{title}</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {isActive && (
            <>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleSnooze} title="Snooze">
                <Minimize2 className="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-500" onClick={handleStop} title="Stop">
                <Square className="h-3 w-3" />
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleDismiss} title="Dismiss">
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Conversation Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 space-y-2 max-h-[200px] min-h-[80px]">
        {messages.map((msg, idx) => (
          <div key={idx} className={cn(
            "text-xs rounded px-2 py-1",
            msg.role === "user" && "border-l-2 border-blue-400 bg-blue-400/5",
            msg.role === "assistant" && "border-l-2 border-gray-400 bg-gray-400/5",
            msg.role === "tool" && "border-l-2 border-orange-400 bg-orange-400/5"
          )}>
            <span className="opacity-60 mr-1">{msg.role === "user" ? "👤" : msg.role === "assistant" ? "🤖" : "🔧"}</span>
            <MarkdownRenderer content={msg.content?.slice(0, 300) || ""} className="inline" />
          </div>
        ))}
        {!progress.isComplete && progress.steps?.find(s => s.status === "in_progress") && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Processing...</span>
          </div>
        )}
      </div>

      {/* Continue Input (active sessions only) */}
      {isActive && progress.isComplete === false && (
        <div className="p-2 border-t border-border/30">
          <div className="flex gap-2">
            <input
              type="text"
              value={continueText}
              onChange={(e) => setContinueText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleContinue()}
              placeholder="Continue conversation..."
              className="flex-1 text-xs px-2 py-1 rounded border border-border bg-background"
              disabled={isSubmitting}
            />
            <Button size="sm" className="h-6 text-xs" onClick={handleContinue} disabled={isSubmitting || !continueText.trim()}>
              Send
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

