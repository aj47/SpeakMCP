import { Control, ControlGroup } from "@renderer/components/ui/control"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import { Switch } from "@renderer/components/ui/switch"
import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { Slider } from "@renderer/components/ui/slider"
import { Badge } from "@renderer/components/ui/badge"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useState, useEffect } from "react"
import { toast } from "sonner"
import { WakeWordConfig } from "@shared/types"

export function Component() {
  const queryClient = useQueryClient()
  const [isDetecting, setIsDetecting] = useState(false)

  const configQuery = useQuery({
    queryKey: ["config"],
    queryFn: () => tipcClient.getConfig(),
  })

  const wakeWordStatusQuery = useQuery({
    queryKey: ["wakeWordStatus"],
    queryFn: () => tipcClient.getWakeWordStatus(),
    refetchInterval: 2000, // Poll every 2 seconds for status updates
  })

  const availableWakeWordsQuery = useQuery({
    queryKey: ["availableWakeWords"],
    queryFn: () => tipcClient.getAvailableWakeWords(),
  })

  const updateSettingsMutation = useMutation({
    mutationFn: (settings: Partial<WakeWordConfig>) =>
      tipcClient.updateWakeWordSettings({ settings }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config"] })
      queryClient.invalidateQueries({ queryKey: ["wakeWordStatus"] })
      toast.success("Wake word settings updated")
    },
    onError: (error: any) => {
      toast.error(`Failed to update settings: ${error.error || error.message}`)
    },
  })

  const startDetectionMutation = useMutation({
    mutationFn: () => tipcClient.startWakeWordDetection(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wakeWordStatus"] })
      toast.success("Wake word detection started")
    },
    onError: (error: any) => {
      toast.error(`Failed to start detection: ${error.error || error.message}`)
    },
  })

  const stopDetectionMutation = useMutation({
    mutationFn: () => tipcClient.stopWakeWordDetection(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wakeWordStatus"] })
      toast.success("Wake word detection stopped")
    },
    onError: (error: any) => {
      toast.error(`Failed to stop detection: ${error.error || error.message}`)
    },
  })

  const initializeMutation = useMutation({
    mutationFn: () => tipcClient.initializeWakeWordService(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wakeWordStatus"] })
      toast.success("Wake word service initialized")
    },
    onError: (error: any) => {
      toast.error(`Failed to initialize: ${error.error || error.message}`)
    },
  })

  useEffect(() => {
    if (wakeWordStatusQuery.data) {
      setIsDetecting(wakeWordStatusQuery.data.isActive)
    }
  }, [wakeWordStatusQuery.data])

  const saveConfig = (updates: Partial<WakeWordConfig>) => {
    if (!configQuery.data) return

    const newConfig = {
      ...configQuery.data,
      wakeWord: {
        ...configQuery.data.wakeWord,
        ...updates,
      },
    }

    tipcClient.saveConfig({ config: newConfig }).then(() => {
      queryClient.invalidateQueries({ queryKey: ["config"] })
    })
  }

  const wakeWordConfig = configQuery.data?.wakeWord || {}
  const isEnabled = wakeWordConfig.enabled || false

  if (configQuery.isLoading) {
    return <div className="p-6">Loading...</div>
  }

  return (
    <div className="h-full overflow-auto px-6 py-4 liquid-glass-panel">
      <header className="mb-5 liquid-glass-card glass-border rounded-lg p-4 glass-shadow">
        <h2 className="text-2xl font-bold">Wake Word</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configure hands-free voice activation with wake word detection
        </p>
      </header>

      <div className="grid gap-4">
        <ControlGroup title="Wake Word Detection">
          <Control label="Enable Wake Word Detection" className="px-3">
            <div className="flex items-center gap-2">
              <Switch
                checked={isEnabled}
                onCheckedChange={(checked) => {
                  saveConfig({ enabled: checked })
                  if (checked) {
                    updateSettingsMutation.mutate({ enabled: checked })
                  }
                }}
              />
              {wakeWordStatusQuery.data?.isActive && (
                <Badge variant="secondary" className="text-xs">
                  Active
                </Badge>
              )}
            </div>
          </Control>

          {isEnabled && (
            <>
              <Control label="Wake Word" className="px-3">
                <Select
                  value={wakeWordConfig.wakeWord || "hey computer"}
                  onValueChange={(value) => {
                    saveConfig({ wakeWord: value as any })
                    updateSettingsMutation.mutate({ wakeWord: value as any })
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableWakeWordsQuery.data?.map((word) => (
                      <SelectItem key={word} value={word}>
                        {word}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Control>

              <Control label="Sensitivity" className="px-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">
                      {((wakeWordConfig.sensitivity || 0.5) * 100).toFixed(0)}%
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Higher = more sensitive
                    </span>
                  </div>
                  <Slider
                    value={[(wakeWordConfig.sensitivity || 0.5) * 100]}
                    onValueChange={([value]) => {
                      const sensitivity = value / 100
                      saveConfig({ sensitivity })
                      updateSettingsMutation.mutate({ sensitivity })
                    }}
                    max={100}
                    min={10}
                    step={5}
                    className="w-full"
                  />
                </div>
              </Control>

              <Control label="Recording Timeout" className="px-3">
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={30}
                    value={wakeWordConfig.recordingTimeout || 5}
                    onChange={(e) => {
                      const timeout = parseInt(e.target.value) || 5
                      saveConfig({ recordingTimeout: timeout })
                      updateSettingsMutation.mutate({ recordingTimeout: timeout })
                    }}
                    className="w-20"
                  />
                  <span className="text-sm text-muted-foreground">seconds</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Time to wait before resuming detection after recording
                </p>
              </Control>

              <Control label="Confirmation Mode" className="px-3">
                <Switch
                  checked={wakeWordConfig.confirmationMode || false}
                  onCheckedChange={(checked) => {
                    saveConfig({ confirmationMode: checked })
                    updateSettingsMutation.mutate({ confirmationMode: checked })
                  }}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Show confirmation dialog before starting recording
                </p>
              </Control>
            </>
          )}
        </ControlGroup>

        {isEnabled && (
          <ControlGroup title="Detection Control">
            <Control label="Manual Control" className="px-3">
              <div className="flex gap-2">
                <Button
                  onClick={() => startDetectionMutation.mutate()}
                  disabled={isDetecting || startDetectionMutation.isPending}
                  size="sm"
                >
                  Start Detection
                </Button>
                <Button
                  onClick={() => stopDetectionMutation.mutate()}
                  disabled={!isDetecting || stopDetectionMutation.isPending}
                  variant="outline"
                  size="sm"
                >
                  Stop Detection
                </Button>
                <Button
                  onClick={() => initializeMutation.mutate()}
                  disabled={initializeMutation.isPending}
                  variant="outline"
                  size="sm"
                >
                  Reinitialize
                </Button>
              </div>
            </Control>

            <Control label="Status" className="px-3">
              <div className="text-sm">
                {isDetecting ? (
                  <span className="text-green-600">🎤 Listening for wake word...</span>
                ) : (
                  <span className="text-muted-foreground">⏸️ Detection stopped</span>
                )}
              </div>
            </Control>
          </ControlGroup>
        )}

        <ControlGroup title="Demo Mode">
          <div className="px-3 py-2 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              <strong>Demo Mode Active:</strong> This implementation simulates wake word detection every 30 seconds when active.
              For production use with real wake word detection, you'll need to:
            </p>
            <ol className="text-xs text-blue-700 dark:text-blue-300 mt-2 ml-4 list-decimal space-y-1">
              <li>Get a Picovoice access key from <a href="https://console.picovoice.ai/" target="_blank" rel="noopener noreferrer" className="underline">console.picovoice.ai</a></li>
              <li>Install Picovoice dependencies</li>
              <li>Configure the access key in settings</li>
            </ol>
          </div>
        </ControlGroup>

        <ControlGroup title="Privacy & Performance">
          <div className="px-3 space-y-2 text-sm text-muted-foreground">
            <div className="flex items-start gap-2">
              <span className="text-green-600">✅</span>
              <span>All processing happens locally on your device</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-green-600">✅</span>
              <span>No audio data is sent to external servers</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-green-600">✅</span>
              <span>You have full control to disable at any time</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-green-600">✅</span>
              <span>Minimal system resource usage</span>
            </div>
          </div>
        </ControlGroup>
      </div>
    </div>
  )
}
