import React, { useState, useRef, useEffect, useImperativeHandle, forwardRef } from "react"
import { Textarea } from "@renderer/components/ui/textarea"
import { cn } from "@renderer/lib/utils"
import { AgentProcessingView } from "./agent-processing-view"
import { AgentProgressUpdate } from "../../../shared/types"
import { useTheme } from "@renderer/contexts/theme-context"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"

interface TextInputPanelProps {
  onSubmit: (text: string, screenshotData?: string) => void
  onCancel: () => void
  isProcessing?: boolean
  agentProgress?: AgentProgressUpdate | null
}

export interface TextInputPanelRef {
  focus: () => void
}

export const TextInputPanel = forwardRef<TextInputPanelRef, TextInputPanelProps>(({
  onSubmit,
  onCancel,
  isProcessing = false,
  agentProgress,
}, ref) => {
  const [text, setText] = useState("")
  const [includeScreenshot, setIncludeScreenshot] = useState(false)
  const [screenshotData, setScreenshotData] = useState<string | null>(null)
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { isDark } = useTheme()

  // Get config to check if screenshot is enabled
  const configQuery = useQuery({
    queryKey: ["config"],
    queryFn: async () => tipcClient.getConfig({}),
  })

  // Expose focus method to parent
  useImperativeHandle(ref, () => ({
    focus: () => {
      textareaRef.current?.focus()
    }
  }))

  // Auto-focus when component mounts - with retry for Windows
  useEffect(() => {
    if (textareaRef.current && !isProcessing) {
      // Try to focus immediately
      textareaRef.current.focus()

      // Retry after a short delay to ensure window is ready (especially on Windows)
      const timer1 = setTimeout(() => {
        textareaRef.current?.focus()
      }, 50)

      // Additional retry for Windows where focus can be delayed
      const timer2 = setTimeout(() => {
        textareaRef.current?.focus()
      }, 150)

      return () => {
        clearTimeout(timer1)
        clearTimeout(timer2)
      }
    }
    return undefined
  }, [isProcessing])

  const handleCaptureScreenshot = async () => {
    setIsCapturingScreenshot(true)
    try {
      const result = await tipcClient.captureScreenshot({})
      if (result && result.data) {
        const dataUrl = `data:image/${result.format};base64,${result.data}`
        setScreenshotData(dataUrl)
      }
    } catch (error) {
      console.error("Failed to capture screenshot:", error)
      const errorMessage = error instanceof Error ? error.message : String(error)

      if (errorMessage.includes("Failed to get sources") || errorMessage.includes("No screen sources")) {
        if (process.env.IS_MAC) {
          toast.error("Screen Recording Permission Required", {
            description: "Please grant Screen Recording permission in System Settings → Privacy & Security → Screen Recording",
            duration: 5000,
          })
        } else {
          toast.error("Screenshot Capture Failed", {
            description: "Unable to capture screenshot. Please check your system permissions.",
            duration: 5000,
          })
        }
      } else {
        toast.error("Screenshot Capture Failed", {
          description: errorMessage,
          duration: 5000,
        })
      }
    } finally {
      setIsCapturingScreenshot(false)
    }
  }

  const handleSubmit = async () => {
    if (text.trim() && !isProcessing) {
      let screenshot = screenshotData

      // If screenshot checkbox is checked but no screenshot captured yet, capture it now
      if (includeScreenshot && !screenshot && !isCapturingScreenshot) {
        setIsCapturingScreenshot(true)
        try {
          const result = await tipcClient.captureScreenshot({})
          if (result && result.data) {
            screenshot = `data:image/${result.format};base64,${result.data}`
          }
        } catch (error) {
          console.error("Failed to capture screenshot:", error)
          const errorMessage = error instanceof Error ? error.message : String(error)

          if (errorMessage.includes("Failed to get sources") || errorMessage.includes("No screen sources")) {
            if (process.env.IS_MAC) {
              toast.error("Screen Recording Permission Required", {
                description: "Please grant Screen Recording permission in System Settings → Privacy & Security → Screen Recording",
                duration: 5000,
              })
            } else {
              toast.error("Screenshot Capture Failed", {
                description: "Unable to capture screenshot. Please check your system permissions.",
                duration: 5000,
              })
            }
          } else {
            toast.error("Screenshot Capture Failed", {
              description: errorMessage,
              duration: 5000,
            })
          }
        } finally {
          setIsCapturingScreenshot(false)
        }
      }

      onSubmit(text.trim(), screenshot || undefined)
      setText("")
      setIncludeScreenshot(false)
      setScreenshotData(null)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Allow zoom shortcuts to pass through (Cmd/Ctrl + Plus/Minus/0)
    const isModifierPressed = e.metaKey || e.ctrlKey;

    // Zoom in: Cmd/Ctrl + Plus/Equals (with or without Shift)
    if (isModifierPressed && (e.key === '=' || e.key === 'Equal' || e.key === '+')) {
      return;
    }

    // Zoom out: Cmd/Ctrl + Minus
    if (isModifierPressed && e.key === '-') {
      return;
    }

    // Zoom reset: Cmd/Ctrl + 0
    if (isModifierPressed && e.key === '0') {
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    } else if (e.key === "Escape") {
      e.preventDefault()
      onCancel()
    }
    // Shift+Enter allows new lines (default textarea behavior)
  }

  if (isProcessing) {
    return (
      <div className={cn(
        "text-input-panel modern-text-strong flex h-full w-full items-center justify-center rounded-xl",
        isDark ? "dark" : ""
      )}>
        {agentProgress ? (
          <AgentProcessingView
            agentProgress={agentProgress}
            isProcessing={isProcessing}
            variant="overlay"
            showBackgroundSpinner={true}
            className="mx-4 w-full"
          />
        ) : (
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></div>
            <span className="text-sm">Processing...</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={cn(
      "text-input-panel modern-text-strong flex h-full w-full flex-col gap-3 rounded-xl p-3",
      isDark ? "dark" : ""
    )}>
      {/* Show agent progress if available */}
      {isProcessing && agentProgress ? (
        <AgentProcessingView
          agentProgress={agentProgress}
          isProcessing={isProcessing}
          variant="default"
          showBackgroundSpinner={true}
          className="flex-1"
        />
      ) : (
        <div className="flex flex-1 flex-col gap-2">
          <div className="modern-text-muted text-xs">
            Type your message • Enter to send • Shift+Enter for new line • Esc
            to cancel
          </div>
          <Textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message here..."
            className={cn(
              "modern-input modern-text-strong min-h-0 flex-1 resize-none border-0",
              "bg-transparent focus:border-ring focus:ring-1 focus:ring-ring",
              "placeholder:modern-text-muted",
            )}
            disabled={isProcessing}
            aria-label="Message input"
          />
        </div>
      )}

      {/* Screenshot preview */}
      {screenshotData && (
        <div className="relative rounded-lg border border-white/10 p-2">
          <img
            src={screenshotData}
            alt="Screenshot preview"
            className="max-h-32 w-full rounded object-contain"
          />
          <button
            onClick={() => {
              setScreenshotData(null)
              setIncludeScreenshot(false)
            }}
            className="absolute right-1 top-1 rounded bg-red-500/80 px-2 py-1 text-xs text-white hover:bg-red-600"
          >
            Remove
          </button>
        </div>
      )}

      <div className="modern-text-muted flex items-center justify-between text-xs">
        <div className="flex items-center gap-3">
          {text.length > 0 && (
            <span>
              {text.length} character{text.length !== 1 ? "s" : ""}
            </span>
          )}
          {configQuery.data?.screenshotEnabled && (
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={includeScreenshot}
                onChange={(e) => {
                  setIncludeScreenshot(e.target.checked)
                  if (e.target.checked && !screenshotData) {
                    handleCaptureScreenshot()
                  } else if (!e.target.checked) {
                    setScreenshotData(null)
                  }
                }}
                disabled={isProcessing || isCapturingScreenshot}
                className="h-3 w-3 rounded border-gray-300"
              />
              <span className="text-xs">
                {isCapturingScreenshot ? "Capturing..." : "Include screenshot"}
              </span>
            </label>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={isProcessing}
            className="rounded px-2 py-1 transition-colors hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!text.trim() || isProcessing || isCapturingScreenshot}
            className={cn(
              "rounded px-2 py-1 transition-colors",
              text.trim() && !isProcessing && !isCapturingScreenshot
                ? "bg-blue-500/20 text-blue-300 hover:bg-blue-500/30"
                : "cursor-not-allowed opacity-50",
            )}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
})

TextInputPanel.displayName = "TextInputPanel"
