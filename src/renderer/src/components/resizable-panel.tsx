import React, { useState, useEffect, useRef } from "react"
import { cn } from "@renderer/lib/utils"
import { ResizeHandle } from "@renderer/components/resize-handle"
import { tipcClient } from "@renderer/lib/tipc-client"

interface ResizablePanelProps {
  children: React.ReactNode
  className?: string
  enableResize?: boolean
  minWidth?: number
  minHeight?: number
  onResize?: (size: { width: number; height: number }) => void
}

export function ResizablePanel({
  children,
  className,
  enableResize = true,
  minWidth = 200,
  minHeight = 100,
  onResize,
}: ResizablePanelProps) {
  const [isResizing, setIsResizing] = useState(false)
  const [currentSize, setCurrentSize] = useState({ width: 300, height: 200 })
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Get initial size when component mounts
    const getInitialSize = async () => {
      try {
        const size = await tipcClient.getPanelSize()
        if (size && typeof size === 'object' && 'width' in size && 'height' in size) {
          setCurrentSize(size as { width: number; height: number })
        }
      } catch (error) {
        console.error("Failed to get initial panel size:", error)
      }
    }
    getInitialSize()
  }, [])

  const handleResizeStart = () => {
    setIsResizing(true)
  }

  const handleResize = async (delta: { width: number; height: number }) => {
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
  }

  const handleResizeEnd = async (size: { width: number; height: number }) => {
    if (!enableResize) return

    setIsResizing(false)

    // Save the final size
    try {
      const finalWidth = Math.max(minWidth, size.width)
      const finalHeight = Math.max(minHeight, size.height)
      
      await tipcClient.savePanelCustomSize({ width: finalWidth, height: finalHeight })
      setCurrentSize({ width: finalWidth, height: finalHeight })
      
      if (onResize) {
        onResize({ width: finalWidth, height: finalHeight })
      }
    } catch (error) {
      console.error("Failed to save panel size:", error)
    }
  }

  return (
    <div
      ref={panelRef}
      className={cn(
        "relative",
        isResizing && "select-none",
        className,
      )}
      style={{
        // Ensure the panel can be resized
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
