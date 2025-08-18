import { useCallback } from "react"
import { Control, ControlGroup, ControlLabel } from "@renderer/components/ui/control"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import {
  useConfigQuery,
  useSaveConfigMutation,
} from "@renderer/lib/query-client"
import { Config } from "@shared/types"
import { ProviderModelSelector } from "@renderer/components/model-selector"
import {
  CHAT_PROVIDER_ID,
} from "@shared/index"

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

  // Memoize model change handlers to prevent infinite re-renders
  const handleOpenAIMcpModelChange = useCallback(
    (value: string) => {
      saveConfig({ mcpToolsOpenaiModel: value })
    },
    [saveConfig],
  )

  const handleOpenAITranscriptModelChange = useCallback(
    (value: string) => {
      saveConfig({ transcriptPostProcessingOpenaiModel: value })
    },
    [saveConfig],
  )

  const handleGroqMcpModelChange = useCallback(
    (value: string) => {
      saveConfig({ mcpToolsGroqModel: value })
    },
    [saveConfig],
  )

  const handleGroqTranscriptModelChange = useCallback(
    (value: string) => {
      saveConfig({ transcriptPostProcessingGroqModel: value })
    },
    [saveConfig],
  )

  const handleGeminiMcpModelChange = useCallback(
    (value: string) => {
      saveConfig({ mcpToolsGeminiModel: value })
    },
    [saveConfig],
  )

  const handleGeminiTranscriptModelChange = useCallback(
    (value: string) => {
      saveConfig({ transcriptPostProcessingGeminiModel: value })
    },
    [saveConfig],
  )

  if (!configQuery.data) return null

  return (
    <div className="modern-panel h-full overflow-auto px-6 py-4">
      <header className="modern-card modern-border mb-5 rounded-lg p-4">
        <h2 className="text-2xl font-bold">Model Settings</h2>
        <p className="text-muted-foreground">
          Configure AI models for MCP tools and transcript processing across all providers
        </p>
      </header>

      <div className="grid gap-4">
        <ControlGroup title="OpenAI Models">
          <div className="space-y-4 p-3 sm:p-4">
            <ProviderModelSelector
              providerId="openai"
              mcpModel={configQuery.data.mcpToolsOpenaiModel}
              transcriptModel={configQuery.data.transcriptPostProcessingOpenaiModel}
              onMcpModelChange={handleOpenAIMcpModelChange}
              onTranscriptModelChange={handleOpenAITranscriptModelChange}
              showMcpModel={true}
              showTranscriptModel={true}
            />
          </div>
        </ControlGroup>

        <ControlGroup title="Groq Models">
          <div className="space-y-4 p-3 sm:p-4">
            <ProviderModelSelector
              providerId="groq"
              mcpModel={configQuery.data.mcpToolsGroqModel}
              transcriptModel={configQuery.data.transcriptPostProcessingGroqModel}
              onMcpModelChange={handleGroqMcpModelChange}
              onTranscriptModelChange={handleGroqTranscriptModelChange}
              showMcpModel={true}
              showTranscriptModel={true}
            />
          </div>
        </ControlGroup>

        <ControlGroup title="Gemini Models">
          <div className="space-y-4 p-3 sm:p-4">
            <ProviderModelSelector
              providerId="gemini"
              mcpModel={configQuery.data.mcpToolsGeminiModel}
              transcriptModel={configQuery.data.transcriptPostProcessingGeminiModel}
              onMcpModelChange={handleGeminiMcpModelChange}
              onTranscriptModelChange={handleGeminiTranscriptModelChange}
              showMcpModel={true}
              showTranscriptModel={true}
            />
          </div>
        </ControlGroup>
      </div>
    </div>
  )
}
