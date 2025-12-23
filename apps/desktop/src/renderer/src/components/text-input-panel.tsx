import React, { useState, useRef, useEffect, useImperativeHandle, forwardRef } from "react"
import { Textarea } from "@renderer/components/ui/textarea"
import { cn } from "@renderer/lib/utils"
import { AgentProcessingView } from "./agent-processing-view"
import { AgentProgressUpdate } from "../../../shared/types"
import { useTheme } from "@renderer/contexts/theme-context"
import { Camera, Eye } from "lucide-react"
import { useConfigQuery } from "@renderer/lib/query-client"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog"
import { Button } from "./ui/button"

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
  const configQuery = useConfigQuery()
  const alwaysIncludeScreenshot = configQuery.data?.alwaysIncludeScreenshot ?? false

  const [text, setText] = useState("")
  const [includeScreenshot, setIncludeScreenshot] = useState(alwaysIncludeScreenshot)
  const [screenshot, setScreenshot] = useState<string | null>(null)
  const [isCapturingScreenshot, setIsCapturingScreenshot] = useState(false)
  const [screenshotError, setScreenshotError] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [previewImageInfo, setPreviewImageInfo] = useState<{ width: number; height: number; size: string } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const captureWantedRef = useRef(false)
  const { isDark } = useTheme()

  // Sync includeScreenshot state when config loads or alwaysIncludeScreenshot setting changes
  useEffect(() => {
    setIncludeScreenshot(alwaysIncludeScreenshot)
  }, [alwaysIncludeScreenshot])

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

  // Helper to find the correct source based on configured display ID
  const findSourceByDisplayId = (sources: Array<{ id: string, name: string, thumbnail: string, display_id: string }>, configuredDisplayId: string | undefined) => {
    if (!configuredDisplayId || configuredDisplayId === '') {
      // No configured display ID, use first source (primary display)
      return sources[0]
    }
    // Find source matching the configured display_id
    const matchingSource = sources.find(s => s.display_id === configuredDisplayId)
    if (matchingSource) {
      console.log('[TextInputPanel] Found matching source for display_id:', configuredDisplayId)
      return matchingSource
    }
    // Fall back to first source if configured display not found
    console.log('[TextInputPanel] Configured display_id not found, falling back to primary:', configuredDisplayId)
    return sources[0]
  }

  const captureScreenshot = async () => {
    console.log('[TextInputPanel] captureScreenshot called')
    setIsCapturingScreenshot(true)
    setScreenshotError(null)
    try {
      // Use IPC to get screen sources from main process (desktopCapturer is only available in main process in Electron 31+)
      console.log('[TextInputPanel] Calling getScreenSources...')
      const sources = await (window as any).electronAPI.getScreenSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 }
      })
      console.log('[TextInputPanel] Got sources:', sources?.length || 0)

      // Check if screenshot is still wanted after async operation completes
      if (!captureWantedRef.current) {
        console.log('[TextInputPanel] Screenshot no longer wanted, discarding')
        return
      }

      if (sources && sources.length > 0) {
        // Get the source matching the configured display, or fallback to primary
        const configuredDisplayId = configQuery.data?.screenshotDisplayId
        const source = findSourceByDisplayId(sources, configuredDisplayId)
        const screenshot = source.thumbnail
        console.log('[TextInputPanel] Screenshot captured from display_id:', source.display_id, 'length:', screenshot?.length || 0)
        setScreenshot(screenshot)
      } else {
        console.log('[TextInputPanel] No sources returned')
      }
    } catch (error: any) {
      console.error('[TextInputPanel] Failed to capture screenshot:', error)
      // Show the actual error message if available (e.g., permission error on macOS)
      const errorMessage = error?.message || 'Failed to capture screenshot'
      setScreenshotError(errorMessage)
      setIncludeScreenshot(false)
    } finally {
      setIsCapturingScreenshot(false)
    }
  }

  const handlePreviewScreenshot = async () => {
    try {
      let imageToPreview: string

      // Use existing screenshot if available, otherwise capture a fresh one
      if (screenshot) {
        // Use the existing screenshot state - this is what will actually be sent
        imageToPreview = screenshot
      } else {
        // No screenshot exists yet, capture one and update state so preview matches what will be sent
        const sources = await (window as any).electronAPI.getScreenSources({
          types: ['screen'],
          thumbnailSize: { width: 1920, height: 1080 }
        })

        if (!sources || sources.length === 0) {
          console.error('[TextInputPanel] No sources available for preview')
          return
        }

        // Get the source matching the configured display, or fallback to primary
        const configuredDisplayId = configQuery.data?.screenshotDisplayId
        const source = findSourceByDisplayId(sources, configuredDisplayId)
        imageToPreview = source.thumbnail as string

        // Update the screenshot state so it matches what we're previewing
        setScreenshot(imageToPreview)
      }

      setPreviewImage(imageToPreview)

      // Calculate image info
      const img = new Image()
      img.onload = () => {
        // Calculate approximate size of base64 data
        const base64Length = imageToPreview.length - (imageToPreview.indexOf(',') + 1)
        const sizeInBytes = Math.ceil(base64Length * 0.75)
        const sizeInKB = (sizeInBytes / 1024).toFixed(1)
        const sizeStr = sizeInBytes > 1024 * 1024
          ? `${(sizeInBytes / (1024 * 1024)).toFixed(2)} MB`
          : `${sizeInKB} KB`

        setPreviewImageInfo({
          width: img.naturalWidth,
          height: img.naturalHeight,
          size: sizeStr
        })
      }
      img.src = imageToPreview

      setPreviewOpen(true)
    } catch (error) {
      console.error('[TextInputPanel] Failed to capture preview screenshot:', error)
    }
  }

  const handleSubmit = () => {
    if (text.trim() && !isProcessing) {
      // Only include screenshot if the checkbox is still checked
      const screenshotToSend = includeScreenshot && screenshot ? screenshot : undefined
      console.log('[TextInputPanel] handleSubmit called, screenshot:', screenshotToSend ? `${screenshotToSend.length} chars` : 'none')
      onSubmit(text.trim(), screenshotToSend)
      setText("")
      setScreenshot(null)
      setIncludeScreenshot(alwaysIncludeScreenshot)
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
            {includeScreenshot && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handlePreviewScreenshot}
                title="Preview screenshot"
                className="h-6 px-2"
              >
                <Eye className="h-3 w-3" />
              </Button>
            )}
            {isCapturingScreenshot && (
              <span className="text-xs modern-text-muted">Capturing...</span>
            )}
            {screenshot && !isCapturingScreenshot && (
              <span className="text-xs text-green-500">✓ Screenshot captured</span>
            )}
            {screenshotError && !isCapturingScreenshot && (
              <span className="text-xs text-red-500" title={screenshotError}>
                ✗ {screenshotError.includes('Screen Recording') ? 'Screen Recording permission required' : screenshotError}
              </span>
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

      {/* Screenshot Preview Dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-[90vw] max-h-[90vh] w-auto">
          <DialogHeader>
            <DialogTitle>Screenshot Preview</DialogTitle>
            <DialogDescription>
              This is what will be sent with your message
              {previewImageInfo && (
                <span className="ml-2 text-xs">
                  ({previewImageInfo.width} × {previewImageInfo.height}, {previewImageInfo.size})
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center items-center overflow-auto max-h-[70vh]">
            {previewImage && (
              <img
                src={previewImage}
                alt="Screenshot preview"
                className="max-w-full max-h-[65vh] object-contain rounded-md border border-border"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
})

TextInputPanel.displayName = "TextInputPanel"
