import React, { useMemo, useState, useCallback } from "react"
import { cn } from "@renderer/lib/utils"
import { useTheme } from "@renderer/contexts/theme-context"
import { useAgentStore } from "@renderer/stores"
import { SessionTile } from "@renderer/components/session-tile"
import { SessionGrid } from "@renderer/components/session-grid"
import { SessionInput } from "@renderer/components/session-input"
import { tipcClient } from "@renderer/lib/tipc-client"
import { Settings } from "lucide-react"
import { Button } from "@renderer/components/ui/button"
import { Link } from "react-router-dom"

/**
 * Sessions Dashboard - Main landing page for SpeakMCP
 * Shows a growing scrollable tiling grid of agent sessions
 */
export function Component() {
  const { isDark } = useTheme()
  const agentProgressById = useAgentStore((s) => s.agentProgressById)
  const setFocusedSessionId = useAgentStore((s) => s.setFocusedSessionId)
  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)

  // Get all sessions (both active and completed, excluding snoozed)
  const sessions = useMemo(() => {
    return Array.from(agentProgressById?.entries() ?? [])
      .filter(([_, progress]) => progress && !progress.isSnoozed)
      .sort((a, b) => {
        // Sort by: active first, then by start time (newer first)
        const aActive = !a[1].isComplete
        const bActive = !b[1].isComplete
        if (aActive !== bActive) return aActive ? -1 : 1
        const timeA = a[1].conversationHistory?.[0]?.timestamp || 0
        const timeB = b[1].conversationHistory?.[0]?.timestamp || 0
        return timeB - timeA
      })
  }, [agentProgressById])

  const handleSubmit = useCallback(async (text: string) => {
    setIsProcessing(true)
    try {
      await tipcClient.processTextInput({ text })
    } catch (e) {
      console.error("Failed to process text input:", e)
    } finally {
      setIsProcessing(false)
    }
  }, [])

  const handleVoiceStart = useCallback(() => {
    setIsRecording(true)
    // Voice recording will be handled by the main process
    tipcClient.startRecording().catch(console.error)
  }, [])

  const handleVoiceStop = useCallback(() => {
    setIsRecording(false)
    tipcClient.stopRecording().catch(console.error)
  }, [])

  const handleFocusSession = useCallback((sessionId: string) => {
    setFocusedSessionId(sessionId)
  }, [setFocusedSessionId])

  return (
    <div className={cn(
      "flex h-full flex-col bg-background",
      isDark ? "dark" : ""
    )}>
      {/* Header with input and settings */}
      <div className="flex-shrink-0 border-b border-border p-4">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <SessionInput
              onSubmit={handleSubmit}
              onVoiceStart={handleVoiceStart}
              onVoiceStop={handleVoiceStop}
              isRecording={isRecording}
              isProcessing={isProcessing}
              placeholder="Ask me anything... (Enter to send, or click mic for voice)"
            />
          </div>
          <Link to="/settings-general">
            <Button variant="ghost" size="icon" title="Settings">
              <Settings className="h-5 w-5" />
            </Button>
          </Link>
        </div>
      </div>

      {/* Sessions Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {sessions.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center text-muted-foreground">
              <p className="text-lg font-medium">No active sessions</p>
              <p className="text-sm">Type a message or use voice to start a new session</p>
            </div>
          </div>
        ) : (
          <SessionGrid sessionCount={sessions.length}>
            {sessions.map(([sessionId, progress]) => (
              <SessionTile
                key={sessionId}
                sessionId={sessionId}
                progress={progress}
                onFocus={() => handleFocusSession(sessionId)}
                className="h-full"
              />
            ))}
          </SessionGrid>
        )}
      </div>
    </div>
  )
}

Component.displayName = "Sessions"

// Default export for lazy loading
export default Component

