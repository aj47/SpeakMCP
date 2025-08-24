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

          <Control label={<ControlLabel label="TTS Model" tooltip="Choose the OpenAI TTS model to use" />} className="px-3">
            <Select
              value={configQuery.data.openaiTtsModel || "tts-1"}
              onValueChange={(value) => {
                saveConfig({
                  openaiTtsModel: value as "tts-1" | "tts-1-hd",
                })
              }}
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
              onValueChange={(value) => {
                saveConfig({
                  openaiTtsVoice: value as "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer",
                })
              }}
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
                  saveConfig({
                    openaiTtsSpeed: speed,
                  })
                }
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

          <Control label={<ControlLabel label="TTS Model" tooltip="Choose the Groq TTS model to use" />} className="px-3">
            <Select
              value={configQuery.data.groqTtsModel || "playai-tts"}
              onValueChange={(value) => {
                saveConfig({
                  groqTtsModel: value as "playai-tts" | "playai-tts-arabic",
                })
              }}
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
              onValueChange={(value) => {
                saveConfig({
                  groqTtsVoice: value,
                })
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(configQuery.data.groqTtsModel === "playai-tts-arabic"
                  ? GROQ_TTS_VOICES_ARABIC
                  : GROQ_TTS_VOICES_ENGLISH
                ).map((voice) => (
                  <SelectItem key={voice.value} value={voice.value}>
                    {voice.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

          <Control label={<ControlLabel label="TTS Model" tooltip="Choose the Gemini TTS model to use" />} className="px-3">
            <Select
              value={configQuery.data.geminiTtsModel || "gemini-2.5-flash-preview-tts"}
              onValueChange={(value) => {
                saveConfig({
                  geminiTtsModel: value as "gemini-2.5-flash-preview-tts" | "gemini-2.5-pro-preview-tts",
                })
              }}
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
              onValueChange={(value) => {
                saveConfig({
                  geminiTtsVoice: value,
                })
              }}
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

        </ControlGroup>
      </div>
    </div>
  )
}
