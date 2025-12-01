import { useState, useCallback, useRef } from "react"

// Shared tile dimension constants
export const TILE_DIMENSIONS = {
  width: {
    default: 400,
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

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX
      setWidth(clampWidth(startWidth + delta))
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      resizeTypeRef.current = null
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
      onResizeEnd?.({ width: clampWidth(startWidth + (window.event as MouseEvent)?.clientX - startX || 0), height })
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

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientY - startY
      setHeight(clampHeight(startHeight + delta))
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      resizeTypeRef.current = null
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
      onResizeEnd?.({ width, height: clampHeight(startHeight + (window.event as MouseEvent)?.clientY - startY || 0) })
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

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX
      const deltaY = moveEvent.clientY - startY
      setWidth(clampWidth(startWidth + deltaX))
      setHeight(clampHeight(startHeight + deltaY))
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      resizeTypeRef.current = null
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
      onResizeEnd?.({ 
        width: clampWidth(startWidth), 
        height: clampHeight(startHeight) 
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

