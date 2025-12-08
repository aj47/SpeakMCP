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
import { ProviderModelSelector } from "@renderer/components/model-selector"
import { ProfileBadgeCompact } from "@renderer/components/profile-badge"

import {
  STT_PROVIDERS,
  CHAT_PROVIDERS,
  TTS_PROVIDERS,
  STT_PROVIDER_ID,
  CHAT_PROVIDER_ID,
  TTS_PROVIDER_ID,
  OPENAI_TTS_MODELS,
  OPENAI_TTS_VOICES,
  GROQ_TTS_MODELS,
  GROQ_TTS_VOICES_ENGLISH,
  GROQ_TTS_VOICES_ARABIC,
  GEMINI_TTS_MODELS,
  GEMINI_TTS_VOICES,
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

          <Control label={<ControlLabel label={<span className="flex items-center gap-1.5">Agent/MCP Tools Provider <ProfileBadgeCompact /></span>} tooltip="Choose which provider to use for agent mode and MCP tool calling. This setting is saved per-profile." />} className="px-3">
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
          <div className="px-3 py-2">
            <ModelPresetManager />
            <p className="text-xs text-muted-foreground mt-3">
              Create presets with individual API keys for different providers (OpenRouter, Together AI, etc.)
            </p>
          </div>

          {/* OpenAI TTS - only shown for native OpenAI preset */}
          <div className="border-t mt-3 pt-3">
            <div className="px-3 pb-2">
              <span className="text-sm font-medium">Text-to-Speech</span>
              <p className="text-xs text-muted-foreground">Only available with native OpenAI API</p>
            </div>
            <Control label={<ControlLabel label="TTS Model" tooltip="Choose the OpenAI TTS model to use" />} className="px-3">
              <Select
                value={configQuery.data.openaiTtsModel || "tts-1"}
                onValueChange={(value) => saveConfig({ openaiTtsModel: value as "tts-1" | "tts-1-hd" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPENAI_TTS_MODELS.map((model) => (
                    <SelectItem key={model.value} value={model.value}>
                      {model.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Control>

            <Control label={<ControlLabel label="TTS Voice" tooltip="Choose the voice for OpenAI TTS" />} className="px-3">
              <Select
                value={configQuery.data.openaiTtsVoice || "alloy"}
                onValueChange={(value) => saveConfig({ openaiTtsVoice: value as "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPENAI_TTS_VOICES.map((voice) => (
                    <SelectItem key={voice.value} value={voice.value}>
                      {voice.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Control>

            <Control label={<ControlLabel label="TTS Speed" tooltip="Speech speed (0.25 to 4.0)" />} className="px-3">
              <Input
                type="number"
                min="0.25"
                max="4.0"
                step="0.25"
                placeholder="1.0"
                defaultValue={configQuery.data.openaiTtsSpeed?.toString()}
                onChange={(e) => {
                  const speed = parseFloat(e.currentTarget.value)
                  if (!isNaN(speed) && speed >= 0.25 && speed <= 4.0) {
                    saveConfig({ openaiTtsSpeed: speed })
                  }
                }}
              />
            </Control>
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

          <div className="px-3 py-2">
            <ProviderModelSelector
              providerId="groq"
              mcpModel={configQuery.data.mcpToolsGroqModel}
              transcriptModel={configQuery.data.transcriptPostProcessingGroqModel}
              onMcpModelChange={(value) => saveConfig({ mcpToolsGroqModel: value })}
              onTranscriptModelChange={(value) => saveConfig({ transcriptPostProcessingGroqModel: value })}
              showMcpModel={true}
              showTranscriptModel={true}
            />
          </div>

          {/* Groq TTS */}
          <div className="border-t mt-3 pt-3">
            <div className="px-3 pb-2">
              <span className="text-sm font-medium">Text-to-Speech</span>
            </div>
            <Control label={<ControlLabel label="TTS Model" tooltip="Choose the Groq TTS model to use" />} className="px-3">
              <Select
                value={configQuery.data.groqTtsModel || "playai-tts"}
                onValueChange={(value) => saveConfig({ groqTtsModel: value as "playai-tts" | "playai-tts-arabic" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GROQ_TTS_MODELS.map((model) => (
                    <SelectItem key={model.value} value={model.value}>
                      {model.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Control>

            <Control label={<ControlLabel label="TTS Voice" tooltip="Choose the voice for Groq TTS" />} className="px-3">
              <Select
                value={configQuery.data.groqTtsVoice || "Fritz-PlayAI"}
                onValueChange={(value) => saveConfig({ groqTtsVoice: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(configQuery.data.groqTtsModel === "playai-tts-arabic" ? GROQ_TTS_VOICES_ARABIC : GROQ_TTS_VOICES_ENGLISH).map((voice) => (
                    <SelectItem key={voice.value} value={voice.value}>
                      {voice.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Control>
          </div>
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

          <div className="px-3 py-2">
            <ProviderModelSelector
              providerId="gemini"
              mcpModel={configQuery.data.mcpToolsGeminiModel}
              transcriptModel={configQuery.data.transcriptPostProcessingGeminiModel}
              onMcpModelChange={(value) => saveConfig({ mcpToolsGeminiModel: value })}
              onTranscriptModelChange={(value) => saveConfig({ transcriptPostProcessingGeminiModel: value })}
              showMcpModel={true}
              showTranscriptModel={true}
            />
          </div>

          {/* Gemini TTS */}
          <div className="border-t mt-3 pt-3">
            <div className="px-3 pb-2">
              <span className="text-sm font-medium">Text-to-Speech</span>
            </div>
            <Control label={<ControlLabel label="TTS Model" tooltip="Choose the Gemini TTS model to use" />} className="px-3">
              <Select
                value={configQuery.data.geminiTtsModel || "gemini-2.5-flash-preview-tts"}
                onValueChange={(value) => saveConfig({ geminiTtsModel: value as "gemini-2.5-flash-preview-tts" | "gemini-2.5-pro-preview-tts" })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GEMINI_TTS_MODELS.map((model) => (
                    <SelectItem key={model.value} value={model.value}>
                      {model.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Control>

            <Control label={<ControlLabel label="TTS Voice" tooltip="Choose the voice for Gemini TTS" />} className="px-3">
              <Select
                value={configQuery.data.geminiTtsVoice || "Kore"}
                onValueChange={(value) => saveConfig({ geminiTtsVoice: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GEMINI_TTS_VOICES.map((voice) => (
                    <SelectItem key={voice.value} value={voice.value}>
                      {voice.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Control>
          </div>
        </ControlGroup>
      </div>
    </div>
  )
}
