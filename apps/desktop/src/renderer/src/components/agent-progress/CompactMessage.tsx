import React, { useEffect, useRef, useState } from "react"
import { cn } from "@renderer/lib/utils"
import { ChevronDown, ChevronUp, Copy, CheckCheck } from "lucide-react"
import { MarkdownRenderer } from "@renderer/components/markdown-renderer"
import { Badge } from "../ui/badge"
import { tipcClient } from "@renderer/lib/tipc-client"
import { AudioPlayer } from "@renderer/components/audio-player"
import { useConfigQuery } from "@renderer/lib/queries"

export interface CompactMessageProps {
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
  /** Variant controls TTS auto-play - only 'overlay' variant auto-plays TTS to prevent double playback */
  variant?: "default" | "overlay" | "tile"
}

// Compact message component for space efficiency
export const CompactMessage: React.FC<CompactMessageProps> = ({ message, isLast, isComplete, hasErrors, wasStopped = false, isExpanded, onToggleExpand, variant = "default" }) => {
  const [audioData, setAudioData] = useState<ArrayBuffer | null>(null)
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false)
  const [ttsError, setTtsError] = useState<string | null>(null)
  const [isCopied, setIsCopied] = useState(false)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const configQuery = useConfigQuery()

  // Cleanup copy timeout on unmount
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current)
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
  //
  // TTS AUTO-PLAY STRATEGY (fixes #557 - double TTS playback):
  // - Only auto-play in "overlay" variant (panel window) to prevent double playback
  // - The panel window is the primary interaction point for agent sessions
  // - When a non-snoozed session is active, the panel window is automatically shown
  // - Snoozed sessions don't show the panel, and intentionally don't auto-play TTS
  //   (they run silently in background - user can unsnooze to see/hear them)
  // - The "default" variant (main window ConversationDisplay) and "tile" variant (session tiles)
  //   never auto-play TTS - they are for viewing/managing, not primary interaction
  useEffect(() => {
    // Only auto-generate and play TTS in overlay variant to prevent double playback
    const shouldAutoPlay = variant === "overlay"
    if (shouldAutoPlay && shouldShowTTS && configQuery.data?.ttsAutoPlay && !audioData && !isGeneratingAudio && !ttsError && !wasStopped) {
      generateAudio().catch((error) => {
        // Error is already handled in generateAudio function
      })
    }
  }, [shouldShowTTS, configQuery.data?.ttsAutoPlay, audioData, isGeneratingAudio, ttsError, wasStopped, variant])

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
                          ? "border-green-200/50 bg-green-50/30 text-green-800 dark:border-green-700/50 dark:bg-green-950/40 dark:text-green-200"
                          : "border-red-200/50 bg-red-50/30 text-red-800 dark:border-red-700/50 dark:bg-red-950/40 dark:text-red-200",
                      )}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold">
                          {result.success ? "✅ Success" : "❌ Error"}
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
