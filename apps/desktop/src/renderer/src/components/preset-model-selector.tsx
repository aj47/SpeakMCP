import { useState, useEffect, useRef } from "react"
import { Label } from "./ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select"
import {
  AlertCircle,
  RefreshCw,
  Wrench,
  Brain,
  Image,
  Search,
} from "lucide-react"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { tipcClient } from "@renderer/lib/tipc-client"

/** Local type matching models.dev service response */
interface ModelsDevModel {
  id: string
  name: string
  tool_call?: boolean
  reasoning?: boolean
  modalities?: {
    input?: string[]
    output?: string[]
  }
  cost?: {
    input?: number
    output?: number
  }
  limit?: {
    context?: number
    output?: number
  }
}

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

/** Format price in a compact way */
function formatPrice(price: number | undefined): string | null {
  if (price === undefined || price === null) return null
  if (price === 0) return "Free"
  if (price < 0.01) return `$${price.toFixed(4)}`
  if (price < 1) return `$${price.toFixed(2)}`
  return `$${price.toFixed(2)}`
}

/** Format context window size in a compact way */
function formatContextSize(context: number | undefined): string | null {
  if (!context) return null
  if (context >= 1000000) return `${(context / 1000000).toFixed(1)}M ctx`
  if (context >= 1000) return `${Math.round(context / 1000)}K ctx`
  return `${context} ctx`
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
  const [modelsDevData, setModelsDevData] = useState<
    Record<string, ModelsDevModel>
  >({})
  const [searchQuery, setSearchQuery] = useState("")
  const [isOpen, setIsOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const fetchModels = async () => {
    if (!baseUrl || !apiKey) {
      setModels([])
      setError("Base URL and API key required")
      return
    }

    setIsLoading(true)
    setError(null)

    try {
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

  // Fetch models.dev data for enriched display using backend fuzzy matching
  useEffect(() => {
    const fetchModelsDevInfo = async () => {
      if (models.length === 0) return

      // Fetch enhanced info for each model using fuzzy matching
      const enrichedData: Record<string, ModelsDevModel> = {}

      await Promise.all(
        models.map(async (model) => {
          try {
            // Use backend fuzzy matching - no providerId to search across ALL providers
            const info = await tipcClient.getModelInfo({ modelId: model.id })
            if (info) {
              enrichedData[model.id] = info
            }
          } catch {
            // Silently ignore - enrichment is optional
          }
        }),
      )

      setModelsDevData(enrichedData)
    }

    fetchModelsDevInfo()
  }, [models])

  useEffect(() => {
    if (baseUrl && apiKey) {
      fetchModels()
    }
  }, [baseUrl, apiKey, presetId])

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery("")
      return
    }

    requestAnimationFrame(() => {
      searchInputRef.current?.focus()
    })
  }, [isOpen])

  // Keep search focus stable while typing; Radix can move focus during content reflow.
  useEffect(() => {
    if (!isOpen) return

    requestAnimationFrame(() => {
      if (
        searchInputRef.current &&
        document.activeElement !== searchInputRef.current
      ) {
        searchInputRef.current.focus()
      }
    })
  }, [searchQuery, isOpen])

  const hasError = !!error && models.length === 0

  /** Get models.dev info for a specific model */
  const getModelInfo = (modelId: string): ModelsDevModel | undefined => {
    return modelsDevData[modelId]
  }

  const filteredModels = models.filter((model) => {
    if (!searchQuery.trim()) return true
    const query = searchQuery.toLowerCase()
    const info = getModelInfo(model.id)
    return (
      model.id.toLowerCase().includes(query) ||
      model.name.toLowerCase().includes(query) ||
      info?.name?.toLowerCase().includes(query)
    )
  })

  const selectedDisplayValue = (() => {
    if (!value) return undefined

    const selectedModel = models.find((model) => model.id === value)
    if (!selectedModel) return value

    const selectedInfo = getModelInfo(selectedModel.id)
    const selectedInputPrice = formatPrice(selectedInfo?.cost?.input)
    const selectedOutputPrice = formatPrice(selectedInfo?.cost?.output)
    const selectedContextSize = formatContextSize(selectedInfo?.limit?.context)

    const metaParts: string[] = []
    if (selectedInputPrice && selectedOutputPrice) {
      metaParts.push(`${selectedInputPrice}/${selectedOutputPrice}/M`)
    }
    if (selectedContextSize) {
      metaParts.push(selectedContextSize)
    }

    if (metaParts.length === 0) return selectedModel.name
    return `${selectedModel.name} • ${metaParts.join(" • ")}`
  })()

  /** Render model item with pricing and capabilities */
  const renderModelItem = (model: { id: string; name: string }) => {
    const info = getModelInfo(model.id)
    const inputPrice = formatPrice(info?.cost?.input)
    const outputPrice = formatPrice(info?.cost?.output)
    const contextSize = formatContextSize(info?.limit?.context)

    const hasToolCall = info?.tool_call
    const hasReasoning = info?.reasoning
    const hasVision = info?.modalities?.input?.includes("image")

    return (
      <SelectItem key={model.id} value={model.id}>
        <div className="flex w-full min-w-0 items-center gap-2 py-0.5">
          <span className="truncate">{model.name}</span>
          {/* Capability indicators */}
          <div className="flex shrink-0 items-center gap-1">
            {hasToolCall && (
              <span title="Tool calling">
                <Wrench className="h-3 w-3 text-blue-500" />
              </span>
            )}
            {hasReasoning && (
              <span title="Reasoning">
                <Brain className="h-3 w-3 text-purple-500" />
              </span>
            )}
            {hasVision && (
              <span title="Vision">
                <Image className="h-3 w-3 text-green-500" />
              </span>
            )}
          </div>
          {/* Pricing and context info */}
          {(inputPrice || contextSize) && (
            <div className="text-muted-foreground ml-auto flex shrink-0 items-center gap-2 text-xs">
              {inputPrice && outputPrice && (
                <span className="whitespace-nowrap">
                  {inputPrice}/{outputPrice}/M
                </span>
              )}
              {contextSize && (
                <span className="whitespace-nowrap">{contextSize}</span>
              )}
            </div>
          )}
        </div>
      </SelectItem>
    )
  }

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
        onOpenChange={setIsOpen}
        disabled={disabled || isLoading || !baseUrl || !apiKey}
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
          >
            {selectedDisplayValue}
          </SelectValue>
        </SelectTrigger>
        <SelectContent
          className="max-h-[300px]"
          onCloseAutoFocus={(e) => e.preventDefault()}
          header={
            <div
              className="flex items-center border-b px-3 py-2"
              onMouseDown={(e) => e.preventDefault()}
            >
              <Search className="text-muted-foreground mr-2 h-4 w-4 shrink-0" />
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
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault()
                  }
                }}
                onMouseDown={(e) => e.stopPropagation()}
                className="h-auto border-0 p-0 focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            </div>
          }
        >
          {filteredModels.map((model) => renderModelItem(model))}
          {models.length > 0 &&
            filteredModels.length === 0 &&
            searchQuery.trim() && (
              <div className="text-muted-foreground flex items-center justify-center py-4 text-sm">
                No models match "{searchQuery}"
              </div>
            )}
          {models.length === 0 && !isLoading && (
            <div className="text-muted-foreground flex items-center justify-center py-4 text-sm">
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
    </div>
  )
}
