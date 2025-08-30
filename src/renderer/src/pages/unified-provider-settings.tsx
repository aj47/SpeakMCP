/**
 * Unified Provider Settings
 * 
 * This component replaces the separate provider and model settings pages
 * with a unified interface that dynamically adapts to available providers.
 */

import { useCallback, useState } from "react"
import { Control, ControlGroup, ControlLabel } from "@renderer/components/ui/control"
import { Input } from "@renderer/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import { Button } from "@renderer/components/ui/button"
import { Badge } from "@renderer/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@renderer/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@renderer/components/ui/tabs"
import { Alert, AlertDescription } from "@renderer/components/ui/alert"
import {
  useConfigQuery,
  useSaveConfigMutation,
} from "@renderer/lib/query-client"
import { Config } from "@shared/types"
import { BaseUrlSelector } from "@renderer/components/base-url-selector"
import { ModelSelector } from "@renderer/components/model-selector"
import { 
  PROVIDER_DEFINITIONS, 
  ALL_PROVIDERS, 
  CHAT_PROVIDERS, 
  STT_PROVIDERS, 
  TTS_PROVIDERS 
} from "@shared/provider-definitions"
import { ProviderId, ServiceType } from "@shared/provider-system"
import { AlertCircle, CheckCircle, Settings, Zap, Mic, Volume2 } from "lucide-react"

interface ProviderCardProps {
  providerId: ProviderId
  service: ServiceType
  isActive: boolean
  onSelect: (providerId: ProviderId) => void
  onConfigure: (providerId: ProviderId) => void
}

