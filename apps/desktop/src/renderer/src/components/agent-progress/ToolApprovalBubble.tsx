import React, { useEffect, useRef, useState } from "react"
import { cn } from "@renderer/lib/utils"
import { ChevronRight, Shield, Check, XCircle, Loader2 } from "lucide-react"
import { Button } from "../ui/button"
import { formatArgumentsPreview } from "./utils"

export interface ToolApprovalBubbleProps {
  approval: {
    approvalId: string
    toolName: string
    arguments: any
  }
  onApprove: () => void
  onDeny: () => void
  isResponding: boolean
}

// Inline Tool Approval bubble - appears in the conversation flow
export const ToolApprovalBubble: React.FC<ToolApprovalBubbleProps> = ({ approval, onApprove, onDeny, isResponding }) => {
  const [showArgs, setShowArgs] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Keyboard shortcut handler for tool approval
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if already responding or if user is typing in an input
      if (isResponding) return
      const target = e.target as HTMLElement
      // Ignore when focus is on interactive elements to preserve standard keyboard navigation
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'BUTTON' ||
        target.tagName === 'A' ||
        target.isContentEditable
      ) {
        return
      }

      // Use e.code for more consistent Space detection across browsers/platforms
      // Space to approve (without modifiers)
      if (e.code === 'Space' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault()
        onApprove()
      }
      // Shift+Space to deny
      else if (e.code === 'Space' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault()
        onDeny()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isResponding, onApprove, onDeny])

  // Generate preview text for collapsed view hint
  const argsPreview = formatArgumentsPreview(approval.arguments)

  return (
    <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/30 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-100/50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800">
        <Shield className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
        <span className="text-xs font-medium text-amber-800 dark:text-amber-200">
          {isResponding ? "Processing..." : "Tool Approval Required"}
        </span>
        {isResponding && (
          <Loader2 className="h-3 w-3 text-amber-600 dark:text-amber-400 animate-spin ml-auto" />
        )}
      </div>

      {/* Content */}
      <div ref={containerRef} className={cn("px-3 py-2", isResponding && "opacity-60")}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-amber-700 dark:text-amber-300">Tool:</span>
          <code className="text-xs font-mono font-medium text-amber-900 dark:text-amber-100 bg-amber-100 dark:bg-amber-900/50 px-1.5 py-0.5 rounded">
            {approval.toolName}
          </code>
        </div>

        {/* Arguments preview - always visible */}
        {argsPreview && (
          <div className="mb-2 text-xs text-amber-700/80 dark:text-amber-300/80 font-mono truncate" title={argsPreview}>
            {argsPreview}
          </div>
        )}

        {/* Expandable arguments */}
        <div className="mb-3">
          <button
            onClick={() => setShowArgs(!showArgs)}
            className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200"
            disabled={isResponding}
          >
            <ChevronRight className={cn("h-3 w-3 transition-transform", showArgs && "rotate-90")} />
            {showArgs ? "Hide" : "View"} full arguments
          </button>
          {showArgs && (
            <pre className="mt-1.5 p-2 text-xs bg-amber-100/70 dark:bg-amber-900/40 rounded overflow-x-auto max-h-32 text-amber-900 dark:text-amber-100">
              {JSON.stringify(approval.arguments, null, 2)}
            </pre>
          )}
        </div>

        {/* Action buttons with hotkey hints */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-950/30"
            onClick={onDeny}
            disabled={isResponding}
            title="Press Shift+Space to deny"
          >
            <XCircle className="h-3 w-3 mr-1" />
            Deny
            <kbd className="ml-1.5 px-1 py-0.5 text-[9px] font-mono bg-red-100 dark:bg-red-900/50 rounded">Shift+Space</kbd>
          </Button>
          <Button
            size="sm"
            className={cn(
              "h-7 text-xs text-white",
              isResponding
                ? "bg-green-500 cursor-not-allowed"
                : "bg-green-600 hover:bg-green-700"
            )}
            onClick={onApprove}
            disabled={isResponding}
            title="Press Space to approve"
          >
            {isResponding ? (
              <>
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Check className="h-3 w-3 mr-1" />
                Approve
                <kbd className="ml-1.5 px-1 py-0.5 text-[9px] font-mono bg-green-700 rounded">Space</kbd>
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
