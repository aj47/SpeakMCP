import React, { useState, useCallback, useRef, useEffect } from "react"
import { cn } from "@renderer/lib/utils"
import { GripVertical } from "lucide-react"

interface SessionGridProps {
  children: React.ReactNode
  sessionCount: number
  className?: string
}

/**
 * Flexible layout manager for sessions.
 * Uses flex-wrap to allow tiles to flow and be resized individually.
 */
export function SessionGrid({ children, sessionCount, className }: SessionGridProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap gap-4 p-4 content-start",
        className
      )}
    >
      {children}
    </div>
  )
}

// Default tile dimensions
const TILE_DEFAULT_WIDTH = 400
const TILE_MIN_WIDTH = 200
const TILE_MAX_WIDTH = 1200
const TILE_DEFAULT_HEIGHT = 300
const TILE_MIN_HEIGHT = 150
const TILE_MAX_HEIGHT = 800

interface SessionTileWrapperProps {
  children: React.ReactNode
  sessionId: string
  index: number
  className?: string
  // Drag and drop callbacks
  onDragStart?: (sessionId: string, index: number) => void
  onDragOver?: (index: number) => void
  onDragEnd?: () => void
  isDragTarget?: boolean
  isDragging?: boolean
}

/**
 * Wrapper for individual session tiles with resizable width/height and drag support.
 */
export function SessionTileWrapper({
  children,
  sessionId,
  index,
  className,
  onDragStart,
  onDragOver,
  onDragEnd,
  isDragTarget,
  isDragging,
}: SessionTileWrapperProps) {
  const [width, setWidth] = useState(TILE_DEFAULT_WIDTH)
  const [height, setHeight] = useState(TILE_DEFAULT_HEIGHT)
  const [isResizingWidth, setIsResizingWidth] = useState(false)
  const [isResizingHeight, setIsResizingHeight] = useState(false)
  const [isResizingCorner, setIsResizingCorner] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Handle horizontal resize (right edge)
  const handleWidthResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizingWidth(true)
    const startX = e.clientX
    const startWidth = width

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX
      const newWidth = Math.min(TILE_MAX_WIDTH, Math.max(TILE_MIN_WIDTH, startWidth + delta))
      setWidth(newWidth)
    }

    const handleMouseUp = () => {
      setIsResizingWidth(false)
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
  }, [width])

  // Handle vertical resize (bottom edge)
  const handleHeightResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizingHeight(true)
    const startY = e.clientY
    const startHeight = height

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientY - startY
      const newHeight = Math.min(TILE_MAX_HEIGHT, Math.max(TILE_MIN_HEIGHT, startHeight + delta))
      setHeight(newHeight)
    }

    const handleMouseUp = () => {
      setIsResizingHeight(false)
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
  }, [height])

  // Handle corner resize (both dimensions)
  const handleCornerResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizingCorner(true)
    const startX = e.clientX
    const startY = e.clientY
    const startWidth = width
    const startHeight = height

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX
      const deltaY = moveEvent.clientY - startY
      const newWidth = Math.min(TILE_MAX_WIDTH, Math.max(TILE_MIN_WIDTH, startWidth + deltaX))
      const newHeight = Math.min(TILE_MAX_HEIGHT, Math.max(TILE_MIN_HEIGHT, startHeight + deltaY))
      setWidth(newWidth)
      setHeight(newHeight)
    }

    const handleMouseUp = () => {
      setIsResizingCorner(false)
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
  }, [width, height])

  // Drag handlers
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData("text/plain", sessionId)
    onDragStart?.(sessionId, index)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    onDragOver?.(index)
  }

  const handleDragEnd = () => {
    onDragEnd?.()
  }

  const isResizing = isResizingWidth || isResizingHeight || isResizingCorner

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex-shrink-0 transition-shadow",
        isResizing && "select-none",
        isDragTarget && "ring-2 ring-blue-500 ring-offset-2",
        isDragging && "opacity-50",
        className
      )}
      style={{ width, height }}
      draggable={!isResizing}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      {/* Drag handle indicator in top-left */}
      <div
        className="absolute top-2 left-2 z-10 p-1 rounded bg-muted/50 cursor-grab active:cursor-grabbing opacity-0 hover:opacity-100 transition-opacity"
        title="Drag to reorder"
      >
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </div>

      {/* Main content */}
      <div className="w-full h-full">
        {children}
      </div>

      {/* Right edge resize handle */}
      <div
        className="absolute top-0 right-0 w-2 h-full cursor-ew-resize hover:bg-blue-500/30 transition-colors"
        onMouseDown={handleWidthResizeStart}
      />

      {/* Bottom edge resize handle */}
      <div
        className="absolute bottom-0 left-0 w-full h-2 cursor-ns-resize hover:bg-blue-500/30 transition-colors"
        onMouseDown={handleHeightResizeStart}
      />

      {/* Corner resize handle */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize hover:bg-blue-500/50 transition-colors rounded-tl"
        onMouseDown={handleCornerResizeStart}
      >
        <svg className="w-4 h-4 text-muted-foreground/50" viewBox="0 0 16 16">
          <path d="M14 14H10M14 14V10M14 14L10 10M14 8V6M8 14H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        </svg>
      </div>
    </div>
  )
}