function ProviderCard({ providerId, service, isActive, onSelect, onConfigure }: ProviderCardProps) {
  const provider = PROVIDER_DEFINITIONS[providerId]
  if (!provider) return null

  const hasCapability = provider.capabilities[service]
  if (!hasCapability) return null

  const getServiceIcon = (service: ServiceType) => {
    switch (service) {
      case "chat": return <Zap className="h-4 w-4" />
      case "stt": return <Mic className="h-4 w-4" />
      case "tts": return <Volume2 className="h-4 w-4" />
    }
  }

  return (
    <Card className={`cursor-pointer transition-all ${isActive ? 'ring-2 ring-primary' : 'hover:shadow-md'}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getServiceIcon(service)}
            <CardTitle className="text-lg">{provider.name}</CardTitle>
            {isActive && <Badge variant="default">Active</Badge>}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onConfigure(providerId)
            }}
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
        <CardDescription>{provider.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-1 mb-3">
          {provider.capabilities.chat && <Badge variant="outline">Chat</Badge>}
          {provider.capabilities.stt && <Badge variant="outline">STT</Badge>}
          {provider.capabilities.tts && <Badge variant="outline">TTS</Badge>}
          {provider.capabilities.supportsToolCalling && <Badge variant="outline">Tools</Badge>}
          {provider.capabilities.supportsStreaming && <Badge variant="outline">Streaming</Badge>}
        </div>
        <Button 
          className="w-full" 
          variant={isActive ? "secondary" : "default"}
          onClick={() => onSelect(providerId)}
        >
          {isActive ? "Currently Active" : "Select Provider"}
        </Button>
      </CardContent>
    </Card>
  )
}

interface ProviderConfigurationProps {
  providerId: ProviderId
  onClose: () => void
}

function ProviderConfiguration({ providerId, onClose }: ProviderConfigurationProps) {
  const configQuery = useConfigQuery()
  const saveConfigMutation = useSaveConfigMutation()
  const provider = PROVIDER_DEFINITIONS[providerId]

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

  if (!provider) return null

  // Get current configuration values based on provider
  const getConfigValue = (field: string) => {
    const prefix = providerId.toLowerCase()
    return configQuery.data?.[`${prefix}${field}`]
  }

  const updateConfigValue = (field: string, value: any) => {
    const prefix = providerId.toLowerCase()
    saveConfig({ [`${prefix}${field}`]: value })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{provider.name} Configuration</h3>
          <p className="text-sm text-muted-foreground">{provider.description}</p>
        </div>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>

      <div className="space-y-4">
        {/* API Key Configuration */}
        {provider.auth.apiKeyRequired && (
          <ControlGroup title="Authentication">
            <Control>
              <ControlLabel>API Key</ControlLabel>
              <Input
                type="password"
                placeholder={`Enter your ${provider.name} API key`}
                value={getConfigValue("ApiKey") || ""}
                onChange={(e) => updateConfigValue("ApiKey", e.target.value)}
              />
            </Control>
          </ControlGroup>
        )}

        {/* Base URL Configuration */}
        <ControlGroup title="API Configuration">
          <Control>
            <ControlLabel>Base URL</ControlLabel>
            <BaseUrlSelector
              value={getConfigValue("BaseUrl") || provider.defaultConfig.baseUrl}
              onChange={(value) => updateConfigValue("BaseUrl", value)}
              history={getConfigValue("BaseUrlHistory") || []}
              onHistoryChange={(history) => updateConfigValue("BaseUrlHistory", history)}
              placeholder={provider.defaultConfig.baseUrl}
            />
          </Control>
        </ControlGroup>

        {/* Service-specific configurations */}
        {provider.capabilities.chat && (
          <ControlGroup title="Chat Models">
            <div className="space-y-4">
              <ModelSelector
                providerId={providerId}
                value={getConfigValue("McpModel")}
                onValueChange={(value) => updateConfigValue("McpModel", value)}
                label="Agent/MCP Tools Model"
                placeholder="Select model for tool calling"
              />
              <ModelSelector
                providerId={providerId}
                value={getConfigValue("TranscriptModel")}
                onValueChange={(value) => updateConfigValue("TranscriptModel", value)}
                label="Transcript Processing Model"
                placeholder="Select model for transcript processing"
              />
            </div>
          </ControlGroup>
        )}

        {provider.capabilities.stt && (
          <ControlGroup title="Speech-to-Text">
            <Control>
              <ControlLabel>Language</ControlLabel>
              <Select
                value={getConfigValue("SttLanguage") || "auto"}
                onValueChange={(value) => updateConfigValue("SttLanguage", value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select language" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto-detect</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="es">Spanish</SelectItem>
                  <SelectItem value="fr">French</SelectItem>
                  <SelectItem value="de">German</SelectItem>
                  <SelectItem value="it">Italian</SelectItem>
                  <SelectItem value="pt">Portuguese</SelectItem>
                  <SelectItem value="ru">Russian</SelectItem>
                  <SelectItem value="ja">Japanese</SelectItem>
                  <SelectItem value="ko">Korean</SelectItem>
                  <SelectItem value="zh">Chinese</SelectItem>
                </SelectContent>
              </Select>
            </Control>
            {providerId === "groq" && (
              <Control>
                <ControlLabel>STT Prompt</ControlLabel>
                <Input
                  placeholder="Optional prompt to guide transcription"
                  value={getConfigValue("SttPrompt") || ""}
                  onChange={(e) => updateConfigValue("SttPrompt", e.target.value)}
                />
              </Control>
            )}
          </ControlGroup>
        )}

        {provider.capabilities.tts && (
          <ControlGroup title="Text-to-Speech">
            <div className="space-y-4">
              <Control>
                <ControlLabel>TTS Model</ControlLabel>
                <Select
                  value={getConfigValue("TtsModel") || provider.defaultConfig.tts?.model}
                  onValueChange={(value) => updateConfigValue("TtsModel", value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select TTS model" />
                  </SelectTrigger>
                  <SelectContent>
                    {provider.models?.tts?.map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        {model.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Control>

              <Control>
                <ControlLabel>Voice</ControlLabel>
                <Select
                  value={getConfigValue("TtsVoice") || provider.defaultConfig.tts?.voice}
                  onValueChange={(value) => updateConfigValue("TtsVoice", value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select voice" />
                  </SelectTrigger>
                  <SelectContent>
                    {provider.voices?.map((voice) => (
                      <SelectItem key={voice.id} value={voice.id}>
                        {voice.name}
                        {voice.language && ` (${voice.language})`}
                        {voice.gender && ` - ${voice.gender}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Control>

              {providerId === "openai" && (
                <Control>
                  <ControlLabel>Speed</ControlLabel>
                  <Select
                    value={String(getConfigValue("TtsSpeed") || 1.0)}
                    onValueChange={(value) => updateConfigValue("TtsSpeed", parseFloat(value))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0.25">0.25x</SelectItem>
                      <SelectItem value="0.5">0.5x</SelectItem>
                      <SelectItem value="0.75">0.75x</SelectItem>
                      <SelectItem value="1.0">1.0x (Normal)</SelectItem>
                      <SelectItem value="1.25">1.25x</SelectItem>
                      <SelectItem value="1.5">1.5x</SelectItem>
                      <SelectItem value="2.0">2.0x</SelectItem>
                      <SelectItem value="3.0">3.0x</SelectItem>
                      <SelectItem value="4.0">4.0x</SelectItem>
                    </SelectContent>
                  </Select>
                </Control>
              )}
            </div>
          </ControlGroup>
        )}
      </div>
    </div>
  )
}

