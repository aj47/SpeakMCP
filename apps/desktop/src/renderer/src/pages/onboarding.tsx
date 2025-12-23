import { useState, useCallback, useRef, useEffect } from "react"
import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { Textarea } from "@renderer/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select"
import { useConfigQuery, useSaveConfigMutation } from "@renderer/lib/query-client"
import { Config } from "@shared/types"
import { useNavigate } from "react-router-dom"
import { tipcClient } from "@renderer/lib/tipc-client"
import { Recorder } from "@renderer/lib/recorder"
import { useMutation } from "@tanstack/react-query"
import { KeyRecorder } from "@renderer/components/key-recorder"

type OnboardingStep = "welcome" | "api-key" | "dictation" | "agent" | "complete"

export function Component() {
  const [step, setStep] = useState<OnboardingStep>("welcome")
  const [apiKey, setApiKey] = useState("")
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [dictationResult, setDictationResult] = useState<string | null>(null)
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null)
  const [micError, setMicError] = useState<string | null>(null)
  const navigate = useNavigate()
  const configQuery = useConfigQuery()
  const saveConfigMutation = useSaveConfigMutation()
  const recorderRef = useRef<Recorder | null>(null)

  const saveConfig = useCallback(
    (config: Partial<Config>) => {
      if (!configQuery.data) return
      saveConfigMutation.mutate({
        config: {
          ...configQuery.data,
          ...config,
        },
      })
    },
    [saveConfigMutation, configQuery.data]
  )

  const saveConfigAsync = useCallback(
    async (config: Partial<Config>) => {
      if (!configQuery.data) return
      await saveConfigMutation.mutateAsync({
        config: {
          ...configQuery.data,
          ...config,
        },
      })
    },
    [saveConfigMutation, configQuery.data]
  )

  // Transcription mutation
  const transcribeMutation = useMutation({
    mutationFn: async ({ blob, duration }: { blob: Blob; duration: number }) => {
      setIsTranscribing(true)
      const result = await tipcClient.createRecording({
        recording: await blob.arrayBuffer(),
        duration,
      })
      return result
    },
    onSuccess: (result) => {
      setIsTranscribing(false)
      if (result?.transcript) {
        setDictationResult(result.transcript)
      }
    },
    onError: (error: any) => {
      setIsTranscribing(false)
      console.error("Transcription failed:", error)
      const errorMessage = error?.message || String(error)
      if (errorMessage.includes("API key") || errorMessage.includes("401") || errorMessage.includes("403")) {
        setTranscriptionError("API key is missing or invalid. Please go back and enter a valid Groq API key.")
      } else if (errorMessage.includes("model")) {
        setTranscriptionError("Model configuration error. Please check your settings.")
      } else {
        setTranscriptionError(`Transcription failed: ${errorMessage}`)
      }
    },
  })

  // Initialize recorder
  useEffect(() => {
    if (recorderRef.current) return undefined

    const recorder = (recorderRef.current = new Recorder())

    recorder.on("record-start", () => {
      setIsRecording(true)
    })

    recorder.on("record-end", (blob, duration) => {
      setIsRecording(false)
      if (blob.size > 0 && duration >= 100) {
        transcribeMutation.mutate({ blob, duration })
      }
    })

    return () => {
      recorder.stopRecording()
    }
  }, [])

  const handleSaveApiKey = useCallback(async () => {
    if (!apiKey.trim()) return

    // Save Groq API key and set Groq as the default provider for STT, chat, and TTS
    // Wait for config to save before advancing to ensure transcription uses the new provider
    await saveConfigAsync({
      groqApiKey: apiKey.trim(),
      sttProviderId: "groq",
      transcriptPostProcessingProviderId: "groq",
      mcpToolsProviderId: "groq",
      ttsProviderId: "groq",
    })

    setStep("dictation")
  }, [apiKey, saveConfigAsync])

  const handleSkipApiKey = useCallback(() => {
    setStep("dictation")
  }, [])

  const handleStartRecording = useCallback(async () => {
    setDictationResult(null)
    setTranscriptionError(null)
    setMicError(null)
    try {
      await recorderRef.current?.startRecording()
    } catch (error: any) {
      console.error("Failed to start recording:", error)
      const errorMessage = error?.message || String(error)
      if (errorMessage.includes("Permission denied") || errorMessage.includes("NotAllowedError")) {
        setMicError("Microphone access was denied. Please allow microphone access in your system settings and try again.")
      } else if (errorMessage.includes("NotFoundError") || errorMessage.includes("no audio input")) {
        setMicError("No microphone found. Please connect a microphone and try again.")
      } else {
        setMicError(`Failed to start recording: ${errorMessage}`)
      }
    }
  }, [])

  const handleStopRecording = useCallback(() => {
    recorderRef.current?.stopRecording()
  }, [])

  const handleCompleteOnboarding = useCallback(async () => {
    await saveConfigAsync({ onboardingCompleted: true })
    navigate("/")
  }, [saveConfigAsync, navigate])

  const handleSkipOnboarding = useCallback(async () => {
    await saveConfigAsync({ onboardingCompleted: true })
    navigate("/")
  }, [saveConfigAsync, navigate])

  return (
    <div className="app-drag-region flex h-dvh items-center justify-center p-10">
      <div className="w-full max-w-2xl -mt-10">
        {step === "welcome" && (
          <WelcomeStep onNext={() => setStep("api-key")} onSkip={handleSkipOnboarding} />
        )}
        {step === "api-key" && (
          <ApiKeyStep
            apiKey={apiKey}
            onApiKeyChange={setApiKey}
            onNext={handleSaveApiKey}
            onSkip={handleSkipApiKey}
            onBack={() => setStep("welcome")}
          />
        )}
        {step === "dictation" && (
          <DictationStep
            isRecording={isRecording}
            isTranscribing={isTranscribing}
            dictationResult={dictationResult}
            onDictationResultChange={setDictationResult}
            onStartRecording={handleStartRecording}
            onStopRecording={handleStopRecording}
            onNext={() => setStep("agent")}
            onBack={() => setStep("api-key")}
            config={configQuery.data}
            onSaveConfig={saveConfig}
            transcriptionError={transcriptionError}
            micError={micError}
          />
        )}
        {step === "agent" && (
          <AgentStep
            onComplete={handleCompleteOnboarding}
            onBack={() => setStep("dictation")}
            config={configQuery.data}
            onSaveConfig={saveConfig}
            onSaveConfigAsync={saveConfigAsync}
          />
        )}
      </div>
    </div>
  )
}

