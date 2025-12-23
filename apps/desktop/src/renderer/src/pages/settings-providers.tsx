import { useCallback, useMemo } from "react"
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
import { Mic, Bot, Volume2, FileText, CheckCircle2 } from "lucide-react"

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

// Badge component to show which features are using this provider
function ActiveProviderBadge({ label, icon: Icon }: { label: string; icon: React.ElementType }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
      <Icon className="h-3 w-3" />
      {label}
    </span>
  )
}

// Inline provider selector with visual feedback
function ProviderSelector({
  label,
  tooltip,
  value,
  onChange,
  providers,
  icon: Icon,
  badge,
}: {
  label: React.ReactNode
  tooltip: string
  value: string
  onChange: (value: string) => void
  providers: readonly { label: string; value: string }[]
  icon: React.ElementType
  badge?: React.ReactNode
}) {
  return (
    <Control
      label={
        <ControlLabel
          label={
            <span className="flex items-center gap-2">
              <Icon className="h-4 w-4 text-muted-foreground" />
              {label}
              {badge}
            </span>
          }
          tooltip={tooltip}
        />
      }
      className="px-3"
    >
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-[180px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {providers.map((provider) => (
            <SelectItem key={provider.value} value={provider.value}>
              {provider.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Control>
  )
}

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

  // Compute which providers are actively being used for each function
  const activeProviders = useMemo(() => {
    if (!configQuery.data) return { openai: [], groq: [], gemini: [] }

    const stt = configQuery.data.sttProviderId || "openai"
    const transcript = configQuery.data.transcriptPostProcessingProviderId || "openai"
    const mcp = configQuery.data.mcpToolsProviderId || "openai"
    const tts = configQuery.data.ttsProviderId || "openai"

    return {
      openai: [
        ...(stt === "openai" ? [{ label: "STT", icon: Mic }] : []),
        ...(transcript === "openai" ? [{ label: "Transcript", icon: FileText }] : []),
        ...(mcp === "openai" ? [{ label: "Agent", icon: Bot }] : []),
        ...(tts === "openai" ? [{ label: "TTS", icon: Volume2 }] : []),
      ],
      groq: [
        ...(stt === "groq" ? [{ label: "STT", icon: Mic }] : []),
        ...(transcript === "groq" ? [{ label: "Transcript", icon: FileText }] : []),
        ...(mcp === "groq" ? [{ label: "Agent", icon: Bot }] : []),
        ...(tts === "groq" ? [{ label: "TTS", icon: Volume2 }] : []),
      ],
      gemini: [
        ...(transcript === "gemini" ? [{ label: "Transcript", icon: FileText }] : []),
        ...(mcp === "gemini" ? [{ label: "Agent", icon: Bot }] : []),
        ...(tts === "gemini" ? [{ label: "TTS", icon: Volume2 }] : []),
      ],
    }
  }, [configQuery.data])

  if (!configQuery.data) return null

  return (
    <div className="modern-panel h-full overflow-auto px-6 py-4">

      <div className="grid gap-4">
        {/* Provider Selection with clear visual hierarchy */}
        <ControlGroup title="Provider Selection">
          <div className="px-3 py-2 bg-muted/30 border-b">
            <p className="text-xs text-muted-foreground">
              Select which AI provider to use for each feature. Configure API keys and models in the provider sections below.
            </p>
          </div>

          <ProviderSelector
            label="Voice Transcription (STT)"
            tooltip="Choose which provider to use for speech-to-text transcription."
            value={configQuery.data.sttProviderId || "openai"}
            onChange={(value) => saveConfig({ sttProviderId: value as STT_PROVIDER_ID })}
            providers={STT_PROVIDERS}
            icon={Mic}
          />

          <ProviderSelector
            label="Transcript Post-Processing"
            tooltip="Choose which provider to use for transcript post-processing."
            value={configQuery.data.transcriptPostProcessingProviderId || "openai"}
            onChange={(value) => saveConfig({ transcriptPostProcessingProviderId: value as CHAT_PROVIDER_ID })}
            providers={CHAT_PROVIDERS}
            icon={FileText}
          />

          <ProviderSelector
            label={<span className="flex items-center gap-1.5">Agent/MCP Tools <ProfileBadgeCompact /></span>}
            tooltip="Choose which provider to use for agent mode and MCP tool calling. This setting is saved per-profile."
            value={configQuery.data.mcpToolsProviderId || "openai"}
            onChange={(value) => saveConfig({ mcpToolsProviderId: value as CHAT_PROVIDER_ID })}
            providers={CHAT_PROVIDERS}
            icon={Bot}
          />

          <ProviderSelector
            label="Text-to-Speech (TTS)"
            tooltip="Choose which provider to use for text-to-speech generation."
            value={configQuery.data.ttsProviderId || "openai"}
            onChange={(value) => saveConfig({ ttsProviderId: value as TTS_PROVIDER_ID })}
            providers={TTS_PROVIDERS}
            icon={Volume2}
          />
        </ControlGroup>

        {/* OpenAI Compatible Provider Section */}
        <div className={`rounded-lg border ${activeProviders.openai.length > 0 ? 'border-primary/30 bg-primary/5' : ''}`}>
          <div className="px-3 py-2 flex items-center justify-between w-full">
            <span className="flex items-center gap-2 text-sm font-semibold">
              OpenAI Compatible
              {activeProviders.openai.length > 0 && (
                <CheckCircle2 className="h-4 w-4 text-primary" />
              )}
            </span>
            {activeProviders.openai.length > 0 && (
              <div className="flex gap-1.5 flex-wrap justify-end">
                {activeProviders.openai.map((badge) => (
                  <ActiveProviderBadge key={badge.label} label={badge.label} icon={badge.icon} />
                ))}
              </div>
            )}
          </div>
          <div className="divide-y border-t">
            {activeProviders.openai.length === 0 && (
              <div className="px-3 py-2 bg-muted/30 border-b">
                <p className="text-xs text-muted-foreground">
                  This provider is not currently selected for any feature. Select it above to use it.
                </p>
              </div>
            )}

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
          </div>
        </div>

        {/* Groq Provider Section */}
        <div className={`rounded-lg border ${activeProviders.groq.length > 0 ? 'border-primary/30 bg-primary/5' : ''}`}>
          <div className="px-3 py-2 flex items-center justify-between w-full">
            <span className="flex items-center gap-2 text-sm font-semibold">
              Groq
              {activeProviders.groq.length > 0 && (
                <CheckCircle2 className="h-4 w-4 text-primary" />
              )}
            </span>
            {activeProviders.groq.length > 0 && (
              <div className="flex gap-1.5 flex-wrap justify-end">
                {activeProviders.groq.map((badge) => (
                  <ActiveProviderBadge key={badge.label} label={badge.label} icon={badge.icon} />
                ))}
              </div>
            )}
          </div>
          <div className="divide-y border-t">
            {activeProviders.groq.length === 0 && (
              <div className="px-3 py-2 bg-muted/30 border-b">
                <p className="text-xs text-muted-foreground">
                  This provider is not currently selected for any feature. Select it above to use it.
                </p>
              </div>
            )}

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
          </div>
        </div>

        {/* Gemini Provider Section */}
        <div className={`rounded-lg border ${activeProviders.gemini.length > 0 ? 'border-primary/30 bg-primary/5' : ''}`}>
          <div className="px-3 py-2 flex items-center justify-between w-full">
            <span className="flex items-center gap-2 text-sm font-semibold">
              Gemini
              {activeProviders.gemini.length > 0 && (
                <CheckCircle2 className="h-4 w-4 text-primary" />
              )}
            </span>
            {activeProviders.gemini.length > 0 && (
              <div className="flex gap-1.5 flex-wrap justify-end">
                {activeProviders.gemini.map((badge) => (
                  <ActiveProviderBadge key={badge.label} label={badge.label} icon={badge.icon} />
                ))}
              </div>
            )}
          </div>
          <div className="divide-y border-t">
            {activeProviders.gemini.length === 0 && (
              <div className="px-3 py-2 bg-muted/30 border-b">
                <p className="text-xs text-muted-foreground">
                  This provider is not currently selected for any feature. Select it above to use it.
                </p>
              </div>
            )}

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
          </div>
        </div>
      </div>
    </div>
  )
}
