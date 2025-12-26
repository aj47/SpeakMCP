import React, { useEffect, useState } from "react"
import { cn } from "@renderer/lib/utils"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Badge } from "../ui/badge"
import { Button } from "../ui/button"
import { getToolResultsSummary } from "@speakmcp/shared"
import { formatArgumentsPreview } from "./utils"

export interface ToolExecutionBubbleProps {
  execution: {
    timestamp: number
    calls: Array<{ name: string; arguments: any }>
    results: Array<{ success: boolean; content: string; error?: string }>
  }
  isExpanded: boolean
  onToggleExpand: () => void
}

// Unified Tool Execution bubble combining call + response
export const ToolExecutionBubble: React.FC<ToolExecutionBubbleProps> = ({ execution, isExpanded, onToggleExpand }) => {
  const [showInputs, setShowInputs] = useState(false)
  const [showOutputs, setShowOutputs] = useState(false)

  // Collapsed by default; expand to show details
  useEffect(() => {
    if (isExpanded) {
      setShowInputs(true)
      setShowOutputs(true)
    } else {
      setShowInputs(false)
      setShowOutputs(false)
    }
  }, [isExpanded, execution])

  const isPending = execution.results.length === 0
  const allSuccess = execution.results.length > 0 && execution.results.every((r) => r.success)
  const hasErrors = execution.results.length > 0 && execution.results.some((r) => !r.success)
  const headerTitle = execution.calls.map((c) => c.name).join(", ") || "Tool Execution"

  const copy = async (text: string) => {
    try {
      await navigator.clipboard?.writeText(text)
    } catch {}
  }

  const handleToggleExpand = () => onToggleExpand()
  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onToggleExpand()
  }

  // Handle hide/show buttons with event propagation stopped
  const handleToggleInputs = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowInputs((v) => !v)
  }

  const handleToggleOutputs = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowOutputs((v) => !v)
  }

  const handleCopy = (e: React.MouseEvent, text: string) => {
    e.stopPropagation()
    copy(text)
  }


  // Generate preview for collapsed state - prioritize showing results when available
  const collapsedInputPreview = (() => {
    if (isExpanded) return null
    // Create a summary of the first tool call's parameters
    const firstCall = execution.calls[0]
    if (!firstCall?.arguments) return null
    return formatArgumentsPreview(firstCall.arguments)
  })()

  // Generate result summary for collapsed state
  const collapsedResultSummary = (() => {
    if (isExpanded || isPending) return null
    if (execution.results.length === 0) return null
    // Convert to the expected ToolResult format
    const toolResults = execution.results.map(r => ({
      success: r.success,
      content: r.content,
      error: r.error,
    }))
    return getToolResultsSummary(toolResults)
  })()

  return (
    <div
      className={cn(
        "rounded-lg border p-2 text-xs",
        isPending
          ? "border-blue-200/50 bg-blue-50/30 text-blue-800 dark:border-blue-700/50 dark:bg-blue-950/40 dark:text-blue-200"
          : allSuccess
            ? "border-green-200/50 bg-green-50/30 text-green-800 dark:border-green-700/50 dark:bg-green-950/40 dark:text-green-200"
            : "border-red-200/50 bg-red-50/30 text-red-800 dark:border-red-700/50 dark:bg-red-950/40 dark:text-red-200",
      )}
    >
      <div
        className="mb-1 flex items-center justify-between px-1 py-1 cursor-pointer hover:bg-muted/20 rounded"
        onClick={handleToggleExpand}
        aria-expanded={isExpanded}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="font-mono font-semibold truncate">{headerTitle}</span>
          {!isExpanded && (
            <Badge variant="outline" className="text-[10px] flex-shrink-0">
              {isPending ? "Pending..." : allSuccess ? "✓" : "✗"}
            </Badge>
          )}
          {isExpanded && (
            <Badge variant="outline" className="text-[10px]">
              {isPending ? "Pending..." : allSuccess ? "Success" : "With errors"}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isExpanded && (
            <span className="opacity-60 text-[10px]">{new Date(execution.timestamp).toLocaleTimeString()}</span>
          )}
          <button
            onClick={handleChevronClick}
            className="p-1 rounded hover:bg-muted/30 transition-colors"
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        </div>
      </div>

      {/* Collapsed preview - show result summary when available, otherwise show input parameters */}
      {!isExpanded && (collapsedResultSummary || collapsedInputPreview) && (
        <div className="px-1 pb-1 text-[10px] opacity-80 truncate" title={collapsedResultSummary || collapsedInputPreview || ''}>
          {collapsedResultSummary ? (
            <span className="font-medium">{collapsedResultSummary}</span>
          ) : (
            <span className="font-mono opacity-70">{collapsedInputPreview}</span>
          )}
        </div>
      )}

      {isExpanded && (
        <>
          {/* Inputs */}
          <div className="rounded-md bg-blue-50/40 dark:bg-blue-900/10 border border-blue-200/40 dark:border-blue-800/40 p-2 mb-2">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold opacity-80">Call Parameters</div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" className="h-6 px-2" onClick={handleToggleInputs}>
                  {showInputs ? "Hide" : "Show"}
                </Button>
                <Button size="sm" variant="ghost" className="h-6 px-2" onClick={(e) => handleCopy(e, JSON.stringify(execution.calls, null, 2))}>
                  Copy
                </Button>
              </div>
            </div>
            {showInputs && (
              <div className="mt-1 space-y-2">
                {execution.calls.map((c, idx) => (
                  <div key={idx} className="rounded bg-muted/50 p-2 overflow-auto whitespace-pre-wrap max-h-80 scrollbar-thin">
                    <div className="mb-1 text-[11px] font-medium opacity-70">{c.name}</div>
                    <pre>{JSON.stringify(c.arguments ?? {}, null, 2)}</pre>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Outputs */}
          <div
            className="rounded-md border p-2"
            style={{
              borderColor: isPending ? "rgb(191 219 254 / 0.5)" : allSuccess ? "rgb(187 247 208 / 0.5)" : "rgb(254 202 202 / 0.5)",
              backgroundColor: isPending ? "rgb(239 246 255 / 0.3)" : allSuccess ? "rgb(240 253 244 / 0.3)" : "rgb(254 242 242 / 0.3)",
            } as React.CSSProperties}
          >
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold opacity-80">Response</div>
              {!isPending && (
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" className="h-6 px-2" onClick={handleToggleOutputs}>
                    {showOutputs ? "Hide" : "Show"}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 px-2" onClick={(e) => handleCopy(e, JSON.stringify(execution.results, null, 2))}>
                    Copy
                  </Button>
                </div>
              )}
            </div>
            {isPending ? (
              <div className="mt-2 text-center py-2 text-[11px] opacity-60 italic">
                Waiting for response...
              </div>
            ) : showOutputs && (
              <div className="mt-1 space-y-2">
                {execution.results.map((r, idx) => (
                  <div
                    key={idx}
                    className={cn(
                      "rounded border p-2 text-xs",
                      r.success
                        ? "border-green-200/50 bg-green-50/30 dark:border-green-700/50 dark:bg-green-950/30"
                        : "border-red-200/50 bg-red-50/30 dark:border-red-700/50 dark:bg-red-950/30",
                    )}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-semibold">{r.success ? "✅ Success" : "❌ Error"}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] opacity-60 font-mono">
                          {(r.content?.length || 0).toLocaleString()} chars
                        </span>
                        <Badge variant="outline" className="text-[10px]">{`Result ${idx + 1}`}</Badge>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div>
                        <div className="text-[11px] font-medium opacity-70 mb-1">Content:</div>
                        <pre className="rounded bg-muted/30 p-2 overflow-auto whitespace-pre-wrap break-all max-h-80 scrollbar-thin">
                          {r.content || "No content returned"}
                        </pre>
                      </div>
                      {r.error && (
                        <div>
                          <div className="text-[11px] font-medium text-destructive mb-1">Error Details:</div>
                          <pre className="rounded bg-destructive/10 p-2 overflow-auto whitespace-pre-wrap break-all max-h-60 scrollbar-thin">
                            {r.error}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}


    </div>
  )
}
