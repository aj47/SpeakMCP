import { useCallback, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Control, ControlGroup, ControlLabel } from "@renderer/components/ui/control"
import { Input } from "@renderer/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import { Switch } from "@renderer/components/ui/switch"
import { Button } from "@renderer/components/ui/button"
import {
  useConfigQuery,
  useSaveConfigMutation,
} from "@renderer/lib/query-client"
import { Config, ModelPreset } from "@shared/types"
import { ModelPresetManager } from "@renderer/components/model-preset-manager"
import { ProviderModelSelector } from "@renderer/components/model-selector"
import { PresetModelSelector } from "@renderer/components/preset-model-selector"
import { ProfileBadgeCompact } from "@renderer/components/profile-badge"
import { Mic, Bot, Volume2, FileText, CheckCircle2, ChevronDown, ChevronRight, Brain, Zap, BookOpen, Settings2, Cpu, Download, Loader2 } from "lucide-react"

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
  KITTEN_TTS_VOICES,
  getBuiltInModelPresets,
  DEFAULT_MODEL_PRESET_ID,
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

// Parakeet Model Download Component
function ParakeetModelDownload() {
  const queryClient = useQueryClient()
  const [isDownloading, setIsDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState(0)

  const modelStatusQuery = useQuery({
    queryKey: ["parakeetModelStatus"],
    queryFn: () => window.electron.ipcRenderer.invoke("getParakeetModelStatus"),
    refetchInterval: isDownloading ? 500 : false,
  })

  const handleDownload = async () => {
    setIsDownloading(true)
    setDownloadProgress(0)
    try {
      await window.electron.ipcRenderer.invoke("downloadParakeetModel")
      queryClient.invalidateQueries({ queryKey: ["parakeetModelStatus"] })
    } catch (error) {
      console.error("Failed to download Parakeet model:", error)
    } finally {
      setIsDownloading(false)
    }
  }

  const status = modelStatusQuery.data as { downloaded: boolean; downloading: boolean; progress: number; error?: string } | undefined

  if (modelStatusQuery.isLoading) {
    return <span className="text-xs text-muted-foreground">Checking...</span>
  }

  if (status?.downloaded) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-green-600">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Model Ready
      </span>
    )
  }

  if (status?.downloading || isDownloading) {
    const progress = status?.progress ?? downloadProgress
    return (
      <div className="flex flex-col gap-1.5 w-full">
        <div className="flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span className="text-xs text-muted-foreground">
            Downloading... {Math.round(progress * 100)}%
          </span>
        </div>
        <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-200"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>
    )
  }

  if (status?.error) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-destructive">{status.error}</span>
        <Button size="sm" variant="outline" onClick={handleDownload}>
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Retry Download
        </Button>
      </div>
    )
  }

  return (
    <Button size="sm" variant="outline" onClick={handleDownload}>
      <Download className="h-3.5 w-3.5 mr-1.5" />
      Download Model (~200MB)
    </Button>
  )
}

