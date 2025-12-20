import React, { useState, useRef, useEffect, useImperativeHandle, forwardRef } from "react"
import { Textarea } from "@renderer/components/ui/textarea"
import { cn } from "@renderer/lib/utils"
import { AgentProcessingView } from "./agent-processing-view"
import { AgentProgressUpdate } from "../../../shared/types"
import { useTheme } from "@renderer/contexts/theme-context"
import { Camera } from "lucide-react"

interface TextInputPanelProps {
  onSubmit: (text: string, screenshot?: string) => void
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
  const [screenshot, setScreenshot] = useState<string | null>(null)
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false)
  const [screenshotError, setScreenshotError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const captureWantedRef = useRef(false)
  const { isDark } = useTheme()

  useImperativeHandle(ref, () => ({
    focus: () => {
      textareaRef.current?.focus()
    }
  }))

  useEffect(() => {
    if (textareaRef.current && !isProcessing) {
      textareaRef.current.focus()

      const timer1 = setTimeout(() => {
        textareaRef.current?.focus()
      }, 50)

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

  const captureScreenshot = async () => {
    setIsCapturingScreenshot(true)
    setScreenshotError(null)
    try {
      // Use IPC to get screen sources from main process (desktopCapturer is only available in main process in Electron 31+)
      const sources = await (window as any).electronAPI.getScreenSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 }
      })

      // Check if screenshot is still wanted after async operation completes
      if (!captureWantedRef.current) {
        return
      }

      if (sources && sources.length > 0) {
        // Get the first screen (primary display) - thumbnail is already a data URL from main process
        const screenshot = sources[0].thumbnail
        setScreenshot(screenshot)
      }
    } catch (error) {
      console.error('Failed to capture screenshot:', error)
      setScreenshotError('Failed to capture screenshot')
      setIncludeScreenshot(false)
    } finally {
      setIsCapturingScreenshot(false)
    }
  }

  const handleSubmit = () => {
    if (text.trim() && !isProcessing) {
      // Only include screenshot if the checkbox is still checked
      onSubmit(text.trim(), includeScreenshot && screenshot ? screenshot : undefined)
      setText("")
      setScreenshot(null)
      setIncludeScreenshot(false)
    }
  }

  // Capture screenshot when checkbox is toggled on, clear when toggled off
  useEffect(() => {
    if (includeScreenshot) {
      captureWantedRef.current = true
      if (!screenshot) {
        captureScreenshot()
      }
    } else {
      captureWantedRef.current = false
      if (screenshot) {
        // Clear screenshot when user unchecks the box
        setScreenshot(null)
      }
    }
  }, [includeScreenshot, screenshot])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const isModifierPressed = e.metaKey || e.ctrlKey;

    if (isModifierPressed && (e.key === '=' || e.key === 'Equal' || e.key === '+')) {
      return;
    }

    if (isModifierPressed && e.key === '-') {
      return;
    }

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
  }

  if (isProcessing && agentProgress) {
    return (
      <div className={cn(
        "text-input-panel modern-text-strong flex h-full w-full items-center justify-center rounded-xl",
        isDark ? "dark" : ""
      )}>
        <AgentProcessingView
          agentProgress={agentProgress}
          isProcessing={isProcessing}
          variant="overlay"
          showBackgroundSpinner={true}
          className="mx-4 w-full"
        />
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

          {/* Screenshot option */}
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 cursor-pointer text-xs modern-text-muted hover:modern-text-strong transition-colors">
              <input
                type="checkbox"
                checked={includeScreenshot}
                onChange={(e) => setIncludeScreenshot(e.target.checked)}
                disabled={isProcessing || isCapturingScreenshot}
                className="h-3 w-3 rounded border-gray-300"
              />
              <Camera className="h-3 w-3" />
              <span>Include screenshot</span>
            </label>
            {isCapturingScreenshot && (
              <span className="text-xs modern-text-muted">Capturing...</span>
            )}
            {screenshot && !isCapturingScreenshot && (
              <span className="text-xs text-green-500">✓ Screenshot captured</span>
            )}
            {screenshotError && !isCapturingScreenshot && (
              <span className="text-xs text-red-500">✗ {screenshotError}</span>
            )}
          </div>
        </div>
      )}

      <div className="modern-text-muted flex items-center justify-between text-xs">
        <div>
          {text.length > 0 && (
            <span>
              {text.length} character{text.length !== 1 ? "s" : ""}
            </span>
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
            disabled={!text.trim() || isProcessing}
            className={cn(
              "rounded px-2 py-1 transition-colors",
              text.trim() && !isProcessing
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
