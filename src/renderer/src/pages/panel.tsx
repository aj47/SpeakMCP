
import { AgentProgress } from "@renderer/components/agent-progress"
import { Recorder } from "@renderer/lib/recorder"
import { playSound } from "@renderer/lib/sound"
import { cn } from "@renderer/lib/utils"
import { useMutation } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { rendererHandlers, tipcClient } from "~/lib/tipc-client"
import { AgentProgressUpdate } from "../../../shared/types"
import { TextInputPanel } from "@renderer/components/text-input-panel"
import { ContinueConversation } from "@renderer/components/continue-conversation"
import { useConversationActions, useConversationState, useConversation } from "@renderer/contexts/conversation-context"
import { PanelDragBar } from "@renderer/components/panel-drag-bar"
import { useConfigQuery } from "@renderer/lib/query-client"



const VISUALIZER_BUFFER_LENGTH = 70

const getInitialVisualizerData = () =>
  Array<number>(VISUALIZER_BUFFER_LENGTH).fill(-1000)

export function Component() {

  const [visualizerData, setVisualizerData] = useState(() =>
    getInitialVisualizerData(),
  )
  const [recording, setRecording] = useState(false)
  const [mcpMode, setMcpMode] = useState(false)
  const [agentProgress, setAgentProgress] = useState<AgentProgressUpdate | null>(null)
  const [showTextInput, setShowTextInput] = useState(false)
  const isConfirmedRef = useRef(false)
  const mcpModeRef = useRef(false)

  // Conversation state
  const { showContinueButton, isWaitingForResponse, isConversationActive, currentConversation } = useConversationState()
  const { addMessage, setIsWaitingForResponse, startNewConversation, continueConversation, endConversation } = useConversationActions()
  const { currentConversationId } = useConversation()

  // Config for drag functionality
  const configQuery = useConfigQuery()
  const isDragEnabled = configQuery.data?.panelDragEnabled ?? true



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
      tipcClient.hidePanelWindow()
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

      // If backend returned a conversationId, continue that conversation
      if (result?.conversationId && result.conversationId !== currentConversationId) {
        continueConversation(result.conversationId)
      }

      return result
    },
    onError(error) {
      setAgentProgress(null) // Clear progress on error
      tipcClient.resizePanelToNormal() // Resize back to normal on error
      tipcClient.hidePanelWindow()
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
      tipcClient.clearTextInputState()
      tipcClient.resizePanelToNormal()
      tipcClient.hidePanelWindow()
      tipcClient.displayError({
        title: error.name,
        message: error.message,
      })
    },
    onSuccess() {
      setShowTextInput(false)
      // Clear text input state
      tipcClient.clearTextInputState()
      tipcClient.resizePanelToNormal()
      tipcClient.hidePanelWindow()
    },
  })

  const mcpTextInputMutation = useMutation({
    mutationFn: async ({ text, conversationId }: { text: string; conversationId?: string }) => {
      await tipcClient.createMcpTextInput({ text, conversationId })
    },
    onError(error) {
      setShowTextInput(false)
      tipcClient.clearTextInputState()
      setAgentProgress(null) // Clear progress on error
      tipcClient.resizePanelToNormal() // Resize back to normal on error
      tipcClient.hidePanelWindow()
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
        tipcClient.showPanelWindow()
        recorderRef.current?.startRecording()
      }
    })

    return unlisten
  }, [recording])

  // Text input handlers
  useEffect(() => {
    const unlisten = rendererHandlers.showTextInput.listen(() => {
      setShowTextInput(true)
      // Panel window is already shown by the keyboard handler
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
      const config = await tipcClient.getConfig()
      if (config.mcpToolsEnabled) {
        mcpTextInputMutation.mutate({
          text,
          conversationId: currentConversation?.id
        })
      } else {
        textInputMutation.mutate({ text })
      }
    } catch (error) {
      textInputMutation.mutate({ text })
    }
  }

  const handleContinueConversation = async (message: string) => {
    // Add user message to conversation
    await addMessage(message, "user")

    // Process the message through the same flow as text input
    try {
      const config = await tipcClient.getConfig()
      if (config.mcpToolsEnabled) {
        mcpTextInputMutation.mutate({
          text: message,
          conversationId: currentConversation?.id
        })
      } else {
        textInputMutation.mutate({ text: message })
      }
    } catch (error) {
      textInputMutation.mutate({ text: message })
    }
  }

  // MCP handlers
  useEffect(() => {

    const unlisten = rendererHandlers.startMcpRecording.listen(() => {
      setMcpMode(true)
      mcpModeRef.current = true
      setAgentProgress(null) // Clear any previous progress
      tipcClient.resizePanelToNormal() // Ensure panel is normal size for recording
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
        tipcClient.resizePanelToNormal() // Ensure panel is normal size for recording
        tipcClient.showPanelWindow()
        recorderRef.current?.startRecording()
      }
    })

    return unlisten
  }, [recording])

  // Agent progress handler
  useEffect(() => {
    const unlisten = rendererHandlers.agentProgressUpdate.listen((update: AgentProgressUpdate) => {


      // Only update if the progress has actually changed to prevent flashing
      setAgentProgress(prevProgress => {
        if (!prevProgress) return update

        // Compare key properties to determine if update is needed
        const hasChanged =
          prevProgress.isComplete !== update.isComplete ||
          prevProgress.currentIteration !== update.currentIteration ||
          prevProgress.steps.length !== update.steps.length ||
          JSON.stringify(prevProgress.steps) !== JSON.stringify(update.steps) ||
          prevProgress.finalContent !== update.finalContent

        return hasChanged ? update : prevProgress
      })

      // Resize panel for agent mode on first progress update or when transitioning from no progress
      if (!agentProgress && update && !update.isComplete) {
        // Small delay to ensure the panel is ready
        setTimeout(() => {
          tipcClient.resizePanelForAgentMode()
        }, 100)
      }

      // Keep the panel open when agent completes - user will press ESC to close
      if (update.isComplete) {
        // Add assistant response to conversation if we have final content
        if (update.finalContent) {
          addMessage(update.finalContent, "assistant").catch(() => {
            // Silently handle error
          })
        }

        // No auto-hide behavior - user controls when to close with ESC
      }
    })

    return unlisten
  }, [agentProgress])

  // Clear agent progress handler
  useEffect(() => {
    const unlisten = rendererHandlers.clearAgentProgress.listen(() => {
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



  return (
    <div className="flex flex-col h-screen liquid-glass-panel text-foreground glass-text-strong">
      {/* Drag bar - show when drag is enabled and not in text input mode */}
      {isDragEnabled && !showTextInput && (
        <PanelDragBar
          className="shrink-0"
          disabled={!isDragEnabled}
        />
      )}

      <div className="flex flex-1 min-h-0">
        {showTextInput ? (
          <TextInputPanel
            onSubmit={handleTextSubmit}
            onCancel={() => {
              setShowTextInput(false)
              tipcClient.clearTextInputState()
              tipcClient.resizePanelToNormal()
              tipcClient.hidePanelWindow()
            }}
            isProcessing={textInputMutation.isPending || mcpTextInputMutation.isPending}
            agentProgress={agentProgress}
          />
        ) : (transcribeMutation.isPending || mcpTranscribeMutation.isPending || textInputMutation.isPending || mcpTextInputMutation.isPending) ? (
        <div className="flex h-full w-full items-center justify-center relative liquid-glass-strong rounded-xl glass-text-strong">
          {agentProgress ? (
            <div className="absolute inset-0 flex items-center justify-center z-20">
              <AgentProgress progress={agentProgress} variant="overlay" className="w-full mx-4" />
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">Processing...</div>
          )}
          {/* Show a subtle background indicator when agent progress is active */}
          {agentProgress && (
            <div className="absolute inset-0 flex items-center justify-center opacity-20">
              <div className="text-xs text-muted-foreground">Processing...</div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex h-full w-full rounded-xl liquid-glass transition-all duration-300 glass-text-strong">
          <div className="flex shrink-0">
            {mcpMode && (
              <div className="flex items-center justify-center w-8 h-full liquid-glass-subtle rounded-l-xl">
                <div className="w-2 h-2 bg-primary rounded-full animate-pulse shadow-lg" title="MCP Tool Mode" />
              </div>
            )}
            {isConversationActive && !mcpMode && (
              <div className="flex items-center justify-center w-8 h-full liquid-glass-subtle rounded-l-xl">
                <div className="w-2 h-2 bg-green-500 rounded-full shadow-lg" title="Conversation Active" />
              </div>
            )}
          </div>
          <div
            className="relative flex grow items-center overflow-hidden"
            dir="rtl"
          >
            {/* Continue conversation overlay - shown when conversation can be continued */}
            {showContinueButton && !agentProgress && (
              <div className="absolute inset-0 flex items-center justify-center z-30 p-4">
                <ContinueConversation
                  onSubmit={handleContinueConversation}
                  isProcessing={isWaitingForResponse || textInputMutation.isPending || mcpTextInputMutation.isPending}
                  className="w-full max-w-md"
                />
              </div>
            )}

            {/* Agent progress overlay - positioned to not interfere with waveform */}
            {agentProgress && !mcpTranscribeMutation.isPending && (
              <div className="absolute inset-0 flex items-center justify-start z-20 liquid-glass-strong rounded-xl glass-text-strong">
                <AgentProgress progress={agentProgress} variant="overlay" className="w-full mx-3" />
              </div>
            )}

            {/* Waveform visualization - dimmed when agent progress is showing */}
            <div className={cn(
              "absolute right-0 flex h-6 items-center gap-0.5 transition-opacity duration-300",
              (agentProgress && !mcpTranscribeMutation.isPending) || showContinueButton ? "opacity-30" : "opacity-100"
            )}>
              {visualizerData
                .slice()
                .reverse()
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
      )}
      </div>
    </div>
  )
}
