import { useState, useEffect, useCallback, useRef } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@renderer/components/ui/select"
import { Label } from "@renderer/components/ui/label"
import { Input } from "@renderer/components/ui/input"
import { useAvailableModelsQuery } from "@renderer/lib/query-client"
import { Loader2, AlertCircle, RefreshCw, Search } from "lucide-react"
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
  const [searchQuery, setSearchQuery] = useState("")
  const [isOpen, setIsOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

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

  // Clear search when dropdown closes and manage focus
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery("")
    } else {
      // Focus the search input when dropdown opens
      setTimeout(() => {
        searchInputRef.current?.focus()
      }, 100)
    }
  }, [isOpen])

  const isLoading = modelsQuery.isLoading || isRefreshing
  const hasError = modelsQuery.isError && !modelsQuery.data
  const allModels = modelsQuery.data || []

  // Filter models based on search query
  const filteredModels = allModels.filter(model => {
    if (!searchQuery.trim()) return true
    const query = searchQuery.toLowerCase()
    return (
      model.id.toLowerCase().includes(query) ||
      model.name.toLowerCase().includes(query) ||
      (model.description && model.description.toLowerCase().includes(query))
    )
  })

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
        disabled={disabled || isLoading || allModels.length === 0}
        open={isOpen}
        onOpenChange={setIsOpen}
      >
        <SelectTrigger className="w-full max-w-[200px] min-w-[120px]">
          <SelectValue placeholder={
            isLoading
              ? "Loading models..."
              : hasError
                ? "Failed to load models"
                : placeholder || "Select a model"
          } />
        </SelectTrigger>
        <SelectContent className="w-[300px] max-h-[400px]">
          {/* Search input */}
          <div className="flex items-center border-b px-3 pb-2 mb-2" onMouseDown={(e) => e.preventDefault()}>
            <Search className="h-4 w-4 mr-2 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              placeholder="Search models..."
              value={searchQuery}
              onChange={(e) => {
                e.stopPropagation()
                setSearchQuery(e.target.value)
              }}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Escape') {
                  setIsOpen(false)
                } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  // Allow arrow keys to navigate through the list
                  e.preventDefault()
                }
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onFocus={(e) => e.stopPropagation()}
              className="border-0 p-0 h-auto focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>

          {/* Scrollable content area with fixed height */}
          <div className="min-h-[200px] max-h-[300px] overflow-y-auto">
            {isLoading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                <span className="text-sm text-muted-foreground">Loading models...</span>
              </div>
            )}

            {hasError && (
              <div className="flex items-center justify-center py-8 text-destructive">
                <AlertCircle className="h-4 w-4 mr-2" />
                <span className="text-sm">Failed to load models</span>
              </div>
            )}

            {!isLoading && !hasError && allModels.length === 0 && (
              <div className="flex items-center justify-center py-8">
                <span className="text-sm text-muted-foreground">No models available</span>
              </div>
            )}

            {!isLoading && !hasError && filteredModels.length === 0 && searchQuery.trim() && (
              <div className="flex items-center justify-center py-8">
                <span className="text-sm text-muted-foreground">No models match "{searchQuery}"</span>
              </div>
            )}

            {filteredModels.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                <div className="flex flex-col min-w-0 w-full">
                  <span className="truncate">{model.name}</span>
                  {model.description && (
                    <span className="text-xs text-muted-foreground truncate">{model.description}</span>
                  )}
                </div>
              </SelectItem>
            ))}
          </div>
        </SelectContent>
      </Select>

      {hasError && (
        <p className="text-xs text-destructive">
          Failed to load models. Using fallback options.
        </p>
      )}

      {!hasError && allModels.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {searchQuery.trim()
            ? `${filteredModels.length} of ${allModels.length} models match "${searchQuery}"`
            : `${allModels.length} model${allModels.length !== 1 ? 's' : ''} available`
          }
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
          label={`${providerName} Model (Agent/MCP Tools)`}
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

      {!showMcpModel && !showTranscriptModel && (
        <div className="text-sm text-muted-foreground p-3 bg-muted/50 rounded-md">
          This provider is not currently selected for any functions. Configure provider selection above to use {providerName} models.
        </div>
      )}
    </div>
  )
}
