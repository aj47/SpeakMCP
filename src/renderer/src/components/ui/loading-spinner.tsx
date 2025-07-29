import { cn } from "@renderer/lib/utils"
import loadingSpinnerGif from "@renderer/assets/loading-spinner.gif"

interface LoadingSpinnerProps {
  className?: string
  size?: "sm" | "md" | "lg"
  showText?: boolean
  text?: string
}

const sizeClasses = {
  sm: "w-6 h-6",
  md: "w-8 h-8", 
  lg: "w-12 h-12"
}

export function LoadingSpinner({
  className,
  size = "md",
  showText = false,
  text = "Loading..."
}: LoadingSpinnerProps) {
  return (
    <div className={cn("flex items-center justify-center", className)}>
      <div className="flex items-center gap-2">
        <img
          src={loadingSpinnerGif}
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
