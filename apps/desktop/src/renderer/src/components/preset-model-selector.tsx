import { useState, useEffect } from "react"
import { Label } from "./ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select"
import { AlertCircle, RefreshCw } from "lucide-react"
import { Button } from "./ui/button"
import { tipcClient } from "@renderer/lib/tipc-client"

interface PresetModelSelectorProps {
  presetId: string
  baseUrl: string
  apiKey: string
  value?: string
  onValueChange: (value: string) => void
  label: string
  placeholder?: string
  disabled?: boolean
}

export function PresetModelSelector({
  presetId,
  baseUrl,
  apiKey,
  value,
  onValueChange,
  label,
  placeholder = "Select a model",
  disabled = false,
}: PresetModelSelectorProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([])
  const [error, setError] = useState<string | null>(null)

  const fetchModels = async () => {
    if (!baseUrl || !apiKey) {
      setModels([])
      setError("Base URL and API key required")
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      // Fetch models using the preset's specific base URL and API key
      const result = await tipcClient.fetchModelsForPreset({
        baseUrl,
        apiKey,
      })
      setModels(result || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch models")
      setModels([])
    } finally {
      setIsLoading(false)
    }
  }

  // Fetch models when baseUrl or apiKey changes
  useEffect(() => {
    if (baseUrl && apiKey) {
      fetchModels()
    }
  }, [baseUrl, apiKey])

  const hasError = !!error && models.length === 0

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{label}</Label>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchModels}
          disabled={isLoading || disabled || !baseUrl || !apiKey}
          className="h-6 px-2 text-xs"
        >
          <RefreshCw className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <Select
        value={value || ""}
        onValueChange={onValueChange}
        disabled={disabled || isLoading || (!baseUrl || !apiKey)}
      >
        <SelectTrigger className="w-full">
          <SelectValue
            placeholder={
              isLoading
                ? "Loading models..."
                : !baseUrl || !apiKey
                  ? "Enter API key first"
                  : hasError
                    ? "Failed to load"
                    : placeholder
            }
          />
        </SelectTrigger>
        <SelectContent className="max-h-[300px]">
          {models.map((model) => (
            <SelectItem key={model.id} value={model.id}>
              {model.name}
            </SelectItem>
          ))}
          {models.length === 0 && !isLoading && (
            <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
              {hasError ? (
                <>
                  <AlertCircle className="mr-2 h-4 w-4" />
                  {error}
                </>
              ) : (
                "No models available"
              )}
            </div>
          )}
        </SelectContent>
      </Select>

      {value && (
        <p className="text-xs text-muted-foreground truncate">
          Selected: {value}
        </p>
      )}
    </div>
  )
}

