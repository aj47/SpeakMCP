import React, { useRef, useState, useEffect, createContext, useContext } from "react"
import { cn } from "@renderer/lib/utils"
import { GripVertical } from "lucide-react"
import { useResizable, TILE_DIMENSIONS } from "@renderer/hooks/use-resizable"

// Context to share container width and gap with tile wrappers
interface SessionGridContextValue {
  containerWidth: number
  gap: number
}

const SessionGridContext = createContext<SessionGridContextValue>({ containerWidth: 0, gap: 16 })

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
  const [gap, setGap] = useState(16) // Default to gap-4 = 16px

  useEffect(() => {
    const updateMeasurements = () => {
      if (containerRef.current) {
        // Dynamically compute padding from computed styles to handle className overrides
        const computedStyle = getComputedStyle(containerRef.current)
        // Use proper NaN check to allow 0 as a valid padding value
        const parsedPaddingLeft = parseFloat(computedStyle.paddingLeft)
        const parsedPaddingRight = parseFloat(computedStyle.paddingRight)
        const paddingLeft = !Number.isNaN(parsedPaddingLeft) ? parsedPaddingLeft : 0
        const paddingRight = !Number.isNaN(parsedPaddingRight) ? parsedPaddingRight : 0
        const totalPadding = paddingLeft + paddingRight
        setContainerWidth(containerRef.current.clientWidth - totalPadding)

        // Also compute gap from styles to handle className overrides (columnGap or gap)
        // Use a proper check that doesn't treat 0 as falsy (0 is a valid gap value)
        const parsedColumnGap = parseFloat(computedStyle.columnGap)
        const parsedGap = parseFloat(computedStyle.gap)
        const columnGap = !Number.isNaN(parsedColumnGap) ? parsedColumnGap : (!Number.isNaN(parsedGap) ? parsedGap : 16)
        setGap(columnGap)
      }
    }

    updateMeasurements()

    // Also update on resize
    const resizeObserver = new ResizeObserver(updateMeasurements)
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }

    return () => resizeObserver.disconnect()
  }, [])

  return (
    <SessionGridContext.Provider value={{ containerWidth, gap }}>
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
function calculateHalfWidth(containerWidth: number, gap: number): number {
  if (containerWidth <= 0) {
    return TILE_DIMENSIONS.width.default
  }
  // Account for gap between tiles (subtract gap for the space between two tiles)
  const halfWidth = Math.floor((containerWidth - gap) / 2)
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
  const { containerWidth, gap } = useSessionGridContext()
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
    initialWidth: calculateHalfWidth(containerWidth, gap),
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
        const halfWidth = calculateHalfWidth(containerWidth, gap)
        setSize({ width: halfWidth })
      }
    }
  }, [containerWidth, gap, setSize])

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

