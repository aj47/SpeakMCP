import React from "react"
import { cn } from "@renderer/lib/utils"

interface SliderProps {
  value: number[]
  onValueChange: (value: number[]) => void
  max?: number
  min?: number
  step?: number
  className?: string
  disabled?: boolean
}

export function Slider({
  value,
  onValueChange,
  max = 100,
  min = 0,
  step = 1,
  className,
  disabled = false,
}: SliderProps) {
  const currentValue = value[0] || 0
  const percentage = ((currentValue - min) / (max - min)) * 100

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseFloat(e.target.value)
    onValueChange([newValue])
  }

  return (
    <div className={cn("relative flex items-center", className)}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={currentValue}
        onChange={handleChange}
        disabled={disabled}
        className={cn(
          "h-2 w-full cursor-pointer appearance-none rounded-lg bg-gray-200 dark:bg-gray-700",
          "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4",
          "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-500 [&::-webkit-slider-thumb]:cursor-pointer",
          "[&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:transition-all [&::-webkit-slider-thumb]:hover:bg-blue-600",
          "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full",
          "[&::-moz-range-thumb]:bg-blue-500 [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:border-0",
          "[&::-moz-range-thumb]:shadow-md [&::-moz-range-thumb]:transition-all [&::-moz-range-thumb]:hover:bg-blue-600"
        )}
        style={{
          background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${percentage}%, #e5e7eb ${percentage}%, #e5e7eb 100%)`,
        }}
      />
    </div>
  )
}
