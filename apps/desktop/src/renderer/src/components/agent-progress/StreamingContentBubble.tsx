import React from "react"
import { Activity, Loader2 } from "lucide-react"
import { MarkdownRenderer } from "@renderer/components/markdown-renderer"

export interface StreamingContentBubbleProps {
  streamingContent: {
    text: string
    isStreaming: boolean
  }
}

// Streaming Content Bubble - shows real-time LLM response as it's being generated
export const StreamingContentBubble: React.FC<StreamingContentBubbleProps> = ({ streamingContent }) => {
  if (!streamingContent.text) return null

  return (
    <div className="rounded-lg border border-blue-300 dark:border-blue-700 bg-blue-50/50 dark:bg-blue-950/30 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-blue-100/50 dark:bg-blue-900/30 border-b border-blue-200 dark:border-blue-800">
        <Activity className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
        <span className="text-xs font-medium text-blue-800 dark:text-blue-200">
          {streamingContent.isStreaming ? "Generating response..." : "Response"}
        </span>
        {streamingContent.isStreaming && (
          <Loader2 className="h-3 w-3 text-blue-600 dark:text-blue-400 animate-spin ml-auto" />
        )}
      </div>

      {/* Content */}
      <div className="px-3 py-2">
        <div className="text-xs text-blue-900 dark:text-blue-100 whitespace-pre-wrap break-words">
          <MarkdownRenderer content={streamingContent.text} />
          {streamingContent.isStreaming && (
            <span className="inline-block w-1.5 h-3.5 bg-blue-600 dark:bg-blue-400 animate-pulse ml-0.5 align-text-bottom" />
          )}
        </div>
      </div>
    </div>
  )
}
