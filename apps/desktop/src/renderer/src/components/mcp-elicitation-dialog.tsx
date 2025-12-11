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
import { Input } from "./ui/input"
import { Switch } from "./ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select"
import { Label } from "./ui/label"
import type {
  ElicitationRequest,
  ElicitationFormRequest,
  ElicitationUrlRequest,
  ElicitationFormSchema,
  ElicitationFormField,
} from "../../../shared/types"

type FormValues = Record<string, string | number | boolean>

function McpElicitationDialog() {
  const [request, setRequest] = useState<ElicitationRequest | null>(null)
  const [formValues, setFormValues] = useState<FormValues>({})
  const [isOpen, setIsOpen] = useState(false)

  // Listen for elicitation requests
  useEffect(() => {
    const unlisten = rendererHandlers["mcp:elicitation-request"].listen(
      (req: ElicitationRequest) => {
        setRequest(req)
        // Initialize form values with defaults
        if (req.mode === "form") {
          const formReq = req as ElicitationFormRequest
          const initialValues: FormValues = {}
          for (const [key, field] of Object.entries(formReq.requestedSchema.properties)) {
            if (field.default !== undefined) {
              initialValues[key] = field.default
            } else if (field.type === "boolean") {
              initialValues[key] = false
            } else if (field.type === "number") {
              initialValues[key] = 0
            } else {
              initialValues[key] = ""
            }
          }
          setFormValues(initialValues)
        }
        setIsOpen(true)
      }
    )
    return unlisten
  }, [])

  // Listen for elicitation complete (for URL mode auto-close)
  useEffect(() => {
    const unlisten = rendererHandlers["mcp:elicitation-complete"].listen(
      (data: { elicitationId: string; requestId: string }) => {
        if (request && request.requestId === data.requestId) {
          setIsOpen(false)
          setRequest(null)
        }
      }
    )
    return unlisten
  }, [request])

  const handleAction = async (action: "accept" | "decline" | "cancel") => {
    if (!request) return

    const content = action === "accept" && request.mode === "form" ? formValues : undefined
    await tipcClient.resolveElicitation({
      requestId: request.requestId,
      action,
      content,
    })
    setIsOpen(false)
    setRequest(null)
  }

  const handleOpenUrl = () => {
    if (request?.mode === "url") {
      window.open((request as ElicitationUrlRequest).url, "_blank")
    }
  }

  const renderFormField = (key: string, field: ElicitationFormSchema["properties"][string]) => {
    const value = formValues[key]
    const label = field.title || key

    if (field.type === "boolean") {
      return (
        <div key={key} className="flex items-center justify-between py-2">
          <div>
            <Label htmlFor={key}>{label}</Label>
            {field.description && (
              <p className="text-xs text-muted-foreground">{field.description}</p>
            )}
          </div>
          <Switch
            id={key}
            checked={Boolean(value)}
            onCheckedChange={(checked) => setFormValues((prev) => ({ ...prev, [key]: checked }))}
          />
        </div>
      )
    }

    if (field.type === "enum" && field.enum) {
      return (
        <div key={key} className="space-y-2 py-2">
          <Label htmlFor={key}>{label}</Label>
          {field.description && (
            <p className="text-xs text-muted-foreground">{field.description}</p>
          )}
          <Select
            value={String(value)}
            onValueChange={(v) => setFormValues((prev) => ({ ...prev, [key]: v }))}
          >
            <SelectTrigger id={key}>
              <SelectValue placeholder={`Select ${label}`} />
            </SelectTrigger>
            <SelectContent>
              {field.enum.map((opt, idx) => (
                <SelectItem key={opt} value={opt}>
                  {field.enumNames?.[idx] || opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )
    }

    // Default: text/number input
    return (
      <div key={key} className="space-y-2 py-2">
        <Label htmlFor={key}>{label}</Label>
        {field.description && (
          <p className="text-xs text-muted-foreground">{field.description}</p>
        )}
        <Input
          id={key}
          type={field.type === "number" ? "number" : "text"}
          value={String(value ?? "")}
          onChange={(e) => {
            const v = field.type === "number" ? Number(e.target.value) : e.target.value
            setFormValues((prev) => ({ ...prev, [key]: v }))
          }}
          placeholder={field.format ? `Enter ${field.format}` : undefined}
        />
      </div>
    )
  }

  if (!request) return null

  const isFormMode = request.mode === "form"
  const formRequest = isFormMode ? (request as ElicitationFormRequest) : null
  const urlRequest = !isFormMode ? (request as ElicitationUrlRequest) : null

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleAction("cancel")}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Request from {request.serverName}</DialogTitle>
          <DialogDescription>{request.message}</DialogDescription>
        </DialogHeader>

        {isFormMode && formRequest && (
          <div className="max-h-[60vh] overflow-y-auto">
            {Object.entries(formRequest.requestedSchema.properties).map(([key, field]) =>
              renderFormField(key, field)
            )}
          </div>
        )}

        {!isFormMode && urlRequest && (
          <div className="py-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              Please complete the required action in your browser. The dialog will close
              automatically when the action is complete.
            </p>
            <Button variant="outline" onClick={handleOpenUrl} className="w-full">
              Open URL Again
            </Button>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={() => handleAction("cancel")}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => handleAction("decline")}>
            Decline
          </Button>
          <Button onClick={() => handleAction("accept")}>Accept</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default McpElicitationDialog

