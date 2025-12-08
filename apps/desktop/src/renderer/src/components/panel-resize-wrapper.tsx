import React, { useState, useEffect, useCallback } from "react"
import { ResizeHandle } from "@renderer/components/resize-handle"
import { tipcClient } from "@renderer/lib/tipc-client"

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
  minHeight = 100,
}: PanelResizeWrapperProps) {
  const [currentSize, setCurrentSize] = useState({ width: 300, height: 200 })

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

  const handleResizeStart = useCallback(() => {
    // No-op: resize start notification if needed for future features
  }, [])

  const handleResize = useCallback(async (delta: { width: number; height: number }) => {
    if (!enableResize) return

    const newWidth = Math.max(minWidth, currentSize.width + delta.width)
    const newHeight = Math.max(minHeight, currentSize.height + delta.height)

    // Update the panel size immediately
    try {
      await tipcClient.updatePanelSize({ width: newWidth, height: newHeight })
      setCurrentSize({ width: newWidth, height: newHeight })
    } catch (error) {
      console.error("Failed to update panel size:", error)
    }
  }, [enableResize, minWidth, minHeight, currentSize])

  const handleResizeEnd = useCallback(async (size: { width: number; height: number }) => {
    if (!enableResize) return

    // Save the final size (unified across all modes)
    try {
      const finalWidth = Math.max(minWidth, size.width)
      const finalHeight = Math.max(minHeight, size.height)

      // Save to unified panelCustomSize
      await tipcClient.savePanelCustomSize({ width: finalWidth, height: finalHeight })
      setCurrentSize({ width: finalWidth, height: finalHeight })
    } catch (error) {
      console.error("Failed to save panel size:", error)
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
