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
import { Label } from "@renderer/components/ui/label"
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
import { ProfileManager } from "@renderer/components/profile-manager"
import { Save } from "lucide-react"

export function Component() {
  const configQuery = useConfigQuery()

  const saveConfigMutation = useSaveConfigMutation()

  const saveConfig = useCallback(
    (config: Partial<Config>) => {
      saveConfigMutation.mutate(
        {
          config: {
            ...(configQuery.data as any),
            ...config,
          },
        },
        {
          onError: (error) => {
            console.error("Failed to save config:", error)
            // TODO: Show user-friendly error notification
          },
        },
      )
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

  // Agent settings state
  const [additionalGuidelines, setAdditionalGuidelines] = useState("")
  const [hasGuidelinesUnsavedChanges, setHasGuidelinesUnsavedChanges] = useState(false)

  // Initialize agent guidelines state when config loads
  useEffect(() => {
    if (configQuery.data?.mcpToolsSystemPrompt !== undefined) {
      setAdditionalGuidelines(configQuery.data.mcpToolsSystemPrompt)
      setHasGuidelinesUnsavedChanges(false)
    }
  }, [configQuery.data?.mcpToolsSystemPrompt])

  const saveAdditionalGuidelines = () => {
    saveConfig({ mcpToolsSystemPrompt: additionalGuidelines })
    setHasGuidelinesUnsavedChanges(false)
  }

  const revertGuidelinesChanges = () => {
    setAdditionalGuidelines(configQuery.data?.mcpToolsSystemPrompt || "")
    setHasGuidelinesUnsavedChanges(false)
  }

  const handleGuidelinesChange = (value: string) => {
    setAdditionalGuidelines(value)
    setHasGuidelinesUnsavedChanges(value !== (configQuery.data?.mcpToolsSystemPrompt || ""))
  }

  const defaultAdditionalGuidelines = `CUSTOM GUIDELINES:
- Prioritize user privacy and security
- Provide clear explanations of actions taken
- Ask for confirmation before destructive operations

DOMAIN-SPECIFIC RULES:
- For file operations: Always backup important files
- For system commands: Use safe, non-destructive commands when possible
- For API calls: Respect rate limits and handle errors gracefully`

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

          <Control label="Settings Window" className="px-3">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Switch
                  checked={configQuery.data?.settingsHotkeyEnabled ?? true}
                  onCheckedChange={(checked) => {
                    saveConfig({
                      settingsHotkeyEnabled: checked,
                    })
                  }}
                />
                <Select
                  value={configQuery.data?.settingsHotkey || "ctrl-shift-s"}
                  onValueChange={(value) => {
                    saveConfig({
                      settingsHotkey:
                        value as typeof configQuery.data.settingsHotkey,
                    })
                  }}
                  disabled={!configQuery.data?.settingsHotkeyEnabled}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ctrl-shift-s">Ctrl+Shift+S</SelectItem>
                    <SelectItem value="ctrl-comma">Ctrl+,</SelectItem>
                    <SelectItem value="ctrl-shift-comma">Ctrl+Shift+,</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {configQuery.data?.settingsHotkey === "custom" &&
                configQuery.data?.settingsHotkeyEnabled && (
                  <KeyRecorder
                    value={configQuery.data?.customSettingsHotkey || ""}
                    onChange={(keyCombo) => {
                      saveConfig({
                        customSettingsHotkey: keyCombo,
                      })
                    }}
                    placeholder="Click to record custom settings hotkey"
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

        {/* Agent Settings Section */}
        <ControlGroup title="Agent Settings">
          <Control label={<ControlLabel label="Enable MCP Tool Calling" tooltip="Allow the AI to use MCP tools to perform actions" />} className="px-3">
            <Switch
              checked={configQuery.data?.mcpToolsEnabled || false}
              onCheckedChange={(checked) => saveConfig({ mcpToolsEnabled: checked })}
            />
          </Control>

          {configQuery.data?.mcpToolsEnabled && (
            <>
              <Control label={<ControlLabel label="Shortcut" tooltip="Choose how to activate MCP tool calling mode" />} className="px-3">
                <div className="space-y-2">
                  <Select
                    value={configQuery.data?.mcpToolsShortcut || "hold-ctrl-alt"}
                    onValueChange={(value: "hold-ctrl-alt" | "ctrl-alt-slash" | "custom") =>
                      saveConfig({ mcpToolsShortcut: value })
                    }
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hold-ctrl-alt">Hold Ctrl+Alt</SelectItem>
                      <SelectItem value="ctrl-alt-slash">Ctrl+Alt+/</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>

                  {configQuery.data?.mcpToolsShortcut === "custom" && (
                    <KeyRecorder
                      value={configQuery.data?.customMcpToolsShortcut || ""}
                      onChange={(keyCombo) => saveConfig({ customMcpToolsShortcut: keyCombo })}
                      placeholder="Click to record custom MCP tools shortcut"
                    />
                  )}
                </div>
              </Control>

              <Control label={<ControlLabel label="Enable Agent Mode" tooltip="When enabled, the agent can see tool results and make follow-up tool calls until the task is complete" />} className="px-3">
                <Switch
                  checked={configQuery.data?.mcpAgentModeEnabled || false}
                  onCheckedChange={(checked) => saveConfig({ mcpAgentModeEnabled: checked })}
                />
              </Control>

              <Control label={<ControlLabel label="Require Approval" tooltip="Adds a confirmation dialog before any tool executes. Recommended for safety, especially in production environments." />} className="px-3">
                <Switch
                  checked={!!configQuery.data?.mcpRequireApprovalBeforeToolCall}
                  onCheckedChange={(checked) => saveConfig({ mcpRequireApprovalBeforeToolCall: checked })}
                />
              </Control>

              {configQuery.data?.mcpAgentModeEnabled && (
                <Control label={<ControlLabel label="Max Iterations" tooltip="Maximum number of iterations the agent can perform before stopping. Higher values allow more complex tasks but may take longer." />} className="px-3">
                  <Input
                    type="number"
                    min="1"
                    max="50"
                    step="1"
                    value={configQuery.data?.mcpMaxIterations ?? 10}
                    onChange={(e) => saveConfig({ mcpMaxIterations: parseInt(e.target.value) || 1 })}
                    className="w-20"
                  />
                </Control>
              )}

              {!configQuery.data?.mcpAgentModeEnabled && (
                <>
                  <Control label={<ControlLabel label="Auto-paste Results" tooltip="Automatically paste tool results to the focused input field" />} className="px-3">
                    <Switch
                      checked={configQuery.data?.mcpAutoPasteEnabled !== false}
                      onCheckedChange={(checked) => saveConfig({ mcpAutoPasteEnabled: checked })}
                    />
                  </Control>

                  {configQuery.data?.mcpAutoPasteEnabled !== false && (
                    <Control label={<ControlLabel label="Auto-paste Delay (ms)" tooltip="Delay before pasting to allow you to return focus to the desired input field. Recommended: 1000ms (1 second)." />} className="px-3">
                      <Input
                        type="number"
                        min="0"
                        max="10000"
                        step="100"
                        value={configQuery.data?.mcpAutoPasteDelay ?? 1000}
                        onChange={(e) => {
                          const parsed = parseInt(e.target.value)
                          saveConfig({ mcpAutoPasteDelay: Number.isNaN(parsed) ? 1000 : parsed })
                        }}
                        className="w-24"
                      />
                    </Control>
                  )}
                </>
              )}
            </>
          )}
        </ControlGroup>

        {/* Agent Guidelines Section - shown when agent mode is enabled */}
        {configQuery.data?.mcpToolsEnabled && configQuery.data?.mcpAgentModeEnabled && (
          <ControlGroup title="Agent Guidelines">
            <div className="px-3 py-2 space-y-4">
              <div className="rounded-lg border p-4 space-y-4">
                <div>
                  <h3 className="text-sm font-semibold mb-1">Profile Management</h3>
                  <p className="text-xs text-muted-foreground mb-3">
                    Save and load different guideline configurations for different workflows.
                  </p>
                </div>
                <ProfileManager
                  currentGuidelines={additionalGuidelines}
                  onGuidelinesChange={(guidelines) => {
                    setAdditionalGuidelines(guidelines)
                    setHasGuidelinesUnsavedChanges(guidelines !== (configQuery.data?.mcpToolsSystemPrompt || ""))
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Additional Guidelines</Label>
                <p className="text-xs text-muted-foreground">
                  Optional additional rules and guidelines for the AI agent. The base system prompt with tool usage instructions is automatically included.
                </p>
                <Textarea
                  value={additionalGuidelines}
                  onChange={(e) => handleGuidelinesChange(e.target.value)}
                  rows={6}
                  className="font-mono text-sm"
                  placeholder={defaultAdditionalGuidelines}
                />
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setAdditionalGuidelines(defaultAdditionalGuidelines)
                    setHasGuidelinesUnsavedChanges(defaultAdditionalGuidelines !== (configQuery.data?.mcpToolsSystemPrompt || ""))
                  }}
                >
                  Use Example Guidelines
                </Button>
                {hasGuidelinesUnsavedChanges && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={revertGuidelinesChanges}
                    disabled={saveConfigMutation.isPending}
                  >
                    Revert Changes
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={saveAdditionalGuidelines}
                  disabled={!hasGuidelinesUnsavedChanges || saveConfigMutation.isPending}
                  className="gap-1"
                >
                  <Save className="h-3 w-3" />
                  {saveConfigMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
              {hasGuidelinesUnsavedChanges && (
                <p className="text-xs text-amber-600">
                  You have unsaved changes. Click "Save Changes" to apply them.
                </p>
              )}
            </div>
          </ControlGroup>
        )}

        {/* Emergency Kill Switch - shown when agent mode is enabled */}
        {configQuery.data?.mcpAgentModeEnabled && (
          <ControlGroup title="Emergency Kill Switch">
            <div className="px-3 py-2 space-y-4 rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/20">
              <Control label={<ControlLabel label="Enable Kill Switch" tooltip="Provides a global hotkey to immediately stop agent mode and kill all agent-created processes" />} className="!py-0">
                <Switch
                  checked={configQuery.data?.agentKillSwitchEnabled !== false}
                  onCheckedChange={(checked) => saveConfig({ agentKillSwitchEnabled: checked })}
                />
              </Control>
              <p className="text-xs text-red-700 dark:text-red-300">
                Provides a global hotkey to immediately stop agent mode and kill all agent-created processes.
              </p>

              {configQuery.data?.agentKillSwitchEnabled !== false && (
                <div className="space-y-2">
                  <Label className="text-red-800 dark:text-red-200">Kill Switch Hotkey</Label>
                  <select
                    value={configQuery.data?.agentKillSwitchHotkey || "ctrl-shift-escape"}
                    onChange={(e) => saveConfig({ agentKillSwitchHotkey: e.target.value as any })}
                    className="w-full rounded-md border bg-background p-2"
                  >
                    <option value="ctrl-shift-escape">Ctrl + Shift + Escape</option>
                    <option value="ctrl-alt-q">Ctrl + Alt + Q</option>
                    <option value="ctrl-shift-q">Ctrl + Shift + Q</option>
                    <option value="custom">Custom</option>
                  </select>

                  {configQuery.data?.agentKillSwitchHotkey === "custom" && (
                    <KeyRecorder
                      value={configQuery.data?.customAgentKillSwitchHotkey || ""}
                      onChange={(keyCombo) => saveConfig({ customAgentKillSwitchHotkey: keyCombo })}
                      placeholder="Click to record custom kill switch hotkey"
                    />
                  )}
                </div>
              )}
            </div>
          </ControlGroup>
        )}

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
