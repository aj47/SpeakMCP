import { cn } from "@renderer/lib/utils"
import React from "react"

export const Control = ({
  label,
  children,
  className,
}: {
  label: React.ReactNode
  children: React.ReactNode
  className?: string
}) => {
  return (
    <div
      className={cn("flex items-center justify-between gap-5 py-2", className)}
    >
      <div className="shrink-0">
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="flex max-w-[50%] grow items-center justify-end">
        {children}
      </div>
    </div>
  )
}
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip"
import { Info } from "lucide-react"

export const ControlLabel = ({
  label,
  tooltip,
}: {
  label: React.ReactNode
  tooltip?: React.ReactNode
}) => {
  if (!tooltip) {
    return <span className="text-sm font-medium">{label}</span>
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium">{label}</span>
      <TooltipProvider delayDuration={0} disableHoverableContent>
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help hover:text-foreground transition-colors" />
          </TooltipTrigger>
          <TooltipContent
            side="right"
            align="start"
            collisionPadding={20}
            avoidCollisions={true}
            sideOffset={8}
            className="z-[99999] max-w-xs"
          >
            <p>{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  )
}

export const ControlGroup = ({
  children,
  className,
  title,
  endDescription,
}: {
  children: React.ReactNode
  className?: string
  title?: React.ReactNode
  endDescription?: React.ReactNode
}) => {
  return (
    <div className={className}>
      {title && (
        <div className="mb-3">
          <span className="text-sm font-semibold">{title}</span>
        </div>
      )}
      <div className="divide-y rounded-lg border">{children}</div>
      {endDescription && (
        <div className="mt-2 flex justify-end text-right text-xs text-muted-foreground">
          <div className="max-w-[70%]">{endDescription}</div>
        </div>
      )}
    </div>
  )
}
