import { Control, ControlGroup } from "@renderer/components/ui/control"
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
import {
  CHAT_PROVIDER_ID,
  CHAT_PROVIDERS,
  STT_PROVIDER_ID,
  STT_PROVIDERS,
} from "@shared/index"
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
import { useState, useCallback } from "react"
import { Config } from "@shared/types"
import { KeyRecorder } from "@renderer/components/key-recorder"
import { getEffectiveShortcut, formatKeyComboForDisplay } from "@shared/key-utils"

export function Component() {
  const configQuery = useConfigQuery()

  const saveConfigMutation = useSaveConfigMutation()

  const saveConfig = useCallback((config: Partial<Config>) => {
    saveConfigMutation.mutate({
      config: {
        ...configQuery.data,
        ...config,
      },
    })
  }, [saveConfigMutation, configQuery.data])

  // Memoize model change handler to prevent infinite re-renders
  const handleTranscriptModelChange = useCallback((value: string) => {
    const transcriptPostProcessingProviderId = configQuery.data?.transcriptPostProcessingProviderId || "openai"

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
  }, [saveConfig, configQuery.data?.transcriptPostProcessingProviderId])



  const sttProviderId: STT_PROVIDER_ID =
    configQuery.data?.sttProviderId || "openai"
  const shortcut = configQuery.data?.shortcut || "hold-ctrl"
  const textInputShortcut = configQuery.data?.textInputShortcut || "ctrl-t"
  const transcriptPostProcessingProviderId: CHAT_PROVIDER_ID =
    configQuery.data?.transcriptPostProcessingProviderId || "openai"

  if (!configQuery.data) return null

  return (
    <div className="h-full overflow-auto px-6 py-4 liquid-glass-panel">
      <header className="mb-5 liquid-glass-card glass-border rounded-lg p-4 glass-shadow">
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
                    textInputShortcut: value as typeof configQuery.data.textInputShortcut,
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

            {textInputShortcut === "custom" && configQuery.data?.textInputEnabled && (
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
        <Control label="Current Provider" className="px-3">
          <div className="flex items-center justify-between">
            <span className="text-sm">
              {STT_PROVIDERS.find(p => p.value === sttProviderId)?.label || "OpenAI"}
            </span>
            <span className="text-xs text-muted-foreground">
              Configure in Providers tab
            </span>
          </div>
        </Control>

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
          <>
            <Control label="Current Provider" className="px-3">
              <div className="flex items-center justify-between">
                <span className="text-sm">
                  {CHAT_PROVIDERS.find(p => p.value === transcriptPostProcessingProviderId)?.label || "OpenAI"}
                </span>
                <span className="text-xs text-muted-foreground">
                  Configure provider and model in Providers tab
                </span>
              </div>
            </Control>

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
                          transcriptPostProcessingPrompt: e.currentTarget.value,
                        })
                      }}
                    ></Textarea>
                    <div className="text-sm text-muted-foreground">
                      Use <span className="select-text">{"{transcript}"}</span>{" "}
                      placeholder to insert the original transcript
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </Control>
          </>
        )}
      </ControlGroup>

      {/* About Section */}
      <ControlGroup title="About">
        <Control label="Version" className="px-3">
          <div className="text-sm">
            {process.env.APP_VERSION}
          </div>
        </Control>
      </ControlGroup>
      </div>
    </div>
  )
}
