import React, { useState } from "react"
import { cn } from "@renderer/lib/utils"
import { AgentStepSummary, AgentProgressUpdate } from "../../../shared/types"
import {
  ChevronDown,
  ChevronRight,
  Save,
  CheckCircle,
  AlertTriangle,
  Info,
  XCircle,
  Clock,
  Tag,
  FileText,
  Brain,
  Loader2,
} from "lucide-react"
import { Button } from "./ui/button"
import { Badge } from "./ui/badge"
import { tipcClient } from "@renderer/lib/tipc-client"

interface AgentSummaryViewProps {
  progress: AgentProgressUpdate | null
  className?: string
  conversationTitle?: string
  conversationId?: string
}

// Importance badge component
function ImportanceBadge({ importance }: { importance: AgentStepSummary["importance"] }) {
  const variants = {
    low: { className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300", icon: Info },
    medium: { className: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300", icon: Info },
    high: { className: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300", icon: AlertTriangle },
    critical: { className: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300", icon: XCircle },
  }
  
  const { className, icon: Icon } = variants[importance]
  
  return (
    <Badge className={cn("flex items-center gap-1 text-xs font-medium", className)}>
      <Icon className="h-3 w-3" />
      {importance}
    </Badge>
  )
}

// Individual summary card component
function SummaryCard({
  summary,
  conversationTitle,
  conversationId,
  onSaved,
}: {
  summary: AgentStepSummary
  conversationTitle?: string
  conversationId?: string
  onSaved?: (summary: AgentStepSummary) => void
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isSaved, setIsSaved] = useState(summary.savedToMemory ?? false)
  
  const handleSaveToMemory = async () => {
    if (isSaving || isSaved) return
    
    setIsSaving(true)
    try {
      const result = await tipcClient.saveMemoryFromSummary({
        summary,
        conversationTitle,
        conversationId,
      })
      
      if (result.success) {
        setIsSaved(true)
        onSaved?.(summary)
      }
    } catch (error) {
      console.error("Failed to save memory:", error)
    } finally {
      setIsSaving(false)
    }
  }
  
  const formattedTime = new Date(summary.timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })
  
  return (
    <div
      className={cn(
        "rounded-lg border transition-all duration-200",
        "bg-card hover:bg-accent/5",
        summary.importance === "critical" && "border-red-500/50",
        summary.importance === "high" && "border-orange-500/50",
      )}
    >
      {/* Header */}
      <div
        className="flex items-start gap-3 p-3 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <button className="mt-1 text-muted-foreground hover:text-foreground">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formattedTime}
            </span>
            <span className="text-xs text-muted-foreground">
              Step {summary.stepNumber}
            </span>
            <ImportanceBadge importance={summary.importance} />
          </div>
          
          <p className="text-sm font-medium line-clamp-2">{summary.actionSummary}</p>
          
          {!isExpanded && summary.keyFindings.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              {summary.keyFindings.length} key finding{summary.keyFindings.length > 1 ? "s" : ""}
            </p>
          )}
        </div>
        
        {/* Save button */}
        <Button
          variant={isSaved ? "ghost" : "outline"}
          size="sm"
          className={cn(
            "shrink-0",
            isSaved && "text-green-600 dark:text-green-400"
          )}
          onClick={(e) => {
            e.stopPropagation()
            handleSaveToMemory()
          }}
          disabled={isSaving || isSaved}
        >
          {isSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isSaved ? (
            <>
              <CheckCircle className="h-4 w-4 mr-1" />
              Saved
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-1" />
              Save
            </>
          )}
        </Button>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-0 ml-7 space-y-3 border-t">
          {/* Key Findings */}
          {summary.keyFindings.length > 0 && (
            <div className="mt-3">
              <h4 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
                <Brain className="h-3 w-3" />
                Key Findings
              </h4>
              <ul className="space-y-1">
                {summary.keyFindings.map((finding, i) => (
                  <li
                    key={i}
                    className="text-sm text-foreground/90 flex items-start gap-2"
                  >
                    <span className="text-primary mt-1">•</span>
                    {finding}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Next Steps */}
          {summary.nextSteps && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
                <FileText className="h-3 w-3" />
                Next Steps
              </h4>
              <p className="text-sm text-foreground/90">{summary.nextSteps}</p>
            </div>
          )}

          {/* Decisions Made */}
          {summary.decisionsMade && summary.decisionsMade.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1">
                <CheckCircle className="h-3 w-3" />
                Decisions Made
              </h4>
              <ul className="space-y-1">
                {summary.decisionsMade.map((decision, i) => (
                  <li
                    key={i}
                    className="text-sm text-foreground/90 flex items-start gap-2"
                  >
                    <span className="text-green-500 mt-1">✓</span>
                    {decision}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Tags */}
          {summary.tags && summary.tags.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <Tag className="h-3 w-3 text-muted-foreground" />
              {summary.tags.map((tag, i) => (
                <Badge key={i} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function AgentSummaryView({
  progress,
  className,
  conversationTitle,
  conversationId,
}: AgentSummaryViewProps) {
  const summaries = progress?.stepSummaries || []
  const latestSummary = progress?.latestSummary

  if (summaries.length === 0) {
    return (
      <div className={cn("flex flex-col items-center justify-center py-8 text-center", className)}>
        <Brain className="h-8 w-8 text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground">
          No summaries yet
        </p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          Summaries will appear here as the agent works
        </p>
      </div>
    )
  }

  // Group summaries by importance for quick access
  const criticalSummaries = summaries.filter(s => s.importance === "critical")
  const highSummaries = summaries.filter(s => s.importance === "high")

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {/* Important summaries highlight */}
      {(criticalSummaries.length > 0 || highSummaries.length > 0) && (
        <div className="rounded-lg bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 p-3">
          <h3 className="text-sm font-semibold text-orange-800 dark:text-orange-200 mb-2 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Important Findings ({criticalSummaries.length + highSummaries.length})
          </h3>
          <p className="text-xs text-orange-700 dark:text-orange-300">
            {criticalSummaries.length > 0 && `${criticalSummaries.length} critical`}
            {criticalSummaries.length > 0 && highSummaries.length > 0 && ", "}
            {highSummaries.length > 0 && `${highSummaries.length} high importance`}
          </p>
        </div>
      )}

      {/* Timeline of summaries */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground mb-3">
          Agent Activity ({summaries.length} step{summaries.length > 1 ? "s" : ""})
        </h3>

        {summaries.map((summary) => (
          <SummaryCard
            key={summary.id}
            summary={summary}
            conversationTitle={conversationTitle}
            conversationId={conversationId}
          />
        ))}
      </div>

      {/* Latest summary highlight */}
      {latestSummary && progress && !progress.isComplete && (
        <div className="sticky bottom-0 pt-2 bg-gradient-to-t from-background via-background to-transparent">
          <div className="rounded-lg bg-primary/5 border border-primary/20 p-3">
            <p className="text-xs font-medium text-primary mb-1">Latest Activity</p>
            <p className="text-sm">{latestSummary.actionSummary}</p>
          </div>
        </div>
      )}
    </div>
  )
}