// Parakeet Provider Section Component
function ParakeetProviderSection({
  isActive,
  isCollapsed,
  onToggleCollapse,
  usageBadges,
  numThreads,
  onNumThreadsChange,
}: {
  isActive: boolean
  isCollapsed: boolean
  onToggleCollapse: () => void
  usageBadges: { label: string; icon: React.ElementType }[]
  numThreads: number
  onNumThreadsChange: (value: number) => void
}) {
  return (
    <div className={`rounded-lg border ${isActive ? 'border-primary/30 bg-primary/5' : ''}`}>
      <button
        type="button"
        className="px-3 py-2 flex items-center justify-between w-full hover:bg-muted/30 transition-colors cursor-pointer"
        onClick={onToggleCollapse}
        aria-expanded={!isCollapsed}
        aria-controls="parakeet-provider-content"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
          <Cpu className="h-4 w-4" />
          Parakeet (Local)
          {isActive && (
            <CheckCircle2 className="h-4 w-4 text-primary" />
          )}
        </span>
        {isActive && usageBadges.length > 0 && (
          <div className="flex gap-1.5 flex-wrap justify-end">
            {usageBadges.map((badge) => (
              <ActiveProviderBadge key={badge.label} label={badge.label} icon={badge.icon} />
            ))}
          </div>
        )}
      </button>
      {!isCollapsed && (
        <div id="parakeet-provider-content" className="divide-y border-t">
          <div className="px-3 py-2 bg-muted/30 border-b">
            <p className="text-xs text-muted-foreground">
              {isActive
                ? "Local speech-to-text using NVIDIA Parakeet. No API key required - runs entirely on your device."
                : "This provider is not currently selected for any feature. Select it above to use it."}
            </p>
          </div>

          {/* Model Download Section */}
          <Control
            label={
              <ControlLabel
                label="Model Status"
                tooltip="Download the Parakeet model (~200MB) for local transcription"
              />
            }
            className="px-3"
          >
            <ParakeetModelDownload />
          </Control>

          {/* Thread Count */}
          <Control
            label={
              <ControlLabel
                label="CPU Threads"
                tooltip="Number of CPU threads to use for transcription (higher = faster but uses more resources)"
              />
            }
            className="px-3"
          >
            <Select
              value={String(numThreads)}
              onValueChange={(value) => onNumThreadsChange(parseInt(value))}
            >
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 thread</SelectItem>
                <SelectItem value="2">2 threads</SelectItem>
                <SelectItem value="4">4 threads</SelectItem>
                <SelectItem value="8">8 threads</SelectItem>
              </SelectContent>
            </Select>
          </Control>
        </div>
      )}
    </div>
  )
}

// Kitten Model Download Component
function KittenModelDownload() {
  const queryClient = useQueryClient()
  const [isDownloading, setIsDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState(0)

  const modelStatusQuery = useQuery({
    queryKey: ["kittenModelStatus"],
    queryFn: () => window.electron.ipcRenderer.invoke("getKittenModelStatus"),
    refetchInterval: isDownloading ? 500 : false,
  })

  const handleDownload = async () => {
    setIsDownloading(true)
    setDownloadProgress(0)
    try {
      await window.electron.ipcRenderer.invoke("downloadKittenModel")
      queryClient.invalidateQueries({ queryKey: ["kittenModelStatus"] })
    } catch (error) {
      console.error("Failed to download Kitten model:", error)
    } finally {
      setIsDownloading(false)
    }
  }

  const status = modelStatusQuery.data as { downloaded: boolean; downloading: boolean; progress: number; error?: string } | undefined

  if (modelStatusQuery.isLoading) {
    return <span className="text-xs text-muted-foreground">Checking...</span>
  }

  if (status?.downloaded) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-green-600">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Model Ready
      </span>
    )
  }

  if (status?.downloading || isDownloading) {
    const progress = status?.progress ?? downloadProgress
    return (
      <div className="flex flex-col gap-1.5 w-full">
        <div className="flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span className="text-xs text-muted-foreground">
            Downloading... {Math.round(progress * 100)}%
          </span>
        </div>
        <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-200"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>
    )
  }

  if (status?.error) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-destructive">{status.error}</span>
        <Button size="sm" variant="outline" onClick={handleDownload}>
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Retry Download
        </Button>
      </div>
    )
  }

  return (
    <Button size="sm" variant="outline" onClick={handleDownload}>
      <Download className="h-3.5 w-3.5 mr-1.5" />
      Download Model (~24MB)
    </Button>
  )
}

