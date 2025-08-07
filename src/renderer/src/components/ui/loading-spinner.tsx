import { cn } from "@renderer/lib/utils"
import { useEffect, useState } from "react"
import loadingSpinnerGif from "@renderer/assets/loading-spinner.gif"
import lightSpinnerGif from "@renderer/assets/light-spinner.gif"

interface LoadingSpinnerProps {
  className?: string
  size?: "sm" | "md" | "lg"
  showText?: boolean
  text?: string
}

const sizeClasses = {
  sm: "w-6 h-6",
  md: "w-8 h-8",
  lg: "w-12 h-12",
}

// Hook to detect theme changes
function useTheme() {
  const [isDark, setIsDark] = useState(() => {
    return document.documentElement.classList.contains("dark")
  })

  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === "attributes" &&
          mutation.attributeName === "class"
        ) {
          setIsDark(document.documentElement.classList.contains("dark"))
        }
      })
    })

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })

    return () => observer.disconnect()
  }, [])

  return { isDark }
}

export function LoadingSpinner({
  className,
  size = "md",
  showText = false,
  text = "Loading...",
}: LoadingSpinnerProps) {
  const { isDark } = useTheme()
  const spinnerSrc = isDark ? loadingSpinnerGif : lightSpinnerGif

  return (
    <div className={cn("flex items-center justify-center", className)}>
      <div className="flex items-center gap-2">
        <img
          src={spinnerSrc}
          alt="Loading..."
          className={cn(sizeClasses[size], "object-contain")}
        />
        {showText && (
          <span className="text-sm text-muted-foreground">{text}</span>
        )}
      </div>
    </div>
  )
}
