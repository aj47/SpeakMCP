import { AgentProgress } from "@renderer/components/agent-progress"
import { AgentProcessingView } from "@renderer/components/agent-processing-view"
import { Recorder } from "@renderer/lib/recorder"
import { playSound } from "@renderer/lib/sound"
import { cn } from "@renderer/lib/utils"
import { useMutation } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { rendererHandlers, tipcClient } from "~/lib/tipc-client"
import { AgentProgressUpdate } from "../../../shared/types"
import { TextInputPanel, TextInputPanelRef } from "@renderer/components/text-input-panel"
import { PanelResizeWrapper } from "@renderer/components/panel-resize-wrapper"
import {
  useConversationActions,
  useConversationState,
  useConversation,
} from "@renderer/contexts/conversation-context"
import { PanelDragBar } from "@renderer/components/panel-drag-bar"
import { useConfigQuery } from "@renderer/lib/query-client"
import { useTheme } from "@renderer/contexts/theme-context"
import { ttsManager } from "@renderer/lib/tts-manager"

const VISUALIZER_BUFFER_LENGTH = 70

const getInitialVisualizerData = () =>
  Array<number>(VISUALIZER_BUFFER_LENGTH).fill(-1000)

export function Component() {
  const [visualizerData, setVisualizerData] = useState(() =>
    getInitialVisualizerData(),
  )
  const [recording, setRecording] = useState(false)
  const [mcpMode, setMcpMode] = useState(false)
  const [agentProgress, setAgentProgress] =
    useState<AgentProgressUpdate | null>(null)
  const [showTextInput, setShowTextInput] = useState(false)
  const isConfirmedRef = useRef(false)
  const mcpModeRef = useRef(false)
  const textInputPanelRef = useRef<TextInputPanelRef>(null)
  const { isDark } = useTheme()

  // Conversation state
  const {
    showContinueButton,
    isWaitingForResponse,
    isConversationActive,
    currentConversation,
  } = useConversationState()
  const {
    addMessage,
    setIsWaitingForResponse,
    startNewConversation,
    endConversation,
    continueConversation,
  } = useConversationActions()
  const { currentConversationId } = useConversation()

  // Config for drag functionality
  const configQuery = useConfigQuery()
  const isDragEnabled = (configQuery.data as any)?.panelDragEnabled ?? true

  const transcribeMutation = useMutation({
    mutationFn: async ({
      blob,
      duration,
      transcript,
    }: {
      blob: Blob
      duration: number
      transcript?: string
    }) => {
      // If we have a transcript, start a conversation with it
      if (transcript && !isConversationActive) {
        await startNewConversation(transcript, "user")
      }

      await tipcClient.createRecording({
        recording: await blob.arrayBuffer(),
        duration,
      })
    },
    onError(error) {
      tipcClient.hidePanelWindow({})
      tipcClient.displayError({
        title: error.name,
        message: error.message,
      })
    },
  })

  const mcpTranscribeMutation = useMutation({
    mutationFn: async ({
      blob,
      duration,
      transcript,
    }: {
      blob: Blob
      duration: number
      transcript?: string
    }) => {
      const arrayBuffer = await blob.arrayBuffer()

      // If we have a transcript, start a conversation with it
      if (transcript && !isConversationActive) {
        await startNewConversation(transcript, "user")
      }

      const result = await tipcClient.createMcpRecording({
        recording: arrayBuffer,
        duration,
        conversationId: currentConversationId || undefined,
      })

      // Update conversation ID if backend created/returned one
      if (result?.conversationId && result.conversationId !== currentConversationId) {
        continueConversation(result.conversationId)
      }

      return result
    },
    onError(error) {
      setAgentProgress(null) // Clear progress on error
      tipcClient.resizePanelToNormal({}) // Resize back to normal on error
      tipcClient.hidePanelWindow({})
      tipcClient.displayError({
        title: error.name,
        message: error.message,
      })
    },
    onSuccess() {
      // Don't clear progress or hide panel on success - agent mode will handle this
      // The panel needs to stay visible for agent mode progress updates
    },
  })

  const textInputMutation = useMutation({
    mutationFn: async ({ text }: { text: string }) => {
      await tipcClient.createTextInput({ text })
    },
    onError(error) {
      setShowTextInput(false)
      tipcClient.clearTextInputState({})
      tipcClient.resizePanelToNormal({})
      tipcClient.hidePanelWindow({})
      tipcClient.displayError({
        title: error.name,
        message: error.message,
      })
    },
    onSuccess() {
      setShowTextInput(false)
      // Clear text input state
      tipcClient.clearTextInputState({})
      tipcClient.resizePanelToNormal({})
      tipcClient.hidePanelWindow({})
    },
  })

  const mcpTextInputMutation = useMutation({
    mutationFn: async ({
      text,
      conversationId,
    }: {
      text: string
      conversationId?: string
    }) => {
      const result = await tipcClient.createMcpTextInput({ text, conversationId })

      // Update conversation ID if backend created/returned one
      if (result?.conversationId && result.conversationId !== currentConversationId) {
        continueConversation(result.conversationId)
      }

      return result
    },
    onError(error) {
      setShowTextInput(false)
      tipcClient.clearTextInputState({})
      setAgentProgress(null) // Clear progress on error
      tipcClient.resizePanelToNormal({}) // Resize back to normal on error
      tipcClient.hidePanelWindow({})
      tipcClient.displayError({
        title: error.name,
        message: error.message,
      })
    },
    onSuccess() {
      setShowTextInput(false)
      // Don't clear progress or hide panel on success - agent mode will handle this
      // The panel needs to stay visible for agent mode progress updates
    },
  })

  const recorderRef = useRef<Recorder | null>(null)

  useEffect(() => {
    if (recorderRef.current) return

    const recorder = (recorderRef.current = new Recorder())

    recorder.on("record-start", () => {
      setRecording(true)
      tipcClient.recordEvent({ type: "start" })
    })

    recorder.on("visualizer-data", (rms) => {
      setVisualizerData((prev) => {
        const data = [...prev, rms]

        if (data.length > VISUALIZER_BUFFER_LENGTH) {
          data.shift()
        }

        return data
      })
    })

    recorder.on("record-end", (blob, duration) => {
      const currentMcpMode = mcpModeRef.current
      setRecording(false)
      setVisualizerData(() => getInitialVisualizerData())
      tipcClient.recordEvent({ type: "end" })

      if (!isConfirmedRef.current) {
        return
      }

      // Check if blob is empty
      if (blob.size === 0) {
        console.error("[Panel] Recording blob is empty, cannot transcribe")
        tipcClient.hidePanelWindow({})
        tipcClient.displayError({
          title: "Recording Error",
          message: "Recording is empty. Please try recording again and speak for at least 1 second.",
        })
        return
      }

      // Check minimum duration (at least 100ms)
      if (duration < 100) {
        console.warn("[Panel] Recording duration too short:", duration, "ms")
        tipcClient.hidePanelWindow({})
        tipcClient.displayError({
          title: "Recording Too Short",
          message: "Recording is too short. Please speak for at least 1 second.",
        })
        return
      }

      playSound("end_record")

      // Use appropriate mutation based on mode
      if (currentMcpMode) {
        mcpTranscribeMutation.mutate({
          blob,
          duration,
        })
      } else {
        transcribeMutation.mutate({
          blob,
          duration,
        })
      }

      // Reset MCP mode after recording
      setMcpMode(false)
      mcpModeRef.current = false
    })
  }, [mcpMode, mcpTranscribeMutation, transcribeMutation])

  useEffect(() => {
    const unlisten = rendererHandlers.startRecording.listen(() => {
      // Ensure we are in normal dictation mode (not MCP/agent)
      setMcpMode(false)
      mcpModeRef.current = false
      setAgentProgress(null)
      setVisualizerData(() => getInitialVisualizerData())
      recorderRef.current?.startRecording()
    })

    return unlisten
  }, [])

  useEffect(() => {
    const unlisten = rendererHandlers.finishRecording.listen(() => {
      isConfirmedRef.current = true
      recorderRef.current?.stopRecording()
    })

    return unlisten
  }, [])

  useEffect(() => {
    const unlisten = rendererHandlers.stopRecording.listen(() => {
      isConfirmedRef.current = false
      recorderRef.current?.stopRecording()
    })

    return unlisten
  }, [])

  useEffect(() => {
    const unlisten = rendererHandlers.startOrFinishRecording.listen(() => {
      if (recording) {
        isConfirmedRef.current = true
        recorderRef.current?.stopRecording()
      } else {
        // If there's an active conversation, automatically continue in MCP mode
        const continueConv = showContinueButton && !mcpMode
        setAgentProgress(null)
        if (continueConv) {
          setMcpMode(true)
          mcpModeRef.current = true
          tipcClient.resizePanelToNormal({})
          tipcClient.showPanelWindow({})
        } else {
          // Force normal dictation mode when not continuing a conversation
          setMcpMode(false)
          mcpModeRef.current = false
          tipcClient.showPanelWindow({})
        }
        recorderRef.current?.startRecording()
      }
    })

    return unlisten
  }, [recording, showContinueButton, mcpMode])

  // Text input handlers
  useEffect(() => {
    const unlisten = rendererHandlers.showTextInput.listen(() => {
      setShowTextInput(true)
      // Panel window is already shown by the keyboard handler
      // Focus the text input after a short delay to ensure it's rendered
      setTimeout(() => {
        textInputPanelRef.current?.focus()
      }, 100)
    })

    return unlisten
  }, [])

  useEffect(() => {
    const unlisten = rendererHandlers.hideTextInput.listen(() => {
      setShowTextInput(false)
    })

    return unlisten
  }, [])

  const handleTextSubmit = async (text: string) => {
    // Start new conversation or add to existing one
    if (!isConversationActive) {
      await startNewConversation(text, "user")
    } else {
      await addMessage(text, "user")
    }

    // Always try to use MCP processing first if available
    try {
      const config = await tipcClient.getConfig({})
      if ((config as any).mcpToolsEnabled) {
        mcpTextInputMutation.mutate({
          text,
          conversationId: currentConversation?.id,
        })
      } else {
        textInputMutation.mutate({ text })
      }
    } catch (error) {
      textInputMutation.mutate({ text })
    }
  }



  // MCP handlers
  useEffect(() => {
    const unlisten = rendererHandlers.startMcpRecording.listen(() => {
      setMcpMode(true)
      mcpModeRef.current = true
      setAgentProgress(null) // Clear any previous progress
      tipcClient.resizePanelToNormal({}) // Ensure panel is normal size for recording
      setVisualizerData(() => getInitialVisualizerData())
      recorderRef.current?.startRecording()
    })

    return unlisten
  }, [])

  useEffect(() => {
    const unlisten = rendererHandlers.finishMcpRecording.listen(() => {
      isConfirmedRef.current = true
      recorderRef.current?.stopRecording()
    })

    return unlisten
  }, [])

  useEffect(() => {
    const unlisten = rendererHandlers.startOrFinishMcpRecording.listen(() => {
      if (recording) {
        isConfirmedRef.current = true
        recorderRef.current?.stopRecording()
      } else {
        setMcpMode(true)
        setAgentProgress(null) // Clear any previous progress
        tipcClient.resizePanelToNormal({}) // Ensure panel is normal size for recording
        tipcClient.showPanelWindow({})
        recorderRef.current?.startRecording()
      }
    })

    return unlisten
  }, [recording])

  // Agent progress handler
  useEffect(() => {
    const unlisten = rendererHandlers.agentProgressUpdate.listen(
      (update: AgentProgressUpdate) => {
        // Only update if the progress has actually changed to prevent flashing
        setAgentProgress((prevProgress) => {
          if (!prevProgress) return update

          // Compare key properties to determine if update is needed
          const hasChanged =
            prevProgress.isComplete !== update.isComplete ||
            prevProgress.currentIteration !== update.currentIteration ||
            prevProgress.steps.length !== update.steps.length ||
            JSON.stringify(prevProgress.steps) !==
              JSON.stringify(update.steps) ||
            prevProgress.finalContent !== update.finalContent

          return hasChanged ? update : prevProgress
        })

        // Resize panel for agent mode on first progress update or when transitioning from no progress
        if (!agentProgress && update && !update.isComplete) {
          // Small delay to ensure the panel is ready
          setTimeout(() => {
            tipcClient.resizePanelForAgentMode({})
          }, 100)
        }

        // Keep the panel open when agent completes - user will press ESC to close
        if (update.isComplete) {
          // Note: Final message insertion is handled by ConversationProvider to prevent duplicates
          // No auto-hide behavior - user controls when to close with ESC
        }
      },
    )

    return unlisten
  }, [agentProgress])

  // Clear agent progress handler
  useEffect(() => {
    const unlisten = rendererHandlers.clearAgentProgress.listen(() => {
      console.log('[Panel] Clearing agent progress - stopping all TTS audio')
      // Stop all TTS audio when clearing progress (ESC key pressed)
      ttsManager.stopAll()

      setAgentProgress(null)
      setMcpMode(false)
      mcpModeRef.current = false
      // End conversation when clearing progress (user pressed ESC)
      if (isConversationActive) {
        endConversation()
      }
    })

    return unlisten
  }, [isConversationActive, endConversation])

  // Emergency stop handler - stop all TTS audio and reset processing state
  useEffect(() => {
    const unlisten = rendererHandlers.emergencyStopAgent.listen(() => {
      console.log('[Panel] Emergency stop triggered - stopping all TTS audio and resetting state')
      ttsManager.stopAll()

      // Reset all processing states
      setAgentProgress(null)
      setMcpMode(false)
      mcpModeRef.current = false
      setShowTextInput(false)

      // Reset mutations to idle state
      transcribeMutation.reset()
      mcpTranscribeMutation.reset()
      textInputMutation.reset()
      mcpTextInputMutation.reset()

      // End conversation if active
      if (isConversationActive) {
        endConversation()
      }
    })

    return unlisten
  }, [isConversationActive, endConversation, transcribeMutation, mcpTranscribeMutation, textInputMutation, mcpTextInputMutation])

  return (
    <PanelResizeWrapper
      enableResize={true}
      minWidth={200}
      minHeight={100}
      className={cn(
        "floating-panel modern-text-strong flex h-screen flex-col text-foreground",
        isDark ? "dark" : ""
      )}
    >
      {/* Drag bar - show whenever dragging is enabled (all states of floating GUI) */}
      {isDragEnabled && (
        <PanelDragBar className="shrink-0" disabled={!isDragEnabled} />
      )}

      <div className="flex min-h-0 flex-1">
        {showTextInput ? (
          <TextInputPanel
            ref={textInputPanelRef}
            onSubmit={handleTextSubmit}
            onCancel={() => {
              setShowTextInput(false)
              tipcClient.clearTextInputState({})
              tipcClient.resizePanelToNormal({})
              tipcClient.hidePanelWindow({})
            }}
            isProcessing={
              textInputMutation.isPending || mcpTextInputMutation.isPending
            }
            agentProgress={agentProgress}
          />
        ) : transcribeMutation.isPending ||
          mcpTranscribeMutation.isPending ||
          textInputMutation.isPending ||
          mcpTextInputMutation.isPending ? (
          <AgentProcessingView
            agentProgress={agentProgress}
            isProcessing={true}
            variant="overlay"
            showBackgroundSpinner={true}
          />
        ) : (
          <div className={cn(
            "voice-input-panel modern-text-strong flex h-full w-full rounded-xl transition-all duration-300",
            isDark ? "dark" : ""
          )}>
            <div className="flex shrink-0">
              {showTextInput && !mcpMode && (
                <div className="modern-panel-subtle flex h-full w-8 items-center justify-center rounded-l-xl">
                  <div
                    className="h-2 w-2 rounded-full bg-blue-500 shadow-lg"
                    title="Text Input Mode"
                  />
                </div>
              )}
              {isConversationActive && !mcpMode && !showTextInput && (
                <div className="modern-panel-subtle flex h-full w-8 items-center justify-center rounded-l-xl">
                  <div
                    className="h-2 w-2 rounded-full bg-green-500 shadow-lg"
                    title="Conversation Active"
                  />
                </div>
              )}
            </div>
            <div className="relative flex grow items-center overflow-hidden">
              {/* Conversation continuation indicator - subtle overlay that doesn't block waveform */}
              {showContinueButton && !agentProgress && (
                <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
                  <div className="flex items-center gap-1.5 rounded-full bg-black/20 px-2 py-1 backdrop-blur-sm">
                    <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
                    <span className="text-xs font-medium text-white/90">
                      Continue conversation
                    </span>
                  </div>
                </div>
              )}

              {/* Agent progress overlay - left-aligned and full coverage */}
              {agentProgress && !mcpTranscribeMutation.isPending && (
                <AgentProgress
                  progress={agentProgress}
                  variant="overlay"
                  className="absolute inset-0 z-20"
                />
              )}

              {/* Waveform visualization - full width with centered content, dimmed when agent progress is showing */}
              <div
                className={cn(
                  "absolute inset-x-0 flex h-6 items-center justify-center transition-opacity duration-300 px-4",
                  agentProgress && !mcpTranscribeMutation.isPending
                    ? "opacity-30"
                    : "opacity-100",
                )}
              >
                <div className="flex h-6 items-center gap-0.5">
                  {visualizerData
                    .slice()
                    .map((rms, index) => {
                      return (
                        <div
                          key={index}
                          className={cn(
                            "h-full w-0.5 shrink-0 rounded-lg",
                            "bg-red-500 dark:bg-white",
                            rms === -1000 && "bg-neutral-400 dark:bg-neutral-500",
                          )}
                          style={{
                            height: `${Math.min(100, Math.max(16, rms * 100))}%`,
                          }}
                        />
                      )
                    })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </PanelResizeWrapper>
  )
}
