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

import { Textarea } from "@renderer/components/ui/textarea"
import { Input } from "@renderer/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@renderer/components/ui/dialog"
import { Button } from "@renderer/components/ui/button"
import {
  useConfigQuery,
  useSaveConfigMutation,
} from "@renderer/lib/query-client"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useState } from "react"
import { Config } from "@shared/types"

export function Component() {
  const configQuery = useConfigQuery()

  const saveConfigMutation = useSaveConfigMutation()

  const saveConfig = (config: Partial<Config>) => {
    saveConfigMutation.mutate({
      config: {
        ...configQuery.data,
        ...config,
      },
    })
  }



  const shortcut = configQuery.data?.shortcut || "hold-ctrl"

  if (!configQuery.data) return null

  return (
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
            </SelectContent>
          </Select>
        </Control>
      </ControlGroup>

      <ControlGroup title="Speech to Text">
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
        )}
      </ControlGroup>
    </div>
  )
}
