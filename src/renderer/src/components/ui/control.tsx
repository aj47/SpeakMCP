import { cn } from "@renderer/lib/utils"
import React from "react"

export const Control = ({
  label,
  children,
  className,
  variant = "default",
}: {
  label: React.ReactNode
  children: React.ReactNode
  className?: string
  variant?: "default" | "glass"
}) => {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-5 py-2 transition-all duration-200",
        variant === "glass" && "liquid-glass-subtle glass-border rounded-lg px-4 py-3 glass-shadow",
        className
      )}
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

export const ControlGroup = ({
  children,
  className,
  title,
  endDescription,
  variant = "default",
}: {
  children: React.ReactNode
  className?: string
  title?: React.ReactNode
  endDescription?: React.ReactNode
  variant?: "default" | "glass"
}) => {
  return (
    <div className={className}>
      {title && (
        <div className="mb-3">
          <span className="text-sm font-semibold">{title}</span>
        </div>
      )}
      <div className={cn(
        "divide-y rounded-lg transition-all duration-200",
        variant === "glass" ? "liquid-glass-card glass-border glass-shadow" : "border"
      )}>{children}</div>
      {endDescription && (
        <div className="mt-2 flex justify-end text-right text-xs text-muted-foreground">
          <div className="max-w-[70%]">{endDescription}</div>
        </div>
      )}
    </div>
  )
}
