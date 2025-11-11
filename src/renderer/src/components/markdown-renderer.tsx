import React, { useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { ChevronDown, ChevronRight, Brain } from "lucide-react"
import { cn } from "@renderer/lib/utils"
import "highlight.js/styles/github.css"

import { logExpand } from "@renderer/lib/debug"

interface MarkdownRendererProps {
  content: string
  className?: string
  // Optional controls for <think> sections expansion persistence
  getThinkKey?: (content: string, index: number) => string
  isThinkExpanded?: (key: string) => boolean
  onToggleThink?: (key: string) => void
}

interface ThinkSectionProps {
  content: string
  defaultCollapsed?: boolean
  // Controlled mode (optional)
  isCollapsed?: boolean
  onToggle?: () => void
}

const ThinkSection: React.FC<ThinkSectionProps> = ({
  content,
  defaultCollapsed = true,
  isCollapsed,
  onToggle,
}) => {
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed)
  const collapsed = isCollapsed ?? internalCollapsed

  const handleToggle = () => {
    if (onToggle) {
      onToggle()
    } else {
      const prev = internalCollapsed
      setInternalCollapsed(!prev)
      // Only log in uncontrolled mode so we don't duplicate logs when parent controls the state
      logExpand("ThinkSection", "toggle", { fromCollapsed: prev, toCollapsed: !prev })
    }
  }

  return (
    <div className="my-4 overflow-hidden rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
      <button
        onClick={handleToggle}
        className="flex w-full items-center gap-2 p-3 text-left transition-colors hover:bg-amber-100 dark:hover:bg-amber-900/30"
        aria-expanded={!collapsed}
        aria-controls="think-content"
      >
        {collapsed ? (
          <ChevronRight className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        )}
        <Brain className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
          {collapsed ? "Show thinking process" : "Hide thinking process"}
        </span>
      </button>

      {!collapsed && (
        <div
          id="think-content"
          className="px-3 pb-3 text-sm text-amber-900 dark:text-amber-100"
        >
          <div className="prose prose-sm prose-amber dark:prose-invert max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={{}}
            >
              {content}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  )
}

const parseThinkSections = (content: string) => {
  const parts: Array<{ type: "text" | "think"; content: string }> = []
  let currentIndex = 0

  // Regex to match <think>...</think> tags (including multiline)
  const thinkRegex = /<think>([\s\S]*?)<\/think>/gi
  let match

  while ((match = thinkRegex.exec(content)) !== null) {
    // Add text before the think section
    if (match.index > currentIndex) {
      const textBefore = content.slice(currentIndex, match.index)
      if (textBefore.trim()) {
        parts.push({ type: "text", content: textBefore })
      }
    }

    // Add the think section content (without the tags)
    parts.push({ type: "think", content: match[1].trim() })
    currentIndex = match.index + match[0].length
  }

  // Add remaining text after the last think section
  if (currentIndex < content.length) {
    const remainingText = content.slice(currentIndex)
    if (remainingText.trim()) {
      parts.push({ type: "text", content: remainingText })
    }
  }

  // If no think sections found, return the original content as text
  if (parts.length === 0) {
    parts.push({ type: "text", content })
  }

  return parts
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  className,
  getThinkKey,
  isThinkExpanded,
  onToggleThink,
}) => {
  const parts = parseThinkSections(content)

  return (
    <div
      className={cn("prose prose-sm dark:prose-invert max-w-none", className)}
    >
      {parts.map((part, index) => {
        if (part.type === "think") {
          const keyBase = getThinkKey ? getThinkKey(part.content, index) : `think-${index}`
          const isControlled = !!(isThinkExpanded && onToggleThink)
          const expanded = isControlled ? !!isThinkExpanded!(keyBase) : undefined
          return (
            <ThinkSection
              key={keyBase}
              content={part.content}
              defaultCollapsed={true}
              {...(isControlled ? { isCollapsed: !expanded, onToggle: () => onToggleThink!(keyBase) } : {})}
            />
          )
        } else {
          return (
            <ReactMarkdown
              key={`text-${index}`}
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={{
                // Custom components for better styling
                h1: ({ children }) => (
                  <h1 className="mb-3 text-xl font-bold text-foreground">
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="mb-2 text-lg font-semibold text-foreground">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="mb-2 text-base font-medium text-foreground">
                    {children}
                  </h3>
                ),
                p: ({ children }) => (
                  <p className="mb-3 leading-relaxed text-foreground">
                    {children}
                  </p>
                ),
                ul: ({ children }) => (
                  <ul className="mb-3 list-inside list-disc space-y-1 text-foreground">
                    {children}
                  </ul>
                ),
                ol: ({ children }) => (
                  <ol className="mb-3 list-inside list-decimal space-y-1 text-foreground">
                    {children}
                  </ol>
                ),
                li: ({ children }) => (
                  <li className="text-foreground">{children}</li>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="mb-3 border-l-4 border-muted-foreground pl-4 italic text-muted-foreground">
                    {children}
                  </blockquote>
                ),
                code: ({ children, ...props }: any) => {
                  const inline = !props.className;
                  if (inline) {
                    return (
                      <code
                        className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm text-foreground"
                        {...props}
                      >
                        {children}
                      </code>
                    )
                  }
                  return (
                    <code
                      className="block overflow-x-auto rounded-lg bg-muted p-3 font-mono text-sm text-foreground"
                      {...props}
                    >
                      {children}
                    </code>
                  )
                },
                pre: ({ children }) => (
                  <pre className="mb-3 overflow-x-auto rounded-lg bg-muted p-3">
                    {children}
                  </pre>
                ),
                a: ({ children, href }) => (
                  <a
                    href={href}
                    className="text-primary underline hover:text-primary/80"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {children}
                  </a>
                ),
                table: ({ children }) => (
                  <div className="mb-3 overflow-x-auto">
                    <table className="min-w-full border-collapse border border-border">
                      {children}
                    </table>
                  </div>
                ),
                th: ({ children }) => (
                  <th className="border border-border bg-muted px-3 py-2 text-left font-semibold">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="border border-border px-3 py-2">{children}</td>
                ),

              }}
            >
              {part.content}
            </ReactMarkdown>
          )
        }
      })}
    </div>
  )
}
