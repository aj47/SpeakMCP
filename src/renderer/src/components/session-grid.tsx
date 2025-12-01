import React from "react"
import { cn } from "@renderer/lib/utils"

interface SessionGridProps {
  children: React.ReactNode
  sessionCount: number
  className?: string
}

/**
 * Responsive tiling layout manager for sessions.
 * 
 * Layout behavior based on session count:
 * - 1 session: Full width tile
 * - 2 sessions: 50/50 split horizontally
 * - 3 sessions: 2 on top (50/50), 1 full width on bottom
 * - 4+ sessions: 3-column grid that grows vertically
 */
export function SessionGrid({ children, sessionCount, className }: SessionGridProps) {
  // Determine grid layout classes based on session count
  const getGridClasses = () => {
    if (sessionCount === 0) {
      return ""
    }
    if (sessionCount === 1) {
      return "grid-cols-1"
    }
    if (sessionCount === 2) {
      return "grid-cols-2"
    }
    // For 3+ sessions, use a 3-column responsive grid
    // On smaller screens, fall back to fewer columns
    return "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
  }

  return (
    <div
      className={cn(
        "grid gap-4 p-4",
        getGridClasses(),
        className
      )}
    >
      {children}
    </div>
  )
}

interface SessionTileWrapperProps {
  children: React.ReactNode
  sessionCount: number
  index: number
  className?: string
}

/**
 * Wrapper for individual session tiles that handles special layout cases.
 * For example, when there are 3 sessions, the last one spans full width.
 */
export function SessionTileWrapper({
  children,
  sessionCount,
  index,
  className,
}: SessionTileWrapperProps) {
  // Special case: 3 sessions - last one spans full width
  const shouldSpanFull = sessionCount === 3 && index === 2

  return (
    <div
      className={cn(
        "min-h-[300px] max-h-[600px]",
        shouldSpanFull && "sm:col-span-2 lg:col-span-3",
        className
      )}
    >
      {children}
    </div>
  )
}

