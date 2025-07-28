import { useCallback } from "react"
import { Control, ControlGroup } from "@renderer/components/ui/control"
import { Input } from "@renderer/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@renderer/components/ui/select"
import {
  useConfigQuery,
  useSaveConfigMutation,
} from "@renderer/lib/query-client"
import { Config } from "@shared/types"
import { ProviderModelSelector } from "@renderer/components/model-selector"
import { STT_PROVIDERS, CHAT_PROVIDERS, STT_PROVIDER_ID, CHAT_PROVIDER_ID } from "@shared/index"

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
    <div className="h-full overflow-auto px-6 py-4 liquid-glass-panel">
      <header className="mb-5 liquid-glass-card glass-border rounded-lg p-4 glass-shadow">
        <h2 className="text-2xl font-bold">Providers</h2>
      </header>

      <div className="grid gap-4">
      <ControlGroup title="Provider Selection">
        <Control label="Voice Transcription Provider" className="px-3">
          <Select
            value={configQuery.data.sttProviderId || "openai"}
            onValueChange={(value) => {
              saveConfig({
                sttProviderId: value as STT_PROVIDER_ID,
              })
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STT_PROVIDERS.map((provider) => (
                <SelectItem key={provider.value} value={provider.value}>
                  {provider.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">
            Choose which provider to use for speech-to-text transcription
          </p>
        </Control>

        <Control label="Transcript Post-Processing Provider" className="px-3">
          <Select
            value={configQuery.data.transcriptPostProcessingProviderId || "openai"}
            onValueChange={(value) => {
              saveConfig({
                transcriptPostProcessingProviderId: value as CHAT_PROVIDER_ID,
              })
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHAT_PROVIDERS.map((provider) => (
                <SelectItem key={provider.value} value={provider.value}>
                  {provider.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">
            Choose which provider to use for transcript post-processing
          </p>
        </Control>

        <Control label="Agent/MCP Tools Provider" className="px-3">
          <Select
            value={configQuery.data.mcpToolsProviderId || "openai"}
            onValueChange={(value) => {
              saveConfig({
                mcpToolsProviderId: value as CHAT_PROVIDER_ID,
              })
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHAT_PROVIDERS.map((provider) => (
                <SelectItem key={provider.value} value={provider.value}>
                  {provider.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">
            Choose which provider to use for agent mode and MCP tool calling
          </p>
        </Control>
      </ControlGroup>
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
            showMcpModel={configQuery.data.mcpToolsProviderId === "openai"}
            showTranscriptModel={configQuery.data.transcriptPostProcessingProviderId === "openai"}
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
            showMcpModel={configQuery.data.mcpToolsProviderId === "groq"}
            showTranscriptModel={configQuery.data.transcriptPostProcessingProviderId === "groq"}
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
            showMcpModel={configQuery.data.mcpToolsProviderId === "gemini"}
            showTranscriptModel={configQuery.data.transcriptPostProcessingProviderId === "gemini"}
            disabled={!configQuery.data.geminiApiKey}
          />
        </Control>
      </ControlGroup>
      </div>
    </div>
  )
}
