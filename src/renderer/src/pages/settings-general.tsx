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
import { useQuery } from "@tanstack/react-query"
import { AlertCircle, CheckCircle2 } from "lucide-react"

export function Component() {
  const configQuery = useConfigQuery()

  const saveConfigMutation = useSaveConfigMutation()

  // Check screen recording permission status
  const screenCaptureStatusQuery = useQuery({
    queryKey: ["screenCaptureStatus"],
    queryFn: () => tipcClient.getScreenCaptureStatus(),
    refetchInterval: 2000, // Check every 2 seconds to detect when user grants permission
  })

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

      <div className="grid gap-4">
        <ControlGroup title="App">
          {process.env.IS_MAC && (
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
          )}
          <Control label="Launch at Login" className="px-3">
            <Switch
              defaultChecked={configQuery.data.launchAtLogin ?? false}
              onCheckedChange={(value) => {
                saveConfig({
                  launchAtLogin: value,
                })
              }}
            />
          </Control>
        </ControlGroup>

        <ControlGroup title="Appearance">
          <Control label="Theme" className="px-3">
            <Select
              value={configQuery.data.themePreference || "system"}
              onValueChange={(value: "system" | "light" | "dark") => {
                saveConfig({
                  themePreference: value,
                })
                // Update localStorage immediately to sync with ThemeProvider
                localStorage.setItem("theme-preference", value)
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
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Mode</label>
                    <Select
                      value={configQuery.data?.customShortcutMode || "hold"}
                      onValueChange={(value: "hold" | "toggle") => {
                        saveConfig({
                          customShortcutMode: value,
                        })
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="hold">Hold (Press and hold to record)</SelectItem>
                        <SelectItem value="toggle">Toggle (Press once to start, again to stop)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <KeyRecorder
                    value={configQuery.data?.customShortcut || ""}
                    onChange={(keyCombo) => {
                      saveConfig({
                        customShortcut: keyCombo,
                      })
                    }}
                    placeholder="Click to record custom shortcut"
                  />
                </>
              )}
            </div>
          </Control>

          <Control label="Toggle Voice Dictation" className="px-3">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Switch
                  checked={configQuery.data?.toggleVoiceDictationEnabled || false}
                  onCheckedChange={(checked) => {
                    saveConfig({
                      toggleVoiceDictationEnabled: checked,
                    })
                  }}
                />
                <span className="text-sm text-muted-foreground">
                  Enable toggle mode (press once to start, press again to stop)
                </span>
              </div>

              {configQuery.data?.toggleVoiceDictationEnabled && (
                <>
                  <Select
                    defaultValue={configQuery.data?.toggleVoiceDictationHotkey || "fn"}
                    onValueChange={(value) => {
                      saveConfig({
                        toggleVoiceDictationHotkey: value as typeof configQuery.data.toggleVoiceDictationHotkey,
                      })
                    }}
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fn">Fn</SelectItem>
                      <SelectItem value="f1">F1</SelectItem>
                      <SelectItem value="f2">F2</SelectItem>
                      <SelectItem value="f3">F3</SelectItem>
                      <SelectItem value="f4">F4</SelectItem>
                      <SelectItem value="f5">F5</SelectItem>
                      <SelectItem value="f6">F6</SelectItem>
                      <SelectItem value="f7">F7</SelectItem>
                      <SelectItem value="f8">F8</SelectItem>
                      <SelectItem value="f9">F9</SelectItem>
                      <SelectItem value="f10">F10</SelectItem>
                      <SelectItem value="f11">F11</SelectItem>
                      <SelectItem value="f12">F12</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>

                  {configQuery.data?.toggleVoiceDictationHotkey === "custom" && (
                    <KeyRecorder
                      value={configQuery.data?.customToggleVoiceDictationHotkey || ""}
                      onChange={(keyCombo) => {
                        saveConfig({
                          customToggleVoiceDictationHotkey: keyCombo,
                        })
                      }}
                      placeholder="Click to record custom toggle shortcut"
                    />
                  )}
                </>
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
          <Control label={<ControlLabel label="Language" tooltip="Select the language for speech transcription. 'Auto-detect' lets the model determine the language automatically based on your speech." />} className="px-3">
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
          </Control>

          {sttProviderId === "openai" && configQuery.data.openaiSttLanguage && configQuery.data.openaiSttLanguage !== configQuery.data.sttLanguage && (
            <Control label={<ControlLabel label="OpenAI Language Override" tooltip="Override the global language setting specifically for OpenAI's Whisper transcription service." />} className="px-3">
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
            <Control label={<ControlLabel label="Groq Language Override" tooltip="Override the global language setting specifically for Groq's Whisper transcription service." />} className="px-3">
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
            <Control label={<ControlLabel label="Prompt" tooltip="Optional prompt to guide the model's style or specify how to spell unfamiliar words. Limited to 224 tokens." />} className="px-3">
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

        <ControlGroup title="Text to Speech">
          <Control label="Enabled" className="px-3">
            <Switch
              defaultChecked={configQuery.data.ttsEnabled ?? false}
              onCheckedChange={(value) => {
                saveConfig({
                  ttsEnabled: value,
                })
              }}
            />
          </Control>

          {configQuery.data.ttsEnabled && (
            <Control label={<ControlLabel label="Auto-play" tooltip="Automatically play TTS audio when assistant responses complete" />} className="px-3">
              <Switch
                defaultChecked={configQuery.data.ttsAutoPlay ?? true}
                onCheckedChange={(value) => {
                  saveConfig({
                    ttsAutoPlay: value,
                  })
                }}
              />
            </Control>
          )}

          {configQuery.data.ttsEnabled && (
            <>
              <Control label={<ControlLabel label="Text Preprocessing" tooltip="Enable preprocessing to make text more speech-friendly by removing code blocks, URLs, and converting markdown" />} className="px-3">
                <Switch
                  defaultChecked={configQuery.data.ttsPreprocessingEnabled ?? true}
                  onCheckedChange={(value) => {
                    saveConfig({
                      ttsPreprocessingEnabled: value,
                    })
                  }}
                />
              </Control>

              {configQuery.data.ttsPreprocessingEnabled !== false && (
                <>
                  <Control label={<ControlLabel label="Remove Code Blocks" tooltip="Remove code blocks and replace with descriptive text" />} className="px-3">
                    <Switch
                      defaultChecked={configQuery.data.ttsRemoveCodeBlocks ?? true}
                      onCheckedChange={(value) => {
                        saveConfig({
                          ttsRemoveCodeBlocks: value,
                        })
                      }}
                    />
                  </Control>

                  <Control label={<ControlLabel label="Remove URLs" tooltip="Remove URLs and replace with descriptive text" />} className="px-3">
                    <Switch
                      defaultChecked={configQuery.data.ttsRemoveUrls ?? true}
                      onCheckedChange={(value) => {
                        saveConfig({
                          ttsRemoveUrls: value,
                        })
                      }}
                    />
                  </Control>

                  <Control label={<ControlLabel label="Convert Markdown" tooltip="Convert markdown formatting to speech-friendly text" />} className="px-3">
                    <Switch
                      defaultChecked={configQuery.data.ttsConvertMarkdown ?? true}
                      onCheckedChange={(value) => {
                        saveConfig({
                          ttsConvertMarkdown: value,
                        })
                      }}
                    />
                  </Control>
                </>
              )}
            </>
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

        {/* Screenshot Settings */}
        <ControlGroup
          title="Screenshot / Multimodal"
          endDescription="Capture and send screenshots along with text input to multimodal AI models (e.g., GPT-4V, Claude with vision)"
        >
          <Control label="Enable Screenshot" className="px-3">
            <Switch
              defaultChecked={configQuery.data.screenshotEnabled ?? true}
              onCheckedChange={(value) => {
                saveConfig({
                  screenshotEnabled: value,
                })
              }}
            />
          </Control>

          {configQuery.data.screenshotEnabled && (
            <>
              {/* Screen Recording Permission Status (macOS only) */}
              {process.env.IS_MAC && (
                <div className="px-3 py-2 mx-3 mb-2 rounded-md bg-muted/50">
                  <div className="flex items-start gap-3">
                    {screenCaptureStatusQuery.data === "granted" ? (
                      <>
                        <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-green-700 dark:text-green-400">
                            Screen Recording Permission Granted
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Screenshots can be captured successfully.
                          </p>
                        </div>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                            Screen Recording Permission Required
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">
                            macOS requires Screen Recording permission to capture screenshots.
                          </p>
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2 h-7 text-xs"
                            onClick={() => {
                              tipcClient.openScreenCaptureInSystemPreferences()
                            }}
                          >
                            Open System Settings
                          </Button>
                          <p className="text-xs text-muted-foreground mt-2">
                            After granting permission, you may need to restart the app.
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              <Control
                label={
                  <ControlLabel
                    label="Image Format"
                    tooltip="JPEG is smaller and faster, PNG is lossless but larger"
                  />
                }
                className="px-3"
              >
                <Select
                  value={configQuery.data?.screenshotFormat || "jpeg"}
                  onValueChange={(value: "jpeg" | "png") => {
                    saveConfig({
                      screenshotFormat: value,
                    })
                  }}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="jpeg">JPEG (Recommended)</SelectItem>
                    <SelectItem value="png">PNG</SelectItem>
                  </SelectContent>
                </Select>
              </Control>

              {configQuery.data?.screenshotFormat === "jpeg" && (
                <Control
                  label={
                    <ControlLabel
                      label="JPEG Quality"
                      tooltip="Higher quality = larger file size. 0.8 is recommended for good balance."
                    />
                  }
                  className="px-3"
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="0.1"
                      max="1.0"
                      step="0.1"
                      value={configQuery.data?.screenshotQuality ?? 0.8}
                      onChange={(e) => {
                        saveConfig({
                          screenshotQuality: parseFloat(e.target.value),
                        })
                      }}
                      className="flex-1"
                    />
                    <span className="text-sm font-medium w-12 text-right">
                      {((configQuery.data?.screenshotQuality ?? 0.8) * 100).toFixed(0)}%
                    </span>
                  </div>
                </Control>
              )}

              <Control
                label={
                  <ControlLabel
                    label="Max Width"
                    tooltip="Screenshots wider than this will be resized. Smaller = faster upload."
                  />
                }
                className="px-3"
              >
                <Select
                  value={String(configQuery.data?.screenshotMaxWidth || 1920)}
                  onValueChange={(value) => {
                    saveConfig({
                      screenshotMaxWidth: parseInt(value),
                    })
                  }}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1280">1280px (HD)</SelectItem>
                    <SelectItem value="1920">1920px (Full HD)</SelectItem>
                    <SelectItem value="2560">2560px (2K)</SelectItem>
                    <SelectItem value="3840">3840px (4K)</SelectItem>
                  </SelectContent>
                </Select>
              </Control>

              <Control
                label={
                  <ControlLabel
                    label="Max Height"
                    tooltip="Screenshots taller than this will be resized. Smaller = faster upload."
                  />
                }
                className="px-3"
              >
                <Select
                  value={String(configQuery.data?.screenshotMaxHeight || 1080)}
                  onValueChange={(value) => {
                    saveConfig({
                      screenshotMaxHeight: parseInt(value),
                    })
                  }}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="720">720px (HD)</SelectItem>
                    <SelectItem value="1080">1080px (Full HD)</SelectItem>
                    <SelectItem value="1440">1440px (2K)</SelectItem>
                    <SelectItem value="2160">2160px (4K)</SelectItem>
                  </SelectContent>
                </Select>
              </Control>
            </>
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
