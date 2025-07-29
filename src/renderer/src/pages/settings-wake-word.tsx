import { Control, ControlGroup } from "@renderer/components/ui/control"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import { Switch } from "@renderer/components/ui/switch"
import { Input } from "@renderer/components/ui/input"
import { Button } from "@renderer/components/ui/button"
import { Label } from "@renderer/components/ui/label"
import { Slider } from "@renderer/components/ui/slider"
import { Badge } from "@renderer/components/ui/badge"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { tipcClient } from "@renderer/lib/tipc-client"
import { toast } from "sonner"
import { useState, useEffect } from "react"
import { Mic, MicOff, Volume2, AlertCircle, CheckCircle } from "lucide-react"

const WAKE_WORD_OPTIONS = [
  { value: "hey computer", label: "Hey Computer" },
  { value: "hey porcupine", label: "Hey Porcupine" },
  { value: "hey picovoice", label: "Hey Picovoice" },
  { value: "alexa", label: "Alexa" },
  { value: "ok google", label: "OK Google" },
  { value: "hey siri", label: "Hey Siri" },
]

function SettingsWakeWord() {
  const queryClient = useQueryClient()
  const [accessKey, setAccessKey] = useState("")

  const configQuery = useQuery({
    queryKey: ["config"],
    queryFn: () => tipcClient.getConfig(),
  })

  const wakeWordStatusQuery = useQuery({
    queryKey: ["wake-word-status"],
    queryFn: () => tipcClient.getWakeWordStatus(),
    refetchInterval: 2000, // Refresh every 2 seconds
  })

  const saveConfigMutation = useMutation({
    mutationFn: tipcClient.saveConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config"] })
      toast.success("Wake word settings saved")
    },
    onError: (error) => {
      toast.error(`Failed to save settings: ${error.message}`)
    },
  })

  const startWakeWordMutation = useMutation({
    mutationFn: () => tipcClient.startWakeWordDetection(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wake-word-status"] })
      toast.success("Wake word detection started")
    },
    onError: (error) => {
      toast.error(`Failed to start wake word detection: ${error.message}`)
    },
  })

  const stopWakeWordMutation = useMutation({
    mutationFn: () => tipcClient.stopWakeWordDetection(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wake-word-status"] })
      toast.success("Wake word detection stopped")
    },
    onError: (error) => {
      toast.error(`Failed to stop wake word detection: ${error.message}`)
    },
  })

  const setAccessKeyMutation = useMutation({
    mutationFn: (key: string) => tipcClient.setWakeWordAccessKey({ accessKey: key }),
    onSuccess: () => {
      toast.success("Access key updated")
    },
    onError: (error) => {
      toast.error(`Failed to set access key: ${error.message}`)
    },
  })

  const updateConfigurationMutation = useMutation({
    mutationFn: () => tipcClient.updateWakeWordConfiguration(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wake-word-status"] })
      toast.success("Wake word configuration updated")
    },
    onError: (error) => {
      toast.error(`Failed to update configuration: ${error.message}`)
    },
  })

  const saveConfig = (updates: Partial<typeof configQuery.data>) => {
    if (!configQuery.data) return
    const newConfig = { ...configQuery.data, ...updates }
    saveConfigMutation.mutate(newConfig)
  }

  const handleAccessKeySubmit = () => {
    if (accessKey.trim()) {
      setAccessKeyMutation.mutate(accessKey.trim())
    }
  }

  const handleToggleWakeWord = async (enabled: boolean) => {
    saveConfig({ wakeWordEnabled: enabled })
    
    // Wait for config to save, then update the service
    setTimeout(() => {
      updateConfigurationMutation.mutate()
    }, 500)
  }

  useEffect(() => {
    // Update configuration when settings change
    if (configQuery.data?.wakeWordEnabled) {
      updateConfigurationMutation.mutate()
    }
  }, [
    configQuery.data?.wakeWordKeyword,
    configQuery.data?.wakeWordSensitivity,
    configQuery.data?.wakeWordTimeout,
    configQuery.data?.wakeWordRequireConfirmation,
  ])

  if (configQuery.isLoading) {
    return <div className="flex items-center justify-center h-64">Loading...</div>
  }

  const config = configQuery.data!
  const wakeWordStatus = wakeWordStatusQuery.data

  return (
    <div className="h-full overflow-auto px-6 py-4 liquid-glass-panel">
      <header className="mb-5 liquid-glass-card glass-border rounded-lg p-4 glass-shadow">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Wake Word Detection</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Configure hands-free voice activation
            </p>
          </div>
          <div className="flex items-center gap-2">
            {wakeWordStatus?.isListening ? (
              <Badge variant="default" className="flex items-center gap-1">
                <Mic className="w-3 h-3" />
                Listening
              </Badge>
            ) : (
              <Badge variant="secondary" className="flex items-center gap-1">
                <MicOff className="w-3 h-3" />
                Inactive
              </Badge>
            )}
          </div>
        </div>
      </header>

      <div className="grid gap-4">
        {/* Setup Instructions */}
        <ControlGroup title="Setup">
          <div className="px-3 space-y-3">
            <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <AlertCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
              <div className="text-sm">
                <p className="font-medium text-blue-900 dark:text-blue-100 mb-1">
                  Picovoice Access Key Required
                </p>
                <p className="text-blue-700 dark:text-blue-300">
                  Wake word detection requires a free Picovoice access key. 
                  <a 
                    href="https://console.picovoice.ai/" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="underline hover:no-underline ml-1"
                  >
                    Get your free key here
                  </a>
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="access-key">Picovoice Access Key</Label>
              <div className="flex gap-2">
                <Input
                  id="access-key"
                  type="password"
                  placeholder="Enter your Picovoice access key"
                  value={accessKey}
                  onChange={(e) => setAccessKey(e.target.value)}
                />
                <Button 
                  onClick={handleAccessKeySubmit}
                  disabled={!accessKey.trim() || setAccessKeyMutation.isPending}
                >
                  {setAccessKeyMutation.isPending ? "Setting..." : "Set Key"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Your access key is stored locally and never shared
              </p>
            </div>
          </div>
        </ControlGroup>

        {/* Main Settings */}
        <ControlGroup title="Configuration">
          <Control label="Enable Wake Word Detection" className="px-3">
            <Switch
              checked={config.wakeWordEnabled || false}
              onCheckedChange={handleToggleWakeWord}
              disabled={saveConfigMutation.isPending}
            />
          </Control>

          {config.wakeWordEnabled && (
            <>
              <Control label="Wake Word" className="px-3">
                <Select
                  value={config.wakeWordKeyword || "hey computer"}
                  onValueChange={(value) => saveConfig({ wakeWordKeyword: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WAKE_WORD_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Choose the phrase that will trigger voice recording
                </p>
              </Control>

              <Control label="Sensitivity" className="px-3">
                <div className="space-y-2">
                  <Slider
                    value={[config.wakeWordSensitivity || 0.5]}
                    onValueChange={([value]) => saveConfig({ wakeWordSensitivity: value })}
                    min={0.1}
                    max={1.0}
                    step={0.1}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Less sensitive</span>
                    <span>{((config.wakeWordSensitivity || 0.5) * 100).toFixed(0)}%</span>
                    <span>More sensitive</span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Higher sensitivity may cause false positives
                </p>
              </Control>

              <Control label="Recording Timeout" className="px-3">
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={config.wakeWordTimeout || 5000}
                    onChange={(e) => saveConfig({ wakeWordTimeout: parseInt(e.target.value) })}
                    min={1000}
                    max={30000}
                    step={1000}
                    className="w-24"
                  />
                  <span className="text-sm text-muted-foreground">ms</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  How long to wait before resuming wake word detection after activation
                </p>
              </Control>

              <Control label="Require Confirmation" className="px-3">
                <Switch
                  checked={config.wakeWordRequireConfirmation || false}
                  onCheckedChange={(value) => saveConfig({ wakeWordRequireConfirmation: value })}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Show confirmation dialog before starting recording
                </p>
              </Control>
            </>
          )}
        </ControlGroup>

        {/* Status and Controls */}
        {config.wakeWordEnabled && (
          <ControlGroup title="Status & Controls">
            <div className="px-3 space-y-3">
              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2">
                  <Volume2 className="w-4 h-4" />
                  <span className="text-sm font-medium">Detection Status</span>
                </div>
                <div className="flex items-center gap-2">
                  {wakeWordStatus?.isListening ? (
                    <Badge variant="default" className="flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" />
                      Active
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Inactive</Badge>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => startWakeWordMutation.mutate()}
                  disabled={wakeWordStatus?.isListening || startWakeWordMutation.isPending}
                >
                  Start Detection
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => stopWakeWordMutation.mutate()}
                  disabled={!wakeWordStatus?.isListening || stopWakeWordMutation.isPending}
                >
                  Stop Detection
                </Button>
              </div>
            </div>
          </ControlGroup>
        )}

        {/* Privacy Notice */}
        <ControlGroup title="Privacy & Performance">
          <div className="px-3 space-y-3">
            <div className="p-3 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-800">
              <div className="flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-medium text-green-900 dark:text-green-100 mb-1">
                    Privacy-First Design
                  </p>
                  <ul className="text-green-700 dark:text-green-300 space-y-1">
                    <li>• All processing happens locally on your device</li>
                    <li>• No audio data is sent to external servers</li>
                    <li>• Wake word detection uses minimal system resources</li>
                    <li>• Can be disabled at any time</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </ControlGroup>
      </div>
    </div>
  )
}

export const Component = SettingsWakeWord
