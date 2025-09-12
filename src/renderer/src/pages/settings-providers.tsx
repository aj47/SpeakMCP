import { useCallback } from "react"
import { Control, ControlGroup, ControlLabel } from "@renderer/components/ui/control"
import { Input } from "@renderer/components/ui/input"
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

import {
  STT_PROVIDERS,
  CHAT_PROVIDERS,
  TTS_PROVIDERS,
  STT_PROVIDER_ID,
  CHAT_PROVIDER_ID,
  TTS_PROVIDER_ID,
  OPENAI_TTS_VOICES,
  OPENAI_TTS_MODELS,
  GROQ_TTS_VOICES_ENGLISH,
  GROQ_TTS_VOICES_ARABIC,
  GROQ_TTS_MODELS,
  GEMINI_TTS_VOICES,
  GEMINI_TTS_MODELS,
  OPENAI_COMPATIBLE_PRESETS,
  OPENAI_COMPATIBLE_PRESET_ID,
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



  if (!configQuery.data) return null

  return (
    <div className="modern-panel h-full overflow-auto px-6 py-4">

      <div className="grid gap-4">
        <ControlGroup title="Provider Selection">
          <Control label={<ControlLabel label="Voice Transcription Provider" tooltip="Choose which provider to use for speech-to-text transcription" />} className="px-3">
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
          </Control>

          <Control label={<ControlLabel label="Transcript Post-Processing Provider" tooltip="Choose which provider to use for transcript post-processing" />} className="px-3">
            <Select
              value={
                configQuery.data.transcriptPostProcessingProviderId || "openai"
              }
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
          </Control>

          <Control label={<ControlLabel label="Agent/MCP Tools Provider" tooltip="Choose which provider to use for agent mode and MCP tool calling" />} className="px-3">
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
          </Control>

          <Control label={<ControlLabel label="Text-to-Speech Provider" tooltip="Choose which provider to use for text-to-speech generation" />} className="px-3">
            <Select
              value={configQuery.data.ttsProviderId || "openai"}
              onValueChange={(value) => {
                saveConfig({
                  ttsProviderId: value as TTS_PROVIDER_ID,
                })
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TTS_PROVIDERS.map((provider) => (
                  <SelectItem key={provider.value} value={provider.value}>
                    {provider.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Control>
        </ControlGroup>
        <ControlGroup title="OpenAI Compatible">
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

          <Control label={<ControlLabel label="Provider Preset" tooltip="Choose a popular OpenAI-compatible provider or select Custom to enter your own base URL" />} className="px-3">
            <Select
              value={configQuery.data.openaiCompatiblePreset || "openai"}
              onValueChange={(value) => {
                const preset = OPENAI_COMPATIBLE_PRESETS.find(p => p.value === value)
                saveConfig({
                  openaiCompatiblePreset: value as OPENAI_COMPATIBLE_PRESET_ID,
                  // Auto-fill base URL when selecting a preset (except custom)
                  ...(preset && preset.value !== "custom" && {
                    openaiBaseUrl: preset.baseUrl,
                  }),
                })
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPENAI_COMPATIBLE_PRESETS.map((preset) => (
                  <SelectItem key={preset.value} value={preset.value}>
                    <div className="flex flex-col">
                      <span>{preset.label}</span>
                      <span className="text-xs text-muted-foreground">{preset.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Control>

          <Control label="API Base URL" className="px-3">
            <Input
              type="url"
              placeholder="https://api.openai.com/v1"
              value={configQuery.data.openaiBaseUrl || ""}
              disabled={configQuery.data.openaiCompatiblePreset !== "custom"}
              onChange={(e) => {
                saveConfig({
                  openaiBaseUrl: e.currentTarget.value,
                })
              }}
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


        </ControlGroup>
      </div>
    </div>
  )
}
