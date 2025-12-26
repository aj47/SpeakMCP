import { useState, useEffect } from "react"
import { rendererHandlers, tipcClient } from "@renderer/lib/tipc-client"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog"
import { Button } from "./ui/button"
import type { ContextLimitWarning } from "../../../shared/types"
import { AlertTriangleIcon, RefreshCwIcon, PackageIcon, ZapIcon } from "lucide-react"

function ContextLimitWarningDialog() {
  const [warning, setWarning] = useState<ContextLimitWarning | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [dismissedSessions, setDismissedSessions] = useState<Set<string>>(new Set())

  // Listen for context limit warnings
  useEffect(() => {
    const unlisten = rendererHandlers["context:limit-warning"].listen(
      (w: ContextLimitWarning) => {
        // Don't show if user already dismissed for this session
        if (dismissedSessions.has(w.sessionId)) {
          return
        }
        setWarning(w)
        setIsOpen(true)
      }
    )
    return unlisten
  }, [dismissedSessions])

  const handleAction = async (action: "clear_and_continue" | "summarize" | "continue_anyway" | "dismiss") => {
    if (!warning) return

    switch (action) {
      case "clear_and_continue":
        // Future: Implement ledger loading
        // For now: Just dismiss and let context reduction handle it
        console.log("[Context Warning] User chose: Clear & Continue (ledger system pending)")
        break

      case "summarize":
        // Context reduction is already happening automatically
        console.log("[Context Warning] User chose: Summarize (already happening)")
        break

      case "continue_anyway":
        // Just continue without taking action
        console.log("[Context Warning] User chose: Continue Anyway")
        break

      case "dismiss":
        // Add to dismissed sessions so we don't show again
        setDismissedSessions((prev) => new Set(prev).add(warning.sessionId))
        console.log("[Context Warning] User dismissed warning for session", warning.sessionId)
        break
    }

    // Close the dialog
    setIsOpen(false)
    setWarning(null)
  }

  if (!warning) return null

  const usagePercent = warning.contextUsagePercent.toFixed(1)
  const tokensFormatted = warning.estTokens.toLocaleString()
  const maxTokensFormatted = warning.maxTokens.toLocaleString()

  return (
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open) {
        setIsOpen(false)
        setWarning(null)
      }
    }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-500">
            <AlertTriangleIcon className="h-5 w-5" />
            Context Limit Approaching ({usagePercent}%)
          </DialogTitle>
          <DialogDescription>
            <div className="mt-2 mb-4">
              <div className="text-sm text-muted-foreground mb-3">
                Current: {tokensFormatted} / {maxTokensFormatted} tokens
              </div>

              {/* Progress bar */}
              <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
                <div
                  className="h-full transition-all bg-gradient-to-r from-amber-500 to-red-500"
                  style={{ width: `${Math.min(warning.contextUsagePercent, 100)}%` }}
                />
              </div>
            </div>

            <p className="text-sm mb-4">
              Your conversation is nearing the context limit. Choose how to proceed:
            </p>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {/* Clear & Load Ledger (Future) */}
          <Button
            onClick={() => handleAction("clear_and_continue")}
            className="w-full justify-start h-auto py-3 px-4 flex-col items-start gap-1"
            variant="default"
            disabled={true} // Disabled until ledger system is implemented
          >
            <div className="flex items-center gap-2 w-full">
              <RefreshCwIcon className="h-4 w-4 shrink-0" />
              <span className="font-semibold">Clear & Load Ledger</span>
              <span className="ml-auto text-xs bg-blue-500/20 text-blue-500 px-2 py-0.5 rounded">
                Coming Soon
              </span>
            </div>
            <span className="text-xs text-muted-foreground font-normal">
              Start fresh with state preserved (lossless)
            </span>
          </Button>

          {/* Summarize Messages */}
          <Button
            onClick={() => handleAction("summarize")}
            className="w-full justify-start h-auto py-3 px-4 flex-col items-start gap-1"
            variant="secondary"
          >
            <div className="flex items-center gap-2">
              <PackageIcon className="h-4 w-4 shrink-0" />
              <span className="font-semibold">Summarize Messages</span>
            </div>
            <span className="text-xs text-muted-foreground font-normal">
              Compress old messages (may lose some details)
            </span>
          </Button>

          {/* Continue Anyway */}
          <Button
            onClick={() => handleAction("continue_anyway")}
            className="w-full justify-start h-auto py-3 px-4 flex-col items-start gap-1"
            variant="outline"
          >
            <div className="flex items-center gap-2">
              <ZapIcon className="h-4 w-4 shrink-0" />
              <span className="font-semibold">Continue Anyway</span>
            </div>
            <span className="text-xs text-muted-foreground font-normal">
              Risk hitting hard limit
            </span>
          </Button>
        </div>

        {/* Dismiss button */}
        <div className="mt-2 text-center">
          <Button
            onClick={() => handleAction("dismiss")}
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
          >
            Dismiss for this session
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default ContextLimitWarningDialog
