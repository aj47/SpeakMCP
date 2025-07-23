import React, { useState } from "react"
import { cn } from "~/lib/utils"
import { AgentProgressStep, AgentProgressUpdate } from "../../../shared/types"

interface AgentProgressProps {
  progress: AgentProgressUpdate | null
  className?: string
}

// Helper function to extract meaningful results from content
const extractKeyResults = (content: string): { summary: string; details: string[]; type: 'success' | 'info' | 'generic' } => {
  if (!content) return { summary: "", details: [], type: 'generic' }

  // First, try to extract terminal results
  const terminalResult = extractTerminalResult(content)
  if (terminalResult) {
    // If it's a number, provide context based on common commands
    if (/^\d+$/.test(terminalResult)) {
      // Try to infer context from the content
      const lowerContent = content.toLowerCase()
      if (lowerContent.includes('desktop') || lowerContent.includes('~/desktop')) {
        return {
          summary: `${terminalResult} files on desktop`,
          details: [],
          type: 'info'
        }
      } else if (lowerContent.includes('ls') && lowerContent.includes('wc -l')) {
        return {
          summary: `${terminalResult} items found`,
          details: [],
          type: 'info'
        }
      } else {
        return {
          summary: `Result: ${terminalResult}`,
          details: [],
          type: 'info'
        }
      }
    }
    return {
      summary: terminalResult,
      details: [],
      type: 'info'
    }
  }

  // Clean up the content
  const cleanContent = content.trim()

  // Look for common result patterns
  const lines = cleanContent.split('\n').filter(line => line.trim())

  // Detect content type and extract accordingly
  let summary = ""
  let type: 'success' | 'info' | 'generic' = 'generic'

  // Look for specific patterns that indicate successful actions
  const successPatterns = [
    /created?\s+(.+)/i,
    /saved?\s+(.+)/i,
    /updated?\s+(.+)/i,
    /generated?\s+(.+)/i,
    /installed?\s+(.+)/i,
    /deployed?\s+(.+)/i,
    /built?\s+(.+)/i,
    /compiled?\s+(.+)/i,
    /executed?\s+(.+)/i,
    /processed?\s+(.+)/i,
    /found\s+(\d+)\s+(.+)/i,
    /counted\s+(\d+)\s+(.+)/i,
  ]

  // Look for file/path patterns
  const filePatterns = [
    /file\s+['"`]?([^'"`\s]+)['"`]?/i,
    /path\s+['"`]?([^'"`\s]+)['"`]?/i,
    /directory\s+['"`]?([^'"`\s]+)['"`]?/i,
  ]

  // Look for quantity/count patterns
  const quantityPatterns = [
    /(\d+)\s+(files?|items?|records?|entries?)/i,
    /(added|removed|modified|updated)\s+(\d+)/i,
    /total:?\s*(\d+)/i,
    /count:?\s*(\d+)/i,
  ]

  // Try to find the most meaningful line
  for (const line of lines) {
    // Skip generic completion messages
    if (/^(task completed|successfully completed|done|finished|success)/i.test(line)) {
      continue
    }

    // Check for success patterns
    for (const pattern of successPatterns) {
      const match = line.match(pattern)
      if (match) {
        summary = line
        type = 'success'
        break
      }
    }

    if (summary) break

    // Check for file/path information
    for (const pattern of filePatterns) {
      const match = line.match(pattern)
      if (match) {
        summary = line
        type = 'info'
        break
      }
    }

    if (summary) break

    // Check for quantity information
    for (const pattern of quantityPatterns) {
      const match = line.match(pattern)
      if (match) {
        summary = line
        type = 'info'
        break
      }
    }

    if (summary) break

    // Fall back to first substantial line
    if (line.length > 20 && !summary) {
      summary = line
      type = 'info'
    }
  }

  // Clean up the summary
  if (summary) {
    // Remove common prefixes
    summary = summary.replace(/^(I have|I've|The task|This task|Here|Now)[:\s]*/i, "")
    summary = summary.replace(/^(Successfully|Completed)[:\s]*/i, "")
  }

  // If still no good summary, use first line
  if (!summary && lines.length > 0) {
    summary = lines[0]
  }

  // Extract additional details (skip the summary line)
  const summaryIndex = lines.findIndex(line => line.includes(summary.substring(0, 30)))
  const detailLines = summaryIndex >= 0 ? lines.slice(summaryIndex + 1) : lines.slice(1)

  const details = detailLines
    .filter(line =>
      line.length > 10 &&
      !line.toLowerCase().includes('note:') &&
      !line.toLowerCase().includes('iteration limit') &&
      !line.toLowerCase().includes('maximum iteration')
    )
    .slice(0, 3) // Limit to 3 detail lines

  return {
    summary: summary.substring(0, 200),
    details,
    type
  }
}

// Helper function to get the most relevant tool result
const getMostRelevantResult = (steps: AgentProgressStep[]): string | null => {
  // Look for successful tool results with meaningful content
  const successfulResults = steps
    .filter(step => step.toolResult?.success && step.toolResult.content)
    .map(step => step.toolResult!.content)
    .filter(content => content.length > 10) // Reduced threshold for short but meaningful results

  // Return the last (most recent) meaningful result
  return successfulResults.length > 0 ? successfulResults[successfulResults.length - 1] : null
}

// Helper function to extract terminal command results
const extractTerminalResult = (content: string): string | null => {
  if (!content) return null

  // Look for terminal output patterns
  const terminalOutputMatch = content.match(/Terminal Output:\s*```\s*([\s\S]*?)\s*```/i)
  if (terminalOutputMatch) {
    const output = terminalOutputMatch[1].trim()

    // Extract the actual command result (usually the last line with meaningful content)
    const lines = output.split('\n').map(line => line.trim()).filter(line => line)

    // Look for numeric results (common for counts, sizes, etc.)
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]
      // Skip shell prompts and common shell messages
      if (line.includes('$') || line.includes('bash-') || line.includes('zsh') ||
          line.includes('interactive shell') || line.includes('chsh') ||
          line.includes('support.apple.com')) {
        continue
      }

      // If it's a simple number, that's likely our result
      if (/^\d+$/.test(line)) {
        return line
      }

      // If it's a short meaningful line, use it
      if (line.length > 0 && line.length < 100) {
        return line
      }
    }
  }

  return null
}

// Component for displaying task results prominently
const ResultDisplay: React.FC<{
  progress: AgentProgressUpdate
  isExpanded: boolean
  onToggleExpanded: () => void
}> = ({ progress, isExpanded, onToggleExpanded }) => {
  const { finalContent, steps, isComplete } = progress

  if (!isComplete) return null

  // Extract meaningful results - prioritize tool results over final content
  const toolResult = getMostRelevantResult(steps)
  const keyResults = extractKeyResults(finalContent || "")

  // Determine what to show as the main result - prefer tool results
  let mainResult = ""
  let resultType: 'success' | 'info' | 'generic' = 'generic'
  let resultDetails: string[] = []

  // First try tool results (more likely to contain actual data)
  if (toolResult) {
    const toolResults = extractKeyResults(toolResult)
    if (toolResults.summary && toolResults.summary.length > 0) {
      mainResult = toolResults.summary
      resultType = toolResults.type
      resultDetails = toolResults.details
    }
  }

  // Fall back to final content only if tool results are empty or generic
  if (!mainResult || (mainResult.length < 10 && keyResults.summary.length > mainResult.length)) {
    // Skip obviously unhelpful final content
    const unhelpfulPhrases = [
      'closing the terminal session',
      'session closed',
      'cleanup complete',
      'done',
      'finished',
      'completed'
    ]

    const isUnhelpful = unhelpfulPhrases.some(phrase =>
      keyResults.summary.toLowerCase().includes(phrase)
    )

    if (!isUnhelpful && keyResults.summary) {
      mainResult = keyResults.summary
      resultType = keyResults.type
      resultDetails = keyResults.details
    }
  }

  // If still no meaningful result, try to extract from step titles/descriptions
  if (!mainResult || mainResult.length < 5) {
    // Look for steps that might contain the answer
    const meaningfulSteps = steps.filter(step =>
      step.toolResult?.content &&
      step.toolResult.content.length > 5 &&
      !step.toolResult.error
    )

    for (const step of meaningfulSteps.reverse()) { // Start with most recent
      const stepResult = extractKeyResults(step.toolResult!.content)
      if (stepResult.summary && stepResult.summary.length > mainResult.length) {
        mainResult = stepResult.summary
        resultType = stepResult.type
        resultDetails = stepResult.details
        break
      }
    }
  }

  // Check if there are errors
  const hasErrors = steps.some(step => step.status === "error" || step.toolResult?.error)
  const errorStep = steps.find(step => step.status === "error" || step.toolResult?.error)

  if (hasErrors && errorStep) {
    return (
      <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-700">
        <div className="flex items-start gap-2">
          <div className="text-red-500 text-sm">❌</div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-red-800 dark:text-red-300">
              Task encountered an error
            </div>
            <div className="text-xs text-red-700 dark:text-red-400 mt-1">
              {errorStep.toolResult?.error || errorStep.description || "An error occurred during execution"}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Get appropriate styling based on result type
  const getResultStyling = () => {
    if (hasErrors) {
      return {
        bgColor: "bg-red-50 dark:bg-red-900/20",
        borderColor: "border-red-200 dark:border-red-700",
        iconColor: "text-red-500",
        titleColor: "text-red-800 dark:text-red-300",
        detailColor: "text-red-700 dark:text-red-400",
        icon: "❌"
      }
    }

    switch (resultType) {
      case 'success':
        return {
          bgColor: "bg-green-50 dark:bg-green-900/20",
          borderColor: "border-green-200 dark:border-green-700",
          iconColor: "text-green-500",
          titleColor: "text-green-800 dark:text-green-300",
          detailColor: "text-green-700 dark:text-green-400",
          icon: "✅"
        }
      case 'info':
        return {
          bgColor: "bg-blue-50 dark:bg-blue-900/20",
          borderColor: "border-blue-200 dark:border-blue-700",
          iconColor: "text-blue-500",
          titleColor: "text-blue-800 dark:text-blue-300",
          detailColor: "text-blue-700 dark:text-blue-400",
          icon: "ℹ️"
        }
      default:
        return {
          bgColor: "bg-green-50 dark:bg-green-900/20",
          borderColor: "border-green-200 dark:border-green-700",
          iconColor: "text-green-500",
          titleColor: "text-green-800 dark:text-green-300",
          detailColor: "text-green-700 dark:text-green-400",
          icon: "✅"
        }
    }
  }

  const styling = getResultStyling()

  // Determine what to display
  const displayTitle = hasErrors && errorStep
    ? "Task encountered an error"
    : mainResult || "Task completed successfully"

  const displayDetails = hasErrors && errorStep
    ? [errorStep.toolResult?.error || errorStep.description || "An error occurred during execution"]
    : resultDetails.length > 0 ? resultDetails : []

  return (
    <div className={`p-3 ${styling.bgColor} rounded-lg border ${styling.borderColor}`}>
      <div className="flex items-start gap-2">
        <div className={`${styling.iconColor} text-sm`}>{styling.icon}</div>
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-medium ${styling.titleColor}`}>
            {displayTitle}
          </div>
          {displayDetails.length > 0 && (
            <div className="mt-2 space-y-1">
              {displayDetails.map((detail, index) => (
                <div key={index} className={`text-xs ${styling.detailColor}`}>
                  • {detail}
                </div>
              ))}
            </div>
          )}
          {(finalContent && finalContent.length > 200) && (
            <button
              onClick={onToggleExpanded}
              className={`text-xs ${styling.detailColor} hover:opacity-80 mt-2 underline`}
            >
              {isExpanded ? "Show less" : "Show full details"}
            </button>
          )}
          {isExpanded && finalContent && (
            <div className={`mt-2 p-2 ${styling.bgColor} rounded text-xs ${styling.titleColor} max-h-32 overflow-y-auto border ${styling.borderColor}`}>
              <pre className="whitespace-pre-wrap font-sans">{finalContent}</pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const StepIcon: React.FC<{ step: AgentProgressStep }> = ({ step }) => {
  const getIcon = () => {
    switch (step.type) {
      case "thinking":
        return "🧠"
      case "tool_call":
        return "🔧"
      case "tool_result":
        return step.status === "error" ? "❌" : "✅"
      case "completion":
        return step.status === "error" ? "⚠️" : "🎉"
      default:
        return "⚡"
    }
  }

  const getStatusColor = () => {
    switch (step.status) {
      case "pending":
        return "text-muted-foreground liquid-glass-subtle"
      case "in_progress":
        return "text-blue-500 liquid-glass glass-border animate-pulse"
      case "completed":
        return "text-green-500 liquid-glass glass-border"
      case "error":
        return "text-red-500 liquid-glass glass-border"
      default:
        return "text-muted-foreground liquid-glass-subtle"
    }
  }

  return (
    <div className={cn(
      "w-6 h-6 rounded-full flex items-center justify-center text-sm transition-all duration-200",
      getStatusColor()
    )}>
      {getIcon()}
    </div>
  )
}

const ProgressStep: React.FC<{ step: AgentProgressStep; isLast: boolean }> = ({ step }) => {
  const getStatusColor = () => {
    switch (step.status) {
      case "pending":
        return "liquid-glass-subtle glass-border"
      case "in_progress":
        return "liquid-glass glass-border glass-shadow animate-pulse"
      case "completed":
        return "liquid-glass glass-border glass-shadow"
      case "error":
        return "liquid-glass glass-border border-red-300/50 bg-red-500/10"
      default:
        return "liquid-glass-subtle glass-border"
    }
  }

  // For completed tasks, show less detail in steps to avoid clutter
  const isMinimal = step.status === "completed" && step.type !== "completion"

  return (
    <div className="flex items-start gap-2 min-w-0">
      <div className="flex-shrink-0 mt-0.5">
        <StepIcon step={step} />
      </div>
      <div className={cn(
        "flex-1 min-w-0 p-2 rounded-lg border text-xs transition-all duration-200",
        getStatusColor()
      )}>
        <div className="font-medium text-foreground truncate">
          {step.title}
        </div>
        {!isMinimal && step.description && (
          <div className="text-muted-foreground mt-1 line-clamp-1 leading-relaxed">
            {step.description}
          </div>
        )}
        {!isMinimal && step.toolCall && (
          <div className="mt-1 flex items-center gap-1">
            <code className="text-foreground font-mono text-xs liquid-glass-subtle px-1 py-0.5 rounded truncate">
              {step.toolCall.name}
            </code>
          </div>
        )}
        {step.toolResult && step.toolResult.error && (
          <div className="mt-1 p-1.5 liquid-glass bg-red-500/20 border-red-300/50 rounded text-xs">
            <div className="text-red-400 font-medium">Error:</div>
            <div className="text-red-300 line-clamp-1 mt-0.5">
              {step.toolResult.error}
            </div>
          </div>
        )}
        {/* Only show successful tool results in details view, not in main flow */}
        {!isMinimal && step.toolResult && step.toolResult.content && !step.toolResult.error && (
          <div className="mt-1 text-muted-foreground line-clamp-1">
            ✓ {step.toolResult.content.substring(0, 50)}...
          </div>
        )}
      </div>
    </div>
  )
}

export const AgentProgress: React.FC<AgentProgressProps> = ({ progress, className }) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const [showDetails, setShowDetails] = useState(false)

  if (!progress) {
    return null
  }

  const { currentIteration, maxIterations, steps, isComplete } = progress

  // Get the latest step (most recent activity)
  const latestStep = steps[steps.length - 1]
  const hasMultipleSteps = steps.length > 1
  const hasErrors = steps.some(step => step.status === "error" || step.toolResult?.error)

  return (
    <div className={cn(
      "flex flex-col gap-3 p-4 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md rounded-xl border border-gray-200/50 dark:border-gray-700/50 shadow-xl",
      // Adaptive sizing based on content
      "w-full max-w-sm",
      isComplete ? "min-h-[160px]" : "min-h-[140px]",
      className
    )}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn(
            "w-2.5 h-2.5 rounded-full",
            isComplete
              ? hasErrors ? "bg-red-500" : "bg-green-500"
              : "bg-blue-500 animate-pulse"
          )} />
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {isComplete
              ? hasErrors ? "Task Failed" : "Task Complete"
              : "Agent Working"
            }
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">
            {isComplete ? "✓ Done" : `${currentIteration}/${maxIterations}`}
          </div>
          {/* Details toggle button */}
          {(hasMultipleSteps || isComplete) && (
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
              title={showDetails ? "Hide details" : "Show details"}
            >
              {showDetails ? "−" : "+"}
            </button>
          )}
        </div>
      </div>

      {/* Result Display - Show prominently when complete */}
      {isComplete && (
        <ResultDisplay
          progress={progress}
          isExpanded={isExpanded}
          onToggleExpanded={() => setIsExpanded(!isExpanded)}
        />
      )}

      {/* Current Activity - Show when not complete or when details are requested */}
      {(!isComplete || showDetails) && (
        <div className="flex flex-col gap-2 flex-1 min-h-0">
          {showDetails ? (
            // Show all steps with scrolling when details are expanded
            <div className="flex flex-col gap-2 max-h-32 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600">
              {steps.map((step, index) => (
                <ProgressStep
                  key={step.id}
                  step={step}
                  isLast={index === steps.length - 1}
                />
              ))}
            </div>
          ) : (
            // Show only the latest step when in progress
            <div className="flex flex-col gap-2">
              {latestStep && !isComplete && (
                <ProgressStep
                  step={latestStep}
                  isLast={true}
                />
              )}
              {/* Show step count if there are multiple steps */}
              {hasMultipleSteps && !isComplete && (
                <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
                  Step {steps.length} • Click + for details
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Progress Bar - Show only when not complete */}
      {!isComplete && (
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 mt-auto">
          <div
            className="h-1.5 rounded-full transition-all duration-500 ease-out bg-blue-500"
            style={{
              width: `${Math.min(100, (currentIteration / maxIterations) * 100)}%`
            }}
          />
        </div>
      )}
    </div>
  )
}
