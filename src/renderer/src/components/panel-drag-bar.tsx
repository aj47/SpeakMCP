import React, { useState, useRef, useEffect } from "react"
import { cn } from "@renderer/lib/utils"
import { tipcClient } from "@renderer/lib/tipc-client"

interface PanelDragBarProps {
  className?: string
  disabled?: boolean
}

export function PanelDragBar({ className, disabled = false }: PanelDragBarProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState<{ x: number; y: number; windowX: number; windowY: number } | null>(null)
  const dragBarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isDragging || disabled) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStart) return

      // Calculate new position based on mouse movement from initial position
      const deltaX = e.screenX - dragStart.x
      const deltaY = e.screenY - dragStart.y

      const newX = dragStart.windowX + deltaX
      const newY = dragStart.windowY + deltaY

      // Update panel position via IPC
      tipcClient.updatePanelPosition({
        x: newX,
        y: newY,
      })
    }

    const handleMouseUp = (e: MouseEvent) => {
      if (!dragStart) return

      // Calculate final position
      const deltaX = e.screenX - dragStart.x
      const deltaY = e.screenY - dragStart.y

      const finalX = dragStart.windowX + deltaX
      const finalY = dragStart.windowY + deltaY

      // Save the final position as custom position
      tipcClient.savePanelCustomPosition({
        x: finalX,
        y: finalY,
      })

      setIsDragging(false)
      setDragStart(null)
      document.body.style.cursor = ""
    }

    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)

    // Set cursor style
    document.body.style.cursor = "grabbing"

    return () => {
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
      document.body.style.cursor = ""
    }
  }, [isDragging, dragStart, disabled])

  const handleMouseDown = async (e: React.MouseEvent) => {
    if (disabled) return

    e.preventDefault()
    e.stopPropagation()

    // Get current window position
    const windowPos = await tipcClient.getPanelPosition()

    setIsDragging(true)
    setDragStart({
      x: e.screenX,
      y: e.screenY,
      windowX: windowPos.x,
      windowY: windowPos.y,
    })
  }

  return (
    <div
      ref={dragBarRef}
      className={cn(
        "flex items-center justify-center h-6 w-full transition-colors duration-200",
        disabled
          ? "cursor-default"
          : isDragging
            ? "cursor-grabbing"
            : "cursor-grab hover:bg-white/5",
        className
      )}
      onMouseDown={handleMouseDown}
      style={{
        WebkitAppRegion: disabled ? "no-drag" : "drag" as any,
        userSelect: "none"
      }}
    >
      {/* Drag handle visual indicator */}
      <div className={cn(
        "flex items-center gap-0.5 transition-opacity duration-200",
        disabled ? "opacity-30" : "opacity-60 hover:opacity-80"
      )}>
        <div className="w-1 h-1 bg-current rounded-full" />
        <div className="w-1 h-1 bg-current rounded-full" />
        <div className="w-1 h-1 bg-current rounded-full" />
        <div className="w-1 h-1 bg-current rounded-full" />
        <div className="w-1 h-1 bg-current rounded-full" />
      </div>
    </div>
  )
}
