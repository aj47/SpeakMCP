import { useState, useCallback, useRef, useEffect } from "react"

// Sidebar dimension constants
export const SIDEBAR_DIMENSIONS = {
  width: {
    default: 176, // 44 in tailwind w-44 = 11rem = 176px
    min: 120,
    max: 400,
    collapsed: 48, // Width when collapsed (just icons)
  },
} as const

const STORAGE_KEY = "speakmcp-sidebar"

interface SidebarState {
  isCollapsed: boolean
  width: number
}

function loadPersistedState(): SidebarState | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (typeof parsed.isCollapsed === "boolean" && typeof parsed.width === "number") {
        return parsed
      }
    }
  } catch {
    return null
  }
  return null
}

function savePersistedState(state: SidebarState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {}
}

export interface UseSidebarOptions {
  initialWidth?: number
  initialCollapsed?: boolean
  onToggle?: (isCollapsed: boolean) => void
  onResizeEnd?: (width: number) => void
}

export interface UseSidebarReturn {
  isCollapsed: boolean
  width: number
  isResizing: boolean
  toggleCollapse: () => void
  setCollapsed: (collapsed: boolean) => void
  handleResizeStart: (e: React.MouseEvent) => void
  reset: () => void
}

export function useSidebar(options: UseSidebarOptions = {}): UseSidebarReturn {
  const {
    initialWidth = SIDEBAR_DIMENSIONS.width.default,
    initialCollapsed = false,
    onToggle,
    onResizeEnd,
  } = options

  const getInitialState = useCallback((): SidebarState => {
    const persisted = loadPersistedState()
    if (persisted) {
      return {
        isCollapsed: persisted.isCollapsed,
        width: Math.min(
          SIDEBAR_DIMENSIONS.width.max,
          Math.max(SIDEBAR_DIMENSIONS.width.min, persisted.width)
        ),
      }
    }
    return { isCollapsed: initialCollapsed, width: initialWidth }
  }, [initialWidth, initialCollapsed])

  const initial = getInitialState()
  const [isCollapsed, setIsCollapsed] = useState(initial.isCollapsed)
  const [width, setWidth] = useState(initial.width)
  const [isResizing, setIsResizing] = useState(false)

  const widthBeforeCollapseRef = useRef(width)
  const cleanupResizeRef = useRef<(() => void) | null>(null)

  const clampWidth = useCallback(
    (w: number) =>
      Math.min(SIDEBAR_DIMENSIONS.width.max, Math.max(SIDEBAR_DIMENSIONS.width.min, w)),
    []
  )

  const toggleCollapse = useCallback(() => {
    setIsCollapsed((prev) => {
      const newCollapsed = !prev
      if (newCollapsed) {
        // Store the current width before collapsing
        widthBeforeCollapseRef.current = width
      }
      const newState: SidebarState = {
        isCollapsed: newCollapsed,
        width: newCollapsed ? widthBeforeCollapseRef.current : width,
      }
      savePersistedState(newState)
      onToggle?.(newCollapsed)
      return newCollapsed
    })
  }, [width, onToggle])

  const setCollapsed = useCallback(
    (collapsed: boolean) => {
      if (collapsed && !isCollapsed) {
        widthBeforeCollapseRef.current = width
      }
      setIsCollapsed(collapsed)
      // When expanding, persist current width; when collapsing, persist the stored width
      savePersistedState({
        isCollapsed: collapsed,
        width: collapsed ? widthBeforeCollapseRef.current : width,
      })
      onToggle?.(collapsed)
    },
    [width, isCollapsed, onToggle]
  )

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      if (isCollapsed) return // Don't allow resize when collapsed

      e.preventDefault()
      e.stopPropagation()
      setIsResizing(true)

      const startX = e.clientX
      const startWidth = width
      let lastWidth = startWidth

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const delta = moveEvent.clientX - startX
        lastWidth = clampWidth(startWidth + delta)
        setWidth(lastWidth)
      }

      const cleanup = () => {
        setIsResizing(false)
        document.removeEventListener("mousemove", handleMouseMove)
        document.removeEventListener("mouseup", handleMouseUp)
        window.removeEventListener("blur", handleBlur)
        cleanupResizeRef.current = null
        savePersistedState({ isCollapsed: false, width: lastWidth })
        onResizeEnd?.(lastWidth)
      }

      const handleMouseUp = () => {
        cleanup()
      }

      const handleBlur = () => {
        cleanup()
      }

      // Store cleanup so it can be called on unmount
      cleanupResizeRef.current = cleanup

      document.addEventListener("mousemove", handleMouseMove)
      document.addEventListener("mouseup", handleMouseUp)
      window.addEventListener("blur", handleBlur)
    },
    [width, isCollapsed, clampWidth, onResizeEnd]
  )

  const reset = useCallback(() => {
    setIsCollapsed(initialCollapsed)
    setWidth(initialWidth)
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {}
  }, [initialWidth, initialCollapsed])

  // Cleanup resize listeners on unmount
  useEffect(() => {
    return () => {
      if (cleanupResizeRef.current) {
        cleanupResizeRef.current()
      }
    }
  }, [])

  return {
    isCollapsed,
    width,
    isResizing,
    toggleCollapse,
    setCollapsed,
    handleResizeStart,
    reset,
  }
}

