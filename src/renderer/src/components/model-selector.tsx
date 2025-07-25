import { useState, useEffect, useCallback } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@renderer/components/ui/select"
import { Label } from "@renderer/components/ui/label"
import { useAvailableModelsQuery } from "@renderer/lib/query-client"
import { Loader2, AlertCircle, RefreshCw } from "lucide-react"
import { Button } from "@renderer/components/ui/button"

interface ModelSelectorProps {
  providerId: string
  value?: string
  onValueChange: (value: string) => void
  label?: string
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function ModelSelector({
  providerId,
  value,
  onValueChange,
  label,
  placeholder,
  className,
  disabled = false
}: ModelSelectorProps) {
  const [isRefreshing, setIsRefreshing] = useState(false)

  const modelsQuery = useAvailableModelsQuery(providerId, !!providerId)

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await modelsQuery.refetch()
    setIsRefreshing(false)
  }

  // Auto-select first model if no value is set and models are available
  useEffect(() => {
    if (!value && modelsQuery.data && modelsQuery.data.length > 0) {
      onValueChange(modelsQuery.data[0].id)
    }
  }, [value, modelsQuery.data]) // Remove onValueChange from dependencies to prevent infinite loops

  const isLoading = modelsQuery.isLoading || isRefreshing
  const hasError = modelsQuery.isError && !modelsQuery.data
  const models = modelsQuery.data || []

  return (
    <div className={`space-y-2 ${className}`}>
      {label && (
        <div className="flex items-center justify-between">
          <Label>{label}</Label>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleRefresh}
            disabled={isLoading || disabled}
            className="h-6 px-2 text-xs"
          >
            <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      )}

      <Select
        value={value}
        onValueChange={onValueChange}
        disabled={disabled || isLoading || models.length === 0}
      >
        <SelectTrigger>
          <SelectValue placeholder={
            isLoading
              ? "Loading models..."
              : hasError
                ? "Failed to load models"
                : placeholder || "Select a model"
          } />
        </SelectTrigger>
        <SelectContent>
          {isLoading && (
            <div className="flex items-center justify-center py-2">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              <span className="text-sm text-muted-foreground">Loading models...</span>
            </div>
          )}

          {hasError && (
            <div className="flex items-center justify-center py-2 text-destructive">
              <AlertCircle className="h-4 w-4 mr-2" />
              <span className="text-sm">Failed to load models</span>
            </div>
          )}

          {!isLoading && !hasError && models.length === 0 && (
            <div className="flex items-center justify-center py-2">
              <span className="text-sm text-muted-foreground">No models available</span>
            </div>
          )}

          {models.map((model) => (
            <SelectItem key={model.id} value={model.id}>
              <div className="flex flex-col">
                <span>{model.name}</span>
                {model.description && (
                  <span className="text-xs text-muted-foreground">{model.description}</span>
                )}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasError && (
        <p className="text-xs text-destructive">
          Failed to load models. Using fallback options.
        </p>
      )}

      {!hasError && models.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {models.length} model{models.length !== 1 ? 's' : ''} available
        </p>
      )}
    </div>
  )
}

interface ProviderModelSelectorProps {
  providerId: string
  mcpModel?: string
  transcriptModel?: string
  onMcpModelChange: (value: string) => void
  onTranscriptModelChange: (value: string) => void
  showMcpModel?: boolean
  showTranscriptModel?: boolean
  disabled?: boolean
}

export function ProviderModelSelector({
  providerId,
  mcpModel,
  transcriptModel,
  onMcpModelChange,
  onTranscriptModelChange,
  showMcpModel = true,
  showTranscriptModel = true,
  disabled = false
}: ProviderModelSelectorProps) {
  const providerNames: Record<string, string> = {
    openai: 'OpenAI',
    groq: 'Groq',
    gemini: 'Gemini'
  }

  const providerName = providerNames[providerId] || providerId

  return (
    <div className="space-y-4">
      {showMcpModel && (
        <ModelSelector
          providerId={providerId}
          value={mcpModel}
          onValueChange={onMcpModelChange}
          label={`${providerName} Model (MCP Tools)`}
          placeholder="Select model for tool calling"
          disabled={disabled}
        />
      )}

      {showTranscriptModel && (
        <ModelSelector
          providerId={providerId}
          value={transcriptModel}
          onValueChange={onTranscriptModelChange}
          label={`${providerName} Model (Transcript Processing)`}
          placeholder="Select model for transcript processing"
          disabled={disabled}
        />
      )}
    </div>
  )
}