// Welcome Step
function WelcomeStep({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  return (
    <div className="text-center">
      <div className="mb-6">
        <span className="i-mingcute-mic-fill text-6xl text-primary"></span>
      </div>
      <h1 className="text-3xl font-extrabold mb-4">
        Welcome to {process.env.PRODUCT_NAME}!
      </h1>
      <p className="text-lg text-muted-foreground mb-8">
        Let's get you set up with voice dictation and AI-powered tools in just a few steps.
      </p>
      <div className="flex flex-col gap-3 items-center">
        <Button size="lg" onClick={onNext} className="w-64">
          Get Started
        </Button>
        <Button variant="ghost" onClick={onSkip} className="text-muted-foreground">
          Skip Tutorial
        </Button>
      </div>
    </div>
  )
}

// API Key Step
function ApiKeyStep({
  apiKey,
  onApiKeyChange,
  onNext,
  onSkip,
  onBack,
}: {
  apiKey: string
  onApiKeyChange: (value: string) => void
  onNext: () => void
  onSkip: () => void
  onBack: () => void
}) {
  return (
    <div>
      <StepIndicator current={1} total={3} />
      <h2 className="text-2xl font-bold mb-2 text-center">Set Up Your API Key</h2>
      <p className="text-muted-foreground mb-6 text-center">
        Enter your Groq API key to enable voice transcription and AI features.
        You can also configure other providers later in Settings.
      </p>
      <div className="space-y-4 mb-8">
        <div>
          <label className="block text-sm font-medium mb-2">Groq API Key</label>
          <Input
            type="password"
            placeholder="gsk_..."
            value={apiKey}
            onChange={(e) => onApiKeyChange(e.target.value)}
            className="w-full"
          />
          <p className="text-xs text-muted-foreground mt-2">
            Get your <span className="font-medium text-green-600 dark:text-green-400">free</span> API key from{" "}
            <a
              href="https://console.groq.com/keys"
              target="_blank"
              rel="noreferrer"
              className="text-primary underline"
            >
              console.groq.com/keys
            </a>
          </p>
        </div>
      </div>
      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onSkip}>
            Skip for Now
          </Button>
          <Button onClick={onNext} disabled={!apiKey.trim()}>
            Continue
          </Button>
        </div>
      </div>
    </div>
  )
}


