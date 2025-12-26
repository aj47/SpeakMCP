import React, { useState } from "react"
import { cn } from "@renderer/lib/utils"
import { ChevronDown, ChevronRight } from "lucide-react"
import { MarkdownRenderer } from "@renderer/components/markdown-renderer"
import { Badge } from "../ui/badge"
import { getToolResultsSummary } from "@speakmcp/shared"

export interface AssistantWithToolsBubbleProps {
  data: {
    thought: string
    timestamp: number
    isComplete: boolean
    calls: Array<{ name: string; arguments: any }>
    results: Array<{ success: boolean; content: string; error?: string }>
  }
  isExpanded: boolean
  onToggleExpand: () => void
}

export const AssistantWithToolsBubble: React.FC<AssistantWithToolsBubbleProps> = ({ data, isExpanded, onToggleExpand }) => {
  const [showToolDetails, setShowToolDetails] = useState(false)

  const isPending = data.results.length === 0
  const allSuccess = data.results.length > 0 && data.results.every(r => r.success)
  const hasThought = data.thought && data.thought.trim().length > 0
  const shouldCollapse = (data.thought?.length ?? 0) > 100 || data.calls.length > 0

  // Generate result summary for collapsed state
  const collapsedResultSummary = (() => {
    if (isExpanded || isPending) return null
    if (data.results.length === 0) return null
    const toolResults = data.results.map(r => ({
      success: r.success,
      content: r.content,
      error: r.error,
    }))
    return getToolResultsSummary(toolResults)
  })()

  const handleToggleExpand = () => {
    if (shouldCollapse) {
      onToggleExpand()
    }
  }

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    onToggleExpand()
  }

  const handleToggleToolDetails = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowToolDetails(!showToolDetails)
  }

  // Tool names for display
  const toolNames = data.calls.map(c => c.name).join(', ')
  const toolCount = data.calls.length

  return (
    <div className={cn(
      "rounded text-xs transition-all duration-200",
      "border-l-2 border-gray-400 bg-gray-400/5",
      !isExpanded && shouldCollapse && "hover:bg-muted/20",
      shouldCollapse && "cursor-pointer"
    )}>
      {/* Thought content section */}
      <div
        className="flex items-start gap-2 px-2 py-1 text-left"
        onClick={handleToggleExpand}
      >
        <span className="opacity-60 mt-0.5 flex-shrink-0">🤖</span>
        <div className="flex-1 min-w-0">
          {hasThought && (
            <div className={cn(
              "leading-relaxed text-left",
              !isExpanded && shouldCollapse && "line-clamp-2"
            )}>
              <MarkdownRenderer content={data.thought.trim()} />
            </div>
          )}

          {/* Tool execution section - always visible but collapsible */}
          <div className={cn(
            "mt-2 rounded-lg border p-2",
            isPending
              ? "border-blue-200/50 bg-blue-50/30 text-blue-800 dark:border-blue-700/50 dark:bg-blue-950/40 dark:text-blue-200"
              : allSuccess
                ? "border-green-200/50 bg-green-50/30 text-green-800 dark:border-green-700/50 dark:bg-green-950/40 dark:text-green-200"
                : "border-red-200/50 bg-red-50/30 text-red-800 dark:border-red-700/50 dark:bg-red-950/40 dark:text-red-200",
          )}>
            <div
              className="flex items-center justify-between cursor-pointer"
              onClick={handleToggleToolDetails}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="opacity-60">🔧</span>
                <span className="font-mono font-semibold truncate">
                  {toolCount === 1 ? data.calls[0].name : `${toolCount} tool calls`}
                </span>
                <Badge variant="outline" className="text-[10px] flex-shrink-0">
                  {isPending ? "Running..." : allSuccess ? "✓" : "✗"}
                </Badge>
              </div>
              <button
                onClick={handleChevronClick}
                className="p-1 rounded hover:bg-muted/30 transition-colors flex-shrink-0"
                aria-label={showToolDetails ? "Collapse" : "Expand"}
              >
                {showToolDetails ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </button>
            </div>

            {/* Collapsed preview - show result summary */}
            {!showToolDetails && collapsedResultSummary && (
              <div className="mt-1 text-[10px] opacity-80 truncate">
                <span className="font-medium">{collapsedResultSummary}</span>
              </div>
            )}

            {/* Expanded tool details */}
            {showToolDetails && (
              <div className="mt-2 space-y-2">
                {/* Tool calls */}
                {data.calls.map((call, idx) => (
                  <div key={idx} className="rounded bg-muted/30 p-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono font-semibold text-primary">{call.name}</span>
                      <Badge variant="outline" className="text-[10px]">Call {idx + 1}</Badge>
                    </div>
                    {call.arguments && (
                      <pre className="rounded bg-muted/50 p-2 overflow-auto text-xs whitespace-pre-wrap max-h-40 scrollbar-thin">
                        {JSON.stringify(call.arguments, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}

                {/* Tool results */}
                {data.results.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold opacity-70">Results:</div>
                    {data.results.map((result, idx) => (
                      <div
                        key={idx}
                        className={cn(
                          "rounded border p-2",
                          result.success
                            ? "border-green-200/50 bg-green-50/20 dark:border-green-700/50 dark:bg-green-950/20"
                            : "border-red-200/50 bg-red-50/20 dark:border-red-700/50 dark:bg-red-950/20",
                        )}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold">{result.success ? "✅ Success" : "❌ Error"}</span>
                          <span className="text-[10px] opacity-60 font-mono">
                            {(result.content?.length || 0).toLocaleString()} chars
                          </span>
                        </div>
                        <pre className="rounded bg-muted/30 p-2 overflow-auto whitespace-pre-wrap break-all max-h-40 scrollbar-thin">
                          {result.content || "No content returned"}
                        </pre>
                        {result.error && (
                          <div className="mt-2">
                            <div className="text-[11px] font-medium text-destructive mb-1">Error:</div>
                            <pre className="rounded bg-destructive/10 p-2 overflow-auto whitespace-pre-wrap break-all max-h-40 scrollbar-thin">
                              {result.error}
                            </pre>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
