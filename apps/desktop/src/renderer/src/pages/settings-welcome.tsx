import { useCallback } from "react"
import { Button } from "@renderer/components/ui/button"
import { Switch } from "@renderer/components/ui/switch"
import { Control, ControlGroup } from "@renderer/components/ui/control"
import {
  useConfigQuery,
  useSaveConfigMutation,
} from "@renderer/lib/query-client"
import type { Config } from "@shared/types"
import { useNavigate } from "react-router-dom"
import { Mic, MessageSquare, Wrench, Keyboard, Sparkles, ArrowRight } from "lucide-react"

export function Component() {
  const navigate = useNavigate()
  const configQuery = useConfigQuery()
  const saveConfigMutation = useSaveConfigMutation()

  const saveConfig = useCallback(
    (config: Partial<Config>) => {
      saveConfigMutation.mutate({
        config: {
          ...(configQuery.data as Config),
          ...config,
        },
      })
    },
    [saveConfigMutation, configQuery.data],
  )

  if (!configQuery.data) return null

  const features = [
    {
      icon: Mic,
      title: "Voice Input",
      description: "Hold a hotkey and speak to transcribe your voice into text or send commands to the AI agent.",
    },
    {
      icon: MessageSquare,
      title: "Text Input",
      description: "Press Ctrl+T to open a quick text input panel for typing commands directly.",
    },
    {
      icon: Wrench,
      title: "MCP Tools",
      description: "Connect powerful tools via the Model Context Protocol to extend your AI assistant's capabilities.",
    },
    {
      icon: Sparkles,
      title: "AI Agent Mode",
      description: "Let the AI agent perform multi-step tasks, using tools and reasoning to accomplish your goals.",
    },
  ]

  const shortcuts = [
    { keys: "Hold Ctrl", description: "Record voice input" },
    { keys: "Ctrl + T", description: "Open text input panel" },
    { keys: "Ctrl + Shift + S", description: "Open settings window" },
    { keys: "Ctrl + Shift + Esc", description: "Emergency stop agent" },
  ]

  return (
    <div className="modern-panel h-full overflow-auto px-6 py-4">
      <div className="max-w-3xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-3">
            <span className="i-mingcute-celebrate-line text-4xl text-primary"></span>
            <h1 className="text-3xl font-bold">Welcome to SpeakMCP!</h1>
          </div>
          <p className="text-muted-foreground text-lg">
            Your AI-powered voice and text assistant with tool integration.
          </p>
        </div>

        {/* Features Grid */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <span className="i-mingcute-star-line"></span>
            Key Features
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-md bg-primary/10">
                    <feature.icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-medium">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {feature.description}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Shortcuts */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Keyboard className="h-5 w-5" />
            Quick Shortcuts
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {shortcuts.map((shortcut) => (
              <div
                key={shortcut.keys}
                className="flex items-center justify-between p-3 rounded-lg border bg-card"
              >
                <span className="text-sm text-muted-foreground">{shortcut.description}</span>
                <kbd className="px-2 py-1 text-xs font-mono bg-muted rounded">
                  {shortcut.keys}
                </kbd>
              </div>
            ))}
          </div>
        </div>

        {/* Getting Started */}
        <div className="space-y-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <ArrowRight className="h-5 w-5" />
            Getting Started
          </h2>
          <div className="p-4 rounded-lg border bg-card space-y-3">
            <ol className="list-decimal list-inside space-y-2 text-sm">
              <li>Configure your API keys in <strong>Models</strong> settings</li>
              <li>Set up MCP servers in <strong>MCP Tools</strong> to add capabilities</li>
              <li>Customize your shortcuts in <strong>General</strong> settings</li>
              <li>Try speaking a command or pressing Ctrl+T to get started!</li>
            </ol>
            <div className="flex gap-2 pt-2">
              <Button onClick={() => navigate("/settings/models")} size="sm">
                Configure Models
              </Button>
              <Button onClick={() => navigate("/settings/mcp-tools")} variant="outline" size="sm">
                Setup MCP Tools
              </Button>
            </div>
          </div>
        </div>

        {/* Hide Welcome Tab Option */}
        <ControlGroup title="Preferences">
          <Control label="Hide this Welcome tab" className="px-3">
            <Switch
              checked={configQuery.data.hideWelcomeTab ?? false}
              onCheckedChange={(value) => saveConfig({ hideWelcomeTab: value })}
            />
          </Control>
          <p className="text-xs text-muted-foreground px-3 pb-3">
            You can always show this tab again from General Settings.
          </p>
        </ControlGroup>
      </div>
    </div>
  )
}