// Dictation Step
function DictationStep({
  isRecording,
  isTranscribing,
  dictationResult,
  onDictationResultChange,
  onStartRecording,
  onStopRecording,
  onNext,
  onBack,
  config,
  onSaveConfig,
  transcriptionError,
  micError,
}: {
  isRecording: boolean
  isTranscribing: boolean
  dictationResult: string | null
  onDictationResultChange: (value: string | null) => void
  onStartRecording: () => void
  onStopRecording: () => void
  onNext: () => void
  onBack: () => void
  config: Config | undefined
  onSaveConfig: (config: Partial<Config>) => void
  transcriptionError: string | null
  micError: string | null
}) {
  const shortcut = config?.shortcut || "hold-ctrl"

  const getShortcutDisplay = () => {
    if (shortcut === "hold-ctrl") {
      return "Hold Ctrl"
    } else if (shortcut === "ctrl-slash") {
      return "Press Ctrl+/"
    } else if (shortcut === "custom" && config?.customShortcut) {
      const mode = config.customShortcutMode || "hold"
      return mode === "hold" ? `Hold ${config.customShortcut}` : `Press ${config.customShortcut}`
    }
    return "Hold Ctrl"
  }

  const getButtonContent = () => {
    if (isTranscribing) {
      return { icon: "i-mingcute-loading-fill animate-spin", text: "Transcribing..." }
    }
    if (isRecording) {
      return { icon: "i-mingcute-stop-fill", text: "Stop" }
    }
    return { icon: "i-mingcute-mic-fill", text: "Record" }
  }

  const buttonContent = getButtonContent()

  return (
    <div>
      <StepIndicator current={2} total={3} />
      <h2 className="text-2xl font-bold mb-2 text-center">Try Voice Dictation</h2>
      <p className="text-muted-foreground mb-4 text-center">
        Click the button or use your hotkey to record. Your speech will be transcribed below.
      </p>

      {/* Hotkey Configuration */}
      <div className="mb-6 p-4 rounded-lg border bg-muted/30">
        <div className="flex items-center gap-2 mb-3">
          <span className="i-mingcute-keyboard-fill text-lg text-primary"></span>
          <label className="text-sm font-medium">Recording Hotkey</label>
        </div>
        <div className="space-y-3">
          <Select
            value={shortcut}
            onValueChange={(value) => {
              onSaveConfig({
                shortcut: value as Config["shortcut"],
              })
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hold-ctrl">Hold Ctrl</SelectItem>
              <SelectItem value="ctrl-slash">Ctrl+/</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>

          {shortcut === "custom" && (
            <>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">Mode</label>
                <Select
                  value={config?.customShortcutMode || "hold"}
                  onValueChange={(value: "hold" | "toggle") => {
                    onSaveConfig({
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
                value={config?.customShortcut || ""}
                onChange={(keyCombo) => {
                  onSaveConfig({
                    customShortcut: keyCombo,
                  })
                }}
                placeholder="Click to record custom shortcut"
              />
            </>
          )}
        </div>
      </div>

      {/* Recording Button and Result */}
      <div className="flex flex-col items-center gap-4 mb-6">
        <div className="flex items-center gap-4">
          <div className="relative">
            <Button
              size="lg"
              variant={isRecording ? "destructive" : "default"}
              onClick={isRecording ? onStopRecording : onStartRecording}
              disabled={isTranscribing}
              className="w-20 h-20 rounded-full flex flex-col items-center justify-center gap-1"
            >
              <span className={`text-2xl ${buttonContent.icon}`}></span>
              <span className="text-xs">{buttonContent.text}</span>
            </Button>
            {isRecording && (
              <div className="absolute inset-0 rounded-full border-4 border-red-500 animate-ping pointer-events-none"></div>
            )}
          </div>
          <div className="text-sm text-muted-foreground">
            <p className="font-medium">Or use your hotkey:</p>
            <p className="text-primary font-semibold">{getShortcutDisplay()}</p>
          </div>
        </div>

        {/* Transcription Result Textarea */}
        <div className="w-full">
          <label className="block text-sm font-medium mb-2">Transcription Result</label>
          <Textarea
            value={dictationResult || ""}
            onChange={(e) => onDictationResultChange(e.target.value || null)}
            placeholder={isRecording ? "Listening..." : isTranscribing ? "Transcribing..." : "Your transcribed text will appear here..."}
            className="min-h-[100px] resize-none"
            readOnly={isRecording || isTranscribing}
          />
        </div>

        {/* Error Messages */}
        {micError && (
          <div className="w-full p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-600 dark:text-red-400">
            <span className="i-mingcute-warning-fill mr-2"></span>
            {micError}
          </div>
        )}

        {transcriptionError && (
          <div className="w-full p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-600 dark:text-red-400">
            <span className="i-mingcute-warning-fill mr-2"></span>
            {transcriptionError}
          </div>
        )}
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack} disabled={isRecording || isTranscribing}>
          Back
        </Button>
        <Button onClick={onNext} disabled={isRecording || isTranscribing}>
          {dictationResult ? "Continue" : "Skip Demo"}
        </Button>
      </div>
    </div>
  )
}

// Agent Step
function AgentStep({
  onComplete,
  onBack,
  config,
  onSaveConfig,
  onSaveConfigAsync,
}: {
  onComplete: () => void
  onBack: () => void
  config: Config | undefined
  onSaveConfig: (config: Partial<Config>) => void
  onSaveConfigAsync: (config: Partial<Config>) => Promise<void>
}) {
  const [isInstallingExa, setIsInstallingExa] = useState(false)
  const [exaInstalled, setExaInstalled] = useState(false)
  const [agentPrompt, setAgentPrompt] = useState("")
  const [isAgentRunning, setIsAgentRunning] = useState(false)
  const [agentResponse, setAgentResponse] = useState<string | null>(null)
  const [agentError, setAgentError] = useState<string | null>(null)

  // Check if Exa is already installed
  useEffect(() => {
    const mcpServers = config?.mcpConfig?.mcpServers || {}
    setExaInstalled("exa" in mcpServers)
  }, [config?.mcpConfig?.mcpServers])

  const mcpToolsShortcut = config?.mcpToolsShortcut || "hold-ctrl-alt"

  const getAgentShortcutDisplay = () => {
    if (mcpToolsShortcut === "hold-ctrl-alt") {
      return "Hold Ctrl+Alt"
    } else if (mcpToolsShortcut === "ctrl-alt-slash") {
      return "Press Ctrl+Alt+/"
    } else if (mcpToolsShortcut === "custom" && config?.customMcpToolsShortcut) {
      return config.customMcpToolsShortcut
    }
    return "Hold Ctrl+Alt"
  }

  const handleInstallExa = async () => {
    setIsInstallingExa(true)
    try {
      // Add Exa MCP server to config
      const currentMcpConfig = config?.mcpConfig || { mcpServers: {} }
      const newMcpConfig = {
        ...currentMcpConfig,
        mcpServers: {
          ...currentMcpConfig.mcpServers,
          exa: {
            transport: "streamableHttp" as const,
            url: "https://mcp.exa.ai/mcp?exaApiKey=YOUR_API_KEY",
          },
        },
      }

      // Wait for config to save, then start the server
      await onSaveConfigAsync({ mcpConfig: newMcpConfig })

      // Enable and start the server
      await tipcClient.setMcpServerRuntimeEnabled({
        serverName: "exa",
        enabled: true,
      })
      await tipcClient.restartMcpServer({ serverName: "exa" })

      setExaInstalled(true)
    } catch (error) {
      console.error("Failed to install Exa:", error)
    } finally {
      setIsInstallingExa(false)
    }
  }

  const handleTestAgent = async () => {
    if (!agentPrompt.trim()) return

    // Check if API key is configured for the selected provider
    const providerId = config?.mcpToolsProviderId || "openai"
    const hasApiKey = providerId === "groq"
      ? !!config?.groqApiKey
      : providerId === "gemini"
      ? !!config?.geminiApiKey
      : !!config?.openaiApiKey

    if (!hasApiKey) {
      setAgentError(`No API key configured. Please go back and enter your ${providerId === "groq" ? "Groq" : providerId === "gemini" ? "Gemini" : "OpenAI"} API key, or configure it in Settings.`)
      return
    }

    setIsAgentRunning(true)
    setAgentResponse(null)
    setAgentError(null)

    try {
      // Start agent session - this will run in the background
      // and show in the floating panel
      await tipcClient.createMcpTextInput({
        text: agentPrompt.trim(),
      })

      // Clear the prompt after sending
      setAgentPrompt("")
      setAgentResponse("Agent started! Check the floating panel to see the progress.")
    } catch (error: any) {
      console.error("Failed to start agent:", error)
      const errorMessage = error?.message || String(error)
      if (errorMessage.includes("API key")) {
        setAgentError("API key is missing or invalid. Please check your settings.")
      } else if (errorMessage.includes("model")) {
        setAgentError("Model configuration error. Please check your model settings.")
      } else {
        setAgentError(`Failed to start agent: ${errorMessage}`)
      }
    } finally {
      setIsAgentRunning(false)
    }
  }

  return (
    <div>
      <StepIndicator current={3} total={3} />
      <h2 className="text-2xl font-bold mb-2 text-center">Meet Your AI Agent</h2>
      <p className="text-muted-foreground mb-4 text-center">
        Your AI agent can use MCP tools to search the web, run code, and more.
      </p>

      {/* Agent Mode Hotkey Configuration */}
      <div className="mb-4 p-4 rounded-lg border bg-muted/30">
        <div className="flex items-center gap-2 mb-3">
          <span className="i-mingcute-keyboard-fill text-lg text-primary"></span>
          <label className="text-sm font-medium">Agent Mode Hotkey</label>
        </div>
        <div className="space-y-3">
          <Select
            value={mcpToolsShortcut}
            onValueChange={(value) => {
              onSaveConfig({
                mcpToolsShortcut: value as Config["mcpToolsShortcut"],
              })
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="hold-ctrl-alt">Hold Ctrl+Alt</SelectItem>
              <SelectItem value="ctrl-alt-slash">Ctrl+Alt+/</SelectItem>
              <SelectItem value="custom">Custom</SelectItem>
            </SelectContent>
          </Select>

          {mcpToolsShortcut === "custom" && (
            <KeyRecorder
              value={config?.customMcpToolsShortcut || ""}
              onChange={(keyCombo) => {
                onSaveConfig({
                  customMcpToolsShortcut: keyCombo,
                })
              }}
              placeholder="Click to record custom agent mode shortcut"
            />
          )}
        </div>
      </div>

      {/* Install Exa MCP Server */}
      <div className="mb-4 p-4 rounded-lg border bg-muted/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="i-mingcute-search-fill text-2xl text-primary"></span>
            <div>
              <h3 className="font-semibold">Exa Web Search</h3>
              <p className="text-sm text-muted-foreground">
                Give your agent the power to search the web
              </p>
            </div>
          </div>
          <Button
            onClick={handleInstallExa}
            disabled={isInstallingExa || exaInstalled}
            variant={exaInstalled ? "outline" : "default"}
            size="sm"
          >
            {isInstallingExa ? (
              <>
                <span className="i-mingcute-loading-fill animate-spin mr-2"></span>
                Installing...
              </>
            ) : exaInstalled ? (
              <>
                <span className="i-mingcute-check-fill mr-2 text-green-500"></span>
                Installed
              </>
            ) : (
              <>
                <span className="i-mingcute-add-fill mr-2"></span>
                Install
              </>
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Get your Exa API key at{" "}
          <a
            href="https://dashboard.exa.ai/api-keys"
            target="_blank"
            rel="noreferrer"
            className="text-primary underline"
          >
            dashboard.exa.ai/api-keys
          </a>
          . Add more MCP tools in Settings → MCP Tools.
        </p>
      </div>

      {/* Try Your Agent */}
      <div className="mb-4 p-4 rounded-lg border bg-muted/30">
        <div className="flex items-center gap-2 mb-3">
          <span className="i-mingcute-robot-fill text-lg text-primary"></span>
          <label className="text-sm font-medium">Try Your Agent</label>
        </div>

        {/* Hotkey hint */}
        <div className="flex items-center gap-2 mb-3 p-2 rounded bg-primary/10 border border-primary/20">
          <span className="i-mingcute-keyboard-fill text-primary"></span>
          <span className="text-sm">
            <strong>{getAgentShortcutDisplay()}</strong> to speak to your agent from anywhere
          </span>
        </div>

        <div className="flex gap-2">
          <Input
            value={agentPrompt}
            onChange={(e) => setAgentPrompt(e.target.value)}
            placeholder={exaInstalled ? "Try: What's the latest news about AI?" : "Ask your agent anything..."}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleTestAgent()
              }
            }}
            disabled={isAgentRunning}
          />
          <Button
            onClick={handleTestAgent}
            disabled={isAgentRunning || !agentPrompt.trim()}
          >
            {isAgentRunning ? (
              <span className="i-mingcute-loading-fill animate-spin"></span>
            ) : (
              <span className="i-mingcute-send-fill"></span>
            )}
          </Button>
        </div>

        {agentResponse && (
          <div className="mt-3 p-2 rounded bg-green-500/10 border border-green-500/20 text-sm text-green-600 dark:text-green-400">
            <span className="i-mingcute-check-circle-fill mr-2"></span>
            {agentResponse}
          </div>
        )}

        {agentError && (
          <div className="mt-3 p-2 rounded bg-red-500/10 border border-red-500/20 text-sm text-red-600 dark:text-red-400">
            <span className="i-mingcute-warning-fill mr-2"></span>
            {agentError}
          </div>
        )}

        <p className="text-xs text-muted-foreground mt-2">
          Or use your hotkey to speak to the agent. Results will appear in the floating panel.
        </p>
      </div>

      <div className="flex justify-between">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onComplete} size="lg">
          Start Using {process.env.PRODUCT_NAME}
        </Button>
      </div>
    </div>
  )
}

// Step Indicator
function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex justify-center gap-2 mb-8">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`w-3 h-3 rounded-full transition-colors ${
            i + 1 <= current ? "bg-primary" : "bg-muted"
          }`}
        />
      ))}
    </div>
  )
}

// Feature Card
function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: string
  title: string
  description: string
}) {
  return (
    <div className="flex gap-4 p-4 rounded-lg border bg-muted/30">
      <div className="flex-shrink-0">
        <span className={`${icon} text-2xl text-primary`}></span>
      </div>
      <div>
        <h3 className="font-semibold mb-1">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

