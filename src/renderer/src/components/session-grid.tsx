import React from "react"
import { cn } from "@renderer/lib/utils"

interface SessionGridProps {
  children: React.ReactNode
  sessionCount: number
  className?: string
}

/**
 * Responsive tiling grid layout for session tiles.
 * Automatically adapts layout based on session count:
 * - 1 session: full width
 * - 2 sessions: 50/50 side by side
 * - 3+ sessions: responsive 3-column grid
 */
export function SessionGrid({
  children,
  sessionCount,
  className,
}: SessionGridProps) {
  const gridClasses = cn(
    "grid gap-4 auto-rows-min transition-all duration-300 ease-in-out",
    {
      "grid-cols-1": sessionCount === 1,
      "grid-cols-2": sessionCount === 2,
      "grid-cols-1 md:grid-cols-2 lg:grid-cols-3": sessionCount >= 3,
    },
    className
  )

  return (
    <div className={gridClasses}>
      {React.Children.map(children, (child, index) => (
        <div
          key={index}
          className="min-h-[200px] animate-in fade-in slide-in-from-bottom-2 duration-300"
          style={{ animationDelay: `${index * 50}ms` }}
        >
          {child}
        </div>
      ))}
    </div>
  )
}

