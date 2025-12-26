import React, { useEffect, useState } from "react"
import { Clock, Loader2 } from "lucide-react"

export interface RetryStatusBannerProps {
  retryInfo: {
    isRetrying: boolean
    attempt: number
    maxAttempts?: number
    delaySeconds: number
    reason: string
    startedAt: number
  }
}

// Retry Status Banner - shows when LLM API is being retried (rate limits, network errors)
export const RetryStatusBanner: React.FC<RetryStatusBannerProps> = ({ retryInfo }) => {
  const [countdown, setCountdown] = useState(retryInfo.delaySeconds)

  // Update countdown timer
  useEffect(() => {
    if (!retryInfo.isRetrying) {
      setCountdown(0)
      return undefined
    }

    // Calculate remaining time based on startedAt
    const updateCountdown = () => {
      const elapsed = Math.floor((Date.now() - retryInfo.startedAt) / 1000)
      const remaining = Math.max(0, retryInfo.delaySeconds - elapsed)
      setCountdown(remaining)
    }

    updateCountdown()
    const interval = setInterval(updateCountdown, 1000)
    return () => clearInterval(interval)
  }, [retryInfo.isRetrying, retryInfo.startedAt, retryInfo.delaySeconds])

  if (!retryInfo.isRetrying) return null

  const attemptText = retryInfo.maxAttempts
    ? `Attempt ${retryInfo.attempt}/${retryInfo.maxAttempts}`
    : `Attempt ${retryInfo.attempt}`

  return (
    <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/30 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-100/50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800">
        <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
        <span className="text-xs font-medium text-amber-800 dark:text-amber-200">
          {retryInfo.reason}
        </span>
        <Loader2 className="h-3 w-3 text-amber-600 dark:text-amber-400 animate-spin ml-auto" />
      </div>

      {/* Content */}
      <div className="px-3 py-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-amber-700 dark:text-amber-300">
            {attemptText}
          </span>
          <span className="text-xs font-mono font-medium text-amber-900 dark:text-amber-100 bg-amber-100 dark:bg-amber-900/50 px-2 py-0.5 rounded">
            Retrying in {countdown}s
          </span>
        </div>
        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5">
          The agent will automatically retry when the API is available.
        </p>
      </div>
    </div>
  )
}
