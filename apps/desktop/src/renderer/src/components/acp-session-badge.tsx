import { useState } from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip"
import { Badge } from "./ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu"
import { cn } from "@renderer/lib/utils"
import { tipcClient } from "@renderer/lib/tipc-client"

interface ModelOrMode {
  id: string
  name: string
  description?: string
}

interface ACPSessionBadgeProps {
  info: {
    agentName?: string
    agentTitle?: string
    agentVersion?: string
    currentModel?: string
    currentMode?: string
    availableModels?: ModelOrMode[]
    availableModes?: ModelOrMode[]
  }
  sessionId?: string
  className?: string
  /** If true, the badge is read-only (no dropdowns) */
  readOnly?: boolean
}

/**
 * A compact badge component showing ACP session agent info.
 * Displays agent title/version and model/mode in a compact format.
 * When interactive (not readOnly), clicking model/mode shows dropdowns for selection.
 *
 * Visual example: `[Claude Code v0.12.6] [Sonnet 4.5]`
 */
export function ACPSessionBadge({ info, sessionId, className, readOnly = false }: ACPSessionBadgeProps) {
  const { agentName, agentTitle, agentVersion, currentModel, currentMode, availableModels, availableModes } = info
  const [isChangingModel, setIsChangingModel] = useState(false)
  const [isChangingMode, setIsChangingMode] = useState(false)

  // Build agent label (e.g., "Claude Code v0.12.6")
  const agentLabel = agentTitle
    ? agentVersion
      ? `${agentTitle} v${agentVersion}`
      : agentTitle
    : null

  // Build model label (e.g., "Sonnet 4.5" or "claude-3-5-sonnet")
  const modelLabel = currentModel || null

  // If nothing to display, return null
  if (!agentLabel && !modelLabel) {
    return null
  }

  const hasMultipleModels = availableModels && availableModels.length > 1
  const hasMultipleModes = availableModes && availableModes.length > 1
  const canChangeModel = !readOnly && sessionId && agentName && hasMultipleModels
  const canChangeMode = !readOnly && sessionId && agentName && hasMultipleModes

  const handleModelChange = async (modelId: string) => {
    if (!sessionId || !agentName || modelId === currentModel) return
    setIsChangingModel(true)
    try {
      await tipcClient.setAcpSessionModel({ agentName, sessionId, modelId })
    } catch (error) {
      console.error("Failed to change model:", error)
    } finally {
      setIsChangingModel(false)
    }
  }

  const handleModeChange = async (modeId: string) => {
    if (!sessionId || !agentName || modeId === currentMode) return
    setIsChangingMode(true)
    try {
      await tipcClient.setAcpSessionMode({ agentName, sessionId, modeId })
    } catch (error) {
      console.error("Failed to change mode:", error)
    } finally {
      setIsChangingMode(false)
    }
  }

  // Build tooltip content with all available info
  const tooltipLines: string[] = []
  if (agentTitle) tooltipLines.push(`Agent: ${agentTitle}`)
  if (agentVersion) tooltipLines.push(`Version: ${agentVersion}`)
  if (currentModel) tooltipLines.push(`Model: ${currentModel}`)
  if (currentMode) tooltipLines.push(`Mode: ${currentMode}`)
  if (canChangeModel || canChangeMode) {
    tooltipLines.push("Click to change model/mode")
  }

  // Agent badge (always read-only)
  const AgentBadge = agentLabel ? (
    <Badge
      variant="secondary"
      className="text-[10px] px-1.5 py-0 font-medium"
    >
      {agentLabel}
    </Badge>
  ) : null

  // Model/Mode badge - interactive if options available
  const ModelModeBadge = modelLabel ? (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] px-1.5 py-0 font-mono",
        (canChangeModel || canChangeMode) && "cursor-pointer hover:bg-accent",
        (isChangingModel || isChangingMode) && "opacity-50"
      )}
    >
      {modelLabel}
      {currentMode && (
        <span className="ml-1 opacity-60">• {currentMode}</span>
      )}
    </Badge>
  ) : null

  // If interactive and has options, wrap in dropdown
  if ((canChangeModel || canChangeMode) && ModelModeBadge) {
    return (
      <div className={cn("inline-flex items-center gap-1.5", className)}>
        {AgentBadge}
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={isChangingModel || isChangingMode}>
            {ModelModeBadge}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-w-[300px]">
            {canChangeModel && (
              <>
                <DropdownMenuLabel className="text-xs">Model</DropdownMenuLabel>
                {availableModels?.map((model) => (
                  <DropdownMenuItem
                    key={model.id}
                    onClick={() => handleModelChange(model.id)}
                    className={cn(
                      "text-xs cursor-pointer",
                      model.id === currentModel && "bg-accent"
                    )}
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">{model.name || model.id}</span>
                      {model.description && (
                        <span className="text-[10px] text-muted-foreground">{model.description}</span>
                      )}
                    </div>
                  </DropdownMenuItem>
                ))}
              </>
            )}
            {canChangeModel && canChangeMode && <DropdownMenuSeparator />}
            {canChangeMode && (
              <>
                <DropdownMenuLabel className="text-xs">Mode</DropdownMenuLabel>
                {availableModes?.map((mode) => (
                  <DropdownMenuItem
                    key={mode.id}
                    onClick={() => handleModeChange(mode.id)}
                    className={cn(
                      "text-xs cursor-pointer",
                      mode.id === currentMode && "bg-accent"
                    )}
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">{mode.name || mode.id}</span>
                      {mode.description && (
                        <span className="text-[10px] text-muted-foreground">{mode.description}</span>
                      )}
                    </div>
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
  }

  // Read-only mode - show tooltip
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={cn(
              "inline-flex items-center gap-1.5 cursor-help",
              className
            )}
          >
            {AgentBadge}
            {ModelModeBadge}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs">
          <div className="space-y-0.5">
            {tooltipLines.map((line, idx) => (
              <p key={idx}>{line}</p>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

