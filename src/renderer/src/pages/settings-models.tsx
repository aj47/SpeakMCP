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
import { OPENAI_TTS_MODELS, GROQ_TTS_MODELS, GEMINI_TTS_MODELS, OPENAI_TTS_VOICES, GROQ_TTS_VOICES_ENGLISH, GROQ_TTS_VOICES_ARABIC, GEMINI_TTS_VOICES } from "@shared/index"

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

  const handleOpenAITtsModelChange = useCallback(
    (value: string) => {
      saveConfig({ openaiTtsModel: value as "tts-1" | "tts-1-hd" })
    },
    [saveConfig],
  )

  const handleOpenAITtsVoiceChange = useCallback(
    (value: string) => {
      saveConfig({ openaiTtsVoice: value as "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer" })
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

  const handleGroqTtsModelChange = useCallback(
    (value: string) => {
      saveConfig({ groqTtsModel: value as "playai-tts" | "playai-tts-arabic" })
    },
    [saveConfig],
  )

  const handleGroqTtsVoiceChange = useCallback(
    (value: string) => {
      saveConfig({ groqTtsVoice: value })
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

  const handleGeminiTtsModelChange = useCallback(
    (value: string) => {
      saveConfig({ geminiTtsModel: value as "gemini-2.5-flash-preview-tts" | "gemini-2.5-pro-preview-tts" })
    },
    [saveConfig],
  )

  const handleGeminiTtsVoiceChange = useCallback(
    (value: string) => {
      saveConfig({ geminiTtsVoice: value })
    },
    [saveConfig],
  )

  if (!configQuery.data) return null

  return (
    <div className="modern-panel h-full overflow-auto px-6 py-4">

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

            <Control label={<ControlLabel label="TTS Model" tooltip="Choose the OpenAI TTS model to use" />} className="px-3">
              <Select
                value={configQuery.data.openaiTtsModel || "tts-1"}
                onValueChange={handleOpenAITtsModelChange}
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
                onValueChange={handleOpenAITtsVoiceChange}
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

            <Control label={<ControlLabel label="TTS Model" tooltip="Choose the Groq TTS model to use" />} className="px-3">
              <Select
                value={configQuery.data.groqTtsModel || "playai-tts"}
                onValueChange={handleGroqTtsModelChange}
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
                onValueChange={handleGroqTtsVoiceChange}
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

            <Control label={<ControlLabel label="TTS Model" tooltip="Choose the Gemini TTS model to use" />} className="px-3">
              <Select
                value={configQuery.data.geminiTtsModel || "gemini-2.5-flash-preview-tts"}
                onValueChange={handleGeminiTtsModelChange}
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
                onValueChange={handleGeminiTtsVoiceChange}
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
