import { useState, useEffect, useCallback, useRef } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@renderer/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@renderer/components/ui/card"
import { Checkbox } from "@renderer/components/ui/checkbox"
import { tipcClient } from "@renderer/lib/tipc-client"
import { useConfigQuery, useSaveConfigMutation } from "@renderer/lib/query-client"
import { toast } from "sonner"
import { Volume2, Mic, CheckCircle, ArrowRight, Loader2, Play, SkipForward } from "lucide-react"
import { MCPTransportType } from "@shared/types"

// MCP tool examples for onboarding - subset of most useful tools
const ONBOARDING_TOOLS = [
  {
    id: "memory",
    name: "Memory",
    description: "Persistent memory storage for the AI assistant to remember context across sessions",
    config: {
      transport: "stdio" as MCPTransportType,
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-memory"],
      env: {},
    },
  },
  {
    id: "sequential-thinking",
    name: "Sequential Thinking",
    description: "Helps the AI break down complex problems into step-by-step reasoning",
    config: {
      transport: "stdio" as MCPTransportType,
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
      env: {},
    },
  },
  {
    id: "desktop-commander",
    name: "Desktop Commander",
    description: "Control your desktop - run commands, manage files, and automate tasks",
    config: {
      transport: "stdio" as MCPTransportType,
      command: "npx",
      args: ["-y", "@wonderwhy-er/desktop-commander@latest"],
      env: {},
    },
  },
  {
    id: "playwright",
    name: "Playwright Browser",
    description: "Automate web browsers - navigate pages, fill forms, and extract data",
    config: {
      transport: "stdio" as MCPTransportType,
      command: "npx",
      args: ["-y", "@playwright/mcp@latest"],
      env: {},
    },
  },
]

type OnboardingStep = "welcome" | "tools" | "installing" | "complete"

