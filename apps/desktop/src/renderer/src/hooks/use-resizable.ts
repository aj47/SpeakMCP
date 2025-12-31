import { useState, useCallback, useRef, useEffect } from "react"

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

export const STORAGE_KEY_PREFIX = "speakmcp-resizable-"

/**
 * Clears all persisted tile sizes from localStorage.
 * Returns the number of entries cleared.
 */
export function clearAllPersistedSizes(): number {
  try {
    const keysToRemove: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(STORAGE_KEY_PREFIX)) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key))
    return keysToRemove.length
  } catch {
    return 0
  }
}

export interface UseResizableOptions {
  initialWidth?: number
  initialHeight?: number
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
  onResizeStart?: () => void
  onResizeEnd?: (size: { width: number; height: number }) => void
  storageKey?: string
}

export interface UseResizableReturn {
  width: number
  height: number
  isResizing: boolean
  handleWidthResizeStart: (e: React.MouseEvent) => void
  handleHeightResizeStart: (e: React.MouseEvent) => void
  handleCornerResizeStart: (e: React.MouseEvent) => void
  reset: () => void
  setSize: (size: { width?: number; height?: number }) => void
}

function loadPersistedSize(storageKey: string): { width?: number; height?: number } | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_PREFIX + storageKey)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (typeof parsed.width === "number" && typeof parsed.height === "number") {
        return parsed
      }
    }
  } catch {
    return null
  }
  return null
}

function savePersistedSize(storageKey: string, size: { width: number; height: number }): void {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + storageKey, JSON.stringify(size))
  } catch {}
}

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
    storageKey,
  } = options

  const getInitialDimensions = useCallback(() => {
    if (storageKey) {
      const persisted = loadPersistedSize(storageKey)
      if (persisted) {
        return {
          width: Math.min(maxWidth, Math.max(minWidth, persisted.width ?? initialWidth)),
          height: Math.min(maxHeight, Math.max(minHeight, persisted.height ?? initialHeight)),
        }
      }
    }
    return { width: initialWidth, height: initialHeight }
  }, [storageKey, initialWidth, initialHeight, minWidth, maxWidth, minHeight, maxHeight])

  const initial = getInitialDimensions()
  const [width, setWidth] = useState(initial.width)
  const [height, setHeight] = useState(initial.height)
  const [isResizing, setIsResizing] = useState(false)

  const resizeTypeRef = useRef<"width" | "height" | "corner" | null>(null)

  const clampWidth = useCallback((w: number) => Math.min(maxWidth, Math.max(minWidth, w)), [minWidth, maxWidth])
  const clampHeight = useCallback((h: number) => Math.min(maxHeight, Math.max(minHeight, h)), [minHeight, maxHeight])

  const storageKeyRef = useRef(storageKey)
  useEffect(() => {
    if (storageKey && storageKey !== storageKeyRef.current) {
      storageKeyRef.current = storageKey
      const persisted = loadPersistedSize(storageKey)
      if (persisted) {
        setWidth(clampWidth(persisted.width ?? initialWidth))
        setHeight(clampHeight(persisted.height ?? initialHeight))
      }
    }
  }, [storageKey, initialWidth, initialHeight, clampWidth, clampHeight])

  const handleWidthResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(true)
    resizeTypeRef.current = "width"
    onResizeStart?.()

    const startX = e.clientX
    const startWidth = width
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
      const finalSize = { width: lastWidth, height }
      if (storageKey) {
        savePersistedSize(storageKey, finalSize)
      }
      onResizeEnd?.(finalSize)
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
  }, [width, height, clampWidth, onResizeStart, onResizeEnd, storageKey])

  const handleHeightResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(true)
    resizeTypeRef.current = "height"
    onResizeStart?.()

    const startY = e.clientY
    const startHeight = height
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
      const finalSize = { width, height: lastHeight }
      if (storageKey) {
        savePersistedSize(storageKey, finalSize)
      }
      onResizeEnd?.(finalSize)
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
  }, [width, height, clampHeight, onResizeStart, onResizeEnd, storageKey])

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
      const finalSize = { width: lastWidth, height: lastHeight }
      if (storageKey) {
        savePersistedSize(storageKey, finalSize)
      }
      onResizeEnd?.(finalSize)
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
  }, [width, height, clampWidth, clampHeight, onResizeStart, onResizeEnd, storageKey])

  const reset = useCallback(() => {
    setWidth(initialWidth)
    setHeight(initialHeight)
    if (storageKey) {
      try {
        localStorage.removeItem(STORAGE_KEY_PREFIX + storageKey)
      } catch {}
    }
  }, [initialWidth, initialHeight, storageKey])

  const setSize = useCallback((size: { width?: number; height?: number }) => {
    const newWidth = size.width !== undefined ? clampWidth(size.width) : width
    const newHeight = size.height !== undefined ? clampHeight(size.height) : height
    if (size.width !== undefined) setWidth(newWidth)
    if (size.height !== undefined) setHeight(newHeight)
    if (storageKey) {
      savePersistedSize(storageKey, { width: newWidth, height: newHeight })
    }
  }, [clampWidth, clampHeight, width, height, storageKey])

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

