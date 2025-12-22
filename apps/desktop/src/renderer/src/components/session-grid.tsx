import React, { useRef, useState, useEffect, createContext, useContext } from "react"
import { cn } from "@renderer/lib/utils"
import { GripVertical } from "lucide-react"
import { useResizable, TILE_DIMENSIONS } from "@renderer/hooks/use-resizable"

// Context to share container width with tile wrappers
const SessionGridContext = createContext<{ containerWidth: number }>({ containerWidth: 0 })

export function useSessionGridContext() {
  return useContext(SessionGridContext)
}

interface SessionGridProps {
  children: React.ReactNode
  sessionCount: number
  className?: string
}

export function SessionGrid({ children, sessionCount, className }: SessionGridProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        // Dynamically compute padding from computed styles to handle className overrides
        const computedStyle = getComputedStyle(containerRef.current)
        const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0
        const paddingRight = parseFloat(computedStyle.paddingRight) || 0
        const totalPadding = paddingLeft + paddingRight
        setContainerWidth(containerRef.current.clientWidth - totalPadding)
      }
    }

    updateWidth()

    // Also update on resize
    const resizeObserver = new ResizeObserver(updateWidth)
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }

    return () => resizeObserver.disconnect()
  }, [])

  return (
    <SessionGridContext.Provider value={{ containerWidth }}>
      <div
        ref={containerRef}
        className={cn(
          "flex flex-wrap gap-4 p-4 content-start",
          className
        )}
      >
        {children}
      </div>
    </SessionGridContext.Provider>
  )
}

interface SessionTileWrapperProps {
  children: React.ReactNode
  sessionId: string
  index: number
  className?: string
  isCollapsed?: boolean
  onDragStart?: (sessionId: string, index: number) => void
  onDragOver?: (index: number) => void
  onDragEnd?: () => void
  isDragTarget?: boolean
  isDragging?: boolean
}

// Calculate half container width for tile sizing, clamped to min/max
function calculateHalfWidth(containerWidth: number): number {
  if (containerWidth <= 0) {
    return TILE_DIMENSIONS.width.default
  }
  // Account for gap between tiles (gap-4 = 16px, so subtract 16px for the gap between two tiles)
  const halfWidth = Math.floor((containerWidth - 16) / 2)
  return Math.max(TILE_DIMENSIONS.width.min, Math.min(TILE_DIMENSIONS.width.max, halfWidth))
}

export function SessionTileWrapper({
  children,
  sessionId,
  index,
  className,
  isCollapsed,
  onDragStart,
  onDragOver,
  onDragEnd,
  isDragTarget,
  isDragging,
}: SessionTileWrapperProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { containerWidth } = useSessionGridContext()
  const hasInitializedRef = useRef(false)

  const {
    width,
    height,
    isResizing,
    handleWidthResizeStart,
    handleHeightResizeStart,
    handleCornerResizeStart,
    setSize,
  } = useResizable({
    initialWidth: calculateHalfWidth(containerWidth),
    initialHeight: TILE_DIMENSIONS.height.default,
    storageKey: "session-tile",
  })

  // Update width to half container width once container is measured (only on first valid measurement)
  // This handles the case where containerWidth is 0 on initial render
  useEffect(() => {
    // Only run once when containerWidth becomes valid and we haven't initialized yet
    if (containerWidth > 0 && !hasInitializedRef.current) {
      hasInitializedRef.current = true
      // Check if there's already a persisted size - if so, don't override it
      // Use try/catch to handle restricted environments where localStorage may throw
      let hasPersistedSize = false
      try {
        const persistedKey = "speakmcp-resizable-session-tile"
        hasPersistedSize = localStorage.getItem(persistedKey) !== null
      } catch {
        // Storage unavailable, fall back to default behavior
      }
      if (!hasPersistedSize) {
        const halfWidth = calculateHalfWidth(containerWidth)
        setSize({ width: halfWidth })
      }
    }
  }, [containerWidth, setSize])

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

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex-shrink-0 transition-all duration-200",
        isResizing && "select-none",
        isDragTarget && "ring-2 ring-blue-500 ring-offset-2",
        isDragging && "opacity-50",
        className
      )}
      style={{ width, height: isCollapsed ? "auto" : height }}
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
      <div className={cn("w-full", isCollapsed ? "h-auto" : "h-full")}>
        {children}
      </div>

      {/* Resize handles - hide when collapsed */}
      {!isCollapsed && (
        <>
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
        </>
      )}
    </div>
  )
}

