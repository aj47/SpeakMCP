import { useState, useEffect, useMemo } from "react"
import { Label } from "./ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select"
import { AlertCircle, RefreshCw, Wrench, Brain, Image } from "lucide-react"
import { Button } from "./ui/button"
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

/** Map baseUrl to models.dev provider ID */
function getModelsDevProviderId(baseUrl: string): string {
  if (baseUrl.includes("openrouter.ai")) return "openrouter"
  if (baseUrl.includes("api.openai.com")) return "openai"
  if (baseUrl.includes("api.together.xyz")) return "together"
  if (baseUrl.includes("api.cerebras.ai")) return "cerebras"
  if (baseUrl.includes("api.perplexity.ai")) return "perplexity"
  if (baseUrl.includes("api.groq.com")) return "groq"
  // Default to openai for unknown providers
  return "openai"
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
  const [modelsDevData, setModelsDevData] = useState<Record<string, ModelsDevModel>>({})

  const providerId = useMemo(() => getModelsDevProviderId(baseUrl), [baseUrl])

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

  // Fetch models.dev data for enriched display
  useEffect(() => {
    const fetchModelsDevInfo = async () => {
      if (models.length === 0) return

      try {
        const data = await tipcClient.getModelsDevData()
        if (data && data[providerId]?.models) {
          setModelsDevData(data[providerId].models)
        }
      } catch {
        // Silently fail - models.dev data is optional enhancement
      }
    }

    fetchModelsDevInfo()
  }, [models, providerId])

  useEffect(() => {
    if (baseUrl && apiKey) {
      fetchModels()
    }
  }, [baseUrl, apiKey])

  const hasError = !!error && models.length === 0

  /** Get models.dev info for a specific model */
  const getModelInfo = (modelId: string): ModelsDevModel | undefined => {
    // Try exact match first
    if (modelsDevData[modelId]) return modelsDevData[modelId]

    // For OpenRouter models (format: provider/model), try the model part
    if (modelId.includes("/")) {
      const modelPart = modelId.split("/")[1]
      if (modelsDevData[modelPart]) return modelsDevData[modelPart]
    }

    return undefined
  }

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
        <div className="flex flex-col gap-0.5 py-0.5">
          <div className="flex items-center gap-2">
            <span>{model.name}</span>
            {/* Capability indicators */}
            <div className="flex items-center gap-1">
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
          </div>
          {/* Pricing and context info */}
          {(inputPrice || contextSize) && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {inputPrice && outputPrice && (
                <span>{inputPrice}/{outputPrice}/M</span>
              )}
              {contextSize && (
                <span>{contextSize}</span>
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
          {models.map((model) => renderModelItem(model))}
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

