import { useCallback } from "react"
import { Control, ControlGroup, ControlLabel } from "@renderer/components/ui/control"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import { Switch } from "@renderer/components/ui/switch"
import { useConfigQuery, useSaveConfigMutation } from "@renderer/lib/query-client"
import { Config } from "@shared/types"
import { ModelSelector } from "@renderer/components/model-selector"
import { Brain, Zap, Settings2, BookOpen } from "lucide-react"

const PROVIDERS = [
  { label: "OpenAI", value: "openai" },
  { label: "Groq", value: "groq" },
  { label: "Gemini", value: "gemini" },
] as const

const SUMMARIZATION_FREQUENCY = [
  { label: "Every Response", value: "every_response" },
  { label: "Major Steps Only", value: "major_steps_only" },
] as const

const DETAIL_LEVELS = [
  { label: "Compact", value: "compact" },
  { label: "Detailed", value: "detailed" },
] as const

export function Component() {
  const configQuery = useConfigQuery()
  const saveConfigMutation = useSaveConfigMutation()

  const saveConfig = useCallback(
    (config: Partial<Config>) => {
      saveConfigMutation.mutate({
        config: {
          ...configQuery.data,
          ...config,
        },
      })
    },
    [saveConfigMutation, configQuery.data],
  )

  if (!configQuery.data) return null

  const config = configQuery.data
  const isEnabled = config.dualModelEnabled ?? false
  const weakProviderId = config.dualModelWeakProviderId || "openai"
  const strongProviderId = config.dualModelStrongProviderId || config.mcpToolsProviderId || "openai"

  // Get current weak model based on provider
  const getWeakModel = () => {
    switch (weakProviderId) {
      case "openai":
        return config.dualModelWeakOpenaiModel || "gpt-4o-mini"
      case "groq":
        return config.dualModelWeakGroqModel || "llama-3.1-8b-instant"
      case "gemini":
        return config.dualModelWeakGeminiModel || "gemini-1.5-flash-002"
      default:
        return ""
    }
  }

  // Get current strong model based on provider
  const getStrongModel = () => {
    switch (strongProviderId) {
      case "openai":
        return config.dualModelStrongOpenaiModel || config.mcpToolsOpenaiModel || "gpt-4o"
      case "groq":
        return config.dualModelStrongGroqModel || config.mcpToolsGroqModel || "llama-3.3-70b-versatile"
      case "gemini":
        return config.dualModelStrongGeminiModel || config.mcpToolsGeminiModel || "gemini-1.5-pro-002"
      default:
        return ""
    }
  }

  // Handle weak model change
  const handleWeakModelChange = (model: string) => {
    const updates: Partial<Config> = {}
    switch (weakProviderId) {
      case "openai":
        updates.dualModelWeakOpenaiModel = model
        break
      case "groq":
        updates.dualModelWeakGroqModel = model
        break
      case "gemini":
        updates.dualModelWeakGeminiModel = model
        break
    }
    saveConfig(updates)
  }

  // Handle strong model change
  const handleStrongModelChange = (model: string) => {
    const updates: Partial<Config> = {}
    switch (strongProviderId) {
      case "openai":
        updates.dualModelStrongOpenaiModel = model
        break
      case "groq":
        updates.dualModelStrongGroqModel = model
        break
      case "gemini":
        updates.dualModelStrongGeminiModel = model
        break
    }
    saveConfig(updates)
  }

  return (
    <div className="modern-panel h-full overflow-auto px-6 py-4">
      <div className="space-y-8">
        {/* Header */}
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Brain className="h-5 w-5" />
            Dual-Model Agent Mode
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Use a strong model for planning and execution, and a weaker model for summarization.
            This provides better visibility into agent activity without affecting performance.
          </p>
        </div>

        {/* Enable toggle */}
        <ControlGroup title="Enable Dual-Model Mode">
          <Control
            label={
              <ControlLabel
                label="Enable Summarization"
                tooltip="When enabled, a separate model will generate summaries of each agent step"
              />
            }
            className="px-3"
          >
            <Switch
              checked={isEnabled}
              onCheckedChange={(checked) => saveConfig({ dualModelEnabled: checked })}
            />
          </Control>
        </ControlGroup>

        {isEnabled && (
          <>
            {/* Strong Model Configuration */}
            <ControlGroup
              title={
                <span className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-yellow-500" />
                  Strong Model (Planning & Execution)
                </span>
              }
              endDescription="The primary model used for reasoning, tool calls, and task completion. Defaults to your agent model if not set."
            >
              <Control
                label={
                  <ControlLabel
                    label="Provider"
                    tooltip="Select the provider for the strong model"
                  />
                }
                className="px-3"
              >
                <Select
                  value={strongProviderId}
                  onValueChange={(value) =>
                    saveConfig({ dualModelStrongProviderId: value as "openai" | "groq" | "gemini" })
                  }
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((provider) => (
                      <SelectItem key={provider.value} value={provider.value}>
                        {provider.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Control>

              <Control
                label={
                  <ControlLabel
                    label="Model"
                    tooltip="Select the model for planning and execution"
                  />
                }
                className="px-3"
              >
                <ModelSelector
                  providerId={strongProviderId}
                  value={getStrongModel()}
                  onValueChange={handleStrongModelChange}
                  placeholder="Select model..."
                />
              </Control>
            </ControlGroup>

            {/* Weak Model Configuration */}
            <ControlGroup
              title={
                <span className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-blue-500" />
                  Weak Model (Summarization)
                </span>
              }
              endDescription="A faster, cheaper model used to summarize agent steps for the UI and memory storage."
            >
              <Control
                label={
                  <ControlLabel
                    label="Provider"
                    tooltip="Select the provider for the summarization model"
                  />
                }
                className="px-3"
              >
                <Select
                  value={weakProviderId}
                  onValueChange={(value) =>
                    saveConfig({ dualModelWeakProviderId: value as "openai" | "groq" | "gemini" })
                  }
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((provider) => (
                      <SelectItem key={provider.value} value={provider.value}>
                        {provider.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Control>

              <Control
                label={
                  <ControlLabel
                    label="Model"
                    tooltip="Select the model for summarization"
                  />
                }
                className="px-3"
              >
                <ModelSelector
                  providerId={weakProviderId}
                  value={getWeakModel()}
                  onValueChange={handleWeakModelChange}
                  placeholder="Select model..."
                />
              </Control>
            </ControlGroup>

            {/* Summarization Settings */}
            <ControlGroup
              title={
                <span className="flex items-center gap-2">
                  <Settings2 className="h-4 w-4" />
                  Summarization Settings
                </span>
              }
            >
              <Control
                label={
                  <ControlLabel
                    label="Frequency"
                    tooltip="How often to generate summaries"
                  />
                }
                className="px-3"
              >
                <Select
                  value={config.dualModelSummarizationFrequency || "every_response"}
                  onValueChange={(value) =>
                    saveConfig({
                      dualModelSummarizationFrequency: value as "every_response" | "major_steps_only",
                    })
                  }
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUMMARIZATION_FREQUENCY.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Control>

              <Control
                label={
                  <ControlLabel
                    label="Detail Level"
                    tooltip="How detailed the summaries should be"
                  />
                }
                className="px-3"
              >
                <Select
                  value={config.dualModelSummaryDetailLevel || "compact"}
                  onValueChange={(value) =>
                    saveConfig({
                      dualModelSummaryDetailLevel: value as "compact" | "detailed",
                    })
                  }
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DETAIL_LEVELS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Control>

              <Control
                label={
                  <ControlLabel
                    label="Auto-save Important Findings"
                    tooltip="Automatically save high and critical importance summaries to memory"
                  />
                }
                className="px-3"
              >
                <Switch
                  checked={config.dualModelAutoSaveImportant ?? false}
                  onCheckedChange={(checked) =>
                    saveConfig({ dualModelAutoSaveImportant: checked })
                  }
                />
              </Control>
            </ControlGroup>
          </>
        )}
      </div>
    </div>
  )
}

