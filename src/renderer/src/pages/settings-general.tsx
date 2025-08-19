import { Control, ControlGroup, ControlLabel } from "@renderer/components/ui/control"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import { Switch } from "@renderer/components/ui/switch"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@renderer/components/ui/tooltip"
import { STT_PROVIDER_ID } from "@shared/index"
import { SUPPORTED_LANGUAGES } from "@shared/languages"
import { Textarea } from "@renderer/components/ui/textarea"
import { Input } from "@renderer/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@renderer/components/ui/dialog"
import { ModelSelector } from "@renderer/components/model-selector"
import { Button } from "@renderer/components/ui/button"
import {
  useConfigQuery,
  useSaveConfigMutation,
} from "@renderer/lib/query-client"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useState, useCallback, useEffect } from "react"
import { Config } from "@shared/types"
import { KeyRecorder } from "@renderer/components/key-recorder"
import {
  getEffectiveShortcut,
  formatKeyComboForDisplay,
} from "@shared/key-utils"

export function Component() {
  const configQuery = useConfigQuery()

  const saveConfigMutation = useSaveConfigMutation()

  const saveConfig = useCallback(
    (config: Partial<Config>) => {
      saveConfigMutation.mutate({
        config: {
          ...(configQuery.data as any),
          ...config,
        },
      })
    },
    [saveConfigMutation, configQuery.data],
  )

  // Sync theme preference from config to localStorage when config loads
  useEffect(() => {
    if ((configQuery.data as any)?.themePreference) {
      localStorage.setItem("theme-preference", (configQuery.data as any).themePreference)
      window.dispatchEvent(
        new CustomEvent("theme-preference-changed", {
          detail: (configQuery.data as any).themePreference,
        }),
      )
    }
  }, [(configQuery.data as any)?.themePreference])

  // Memoize model change handler to prevent infinite re-renders
  const handleTranscriptModelChange = useCallback(
    (value: string) => {
      const transcriptPostProcessingProviderId =
        (configQuery.data as any)?.transcriptPostProcessingProviderId || "openai"

      if (transcriptPostProcessingProviderId === "openai") {
        saveConfig({
          transcriptPostProcessingOpenaiModel: value,
        })
      } else if (transcriptPostProcessingProviderId === "groq") {
        saveConfig({
          transcriptPostProcessingGroqModel: value,
        })
      } else {
        saveConfig({
          transcriptPostProcessingGeminiModel: value,
        })
      }
    },
    [saveConfig, (configQuery.data as any)?.transcriptPostProcessingProviderId],
  )

  const sttProviderId: STT_PROVIDER_ID =
    (configQuery.data as any)?.sttProviderId || "openai"
  const shortcut = (configQuery.data as any)?.shortcut || "hold-ctrl"
  const textInputShortcut = (configQuery.data as any)?.textInputShortcut || "ctrl-t"


  if (!configQuery.data) return null

  return (
    <div className="modern-panel h-full overflow-auto px-6 py-4">
      <header className="modern-card modern-border mb-5 rounded-lg p-4">
        <h2 className="text-2xl font-bold">General</h2>
      </header>

      <div className="grid gap-4">
        {process.env.IS_MAC && (
          <ControlGroup title="App">
            <Control label="Hide Dock Icon" className="px-3">
              <Switch
                defaultChecked={configQuery.data.hideDockIcon}
                onCheckedChange={(value) => {
                  saveConfig({
                    hideDockIcon: value,
                  })
                }}
              />
            </Control>
          </ControlGroup>
        )}

        <ControlGroup title="Appearance">
          <Control label="Theme" className="px-3">
            <Select
              value={configQuery.data.themePreference || "system"}
              onValueChange={(value: "system" | "light" | "dark") => {
                saveConfig({
                  themePreference: value,
                })
                // Apply theme immediately
                window.dispatchEvent(
                  new CustomEvent("theme-preference-changed", {
                    detail: value,
                  }),
                )
              }}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="system">System</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
              </SelectContent>
            </Select>
          </Control>
        </ControlGroup>

        <ControlGroup
          title="Shortcuts"
          endDescription={
            <div className="flex items-center gap-1">
              <div>
                {shortcut === "hold-ctrl"
                  ? "Hold Ctrl key to record, release it to finish recording"
                  : "Press Ctrl+/ to start and finish recording"}
              </div>
              <TooltipProvider disableHoverableContent delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger className="inline-flex items-center justify-center">
                    <span className="i-mingcute-information-fill text-base"></span>
                  </TooltipTrigger>
                  <TooltipContent collisionPadding={5}>
                    {shortcut === "hold-ctrl"
                      ? "Press any key to cancel"
                      : "Press Esc to cancel"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          }
        >
          <Control label="Recording" className="px-3">
            <div className="space-y-2">
              <Select
                defaultValue={shortcut}
                onValueChange={(value) => {
                  saveConfig({
                    shortcut: value as typeof configQuery.data.shortcut,
                  })
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hold-ctrl">Hold Ctrl</SelectItem>
                  <SelectItem value="ctrl-slash">Ctrl+{"/"}</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>

              {shortcut === "custom" && (
                <KeyRecorder
                  value={configQuery.data?.customShortcut || ""}
                  onChange={(keyCombo) => {
                    saveConfig({
                      customShortcut: keyCombo,
                    })
                  }}
                  placeholder="Click to record custom shortcut"
                />
              )}
            </div>
          </Control>

          <Control label="Text Input" className="px-3">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Switch
                  checked={configQuery.data?.textInputEnabled ?? true}
                  onCheckedChange={(checked) => {
                    saveConfig({
                      textInputEnabled: checked,
                    })
                  }}
                />
                <Select
                  value={textInputShortcut}
                  onValueChange={(value) => {
                    saveConfig({
                      textInputShortcut:
                        value as typeof configQuery.data.textInputShortcut,
                    })
                  }}
                  disabled={!configQuery.data?.textInputEnabled}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ctrl-t">Ctrl+T</SelectItem>
                    <SelectItem value="ctrl-shift-t">Ctrl+Shift+T</SelectItem>
                    <SelectItem value="alt-t">Alt+T</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {textInputShortcut === "custom" &&
                configQuery.data?.textInputEnabled && (
                  <KeyRecorder
                    value={configQuery.data?.customTextInputShortcut || ""}
                    onChange={(keyCombo) => {
                      saveConfig({
                        customTextInputShortcut: keyCombo,
                      })
                    }}
                    placeholder="Click to record custom text input shortcut"
                  />
                )}
            </div>
          </Control>
        </ControlGroup>

        <ControlGroup title="Speech to Text">
          <Control label="Language" className="px-3">
            <Select
              value={configQuery.data.sttLanguage || "auto"}
              onValueChange={(value) => {
                saveConfig({
                  sttLanguage: value,
                })
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORTED_LANGUAGES.map((language) => (
                  <SelectItem key={language.code} value={language.code}>
                    {language.nativeName} ({language.name})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              Select the language for speech transcription. "Auto-detect" lets the
              model determine the language automatically.
            </p>
          </Control>

          {sttProviderId === "openai" && configQuery.data.openaiSttLanguage && configQuery.data.openaiSttLanguage !== configQuery.data.sttLanguage && (
            <Control label="OpenAI Language Override" className="px-3">
              <Select
                value={configQuery.data.openaiSttLanguage || "auto"}
                onValueChange={(value) => {
                  saveConfig({
                    openaiSttLanguage: value,
                  })
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_LANGUAGES.map((language) => (
                    <SelectItem key={language.code} value={language.code}>
                      {language.nativeName} ({language.name})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Control>
          )}

          {sttProviderId === "groq" && configQuery.data.groqSttLanguage && configQuery.data.groqSttLanguage !== configQuery.data.sttLanguage && (
            <Control label="Groq Language Override" className="px-3">
              <Select
                value={configQuery.data.groqSttLanguage || "auto"}
                onValueChange={(value) => {
                  saveConfig({
                    groqSttLanguage: value,
                  })
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_LANGUAGES.map((language) => (
                    <SelectItem key={language.code} value={language.code}>
                      {language.nativeName} ({language.name})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Control>
          )}

          {sttProviderId === "groq" && (
            <Control label="Prompt" className="px-3">
              <Textarea
                placeholder="Optional prompt to guide the model's style or specify how to spell unfamiliar words (limited to 224 tokens)"
                defaultValue={configQuery.data.groqSttPrompt || ""}
                onChange={(e) => {
                  saveConfig({
                    groqSttPrompt: e.currentTarget.value,
                  })
                }}
                className="min-h-[80px]"
              />
            </Control>
          )}
        </ControlGroup>

        <ControlGroup title="Transcript Post-Processing">
          <Control label="Enabled" className="px-3">
            <Switch
              defaultChecked={configQuery.data.transcriptPostProcessingEnabled}
              onCheckedChange={(value) => {
                saveConfig({
                  transcriptPostProcessingEnabled: value,
                })
              }}
            />
          </Control>

          {configQuery.data.transcriptPostProcessingEnabled && (
              <Control label="Prompt" className="px-3">
                <div className="flex flex-col items-end gap-1 text-right">
                  {configQuery.data.transcriptPostProcessingPrompt && (
                    <div className="line-clamp-3 text-sm text-neutral-500 dark:text-neutral-400">
                      {configQuery.data.transcriptPostProcessingPrompt}
                    </div>
                  )}
                  <Dialog>
                    <DialogTrigger className="" asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 gap-1 px-2"
                      >
                        <span className="i-mingcute-edit-2-line"></span>
                        Edit
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Edit Prompt</DialogTitle>
                      </DialogHeader>
                      <Textarea
                        rows={10}
                        defaultValue={
                          configQuery.data.transcriptPostProcessingPrompt
                        }
                        onChange={(e) => {
                          saveConfig({
                            transcriptPostProcessingPrompt:
                              e.currentTarget.value,
                          })
                        }}
                      ></Textarea>
                      <div className="text-sm text-muted-foreground">
                        Use{" "}
                        <span className="select-text">{"{transcript}"}</span>{" "}
                        placeholder to insert the original transcript
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </Control>
            )}
        </ControlGroup>

        {/* Panel Position Settings */}
        <ControlGroup title="Panel Position">
          <Control label={<ControlLabel label="Default Position" tooltip="Choose where the floating panel appears on your screen. Custom position: Panel can be dragged to any location and will remember its position." />} className="px-3">
            <Select
              value={configQuery.data?.panelPosition || "top-right"}
              onValueChange={(
                value:
                  | "top-left"
                  | "top-center"
                  | "top-right"
                  | "bottom-left"
                  | "bottom-center"
                  | "bottom-right"
                  | "custom",
              ) => {
                saveConfig({
                  panelPosition: value,
                })
                // Update panel position immediately if it's visible
                tipcClient.setPanelPosition({ position: value })
              }}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="top-left">Top Left</SelectItem>
                <SelectItem value="top-center">Top Center</SelectItem>
                <SelectItem value="top-right">Top Right</SelectItem>
                <SelectItem value="bottom-left">Bottom Left</SelectItem>
                <SelectItem value="bottom-center">Bottom Center</SelectItem>
                <SelectItem value="bottom-right">Bottom Right</SelectItem>
                <SelectItem value="custom">Custom (Draggable)</SelectItem>
              </SelectContent>
            </Select>
          </Control>

          <Control label={<ControlLabel label="Enable Dragging" tooltip="Enable dragging to move the panel by holding the top bar." />} className="px-3">
            <Switch
              defaultChecked={configQuery.data?.panelDragEnabled ?? true}
              onCheckedChange={(value) => {
                saveConfig({
                  panelDragEnabled: value,
                })
              }}
            />
          </Control>


        </ControlGroup>

        {/* Mobile Server Settings */}
        <ControlGroup title="Mobile Server">
          <Control label={<ControlLabel label="Enable Mobile Server" tooltip="Enable mobile app connectivity via LiveKit and ngrok tunneling." />} className="px-3">
            <Switch
              checked={configQuery.data?.mobileServerEnabled ?? false}
              onCheckedChange={(value) => {
                saveConfig({
                  mobileServerEnabled: value,
                })
              }}
            />
          </Control>

          <Control label={<ControlLabel label="LiveKit API Key" tooltip="Your LiveKit API key for mobile server authentication." />} className="px-3">
            <Input
              type="password"
              placeholder="LiveKit API Key"
              value={configQuery.data?.livekitApiKey || ""}
              onChange={(e) => {
                saveConfig({
                  livekitApiKey: e.target.value,
                })
              }}
            />
          </Control>

          <Control label={<ControlLabel label="LiveKit API Secret" tooltip="Your LiveKit API secret for mobile server authentication." />} className="px-3">
            <Input
              type="password"
              placeholder="LiveKit API Secret"
              value={configQuery.data?.livekitApiSecret || ""}
              onChange={(e) => {
                saveConfig({
                  livekitApiSecret: e.target.value,
                })
              }}
            />
          </Control>

          <Control label={<ControlLabel label="LiveKit Server Port" tooltip="Port for the LiveKit server (default: 7880)." />} className="px-3">
            <Input
              type="number"
              placeholder="7880"
              value={configQuery.data?.livekitServerPort || 7880}
              onChange={(e) => {
                saveConfig({
                  livekitServerPort: parseInt(e.target.value) || 7880,
                })
              }}
            />
          </Control>

          <Control label={<ControlLabel label="Ngrok Auth Token" tooltip="Your ngrok auth token for tunneling mobile connections." />} className="px-3">
            <Input
              type="password"
              placeholder="Ngrok Auth Token"
              value={configQuery.data?.ngrokAuthToken || ""}
              onChange={(e) => {
                saveConfig({
                  ngrokAuthToken: e.target.value,
                })
              }}
            />
          </Control>

          <Control label={<ControlLabel label="Ngrok Region" tooltip="Ngrok tunnel region for optimal performance." />} className="px-3">
            <Select
              value={configQuery.data?.ngrokRegion || "us"}
              onValueChange={(value) => {
                saveConfig({
                  ngrokRegion: value,
                })
              }}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="us">United States</SelectItem>
                <SelectItem value="eu">Europe</SelectItem>
                <SelectItem value="ap">Asia Pacific</SelectItem>
                <SelectItem value="au">Australia</SelectItem>
                <SelectItem value="sa">South America</SelectItem>
                <SelectItem value="jp">Japan</SelectItem>
                <SelectItem value="in">India</SelectItem>
              </SelectContent>
            </Select>
          </Control>

          <Control label={<ControlLabel label="Mobile Audio Sample Rate" tooltip="Audio sample rate for mobile connections (default: 44100 Hz)." />} className="px-3">
            <Input
              type="number"
              placeholder="44100"
              value={configQuery.data?.mobileAudioSampleRate || 44100}
              onChange={(e) => {
                saveConfig({
                  mobileAudioSampleRate: parseInt(e.target.value) || 44100,
                })
              }}
            />
          </Control>

          <Control label={<ControlLabel label="Mobile Audio Bitrate" tooltip="Audio bitrate for mobile connections in kbps (default: 128)." />} className="px-3">
            <Input
              type="number"
              placeholder="128"
              value={configQuery.data?.mobileAudioBitrate || 128}
              onChange={(e) => {
                saveConfig({
                  mobileAudioBitrate: parseInt(e.target.value) || 128,
                })
              }}
            />
          </Control>

          <Control label={<ControlLabel label="QR Code Display" tooltip="Enable QR code generation for mobile app connections." />} className="px-3">
            <Switch
              checked={configQuery.data?.qrCodeDisplayEnabled ?? true}
              onCheckedChange={(value) => {
                saveConfig({
                  qrCodeDisplayEnabled: value,
                })
              }}
            />
          </Control>

          <Control label={<ControlLabel label="Mobile Session Timeout" tooltip="Session timeout in minutes for mobile connections (default: 60)." />} className="px-3">
            <Input
              type="number"
              placeholder="60"
              value={configQuery.data?.mobileSessionTimeout || 60}
              onChange={(e) => {
                saveConfig({
                  mobileSessionTimeout: parseInt(e.target.value) || 60,
                })
              }}
            />
          </Control>

          <Control label={<ControlLabel label="Max Concurrent Sessions" tooltip="Maximum number of concurrent mobile sessions (default: 5)." />} className="px-3">
            <Input
              type="number"
              placeholder="5"
              value={configQuery.data?.maxConcurrentMobileSessions || 5}
              onChange={(e) => {
                saveConfig({
                  maxConcurrentMobileSessions: parseInt(e.target.value) || 5,
                })
              }}
            />
          </Control>
        </ControlGroup>

        {/* About Section */}
        <ControlGroup title="About">
          <Control label="Version" className="px-3">
            <div className="text-sm">{process.env.APP_VERSION}</div>
          </Control>
        </ControlGroup>
      </div>
    </div>
  )
}
