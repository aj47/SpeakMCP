import { useCallback } from "react"
import { Control, ControlGroup } from "@renderer/components/ui/control"
import { Input } from "@renderer/components/ui/input"
import {
  useConfigQuery,
  useSaveConfigMutation,
} from "@renderer/lib/query-client"
import { Config } from "@shared/types"
import { ProviderModelSelector } from "@renderer/components/model-selector"

export function Component() {
  const configQuery = useConfigQuery()

  const saveConfigMutation = useSaveConfigMutation()

  const saveConfig = useCallback((config: Partial<Config>) => {
    saveConfigMutation.mutate({
      config: {
        ...configQuery.data,
        ...config,
      },
    })
  }, [saveConfigMutation, configQuery.data])

  // Memoize model change handlers to prevent infinite re-renders
  const handleOpenAIMcpModelChange = useCallback((value: string) => {
    saveConfig({ mcpToolsOpenaiModel: value })
  }, [saveConfig])

  const handleOpenAITranscriptModelChange = useCallback((value: string) => {
    saveConfig({ transcriptPostProcessingOpenaiModel: value })
  }, [saveConfig])

  const handleGroqMcpModelChange = useCallback((value: string) => {
    saveConfig({ mcpToolsGroqModel: value })
  }, [saveConfig])

  const handleGroqTranscriptModelChange = useCallback((value: string) => {
    saveConfig({ transcriptPostProcessingGroqModel: value })
  }, [saveConfig])

  const handleGeminiMcpModelChange = useCallback((value: string) => {
    saveConfig({ mcpToolsGeminiModel: value })
  }, [saveConfig])

  const handleGeminiTranscriptModelChange = useCallback((value: string) => {
    saveConfig({ transcriptPostProcessingGeminiModel: value })
  }, [saveConfig])

  if (!configQuery.data) return null

  return (
    <div className="grid gap-4">
      <ControlGroup title="OpenAI">
        <Control label="API Key" className="px-3">
          <Input
            type="password"
            defaultValue={configQuery.data.openaiApiKey}
            onChange={(e) => {
              saveConfig({
                openaiApiKey: e.currentTarget.value,
              })
            }}
          />
        </Control>

        <Control label="API Base URL" className="px-3">
          <Input
            type="url"
            placeholder="https://api.openai.com/v1"
            defaultValue={configQuery.data.openaiBaseUrl}
            onChange={(e) => {
              saveConfig({
                openaiBaseUrl: e.currentTarget.value,
              })
            }}
          />
        </Control>

        <Control label="Models" className="px-3">
          <ProviderModelSelector
            providerId="openai"
            mcpModel={configQuery.data.mcpToolsOpenaiModel}
            transcriptModel={configQuery.data.transcriptPostProcessingOpenaiModel}
            onMcpModelChange={handleOpenAIMcpModelChange}
            onTranscriptModelChange={handleOpenAITranscriptModelChange}
            disabled={!configQuery.data.openaiApiKey}
          />
        </Control>
      </ControlGroup>

      <ControlGroup title="Groq">
        <Control label="API Key" className="px-3">
          <Input
            type="password"
            defaultValue={configQuery.data.groqApiKey}
            onChange={(e) => {
              saveConfig({
                groqApiKey: e.currentTarget.value,
              })
            }}
          />
        </Control>

        <Control label="API Base URL" className="px-3">
          <Input
            type="url"
            placeholder="https://api.groq.com/openai/v1"
            defaultValue={configQuery.data.groqBaseUrl}
            onChange={(e) => {
              saveConfig({
                groqBaseUrl: e.currentTarget.value,
              })
            }}
          />
        </Control>

        <Control label="Models" className="px-3">
          <ProviderModelSelector
            providerId="groq"
            mcpModel={configQuery.data.mcpToolsGroqModel}
            transcriptModel={configQuery.data.transcriptPostProcessingGroqModel}
            onMcpModelChange={handleGroqMcpModelChange}
            onTranscriptModelChange={handleGroqTranscriptModelChange}
            disabled={!configQuery.data.groqApiKey}
          />
        </Control>
      </ControlGroup>

      <ControlGroup title="Gemini">
        <Control label="API Key" className="px-3">
          <Input
            type="password"
            defaultValue={configQuery.data.geminiApiKey}
            onChange={(e) => {
              saveConfig({
                geminiApiKey: e.currentTarget.value,
              })
            }}
          />
        </Control>

        <Control label="API Base URL" className="px-3">
          <Input
            type="url"
            placeholder="https://generativelanguage.googleapis.com"
            defaultValue={configQuery.data.geminiBaseUrl}
            onChange={(e) => {
              saveConfig({
                geminiBaseUrl: e.currentTarget.value,
              })
            }}
          />
        </Control>

        <Control label="Models" className="px-3">
          <ProviderModelSelector
            providerId="gemini"
            mcpModel={configQuery.data.mcpToolsGeminiModel}
            transcriptModel={configQuery.data.transcriptPostProcessingGeminiModel}
            onMcpModelChange={handleGeminiMcpModelChange}
            onTranscriptModelChange={handleGeminiTranscriptModelChange}
            disabled={!configQuery.data.geminiApiKey}
          />
        </Control>
      </ControlGroup>
    </div>
  )
}
