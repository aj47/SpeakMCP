import { useState, useCallback, useRef } from "react"

// Shared tile dimension constants
export const TILE_DIMENSIONS = {
  width: {
    default: 320,
    min: 200,
    max: 1200,
  },
  height: {
    default: 300,
    min: 150,
    max: 800,
  },
} as const

export interface UseResizableOptions {
  /** Initial width */
  initialWidth?: number
  /** Initial height */
  initialHeight?: number
  /** Minimum width */
  minWidth?: number
  /** Maximum width */
  maxWidth?: number
  /** Minimum height */
  minHeight?: number
  /** Maximum height */
  maxHeight?: number
  /** Callback when resize starts */
  onResizeStart?: () => void
  /** Callback when resize ends */
  onResizeEnd?: (size: { width: number; height: number }) => void
}

export interface UseResizableReturn {
  /** Current width */
  width: number
  /** Current height */
  height: number
  /** Whether currently resizing */
  isResizing: boolean
  /** Handler for horizontal (right edge) resize */
  handleWidthResizeStart: (e: React.MouseEvent) => void
  /** Handler for vertical (bottom edge) resize */
  handleHeightResizeStart: (e: React.MouseEvent) => void
  /** Handler for corner (both dimensions) resize */
  handleCornerResizeStart: (e: React.MouseEvent) => void
  /** Reset to initial dimensions */
  reset: () => void
  /** Set dimensions programmatically */
  setSize: (size: { width?: number; height?: number }) => void
}

/**
 * Hook for making elements resizable via mouse drag.
 * Supports width-only, height-only, and corner (both) resize.
 */
export function useResizable(options: UseResizableOptions = {}): UseResizableReturn {
  const {
    initialWidth = TILE_DIMENSIONS.width.default,
    initialHeight = TILE_DIMENSIONS.height.default,
    minWidth = TILE_DIMENSIONS.width.min,
    maxWidth = TILE_DIMENSIONS.width.max,
    minHeight = TILE_DIMENSIONS.height.min,
    maxHeight = TILE_DIMENSIONS.height.max,
    onResizeStart,
    onResizeEnd,
  } = options

  const [width, setWidth] = useState(initialWidth)
  const [height, setHeight] = useState(initialHeight)
  const [isResizing, setIsResizing] = useState(false)
  
  // Use ref to track resize type for cleanup
  const resizeTypeRef = useRef<"width" | "height" | "corner" | null>(null)

  const clampWidth = useCallback((w: number) => Math.min(maxWidth, Math.max(minWidth, w)), [minWidth, maxWidth])
  const clampHeight = useCallback((h: number) => Math.min(maxHeight, Math.max(minHeight, h)), [minHeight, maxHeight])

  const handleWidthResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(true)
    resizeTypeRef.current = "width"
    onResizeStart?.()

    const startX = e.clientX
    const startWidth = width
    // Track last computed width to avoid using non-standard window.event
    let lastWidth = startWidth

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX
      lastWidth = clampWidth(startWidth + delta)
      setWidth(lastWidth)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      resizeTypeRef.current = null
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
      onResizeEnd?.({ width: lastWidth, height })
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
  }, [width, height, clampWidth, onResizeStart, onResizeEnd])

  const handleHeightResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(true)
    resizeTypeRef.current = "height"
    onResizeStart?.()

    const startY = e.clientY
    const startHeight = height
    // Track last computed height to avoid using non-standard window.event
    let lastHeight = startHeight

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientY - startY
      lastHeight = clampHeight(startHeight + delta)
      setHeight(lastHeight)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      resizeTypeRef.current = null
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
      onResizeEnd?.({ width, height: lastHeight })
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
  }, [width, height, clampHeight, onResizeStart, onResizeEnd])

  const handleCornerResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(true)
    resizeTypeRef.current = "corner"
    onResizeStart?.()

    const startX = e.clientX
    const startY = e.clientY
    const startWidth = width
    const startHeight = height
    // Track last computed dimensions to report correct final size
    let lastWidth = startWidth
    let lastHeight = startHeight

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX
      const deltaY = moveEvent.clientY - startY
      lastWidth = clampWidth(startWidth + deltaX)
      lastHeight = clampHeight(startHeight + deltaY)
      setWidth(lastWidth)
      setHeight(lastHeight)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      resizeTypeRef.current = null
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
      onResizeEnd?.({
        width: lastWidth,
        height: lastHeight
      })
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
  }, [width, height, clampWidth, clampHeight, onResizeStart, onResizeEnd])

  const reset = useCallback(() => {
    setWidth(initialWidth)
    setHeight(initialHeight)
  }, [initialWidth, initialHeight])

  const setSize = useCallback((size: { width?: number; height?: number }) => {
    if (size.width !== undefined) setWidth(clampWidth(size.width))
    if (size.height !== undefined) setHeight(clampHeight(size.height))
  }, [clampWidth, clampHeight])

  return {
    width,
    height,
    isResizing,
    handleWidthResizeStart,
    handleHeightResizeStart,
    handleCornerResizeStart,
    reset,
    setSize,
  }
}

