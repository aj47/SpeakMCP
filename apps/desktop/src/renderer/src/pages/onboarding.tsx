import { useState, useCallback, useRef, useEffect } from "react"
import { Button } from "@renderer/components/ui/button"
import { Input } from "@renderer/components/ui/input"
import { useConfigQuery, useSaveConfigMutation } from "@renderer/lib/query-client"
import { Config } from "@shared/types"
import { useNavigate } from "react-router-dom"
import { tipcClient } from "@renderer/lib/tipc-client"
import { Recorder } from "@renderer/lib/recorder"
import { useMutation } from "@tanstack/react-query"

type OnboardingStep = "welcome" | "api-key" | "dictation" | "agent" | "complete"

export function Component() {
  const [step, setStep] = useState<OnboardingStep>("welcome")
  const [apiKey, setApiKey] = useState("")
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [dictationResult, setDictationResult] = useState<string | null>(null)
  const navigate = useNavigate()
  const configQuery = useConfigQuery()
  const saveConfigMutation = useSaveConfigMutation()
  const recorderRef = useRef<Recorder | null>(null)

  const saveConfig = useCallback(
    (config: Partial<Config>) => {
      saveConfigMutation.mutate({
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
    onError: (error) => {
      setIsTranscribing(false)
      console.error("Transcription failed:", error)
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

  const handleSaveApiKey = useCallback(() => {
    if (!apiKey.trim()) return

    // Save Groq API key and set Groq as the default provider for STT, chat, and TTS
    saveConfig({
      groqApiKey: apiKey.trim(),
      sttProviderId: "groq",
      transcriptPostProcessingProviderId: "groq",
      mcpToolsProviderId: "groq",
      ttsProviderId: "groq",
    })

    setStep("dictation")
  }, [apiKey, saveConfig])

  const handleSkipApiKey = useCallback(() => {
    setStep("dictation")
  }, [])

  const handleStartRecording = useCallback(async () => {
    setDictationResult(null)
    recorderRef.current?.startRecording()
  }, [])

  const handleStopRecording = useCallback(() => {
    recorderRef.current?.stopRecording()
  }, [])

  const handleCompleteOnboarding = useCallback(() => {
    saveConfig({ onboardingCompleted: true })
    navigate("/")
  }, [saveConfig, navigate])

  const handleSkipOnboarding = useCallback(() => {
    saveConfig({ onboardingCompleted: true })
    navigate("/")
  }, [saveConfig, navigate])

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
            onStartRecording={handleStartRecording}
            onStopRecording={handleStopRecording}
            onNext={() => setStep("agent")}
            onBack={() => setStep("api-key")}
          />
        )}
        {step === "agent" && (
          <AgentStep
            onComplete={handleCompleteOnboarding}
            onBack={() => setStep("dictation")}
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
  onStartRecording,
  onStopRecording,
  onNext,
  onBack,
}: {
  isRecording: boolean
  isTranscribing: boolean
  dictationResult: string | null
  onStartRecording: () => void
  onStopRecording: () => void
  onNext: () => void
  onBack: () => void
}) {
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
      <p className="text-muted-foreground mb-6 text-center">
        Click the button below and speak to test voice dictation.
        Your speech will be transcribed in real-time.
      </p>
      <div className="flex flex-col items-center gap-6 mb-8">
        <div className="relative">
          <Button
            size="lg"
            variant={isRecording ? "destructive" : "default"}
            onClick={isRecording ? onStopRecording : onStartRecording}
            disabled={isTranscribing}
            className="w-32 h-32 rounded-full flex flex-col items-center justify-center gap-2"
          >
            <span className={`text-4xl ${buttonContent.icon}`}></span>
            <span className="text-sm">{buttonContent.text}</span>
          </Button>
          {isRecording && (
            <div className="absolute inset-0 rounded-full border-4 border-red-500 animate-ping pointer-events-none"></div>
          )}
        </div>
        {dictationResult && (
          <div className="w-full p-4 rounded-lg border bg-muted/30">
            <p className="text-sm font-medium mb-1">Transcription Result:</p>
            <p className="text-muted-foreground">{dictationResult}</p>
          </div>
        )}
        <p className="text-sm text-muted-foreground text-center">
          <strong>Tip:</strong> You can also hold <kbd className="px-1.5 py-0.5 rounded bg-muted border text-xs">Ctrl</kbd> to record from anywhere!
        </p>
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
}: {
  onComplete: () => void
  onBack: () => void
}) {
  return (
    <div>
      <StepIndicator current={3} total={3} />
      <h2 className="text-2xl font-bold mb-2 text-center">Meet Your AI Agent</h2>
      <p className="text-muted-foreground mb-6 text-center">
        {process.env.PRODUCT_NAME} includes a powerful AI agent that can use tools to help you with tasks.
      </p>
      <div className="space-y-4 mb-8">
        <FeatureCard
          icon="i-mingcute-robot-fill"
          title="Agent Mode"
          description="Hold Ctrl+Alt to activate agent mode. The AI can browse the web, run code, and more using MCP tools."
        />
        <FeatureCard
          icon="i-mingcute-tool-fill"
          title="MCP Tools"
          description="Configure Model Context Protocol (MCP) servers in Settings to extend your agent's capabilities."
        />
        <FeatureCard
          icon="i-mingcute-keyboard-fill"
          title="Text Input"
          description="Press Ctrl+T to type messages to the agent instead of speaking."
        />
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

