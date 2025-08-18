import React, { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "./ui/dialog"
import { Button } from "./ui/button"
import { Switch } from "./ui/switch"
import { cn } from "@renderer/lib/utils"

interface OnboardingModalProps {
  isOpen: boolean
  onClose: () => void
  onComplete: (dontShowAgain: boolean) => void
}

interface SlideData {
  title: string
  description: string
  icon: string
  content: React.ReactNode
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  isOpen,
  onClose,
  onComplete,
}) => {
  const [currentSlide, setCurrentSlide] = useState(0)
  const [dontShowAgain, setDontShowAgain] = useState(false)

  const slides: SlideData[] = [
    {
      title: "Welcome to SpeakMCP",
      description: "Voice-powered AI conversations made simple",
      icon: "i-mingcute-mic-line",
      content: (
        <div className="space-y-4">
          <div className="flex items-center justify-center">
            <div className="rounded-full bg-blue-100 p-6 dark:bg-blue-900">
              <span className="i-mingcute-mic-line text-4xl text-blue-600 dark:text-blue-400"></span>
            </div>
          </div>
          <div className="text-center space-y-2">
            <h3 className="text-lg font-semibold">Voice Recording & Transcription</h3>
            <p className="text-sm text-muted-foreground">
              Hold your configured shortcut key to start recording. Your voice will be 
              transcribed and sent to AI models for intelligent responses.
            </p>
            <div className="bg-muted rounded-lg p-3 mt-4">
              <p className="text-xs text-muted-foreground">
                💡 <strong>Tip:</strong> You can configure your recording shortcut in Settings → General
              </p>
            </div>
          </div>
        </div>
      ),
    },
    {
      title: "Powerful AI Tools",
      description: "MCP tools and autonomous agent mode",
      icon: "i-mingcute-tool-line",
      content: (
        <div className="space-y-4">
          <div className="flex items-center justify-center">
            <div className="rounded-full bg-green-100 p-6 dark:bg-green-900">
              <span className="i-mingcute-tool-line text-4xl text-green-600 dark:text-green-400"></span>
            </div>
          </div>
          <div className="text-center space-y-2">
            <h3 className="text-lg font-semibold">MCP Tools & Agent Mode</h3>
            <p className="text-sm text-muted-foreground">
              Connect external tools and services through the Model Context Protocol (MCP). 
              Enable agent mode for autonomous task execution.
            </p>
            <div className="grid grid-cols-2 gap-2 mt-4">
              <div className="bg-muted rounded-lg p-3">
                <p className="text-xs font-medium">🔧 MCP Tools</p>
                <p className="text-xs text-muted-foreground">External integrations</p>
              </div>
              <div className="bg-muted rounded-lg p-3">
                <p className="text-xs font-medium">🤖 Agent Mode</p>
                <p className="text-xs text-muted-foreground">Autonomous execution</p>
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      title: "Organize & Customize",
      description: "Conversations, settings, and personalization",
      icon: "i-mingcute-settings-3-line",
      content: (
        <div className="space-y-4">
          <div className="flex items-center justify-center">
            <div className="rounded-full bg-purple-100 p-6 dark:bg-purple-900">
              <span className="i-mingcute-settings-3-line text-4xl text-purple-600 dark:text-purple-400"></span>
            </div>
          </div>
          <div className="text-center space-y-2">
            <h3 className="text-lg font-semibold">Conversations & Settings</h3>
            <p className="text-sm text-muted-foreground">
              View your conversation history, configure AI providers, customize shortcuts, 
              and personalize your SpeakMCP experience.
            </p>
            <div className="grid grid-cols-3 gap-2 mt-4">
              <div className="bg-muted rounded-lg p-2">
                <p className="text-xs font-medium">💬 History</p>
              </div>
              <div className="bg-muted rounded-lg p-2">
                <p className="text-xs font-medium">🎨 Themes</p>
              </div>
              <div className="bg-muted rounded-lg p-2">
                <p className="text-xs font-medium">⚙️ Settings</p>
              </div>
            </div>
          </div>
        </div>
      ),
    },
  ]

  const handleNext = () => {
    if (currentSlide < slides.length - 1) {
      setCurrentSlide(currentSlide + 1)
    } else {
      onComplete(dontShowAgain)
    }
  }

  const handlePrevious = () => {
    if (currentSlide > 0) {
      setCurrentSlide(currentSlide - 1)
    }
  }

  const handleSkip = () => {
    onComplete(dontShowAgain)
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center">
            {slides[currentSlide].title}
          </DialogTitle>
          <p className="text-center text-sm text-muted-foreground">
            {slides[currentSlide].description}
          </p>
        </DialogHeader>

        <div className="py-6">
          {slides[currentSlide].content}
        </div>

        {/* Progress indicators */}
        <div className="flex justify-center space-x-2 mb-4">
          {slides.map((_, index) => (
            <div
              key={index}
              className={cn(
                "h-2 w-2 rounded-full transition-colors",
                index === currentSlide
                  ? "bg-primary"
                  : "bg-muted-foreground/30"
              )}
            />
          ))}
        </div>

        <DialogFooter className="flex-col space-y-4">
          {/* Don't show again toggle */}
          <div className="flex items-center justify-center space-x-2">
            <Switch
              id="dont-show-again"
              checked={dontShowAgain}
              onCheckedChange={setDontShowAgain}
            />
            <label
              htmlFor="dont-show-again"
              className="text-sm text-muted-foreground cursor-pointer"
            >
              Don't show me this again
            </label>
          </div>

          {/* Navigation buttons */}
          <div className="flex justify-between w-full">
            <div className="flex space-x-2">
              {currentSlide > 0 && (
                <Button variant="outline" onClick={handlePrevious}>
                  Previous
                </Button>
              )}
            </div>
            
            <div className="flex space-x-2">
              <Button variant="ghost" onClick={handleSkip}>
                Skip
              </Button>
              <Button onClick={handleNext}>
                {currentSlide === slides.length - 1 ? "Get Started" : "Next"}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