export function Component() {
  const navigate = useNavigate()
  const configQuery = useConfigQuery()
  const saveConfigMutation = useSaveConfigMutation()
  
  const [step, setStep] = useState<OnboardingStep>("welcome")
  const [selectedTools, setSelectedTools] = useState<string[]>(["memory", "sequential-thinking"])
  const [isPlayingAudio, setIsPlayingAudio] = useState(false)
  const [installingTool, setInstallingTool] = useState<string | null>(null)
  const [installedTools, setInstalledTools] = useState<string[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Voice messages for each step
  const voiceMessages = {
    welcome: "Welcome to SpeakMCP! I'm here to help you set up your AI assistant with powerful tools. Let's discover some MCP tools that can supercharge your productivity.",
    tools: "Here are some recommended tools to get you started. Memory helps me remember our conversations. Sequential thinking helps me solve complex problems step by step. Desktop commander lets me control your computer. And Playwright helps me browse the web for you. Select the tools you'd like to install.",
    installing: "Great choices! I'm now installing your selected tools. This may take a moment.",
    complete: "Excellent! Your tools are now installed and ready to use. You can always add more tools from the MCP Tools settings. Let's start using SpeakMCP!",
  }

  const playVoiceMessage = useCallback(async (message: string) => {
    if (!configQuery.data?.ttsEnabled) {
      return // TTS not enabled, skip voice
    }
    
    try {
      setIsPlayingAudio(true)
      const audioData = await tipcClient.generateSpeech({ text: message })
      
      if (audioData && audioRef.current) {
        const blob = new Blob([audioData], { type: "audio/wav" })
        const url = URL.createObjectURL(blob)
        audioRef.current.src = url
        audioRef.current.onended = () => {
          setIsPlayingAudio(false)
          URL.revokeObjectURL(url)
        }
        audioRef.current.onerror = () => {
          setIsPlayingAudio(false)
          URL.revokeObjectURL(url)
        }
        await audioRef.current.play()
      }
    } catch (error) {
      console.error("Failed to play voice message:", error)
      setIsPlayingAudio(false)
    }
  }, [configQuery.data?.ttsEnabled])

  // Play welcome message on mount
  useEffect(() => {
    if (step === "welcome" && configQuery.data) {
      const timer = setTimeout(() => {
        playVoiceMessage(voiceMessages.welcome)
      }, 500)
      return () => clearTimeout(timer)
    }
  }, [step, configQuery.data])

  const handleToolToggle = (toolId: string) => {
    setSelectedTools(prev => 
      prev.includes(toolId) 
        ? prev.filter(id => id !== toolId)
        : [...prev, toolId]
    )
  }

  const handleInstallTools = async () => {
    setStep("installing")
    playVoiceMessage(voiceMessages.installing)
    
    for (const toolId of selectedTools) {
      const tool = ONBOARDING_TOOLS.find(t => t.id === toolId)
      if (!tool) continue
      
      setInstallingTool(toolId)
      try {
        // Add the MCP server configuration
        const currentConfig = configQuery.data?.mcpConfig || { mcpServers: {} }
        const newConfig = {
          ...currentConfig,
          mcpServers: {
            ...currentConfig.mcpServers,
            [tool.name.toLowerCase().replace(/\s+/g, "-")]: tool.config,
          },
        }
        
        await saveConfigMutation.mutateAsync({
          config: { ...configQuery.data, mcpConfig: newConfig },
        })
        
        setInstalledTools(prev => [...prev, toolId])
        toast.success(`Installed ${tool.name}`)
      } catch (error) {
        console.error(`Failed to install ${tool.name}:`, error)
        toast.error(`Failed to install ${tool.name}`)
      }
    }
    
    setInstallingTool(null)
    setStep("complete")
    playVoiceMessage(voiceMessages.complete)
  }

  const handleComplete = async () => {
    // Mark onboarding as completed
    await saveConfigMutation.mutateAsync({
      config: { ...configQuery.data, voiceOnboardingCompleted: true },
    })
    navigate("/")
  }

  const handleSkip = async () => {
    // Mark onboarding as skipped
    await saveConfigMutation.mutateAsync({
      config: { ...configQuery.data, voiceOnboardingSkipped: true },
    })
    navigate("/")
  }

  const handleNextStep = () => {
    if (step === "welcome") {
      setStep("tools")
      playVoiceMessage(voiceMessages.tools)
    }
  }

  if (!configQuery.data) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    )
  }

  return (
    <div className="app-drag-region flex h-dvh flex-col items-center justify-center p-10">
      <audio ref={audioRef} />

      <div className="w-full max-w-2xl">
        {/* Progress indicator */}
        <div className="mb-8 flex justify-center gap-2">
          {["welcome", "tools", "installing", "complete"].map((s, i) => (
            <div
              key={s}
              className={`h-2 w-16 rounded-full transition-colors ${
                step === s ? "bg-primary" :
                ["welcome", "tools", "installing", "complete"].indexOf(step) > i
                  ? "bg-primary/50"
                  : "bg-muted"
              }`}
            />
          ))}
        </div>

        {step === "welcome" && (
          <Card className="text-center">
            <CardHeader>
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                <Volume2 className="h-8 w-8 text-primary" />
              </div>
              <CardTitle className="text-2xl">Welcome to SpeakMCP!</CardTitle>
              <CardDescription className="text-base">
                Let's set up your AI assistant with powerful MCP tools
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                {voiceMessages.welcome}
              </p>
              <div className="flex justify-center gap-3">
                <Button variant="outline" onClick={handleSkip}>
                  <SkipForward className="mr-2 h-4 w-4" />
                  Skip Setup
                </Button>
                <Button onClick={handleNextStep} disabled={isPlayingAudio}>
                  {isPlayingAudio ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowRight className="mr-2 h-4 w-4" />
                  )}
                  Discover Tools
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === "tools" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mic className="h-5 w-5" />
                Select Your Tools
              </CardTitle>
              <CardDescription>
                Choose the MCP tools you'd like to install. You can add more later.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3">
                {ONBOARDING_TOOLS.map((tool) => (
                  <div
                    key={tool.id}
                    className={`flex items-start gap-3 rounded-lg border p-4 transition-colors cursor-pointer ${
                      selectedTools.includes(tool.id)
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50"
                    }`}
                    onClick={() => handleToolToggle(tool.id)}
                  >
                    <Checkbox
                      checked={selectedTools.includes(tool.id)}
                      onCheckedChange={() => handleToolToggle(tool.id)}
                    />
                    <div className="flex-1">
                      <div className="font-medium">{tool.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {tool.description}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between pt-4">
                <Button variant="outline" onClick={handleSkip}>
                  Skip
                </Button>
                <Button
                  onClick={handleInstallTools}
                  disabled={selectedTools.length === 0}
                >
                  <Play className="mr-2 h-4 w-4" />
                  Install {selectedTools.length} Tool{selectedTools.length !== 1 ? "s" : ""}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === "installing" && (
          <Card className="text-center">
            <CardHeader>
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
              <CardTitle>Installing Tools</CardTitle>
              <CardDescription>
                Setting up your selected MCP tools...
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {selectedTools.map((toolId) => {
                  const tool = ONBOARDING_TOOLS.find(t => t.id === toolId)
                  const isInstalled = installedTools.includes(toolId)
                  const isInstalling = installingTool === toolId

                  return (
                    <div
                      key={toolId}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <span>{tool?.name}</span>
                      {isInstalled ? (
                        <CheckCircle className="h-5 w-5 text-green-500" />
                      ) : isInstalling ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <div className="h-5 w-5" />
                      )}
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {step === "complete" && (
          <Card className="text-center">
            <CardHeader>
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                <CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400" />
              </div>
              <CardTitle>You're All Set!</CardTitle>
              <CardDescription>
                Your MCP tools are installed and ready to use
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                {voiceMessages.complete}
              </p>
              <div className="rounded-lg bg-muted/50 p-4">
                <div className="text-sm font-medium mb-2">Installed Tools:</div>
                <div className="flex flex-wrap gap-2">
                  {installedTools.map((toolId) => {
                    const tool = ONBOARDING_TOOLS.find(t => t.id === toolId)
                    return (
                      <span
                        key={toolId}
                        className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-sm"
                      >
                        <CheckCircle className="h-3 w-3" />
                        {tool?.name}
                      </span>
                    )
                  })}
                </div>
              </div>
              <Button onClick={handleComplete} className="w-full">
                <ArrowRight className="mr-2 h-4 w-4" />
                Start Using SpeakMCP
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