export function Component() {
  const configQuery = useConfigQuery()
  const saveConfigMutation = useSaveConfigMutation()
  const [selectedService, setSelectedService] = useState<ServiceType>("chat")
  const [configuringProvider, setConfiguringProvider] = useState<ProviderId | null>(null)

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

  const getActiveProvider = (service: ServiceType): ProviderId => {
    switch (service) {
      case "chat":
        return (configQuery.data?.mcpToolsProviderId as ProviderId) || "openai"
      case "stt":
        return (configQuery.data?.sttProviderId as ProviderId) || "openai"
      case "tts":
        return (configQuery.data?.ttsProviderId as ProviderId) || "openai"
    }
  }

  const setActiveProvider = (service: ServiceType, providerId: ProviderId) => {
    switch (service) {
      case "chat":
        saveConfig({ 
          mcpToolsProviderId: providerId,
          transcriptPostProcessingProviderId: providerId 
        })
        break
      case "stt":
        saveConfig({ sttProviderId: providerId })
        break
      case "tts":
        saveConfig({ ttsProviderId: providerId })
        break
    }
  }

  const getProvidersForService = (service: ServiceType) => {
    switch (service) {
      case "chat": return CHAT_PROVIDERS
      case "stt": return STT_PROVIDERS
      case "tts": return TTS_PROVIDERS
    }
  }

  if (configuringProvider) {
    return (
      <div className="container mx-auto p-6">
        <ProviderConfiguration
          providerId={configuringProvider}
          onClose={() => setConfiguringProvider(null)}
        />
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Provider Settings</h1>
          <p className="text-muted-foreground">
            Configure AI providers for different services. Each service can use a different provider.
          </p>
        </div>

        <Tabs value={selectedService} onValueChange={(value) => setSelectedService(value as ServiceType)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="chat" className="flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Chat & Tools
            </TabsTrigger>
            <TabsTrigger value="stt" className="flex items-center gap-2">
              <Mic className="h-4 w-4" />
              Speech-to-Text
            </TabsTrigger>
            <TabsTrigger value="tts" className="flex items-center gap-2">
              <Volume2 className="h-4 w-4" />
              Text-to-Speech
            </TabsTrigger>
          </TabsList>

          {(["chat", "stt", "tts"] as ServiceType[]).map((service) => (
            <TabsContent key={service} value={service} className="space-y-4">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Current active provider for {service}: <strong>{getActiveProvider(service)}</strong>
                </AlertDescription>
              </Alert>

              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {getProvidersForService(service).map((provider) => (
                  <ProviderCard
                    key={provider.id}
                    providerId={provider.id}
                    service={service}
                    isActive={getActiveProvider(service) === provider.id}
                    onSelect={(providerId) => setActiveProvider(service, providerId)}
                    onConfigure={(providerId) => setConfiguringProvider(providerId)}
                  />
                ))}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  )
}