// Kitten Provider Section Component
function KittenProviderSection({
  isActive,
  isCollapsed,
  onToggleCollapse,
  usageBadges,
  voiceId,
  onVoiceIdChange,
}: {
  isActive: boolean
  isCollapsed: boolean
  onToggleCollapse: () => void
  usageBadges: { label: string; icon: React.ElementType }[]
  voiceId: number
  onVoiceIdChange: (value: number) => void
}) {
  // Query model status to determine if voice controls should be shown
  const modelStatusQuery = useQuery({
    queryKey: ["kittenModelStatus"],
    queryFn: () => window.electron.ipcRenderer.invoke("getKittenModelStatus"),
  })
  const modelDownloaded = (modelStatusQuery.data as { downloaded: boolean } | undefined)?.downloaded ?? false
  const handleTestVoice = async () => {
    try {
      await window.electron.ipcRenderer.invoke("synthesizeWithKitten", {
        text: "Hello! This is a test of the Kitten text to speech voice.",
        voiceId,
      })
    } catch (error) {
      console.error("Failed to test Kitten voice:", error)
    }
  }

  return (
    <div className={`rounded-lg border ${isActive ? 'border-primary/30 bg-primary/5' : ''}`}>
      <button
        type="button"
        className="px-3 py-2 flex items-center justify-between w-full hover:bg-muted/30 transition-colors cursor-pointer"
        onClick={onToggleCollapse}
        aria-expanded={!isCollapsed}
        aria-controls="kitten-provider-content"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
          <Volume2 className="h-4 w-4" />
          Kitten (Local)
          {isActive && (
            <CheckCircle2 className="h-4 w-4 text-primary" />
          )}
        </span>
        {isActive && usageBadges.length > 0 && (
          <div className="flex gap-1.5 flex-wrap justify-end">
            {usageBadges.map((badge) => (
              <ActiveProviderBadge key={badge.label} label={badge.label} icon={badge.icon} />
            ))}
          </div>
        )}
      </button>
      {!isCollapsed && (
        <div id="kitten-provider-content" className="divide-y border-t">
          <div className="px-3 py-2 bg-muted/30 border-b">
            <p className="text-xs text-muted-foreground">
              {isActive
                ? "Local text-to-speech using Kitten TTS. No API key required - runs entirely on your device."
                : "This provider is not currently selected for any feature. Select it above to use it."}
            </p>
          </div>

          {/* Model Download Section */}
          <Control
            label={
              <ControlLabel
                label="Model Status"
                tooltip="Download the Kitten TTS model (~24MB) for local speech synthesis"
              />
            }
            className="px-3"
          >
            <KittenModelDownload />
          </Control>

          {/* Voice Selection - only shown when model is downloaded */}
          {modelDownloaded && (
            <>
              <Control
                label={
                  <ControlLabel
                    label="Voice"
                    tooltip="Select the voice to use for text-to-speech synthesis"
                  />
                }
                className="px-3"
              >
                <Select
                  value={String(voiceId)}
                  onValueChange={(value) => onVoiceIdChange(parseInt(value))}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KITTEN_TTS_VOICES.map((voice) => (
                      <SelectItem key={voice.value} value={String(voice.value)}>
                        {voice.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Control>

              {/* Test Voice Button */}
              <Control
                label={
                  <ControlLabel
                    label="Test Voice"
                    tooltip="Play a sample phrase using the selected voice"
                  />
                }
                className="px-3"
              >
                <Button size="sm" variant="outline" onClick={handleTestVoice}>
                  <Volume2 className="h-3.5 w-3.5 mr-1.5" />
                  Test Voice
                </Button>
              </Control>
            </>
          )}
        </div>
      )}
    </div>
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
    if (!configQuery.data) return { openai: [], groq: [], gemini: [], parakeet: [], kitten: [] }

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
      parakeet: [
        ...(stt === "parakeet" ? [{ label: "STT", icon: Mic }] : []),
      ],
      kitten: [
        ...(tts === "kitten" ? [{ label: "TTS", icon: Volume2 }] : []),
      ],
    }
  }, [configQuery.data])

  // Determine which providers are active (selected for at least one feature)
  const isGroqActive = activeProviders.groq.length > 0
  const isGeminiActive = activeProviders.gemini.length > 0
  const isParakeetActive = activeProviders.parakeet.length > 0
  const isKittenActive = activeProviders.kitten.length > 0

  // Get all available presets for dual-model selection
  const allPresets = useMemo(() => {
    const builtIn = getBuiltInModelPresets()
    const custom = configQuery.data?.modelPresets || []

    // Merge built-in presets with any saved data
    const mergedBuiltIn = builtIn.map(preset => {
      const saved = custom.find(c => c.id === preset.id)
      if (saved) {
        return { ...preset, ...saved }
      }
      return preset
    })

    // Add custom (non-built-in) presets
    const customOnly = custom.filter(c => !c.isBuiltIn)
    return [...mergedBuiltIn, ...customOnly]
  }, [configQuery.data?.modelPresets])

  // Get preset by ID helper
  const getPresetById = (presetId: string | undefined): ModelPreset | undefined => {
    if (!presetId) return undefined
    return allPresets.find(p => p.id === presetId)
  }

  if (!configQuery.data) return null

  const config = configQuery.data
  const dualModelEnabled = config.dualModelEnabled ?? false
  const strongPresetId = config.dualModelStrongPresetId || config.currentModelPresetId || DEFAULT_MODEL_PRESET_ID
  const weakPresetId = config.dualModelWeakPresetId || config.currentModelPresetId || DEFAULT_MODEL_PRESET_ID
  const strongPreset = getPresetById(strongPresetId)
  const weakPreset = getPresetById(weakPresetId)

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
          <button
            type="button"
            className="px-3 py-2 flex items-center justify-between w-full hover:bg-muted/30 transition-colors cursor-pointer"
            onClick={() => saveConfig({ providerSectionCollapsedOpenai: !configQuery.data.providerSectionCollapsedOpenai })}
            aria-expanded={!configQuery.data.providerSectionCollapsedOpenai}
            aria-controls="openai-provider-content"
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              {configQuery.data.providerSectionCollapsedOpenai ? (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
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
          </button>
          {!configQuery.data.providerSectionCollapsedOpenai && (
            <div id="openai-provider-content" className="divide-y border-t">
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

              {/* Summarization Model - shown when dual model is enabled */}
              {dualModelEnabled && (
                <div className="px-3 py-3 border-t bg-muted/20">
                  <div className="flex items-center gap-2 mb-2">
                    <BookOpen className="h-4 w-4 text-blue-500" />
                    <span className="text-sm font-medium">Summarization Model</span>
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">
                    Faster, cheaper model for summarizing agent steps.
                  </p>
                  <div className="space-y-2">
                    <Control
                      label={<ControlLabel label="Preset" tooltip="Select which model preset to use for summarization" />}
                    >
                      <Select
                        value={weakPresetId}
                        onValueChange={(value) => saveConfig({ dualModelWeakPresetId: value })}
                      >
                        <SelectTrigger className="w-[200px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {allPresets.map((preset) => (
                            <SelectItem key={preset.id} value={preset.id}>
                              {preset.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Control>
                    {weakPreset && (
                      <PresetModelSelector
                        presetId={weakPresetId}
                        baseUrl={weakPreset.baseUrl}
                        apiKey={weakPreset.apiKey}
                        value={config.dualModelWeakModelName || ""}
                        onValueChange={(value) => saveConfig({ dualModelWeakModelName: value })}
                        label="Model"
                        placeholder="Select model..."
                      />
                    )}
                    <Control
                      label={<ControlLabel label="Frequency" tooltip="How often to generate summaries" />}
                    >
                      <Select
                        value={config.dualModelSummarizationFrequency || "every_response"}
                        onValueChange={(value) =>
                          saveConfig({ dualModelSummarizationFrequency: value as "every_response" | "major_steps_only" })
                        }
                      >
                        <SelectTrigger className="w-[180px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="every_response">Every Response</SelectItem>
                          <SelectItem value="major_steps_only">Major Steps Only</SelectItem>
                        </SelectContent>
                      </Select>
                    </Control>
                    <Control
                      label={<ControlLabel label="Detail Level" tooltip="How detailed the summaries should be" />}
                    >
                      <Select
                        value={config.dualModelSummaryDetailLevel || "compact"}
                        onValueChange={(value) =>
                          saveConfig({ dualModelSummaryDetailLevel: value as "compact" | "detailed" })
                        }
                      >
                        <SelectTrigger className="w-[180px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="compact">Compact</SelectItem>
                          <SelectItem value="detailed">Detailed</SelectItem>
                        </SelectContent>
                      </Select>
                    </Control>
                  </div>
                </div>
              )}

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
          )}
        </div>

        {/* Groq Provider Section - rendered in order based on active status */}
        {isGroqActive && (
          <div className="rounded-lg border border-primary/30 bg-primary/5">
            <button
              type="button"
              className="px-3 py-2 flex items-center justify-between w-full hover:bg-muted/30 transition-colors cursor-pointer"
              onClick={() => saveConfig({ providerSectionCollapsedGroq: !configQuery.data.providerSectionCollapsedGroq })}
              aria-expanded={!configQuery.data.providerSectionCollapsedGroq}
              aria-controls="groq-provider-content"
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                {configQuery.data.providerSectionCollapsedGroq ? (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
                Groq
                <CheckCircle2 className="h-4 w-4 text-primary" />
              </span>
              <div className="flex gap-1.5 flex-wrap justify-end">
                {activeProviders.groq.map((badge) => (
                  <ActiveProviderBadge key={badge.label} label={badge.label} icon={badge.icon} />
                ))}
              </div>
            </button>
            {!configQuery.data.providerSectionCollapsedGroq && (
              <div id="groq-provider-content" className="divide-y border-t">
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
                      value={configQuery.data.groqTtsModel || "canopylabs/orpheus-v1-english"}
                      onValueChange={(value) => {
                        // Reset voice to appropriate default when model changes
                        const defaultVoice = value === "canopylabs/orpheus-arabic-saudi" ? "fahad" : "troy"
                        saveConfig({
                          groqTtsModel: value as "canopylabs/orpheus-v1-english" | "canopylabs/orpheus-arabic-saudi",
                          groqTtsVoice: defaultVoice
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
                      value={configQuery.data.groqTtsVoice || (configQuery.data.groqTtsModel === "canopylabs/orpheus-arabic-saudi" ? "fahad" : "troy")}
                      onValueChange={(value) => saveConfig({ groqTtsVoice: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(configQuery.data.groqTtsModel === "canopylabs/orpheus-arabic-saudi" ? GROQ_TTS_VOICES_ARABIC : GROQ_TTS_VOICES_ENGLISH).map((voice) => (
                          <SelectItem key={voice.value} value={voice.value}>
                            {voice.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Control>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Gemini Provider Section - rendered in order based on active status */}
        {isGeminiActive && (
          <div className="rounded-lg border border-primary/30 bg-primary/5">
            <button
              type="button"
              className="px-3 py-2 flex items-center justify-between w-full hover:bg-muted/30 transition-colors cursor-pointer"
              onClick={() => saveConfig({ providerSectionCollapsedGemini: !configQuery.data.providerSectionCollapsedGemini })}
              aria-expanded={!configQuery.data.providerSectionCollapsedGemini}
              aria-controls="gemini-provider-content"
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                {configQuery.data.providerSectionCollapsedGemini ? (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
                Gemini
                <CheckCircle2 className="h-4 w-4 text-primary" />
              </span>
              <div className="flex gap-1.5 flex-wrap justify-end">
                {activeProviders.gemini.map((badge) => (
                  <ActiveProviderBadge key={badge.label} label={badge.label} icon={badge.icon} />
                ))}
              </div>
            </button>
            {!configQuery.data.providerSectionCollapsedGemini && (
              <div id="gemini-provider-content" className="divide-y border-t">
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
            )}
          </div>
        )}

        {/* Parakeet (Local) Provider Section */}
        {isParakeetActive && (
          <ParakeetProviderSection
            isActive={true}
            isCollapsed={configQuery.data.providerSectionCollapsedParakeet ?? true}
            onToggleCollapse={() => saveConfig({ providerSectionCollapsedParakeet: !(configQuery.data.providerSectionCollapsedParakeet ?? true) })}
            usageBadges={activeProviders.parakeet}
            numThreads={configQuery.data.parakeetNumThreads || 2}
            onNumThreadsChange={(value) => saveConfig({ parakeetNumThreads: value })}
          />
        )}

        {/* Kitten (Local) TTS Provider Section */}
        {isKittenActive && (
          <KittenProviderSection
            isActive={true}
            isCollapsed={configQuery.data.providerSectionCollapsedKitten ?? true}
            onToggleCollapse={() => saveConfig({ providerSectionCollapsedKitten: !(configQuery.data.providerSectionCollapsedKitten ?? true) })}
            usageBadges={activeProviders.kitten}
            voiceId={configQuery.data.kittenVoiceId ?? 5}
            onVoiceIdChange={(value) => saveConfig({ kittenVoiceId: value })}
          />
        )}

        {/* Inactive Groq Provider Section - shown at bottom when not selected */}
        {!isGroqActive && (
          <div className="rounded-lg border">
            <button
              type="button"
              className="px-3 py-2 flex items-center justify-between w-full hover:bg-muted/30 transition-colors cursor-pointer"
              onClick={() => saveConfig({ providerSectionCollapsedGroq: !configQuery.data.providerSectionCollapsedGroq })}
              aria-expanded={!configQuery.data.providerSectionCollapsedGroq}
              aria-controls="groq-provider-content-inactive"
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                {configQuery.data.providerSectionCollapsedGroq ? (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
                Groq
              </span>
            </button>
            {!configQuery.data.providerSectionCollapsedGroq && (
              <div id="groq-provider-content-inactive" className="divide-y border-t">
                <div className="px-3 py-2 bg-muted/30 border-b">
                  <p className="text-xs text-muted-foreground">
                    This provider is not currently selected for any feature. Select it above to use it.
                  </p>
                </div>

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
                      value={configQuery.data.groqTtsModel || "canopylabs/orpheus-v1-english"}
                      onValueChange={(value) => {
                        // Reset voice to appropriate default when model changes
                        const defaultVoice = value === "canopylabs/orpheus-arabic-saudi" ? "fahad" : "troy"
                        saveConfig({
                          groqTtsModel: value as "canopylabs/orpheus-v1-english" | "canopylabs/orpheus-arabic-saudi",
                          groqTtsVoice: defaultVoice
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
                      value={configQuery.data.groqTtsVoice || (configQuery.data.groqTtsModel === "canopylabs/orpheus-arabic-saudi" ? "fahad" : "troy")}
                      onValueChange={(value) => saveConfig({ groqTtsVoice: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(configQuery.data.groqTtsModel === "canopylabs/orpheus-arabic-saudi" ? GROQ_TTS_VOICES_ARABIC : GROQ_TTS_VOICES_ENGLISH).map((voice) => (
                          <SelectItem key={voice.value} value={voice.value}>
                            {voice.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Control>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Inactive Gemini Provider Section - shown at bottom when not selected */}
        {!isGeminiActive && (
          <div className="rounded-lg border">
            <button
              type="button"
              className="px-3 py-2 flex items-center justify-between w-full hover:bg-muted/30 transition-colors cursor-pointer"
              onClick={() => saveConfig({ providerSectionCollapsedGemini: !configQuery.data.providerSectionCollapsedGemini })}
              aria-expanded={!configQuery.data.providerSectionCollapsedGemini}
              aria-controls="gemini-provider-content-inactive"
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                {configQuery.data.providerSectionCollapsedGemini ? (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
                Gemini
              </span>
            </button>
            {!configQuery.data.providerSectionCollapsedGemini && (
              <div id="gemini-provider-content-inactive" className="divide-y border-t">
                <div className="px-3 py-2 bg-muted/30 border-b">
                  <p className="text-xs text-muted-foreground">
                    This provider is not currently selected for any feature. Select it above to use it.
                  </p>
                </div>

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
            )}
          </div>
        )}

        {/* Inactive Parakeet Provider Section - shown at bottom when not selected */}
        {!isParakeetActive && (
          <ParakeetProviderSection
            isActive={false}
            isCollapsed={configQuery.data.providerSectionCollapsedParakeet ?? true}
            onToggleCollapse={() => saveConfig({ providerSectionCollapsedParakeet: !(configQuery.data.providerSectionCollapsedParakeet ?? true) })}
            usageBadges={activeProviders.parakeet}
            numThreads={configQuery.data.parakeetNumThreads || 2}
            onNumThreadsChange={(value) => saveConfig({ parakeetNumThreads: value })}
          />
        )}

        {/* Inactive Kitten Provider Section - shown at bottom when not selected */}
        {!isKittenActive && (
          <KittenProviderSection
            isActive={false}
            isCollapsed={configQuery.data.providerSectionCollapsedKitten ?? true}
            onToggleCollapse={() => saveConfig({ providerSectionCollapsedKitten: !(configQuery.data.providerSectionCollapsedKitten ?? true) })}
            usageBadges={activeProviders.kitten}
            voiceId={configQuery.data.kittenVoiceId ?? 5}
            onVoiceIdChange={(value) => saveConfig({ kittenVoiceId: value })}
          />
        )}

        {/* Dual-Model Agent Mode Section */}
        <div className={`rounded-lg border ${dualModelEnabled ? 'border-primary/30 bg-primary/5' : ''}`}>
          <button
            type="button"
            className="px-3 py-2 flex items-center justify-between w-full hover:bg-muted/30 transition-colors cursor-pointer"
            onClick={() => saveConfig({ dualModelSectionCollapsed: !config.dualModelSectionCollapsed })}
            aria-expanded={!config.dualModelSectionCollapsed}
            aria-controls="dual-model-content"
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              {config.dualModelSectionCollapsed ? (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
              <Brain className="h-4 w-4" />
              Dual-Model Summarization
              {dualModelEnabled && (
                <CheckCircle2 className="h-4 w-4 text-primary" />
              )}
            </span>
          </button>
          {!config.dualModelSectionCollapsed && (
            <div id="dual-model-content" className="divide-y border-t">
              <div className="px-3 py-2 bg-muted/30 border-b">
                <p className="text-xs text-muted-foreground">
                  Use a weaker model to summarize agent steps for the UI and memory storage.
                </p>
              </div>

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
                  checked={dualModelEnabled}
                  onCheckedChange={(checked) => saveConfig({ dualModelEnabled: checked })}
                />
              </Control>

              <Control
                label={
                  <ControlLabel
                    label="Inject Memories"
                    tooltip="Include saved memories in agent context. Works independently of summarization."
                  />
                }
                className="px-3"
              >
                <Switch
                  checked={config.dualModelInjectMemories ?? false}
                  onCheckedChange={(checked) => saveConfig({ dualModelInjectMemories: checked })}
                />
              </Control>

              {dualModelEnabled && (
                <>
                  {/* Strong Model Configuration */}
                  <div className="px-3 py-3 space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Zap className="h-4 w-4 text-yellow-500" />
                      Strong Model (Planning)
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Primary model for reasoning and tool calls. Uses current agent model if not set.
                    </p>
                    <div className="space-y-2">
                      <Control
                        label={<ControlLabel label="Preset" tooltip="Select which model preset to use" />}
                      >
                        <Select
                          value={strongPresetId}
                          onValueChange={(value) => saveConfig({ dualModelStrongPresetId: value })}

                        >
                          <SelectTrigger className="w-[200px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {allPresets.map((preset) => (
                              <SelectItem key={preset.id} value={preset.id}>
                                {preset.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Control>
                      {strongPreset && (
                        <Control
                          label={<ControlLabel label="Model" tooltip="Select the model" />}
                        >
                          <PresetModelSelector
                            presetId={strongPresetId}
                            baseUrl={strongPreset.baseUrl}
                            apiKey={strongPreset.apiKey}
                            value={config.dualModelStrongModelName || ""}
                            onValueChange={(value) => saveConfig({ dualModelStrongModelName: value })}
                            label="Strong Model"
                            placeholder="Select model..."
                          />
                        </Control>
                      )}
                    </div>
                  </div>

                  {/* Weak Model Configuration */}
                  <div className="px-3 py-3 space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <BookOpen className="h-4 w-4 text-blue-500" />
                      Weak Model (Summarization)
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Faster, cheaper model for summarizing agent steps.
                    </p>
                    <div className="space-y-2">
                      <Control
                        label={<ControlLabel label="Preset" tooltip="Select which model preset to use" />}
                      >
                        <Select
                          value={weakPresetId}
                          onValueChange={(value) => saveConfig({ dualModelWeakPresetId: value })}
                        >
                          <SelectTrigger className="w-[200px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {allPresets.map((preset) => (
                              <SelectItem key={preset.id} value={preset.id}>
                                {preset.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Control>
                      {weakPreset && (
                        <Control
                          label={<ControlLabel label="Model" tooltip="Select the model" />}
                        >
                          <PresetModelSelector
                            presetId={weakPresetId}
                            baseUrl={weakPreset.baseUrl}
                            apiKey={weakPreset.apiKey}
                            value={config.dualModelWeakModelName || ""}
                            onValueChange={(value) => saveConfig({ dualModelWeakModelName: value })}
                            label="Weak Model"
                            placeholder="Select model..."
                          />
                        </Control>
                      )}
                    </div>
                  </div>

                  {/* Summarization Settings */}
                  <div className="px-3 py-3 space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Settings2 className="h-4 w-4" />
                      Summarization Settings
                    </div>
                    <Control
                      label={<ControlLabel label="Frequency" tooltip="How often to generate summaries" />}
                    >
                      <Select
                        value={config.dualModelSummarizationFrequency || "every_response"}
                        onValueChange={(value) =>
                          saveConfig({ dualModelSummarizationFrequency: value as "every_response" | "major_steps_only" })
                        }
                      >
                        <SelectTrigger className="w-[180px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="every_response">Every Response</SelectItem>
                          <SelectItem value="major_steps_only">Major Steps Only</SelectItem>
                        </SelectContent>
                      </Select>
                    </Control>
                    <Control
                      label={<ControlLabel label="Detail Level" tooltip="How detailed the summaries should be" />}
                    >
                      <Select
                        value={config.dualModelSummaryDetailLevel || "compact"}
                        onValueChange={(value) =>
                          saveConfig({ dualModelSummaryDetailLevel: value as "compact" | "detailed" })
                        }
                      >
                        <SelectTrigger className="w-[180px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="compact">Compact</SelectItem>
                          <SelectItem value="detailed">Detailed</SelectItem>
                        </SelectContent>
                      </Select>
                    </Control>
                    <Control
                      label={
                        <ControlLabel
                          label="Auto-save Important"
                          tooltip="Automatically save high and critical importance summaries to memory"
                        />
                      }
                    >
                      <Switch
                        checked={config.dualModelAutoSaveImportant ?? false}
                        onCheckedChange={(checked) => saveConfig({ dualModelAutoSaveImportant: checked })}
                      />
                    </Control>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
