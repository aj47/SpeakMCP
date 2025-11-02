import React from "react"
import { cn } from "@renderer/lib/utils"

interface SettingsDragBarProps {
  className?: string
}

/**
 * A draggable top bar for the settings window on macOS.
 * This allows users to drag the window while maintaining scrollable content below.
 * Similar to the implementation in MCPtools.
 */
export function SettingsDragBar({ className }: SettingsDragBarProps) {
  return (
    <div
      className={cn(
        "app-drag-region flex h-10 w-full shrink-0 items-center justify-center",
        className,
      )}
      style={{
        WebkitAppRegion: "drag",
        userSelect: "none",
      } as any}
    >
      {/* Empty drag bar - just provides the draggable area */}
    </div>
  )
}

