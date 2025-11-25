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
import { ModelPresetManager } from "@renderer/components/model-preset-manager"

import {
  STT_PROVIDERS,
  CHAT_PROVIDERS,
  TTS_PROVIDERS,
  STT_PROVIDER_ID,
  CHAT_PROVIDER_ID,
  TTS_PROVIDER_ID,
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
        <ControlGroup title="OpenAI Compatible Presets">
          <div className="px-3 py-2">
            <ModelPresetManager />
            <p className="text-xs text-muted-foreground mt-3">
              Create presets with individual API keys for different providers (OpenRouter, Together AI, etc.)
            </p>
          </div>
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
