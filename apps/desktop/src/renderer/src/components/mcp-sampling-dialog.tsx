import { useState, useEffect } from "react"
import { rendererHandlers, tipcClient } from "@renderer/lib/tipc-client"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog"
import { Button } from "./ui/button"
import type { SamplingRequest } from "../../../shared/types"

export default function McpSamplingDialog() {
  const [request, setRequest] = useState<SamplingRequest | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    const unlisten = rendererHandlers["mcp:sampling-request"].listen(
      (samplingRequest: SamplingRequest) => {
        setRequest(samplingRequest)
        setIsOpen(true)
      }
    )
    return unlisten
  }, [])

  const handleResponse = async (approved: boolean) => {
    if (!request) return

    await tipcClient.resolveSampling({
      requestId: request.requestId,
      approved,
    })

    setIsOpen(false)
    setRequest(null)
  }

  if (!request) return null

  const messageCount = request.messages.length
  const hasSystemPrompt = !!request.systemPrompt
  const modelHints = request.modelPreferences?.hints
    ?.map((h) => h.name)
    .filter(Boolean)

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleResponse(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Sampling Request</DialogTitle>
          <DialogDescription>
            <span className="font-medium text-foreground">{request.serverName}</span>{" "}
            is requesting to use your AI model
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="rounded-md border bg-muted/50 p-3 space-y-2">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Messages:</span>
              <span className="font-medium">{messageCount}</span>
            </div>
            {hasSystemPrompt && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">System prompt:</span>
                <span className="font-medium text-green-600">Present</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Max tokens:</span>
              <span className="font-medium">{request.maxTokens}</span>
            </div>
            {request.temperature !== undefined && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Temperature:</span>
                <span className="font-medium">{request.temperature}</span>
              </div>
            )}
          </div>

          {modelHints && modelHints.length > 0 && (
            <div className="rounded-md border bg-muted/50 p-3">
              <div className="text-muted-foreground mb-1">Model preferences:</div>
              <div className="flex flex-wrap gap-1">
                {modelHints.map((hint, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                  >
                    {hint}
                  </span>
                ))}
              </div>
            </div>
          )}

          {request.modelPreferences && (
            <div className="rounded-md border bg-muted/50 p-3 space-y-1">
              {request.modelPreferences.costPriority !== undefined && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Cost priority:</span>
                  <span>{request.modelPreferences.costPriority}</span>
                </div>
              )}
              {request.modelPreferences.speedPriority !== undefined && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Speed priority:</span>
                  <span>{request.modelPreferences.speedPriority}</span>
                </div>
              )}
              {request.modelPreferences.intelligencePriority !== undefined && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Intelligence priority:</span>
                  <span>{request.modelPreferences.intelligencePriority}</span>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => handleResponse(false)}>
            Decline
          </Button>
          <Button onClick={() => handleResponse(true)}>
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

