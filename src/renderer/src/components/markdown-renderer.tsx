import React, { useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { ChevronDown, ChevronRight, Brain } from "lucide-react"
import { cn } from "@renderer/lib/utils"
import "highlight.js/styles/github.css"

interface MarkdownRendererProps {
  content: string
  className?: string
}

interface ThinkSectionProps {
  content: string
  defaultCollapsed?: boolean
}

const ThinkSection: React.FC<ThinkSectionProps> = ({ 
  content, 
  defaultCollapsed = true 
}) => {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed)

  return (
    <div className="my-4 border border-amber-200 dark:border-amber-800 rounded-lg overflow-hidden bg-amber-50 dark:bg-amber-950/30">
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full flex items-center gap-2 p-3 text-left hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
        aria-expanded={!isCollapsed}
        aria-controls="think-content"
      >
        {isCollapsed ? (
          <ChevronRight className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        )}
        <Brain className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
          {isCollapsed ? "Show thinking process" : "Hide thinking process"}
        </span>
      </button>
      
      {!isCollapsed && (
        <div 
          id="think-content"
          className="px-3 pb-3 text-sm text-amber-900 dark:text-amber-100"
        >
          <div className="prose prose-sm prose-amber dark:prose-invert max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={{
                // Prevent nested think sections
                think: ({ children }) => <span>{children}</span>
              }}
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
  const parts: Array<{ type: 'text' | 'think'; content: string }> = []
  let currentIndex = 0
  
  // Regex to match <think>...</think> tags (including multiline)
  const thinkRegex = /<think>([\s\S]*?)<\/think>/gi
  let match
  
  while ((match = thinkRegex.exec(content)) !== null) {
    // Add text before the think section
    if (match.index > currentIndex) {
      const textBefore = content.slice(currentIndex, match.index)
      if (textBefore.trim()) {
        parts.push({ type: 'text', content: textBefore })
      }
    }
    
    // Add the think section content (without the tags)
    parts.push({ type: 'think', content: match[1].trim() })
    currentIndex = match.index + match[0].length
  }
  
  // Add remaining text after the last think section
  if (currentIndex < content.length) {
    const remainingText = content.slice(currentIndex)
    if (remainingText.trim()) {
      parts.push({ type: 'text', content: remainingText })
    }
  }
  
  // If no think sections found, return the original content as text
  if (parts.length === 0) {
    parts.push({ type: 'text', content })
  }
  
  return parts
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ 
  content, 
  className 
}) => {
  const parts = parseThinkSections(content)
  
  return (
    <div className={cn("prose prose-sm dark:prose-invert max-w-none", className)}>
      {parts.map((part, index) => {
        if (part.type === 'think') {
          return (
            <ThinkSection 
              key={`think-${index}`}
              content={part.content}
              defaultCollapsed={true}
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
                  <h1 className="text-xl font-bold mb-3 text-foreground">{children}</h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-lg font-semibold mb-2 text-foreground">{children}</h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-base font-medium mb-2 text-foreground">{children}</h3>
                ),
                p: ({ children }) => (
                  <p className="mb-3 text-foreground leading-relaxed">{children}</p>
                ),
                ul: ({ children }) => (
                  <ul className="list-disc list-inside mb-3 space-y-1 text-foreground">{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol className="list-decimal list-inside mb-3 space-y-1 text-foreground">{children}</ol>
                ),
                li: ({ children }) => (
                  <li className="text-foreground">{children}</li>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="border-l-4 border-muted-foreground pl-4 italic text-muted-foreground mb-3">
                    {children}
                  </blockquote>
                ),
                code: ({ inline, children, ...props }) => {
                  if (inline) {
                    return (
                      <code 
                        className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono text-foreground"
                        {...props}
                      >
                        {children}
                      </code>
                    )
                  }
                  return (
                    <code 
                      className="block bg-muted p-3 rounded-lg text-sm font-mono overflow-x-auto text-foreground"
                      {...props}
                    >
                      {children}
                    </code>
                  )
                },
                pre: ({ children }) => (
                  <pre className="bg-muted p-3 rounded-lg overflow-x-auto mb-3">
                    {children}
                  </pre>
                ),
                a: ({ children, href }) => (
                  <a 
                    href={href}
                    className="text-primary hover:text-primary/80 underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {children}
                  </a>
                ),
                table: ({ children }) => (
                  <div className="overflow-x-auto mb-3">
                    <table className="min-w-full border-collapse border border-border">
                      {children}
                    </table>
                  </div>
                ),
                th: ({ children }) => (
                  <th className="border border-border px-3 py-2 bg-muted font-semibold text-left">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="border border-border px-3 py-2">
                    {children}
                  </td>
                ),
                // Prevent processing think tags as regular elements
                think: ({ children }) => <span>{children}</span>
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
