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
      className={cn(
        "flex flex-col gap-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-5",
        className
      )}
    >
      <div className="shrink-0">
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="flex w-full items-center justify-start sm:max-w-[50%] sm:grow sm:justify-end">
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
