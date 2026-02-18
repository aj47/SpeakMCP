import React, { useState, useEffect, useCallback, useRef } from "react"
import { ResizeHandle } from "@renderer/components/resize-handle"
import { tipcClient, rendererHandlers } from "@renderer/lib/tipc-client"

// Minimum height for waveform panel - matches WAVEFORM_MIN_HEIGHT in main/window.ts
const WAVEFORM_MIN_HEIGHT = 150
type PanelMode = "normal" | "agent" | "textInput"

interface PanelResizeWrapperProps {
  children: React.ReactNode
  className?: string
  enableResize?: boolean
  minWidth?: number
  minHeight?: number
}

export function PanelResizeWrapper({
  children,
  className,
  enableResize = true,
  minWidth = 200,
  minHeight = WAVEFORM_MIN_HEIGHT,
}: PanelResizeWrapperProps) {
  const [currentSize, setCurrentSize] = useState({ width: 300, height: 200 })
  const resizeStartSizeRef = useRef<{ width: number; height: number } | null>(null)
  const lastResizeCallRef = useRef<number>(0)
  const RESIZE_THROTTLE_MS = 16 // ~60fps

  useEffect(() => {
    // Initialize local size state from current window bounds; do not change size on mount
    const init = async () => {
      try {
        const size = await tipcClient.getPanelSize()
        if (size && typeof size === "object" && "width" in size && "height" in size) {
          setCurrentSize(size as { width: number; height: number })
        }
      } catch (error) {
        console.error("Failed to get panel size on mount:", error)
      }
    }
    init()
  }, [])

  // Listen for size changes from main process (when main programmatically resizes panel)
  useEffect(() => {
    const unlisten = rendererHandlers.onPanelSizeChanged.listen((size) => {
      if (size && typeof size === 'object' && 'width' in size && 'height' in size) {
        setCurrentSize(size as { width: number; height: number })
      }
    })
    return unlisten
  }, [])

  const handleResizeStart = useCallback(() => {
    // Capture current size at the start of resize operation
    resizeStartSizeRef.current = currentSize
  }, [currentSize])

  const handleResize = useCallback(async (delta: { width: number; height: number }) => {
    const startSize = resizeStartSizeRef.current
    if (!startSize || !enableResize) return

    // Throttle IPC calls to ~60fps to avoid race conditions
    const now = Date.now()
    if (now - lastResizeCallRef.current < RESIZE_THROTTLE_MS) {
      return // Skip this frame
    }
    lastResizeCallRef.current = now

    const newWidth = Math.max(minWidth, startSize.width + delta.width)
    const newHeight = Math.max(minHeight, startSize.height + delta.height)

    // Update the panel size immediately
    try {
      await tipcClient.updatePanelSize({ width: newWidth, height: newHeight })
      setCurrentSize({ width: newWidth, height: newHeight })
    } catch (error) {
      console.error("Failed to update panel size:", error)
    }
  }, [enableResize, minWidth, minHeight])

  const handleResizeEnd = useCallback(async (size: { width: number; height: number }) => {
    if (!enableResize) return

    // Save the final size by mode so waveform and progress views don't override each other.
    try {
      const finalWidth = Math.max(minWidth, size.width)
      const finalHeight = Math.max(minHeight, size.height)
      const mode = (await tipcClient.getPanelMode()) as PanelMode
      await tipcClient.savePanelModeSize({
        mode,
        width: finalWidth,
        height: finalHeight,
      })
      setCurrentSize({ width: finalWidth, height: finalHeight })
    } catch (error) {
      try {
        // Fallback for older router builds that may not have mode-aware persistence.
        const finalWidth = Math.max(minWidth, size.width)
        const finalHeight = Math.max(minHeight, size.height)
        await tipcClient.savePanelCustomSize({ width: finalWidth, height: finalHeight })
        setCurrentSize({ width: finalWidth, height: finalHeight })
      } catch (fallbackError) {
        console.error("Failed to save panel size:", fallbackError || error)
      }
    }
  }, [enableResize, minWidth, minHeight])

  return (
    <div
      className={className}
      style={{
        minWidth: `${minWidth}px`,
        minHeight: `${minHeight}px`,
      }}
    >
      {children}

      {enableResize && (
        <>
          {/* Corner resize handles */}
          <ResizeHandle
            position="bottom-right"
            onResizeStart={handleResizeStart}
            onResize={handleResize}
            onResizeEnd={handleResizeEnd}
          />
          <ResizeHandle
            position="bottom-left"
            onResizeStart={handleResizeStart}
            onResize={handleResize}
            onResizeEnd={handleResizeEnd}
          />
          <ResizeHandle
            position="top-right"
            onResizeStart={handleResizeStart}
            onResize={handleResize}
            onResizeEnd={handleResizeEnd}
          />
          <ResizeHandle
            position="top-left"
            onResizeStart={handleResizeStart}
            onResize={handleResize}
            onResizeEnd={handleResizeEnd}
          />

          {/* Edge resize handles */}
          <ResizeHandle
            position="right"
            onResizeStart={handleResizeStart}
            onResize={handleResize}
            onResizeEnd={handleResizeEnd}
          />
          <ResizeHandle
            position="left"
            onResizeStart={handleResizeStart}
            onResize={handleResize}
            onResizeEnd={handleResizeEnd}
          />
          <ResizeHandle
            position="bottom"
            onResizeStart={handleResizeStart}
            onResize={handleResize}
            onResizeEnd={handleResizeEnd}
          />
          <ResizeHandle
            position="top"
            onResizeStart={handleResizeStart}
            onResize={handleResize}
            onResizeEnd={handleResizeEnd}
          />
        </>
      )}
    </div>
  )
}
