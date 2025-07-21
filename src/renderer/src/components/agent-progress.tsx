import React, { useState } from "react"
import { cn } from "~/lib/utils"
import { AgentProgressStep, AgentProgressUpdate } from "../../../shared/types"

interface AgentProgressProps {
  progress: AgentProgressUpdate | null
  className?: string
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
        return "text-gray-400 bg-gray-100 dark:bg-gray-800"
      case "in_progress":
        return "text-blue-500 bg-blue-100 dark:bg-blue-900/30 animate-pulse"
      case "completed":
        return "text-green-500 bg-green-100 dark:bg-green-900/30"
      case "error":
        return "text-red-500 bg-red-100 dark:bg-red-900/30"
      default:
        return "text-gray-400 bg-gray-100 dark:bg-gray-800"
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

const ProgressStep: React.FC<{ step: AgentProgressStep; isLast: boolean }> = ({ step, isLast }) => {
  const getStatusColor = () => {
    switch (step.status) {
      case "pending":
        return "border-gray-200 bg-gray-50/50 dark:border-gray-600 dark:bg-gray-800/50"
      case "in_progress":
        return "border-blue-300 bg-blue-50/70 dark:border-blue-400 dark:bg-blue-900/30 shadow-sm"
      case "completed":
        return "border-green-300 bg-green-50/70 dark:border-green-400 dark:bg-green-900/30"
      case "error":
        return "border-red-300 bg-red-50/70 dark:border-red-400 dark:bg-red-900/30"
      default:
        return "border-gray-200 bg-gray-50/50 dark:border-gray-600 dark:bg-gray-800/50"
    }
  }

  return (
    <div className="flex items-start gap-3 min-w-0">
      <div className="flex-shrink-0 mt-0.5">
        <StepIcon step={step} />
      </div>
      <div className={cn(
        "flex-1 min-w-0 p-2.5 rounded-lg border text-xs transition-all duration-200",
        getStatusColor()
      )}>
        <div className="font-semibold text-gray-900 dark:text-gray-100 truncate">
          {step.title}
        </div>
        {step.description && (
          <div className="text-gray-600 dark:text-gray-400 mt-1.5 line-clamp-2 leading-relaxed">
            {step.description}
          </div>
        )}
        {step.toolCall && (
          <div className="mt-2 flex items-center gap-1">
            <span className="text-gray-500 dark:text-gray-500 text-xs">Tool:</span>
            <code className="text-gray-700 dark:text-gray-300 font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded truncate">
              {step.toolCall.name}
            </code>
          </div>
        )}
        {step.toolResult && step.toolResult.content && (
          <div className="mt-2 p-2 bg-gray-100 dark:bg-gray-800 rounded text-xs">
            <div className="text-gray-500 dark:text-gray-400 mb-1">Result:</div>
            <div className="text-gray-700 dark:text-gray-300 line-clamp-2">
              {step.toolResult.content}
            </div>
          </div>
        )}
        {step.toolResult && step.toolResult.error && (
          <div className="mt-2 p-2 bg-red-100 dark:bg-red-900/20 rounded text-xs">
            <div className="text-red-600 dark:text-red-400 font-medium">Error:</div>
            <div className="text-red-700 dark:text-red-300 line-clamp-2 mt-1">
              {step.toolResult.error}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export const AgentProgress: React.FC<AgentProgressProps> = ({ progress, className }) => {
  const [isExpanded, setIsExpanded] = useState(false)

  if (!progress) {
    return null
  }

  const { currentIteration, maxIterations, steps, isComplete } = progress

  // Get the latest step (most recent activity)
  const latestStep = steps[steps.length - 1]
  const hasMultipleSteps = steps.length > 1

  return (
    <div className={cn(
      "flex flex-col gap-3 p-4 bg-white/95 dark:bg-gray-900/95 backdrop-blur-md rounded-xl border border-gray-200/50 dark:border-gray-700/50 shadow-xl",
      // Fixed dimensions to ensure consistent size
      "w-full max-w-sm min-h-[140px]",
      className
    )}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={cn(
            "w-2.5 h-2.5 rounded-full",
            isComplete ? "bg-green-500" : "bg-blue-500 animate-pulse"
          )} />
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {isComplete ? "Agent Complete" : "Agent Working"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">
            {isComplete ? "✓ Done" : `${currentIteration}/${maxIterations}`}
          </div>
          {/* Expand/Collapse button - only show if there are multiple steps */}
          {hasMultipleSteps && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
              title={isExpanded ? "Show latest only" : "Show all steps"}
            >
              {isExpanded ? "−" : "+"}
            </button>
          )}
        </div>
      </div>

      {/* Progress Steps - Show latest only or all based on expanded state */}
      <div className="flex flex-col gap-2 flex-1 min-h-0">
        {isExpanded ? (
          // Show all steps with scrolling
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
          // Show only the latest step
          <div className="flex flex-col gap-2">
            {latestStep && (
              <ProgressStep
                step={latestStep}
                isLast={true}
              />
            )}
            {/* Show step count if there are multiple steps */}
            {hasMultipleSteps && (
              <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
                Step {steps.length} of {steps.length} • Click + to see all
              </div>
            )}
          </div>
        )}
      </div>

      {/* Progress Bar - Always at bottom */}
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 mt-auto">
        <div
          className={cn(
            "h-1.5 rounded-full transition-all duration-500 ease-out",
            isComplete ? "bg-green-500" : "bg-blue-500"
          )}
          style={{
            width: `${Math.min(100, (currentIteration / maxIterations) * 100)}%`
          }}
        />
      </div>

      {/* Final content display for completed tasks - only show when expanded or if it's the only content */}
      {isComplete && progress.finalContent && (isExpanded || !hasMultipleSteps) && (
        <div className="p-2 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-700">
          <div className="text-xs text-green-800 dark:text-green-300 font-medium">
            Result:
          </div>
          <div className="text-xs text-green-700 dark:text-green-400 mt-1 line-clamp-2">
            {progress.finalContent}
          </div>
        </div>
      )}
    </div>
  )
}
