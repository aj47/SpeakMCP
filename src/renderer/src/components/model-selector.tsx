import { useState, useEffect, useCallback, useRef } from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import { Label } from "@renderer/components/ui/label"
import { Input } from "@renderer/components/ui/input"
import { useAvailableModelsQuery } from "@renderer/lib/query-client"
import { AlertCircle, RefreshCw, Search, Edit3 } from "lucide-react"
import { Button } from "@renderer/components/ui/button"
import { logUI, logFocus, logStateChange, logRender } from "@renderer/lib/debug"

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
  disabled = false,
}: ModelSelectorProps) {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [isOpen, setIsOpen] = useState(false)
  const [useCustomModel, setUseCustomModel] = useState(false)
  const [customModelName, setCustomModelName] = useState("")
  const [lastDropdownValue, setLastDropdownValue] = useState<string | undefined>()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const customInputRef = useRef<HTMLInputElement>(null)

  const modelsQuery = useAvailableModelsQuery(providerId, !!providerId)

  // Log component renders
  useEffect(() => {
    logRender('ModelSelector', 'mount/update', {
      providerId,
      value,
      isOpen,
      searchQuery,
      modelsCount: modelsQuery.data?.length,
      useCustomModel,
      customModelName
    })
  })

  // Check if current value is a custom model (not in the list)
  // Synchronize mode with value: switch to custom if value not in list, switch to dropdown if it is
  useEffect(() => {
    if (value && modelsQuery.data) {
      const isInList = modelsQuery.data.some(model => model.id === value)
      if (!isInList) {
        // Current value is a custom model - switch to custom mode if not already
        if (!useCustomModel || customModelName !== value) {
          setUseCustomModel(true)
          setCustomModelName(value)
          logUI('[ModelSelector] Detected custom model:', value)
        }
      } else if (isInList && useCustomModel) {
        // Value is now in the list but we're in custom mode - switch back to dropdown
        setUseCustomModel(false)
        setCustomModelName('')
        logUI('[ModelSelector] Value now in list, switching to dropdown mode')
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, modelsQuery.data])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      await modelsQuery.refetch()
    } finally {
      setIsRefreshing(false)
    }
  }

  // Auto-select first model if no value is set and models are available
  // Only auto-select when not in custom mode to avoid state inconsistency
  useEffect(() => {
    if (!value && modelsQuery.data && modelsQuery.data.length > 0 && !useCustomModel) {
      logUI('[ModelSelector] Auto-selecting first model:', modelsQuery.data[0].id)
      onValueChange(modelsQuery.data[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, modelsQuery.data, useCustomModel])

  // Clear search when dropdown closes and manage focus
  useEffect(() => {
    if (!isOpen) {
      logStateChange('ModelSelector', 'isOpen', true, false)
      logUI('[ModelSelector] Dropdown closed, clearing search query')
      setSearchQuery("")
    } else {
      logStateChange('ModelSelector', 'isOpen', false, true)
      logUI('[ModelSelector] Dropdown opened, focusing search input')
      // Focus the search input when dropdown opens
      requestAnimationFrame(() => {
        if (searchInputRef.current) {
          searchInputRef.current.focus()
          logFocus('ModelSelector.searchInput', 'focus', { delayed: true })
        }
      })
    }
  }, [isOpen])

  // Ensure the search input retains focus while typing (some Radix focus management can steal it)
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        if (
          searchInputRef.current &&
          document.activeElement !== searchInputRef.current
        ) {
          logUI('[ModelSelector] Refocusing search input after query change')
          searchInputRef.current.focus()
        }
      })
    }
  }, [searchQuery, isOpen])

  const isLoading = modelsQuery.isLoading || isRefreshing
  const hasError = modelsQuery.isError && !modelsQuery.data
  const allModels = modelsQuery.data || []

  // Filter models based on search query
  const filteredModels = allModels.filter((model) => {
    if (!searchQuery.trim()) return true
    const query = searchQuery.toLowerCase()
    return (
      model.id.toLowerCase().includes(query) ||
      model.name.toLowerCase().includes(query) ||
      (model.description && model.description.toLowerCase().includes(query))
    )
  })

  // Handle custom model toggle
  const handleCustomModelToggle = () => {
    if (useCustomModel) {
      // Switching back to dropdown
      setUseCustomModel(false)
      setCustomModelName("")
      // Restore previous dropdown selection or select first model, or clear if no models
      const valueToRestore = lastDropdownValue && allModels.some(m => m.id === lastDropdownValue)
        ? lastDropdownValue
        : allModels[0]?.id
      if (valueToRestore) {
        onValueChange(valueToRestore)
      } else {
        // No models available, clear the value
        onValueChange('')
      }
    } else {
      // Switching to custom input
      setUseCustomModel(true)
      setLastDropdownValue(value)
      setCustomModelName(value || "")
      // Focus the custom input after state update
      requestAnimationFrame(() => {
        customInputRef.current?.focus()
      })
    }
  }

  // Handle custom model name change with validation and sanitization
  const handleCustomModelChange = (newValue: string) => {
    // Sanitize: only allow alphanumeric, dots, hyphens, underscores, and colons (for provider:model format)
    const sanitized = newValue.replace(/[^a-zA-Z0-9._:-]/g, '')
    // Truncate to reasonable length to prevent DoS
    const truncated = sanitized.substring(0, 100)
    setCustomModelName(truncated)
    // Only propagate non-empty values
    if (truncated.trim()) {
      onValueChange(truncated)
    }
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {label && (
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">{label}</Label>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCustomModelToggle}
              disabled={disabled}
              className="h-6 px-2 text-xs flex-shrink-0"
              title={useCustomModel ? "Switch to model list" : "Use custom model name"}
            >
              <Edit3 className="h-3 w-3" />
            </Button>
            {!useCustomModel && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefresh}
                disabled={isLoading || disabled}
                className="h-6 px-2 text-xs flex-shrink-0"
              >
                <RefreshCw
                  className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`}
                />
              </Button>
            )}
          </div>
        </div>
      )}

      {useCustomModel ? (
        <div className="space-y-1">
          <Input
            ref={customInputRef}
            value={customModelName}
            onChange={(e) => handleCustomModelChange(e.target.value)}
            placeholder="Enter custom model name (e.g., gpt-4, claude-3-opus)"
            disabled={disabled}
            className="w-full"
            maxLength={100}
            pattern="[a-zA-Z0-9._:-]+"
            title="Model name can only contain letters, numbers, dots, hyphens, underscores, and colons"
          />
          <p className="text-xs text-muted-foreground">
            Enter any model name supported by your provider (alphanumeric, dots, hyphens, underscores, colons only)
          </p>
        </div>
      ) : (
        <Select
          value={value}
          onValueChange={(newValue) => {
            logUI('[ModelSelector] Select onValueChange:', newValue)
            setLastDropdownValue(newValue)
            onValueChange(newValue)
          }}
          disabled={disabled || isLoading || allModels.length === 0}
          open={isOpen}
          onOpenChange={(open) => {
            logUI('[ModelSelector] Select onOpenChange:', open)
            setIsOpen(open)
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue
              placeholder={
                isLoading
                  ? "Loading models..."
                  : hasError
                    ? "Failed to load models"
                    : placeholder || "Select a model"
              }
            />
          </SelectTrigger>
        <SelectContent
          className="max-h-[400px] w-[300px]"
          onCloseAutoFocus={(e) => {
            // Prevent Radix from moving focus back to the trigger; we'll manage it
            e.preventDefault()
          }}
        >
          {/* Search input */}
          <div
            className="mb-2 flex items-center border-b px-3 pb-2"
            onMouseDown={(e) => e.preventDefault()}
          >
            <Search className="mr-2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              placeholder="Search models..."
              value={searchQuery}
              onChange={(e) => {
                const newValue = e.target.value
                logStateChange('ModelSelector', 'searchQuery', searchQuery, newValue)
                logUI('[ModelSelector] Search input onChange, activeElement:', document.activeElement?.tagName)
                e.stopPropagation()
                setSearchQuery(newValue)
              }}
              onKeyDown={(e) => {
                logUI('[ModelSelector] Search input onKeyDown:', e.key, 'activeElement:', document.activeElement?.tagName)
                e.stopPropagation()
                if (e.key === "Escape") {
                  logUI('[ModelSelector] Escape pressed, closing dropdown')
                  setIsOpen(false)
                } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  logUI('[ModelSelector] Arrow key pressed:', e.key)
                  // Allow arrow keys to navigate through the list
                  e.preventDefault()
                }
              }}
              onFocus={(e) => {
                e.stopPropagation()
                logFocus('ModelSelector.searchInput', 'focus', {
                  relatedTarget: e.relatedTarget?.tagName,
                  activeElement: document.activeElement?.tagName
                })
              }}
              onBlur={(e) => {
                e.stopPropagation()
                logFocus('ModelSelector.searchInput', 'blur', {
                  relatedTarget: e.relatedTarget?.tagName,
                  activeElement: document.activeElement?.tagName
                })
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className="h-auto border-0 p-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>

          {/* Scrollable content area with fixed height */}
          <div className="max-h-[300px] min-h-[200px] overflow-y-auto">
            {isLoading && (
              <div className="flex items-center justify-center py-8">
                <span className="text-sm text-muted-foreground">
                  Loading models...
                </span>
              </div>
            )}

            {hasError && (
              <div className="flex items-center justify-center py-8 text-destructive">
                <AlertCircle className="mr-2 h-4 w-4" />
                <span className="text-sm">Failed to load models</span>
              </div>
            )}

            {!isLoading && !hasError && allModels.length === 0 && (
              <div className="flex items-center justify-center py-8">
                <span className="text-sm text-muted-foreground">
                  No models available
                </span>
              </div>
            )}

            {!isLoading &&
              !hasError &&
              filteredModels.length === 0 &&
              searchQuery.trim() && (
                <div className="flex items-center justify-center py-8">
                  <span className="text-sm text-muted-foreground">
                    No models match "{searchQuery}"
                  </span>
                </div>
              )}

            {filteredModels.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                <div className="flex w-full min-w-0 flex-col">
                  <span className="truncate">{model.name}</span>

                </div>
              </SelectItem>
            ))}
          </div>
        </SelectContent>
      </Select>
      )}

      {!useCustomModel && hasError && (
        <p className="text-xs text-destructive">
          Failed to load models. Using fallback options.
        </p>
      )}

      {!useCustomModel && !hasError && allModels.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {searchQuery.trim()
            ? `${filteredModels.length} of ${allModels.length} models match "${searchQuery}"`
            : `${allModels.length} model${allModels.length !== 1 ? "s" : ""} available`}
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
  disabled = false,
}: ProviderModelSelectorProps) {
  const providerNames: Record<string, string> = {
    openai: "OpenAI",
    groq: "Groq",
    gemini: "Gemini",
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
        <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
          This provider is not currently selected for any functions. Configure
          provider selection above to use {providerName} models.
        </div>
      )}
    </div>
  )
}
