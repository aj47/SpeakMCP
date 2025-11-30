import { Button } from "@renderer/components/ui/button"
import {
  useConfigQuery,
  useSaveConfigMutation,
} from "@renderer/lib/query-client"
import { useCallback } from "react"
import { Config } from "@shared/types"
import { useNavigate } from "react-router-dom"

export function Component() {
  const configQuery = useConfigQuery()
  const saveConfigMutation = useSaveConfigMutation()
  const navigate = useNavigate()

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

  const handleGetStarted = () => {
    navigate("/settings")
  }

  const handleHideWelcome = () => {
    saveConfig({ showWelcomeTab: false })
    navigate("/settings")
  }

  if (!configQuery.data) return null

  return (
    <div className="modern-panel h-full overflow-auto px-6 py-6">
      <div className="max-w-2xl mx-auto space-y-8">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="text-5xl mb-4">🎙️</div>
          <h1 className="text-3xl font-bold">Welcome to SpeakMCP</h1>
          <p className="text-muted-foreground text-lg">
            Your AI-powered voice assistant with MCP tool integration
          </p>
        </div>

        {/* Features Overview */}
        <div className="grid gap-4">
          <FeatureCard
            icon="🗣️"
            title="Voice Input"
            description="Hold a hotkey to speak. Your voice is transcribed and sent to your AI model."
          />
          <FeatureCard
            icon="🤖"
            title="Agent Mode"
            description="Let AI agents execute multi-step tasks using MCP tools like file operations, web browsing, and more."
          />
          <FeatureCard
            icon="🔧"
            title="MCP Tools"
            description="Connect powerful tools via the Model Context Protocol. Browse files, control your desktop, and integrate with services."
          />
          <FeatureCard
            icon="⌨️"
            title="Text Input"
            description="Prefer typing? Use the text input panel for quick interactions with your AI."
          />
        </div>

        {/* Getting Started */}
        <div className="rounded-lg border bg-card p-6 space-y-4">
          <h2 className="text-xl font-semibold">Getting Started</h2>
          <ol className="space-y-3 text-sm text-muted-foreground">
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-medium">1</span>
              <span><strong className="text-foreground">Configure your API key</strong> — Go to Models to set up your OpenAI, Groq, or Gemini credentials.</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-medium">2</span>
              <span><strong className="text-foreground">Set up MCP tools</strong> — Visit MCP Tools to enable and configure available tools.</span>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-medium">3</span>
              <span><strong className="text-foreground">Try the hotkeys</strong> — Hold <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-xs">Ctrl</kbd> to record voice, or <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-xs">Ctrl+Alt</kbd> for agent mode.</span>
            </li>
          </ol>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button size="lg" onClick={handleGetStarted}>
            Get Started
          </Button>
          <Button size="lg" variant="outline" onClick={handleHideWelcome}>
            Don't Show Again
          </Button>
        </div>

        {/* Footer Note */}
        <p className="text-center text-xs text-muted-foreground">
          You can always access this page again from General Settings.
        </p>
      </div>
    </div>
  )
}

function FeatureCard({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div className="rounded-lg border bg-card p-4 flex gap-4 items-start">
      <span className="text-2xl">{icon}</span>
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

