import { AgentProgress } from "@renderer/components/agent-progress"
import { AgentProcessingView } from "@renderer/components/agent-processing-view"
import { MultiAgentProgressView } from "@renderer/components/multi-agent-progress-view"
import { Recorder } from "@renderer/lib/recorder"
import { playSound } from "@renderer/lib/sound"
import { cn } from "@renderer/lib/utils"
import { useMutation } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import { rendererHandlers, tipcClient } from "~/lib/tipc-client"
import { TextInputPanel, TextInputPanelRef } from "@renderer/components/text-input-panel"
import { PanelResizeWrapper } from "@renderer/components/panel-resize-wrapper"
import { logUI } from "@renderer/lib/debug"
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
  const [showTextInput, setShowTextInput] = useState(false)
  const isConfirmedRef = useRef(false)
  const mcpModeRef = useRef(false)
  const recordingRef = useRef(false)
  const textInputPanelRef = useRef<TextInputPanelRef>(null)
  const { isDark } = useTheme()
  const lastRequestedModeRef = useRef<"normal" | "agent" | "textInput">("normal")
  const requestPanelMode = (mode: "normal" | "agent" | "textInput") => {
    if (lastRequestedModeRef.current === mode) return
    lastRequestedModeRef.current = mode
    tipcClient.setPanelMode({ mode })
  }


  // Conversation state
  const {
    showContinueButton,
    isWaitingForResponse,
    isConversationActive,
    currentConversation,
    agentProgress, // Get agent progress from conversation context (session-aware)
  } = useConversationState()
  const {
    addMessage,
    setIsWaitingForResponse,
    startNewConversation,
    endConversation,
    continueConversation,
  } = useConversationActions()
  const { currentConversationId, focusedSessionId, agentProgressById, lastCompletedConversationId } = useConversation()

  // Check if we have multiple active (non-snoozed) sessions
  // Note: We intentionally include completed sessions in the count because:
  // 1. Completed sessions should remain visible until the user manually closes them
  // 2. The panel should stay in agent mode to show the completed results
  // 3. Recording cleanup is handled separately when switching TO agent mode (line 479)
  const activeSessionCount = Array.from(agentProgressById.values())
    .filter(progress => !progress.isSnoozed).length
  const hasMultipleSessions = activeSessionCount > 1

  // Aggregate session state helpers
  const anyActiveNonSnoozed = activeSessionCount > 0
  const displayProgress = useMemo(() => {
    if (agentProgress && !agentProgress.isSnoozed) return agentProgress
    // pick first non-snoozed session if focused one is missing/snoozed
    const entry = Array.from(agentProgressById.values()).find(p => !p.isSnoozed)
    return entry || null
  }, [agentProgress, agentProgressById])

  // Debug: Log when agentProgress changes in Panel
  useEffect(() => {
    logUI('[Panel] agentProgress changed:', {
      hasProgress: !!agentProgress,
      sessionId: agentProgress?.sessionId,
      focusedSessionId,
      totalSessions: agentProgressById.size,
      activeSessionCount,
      hasMultipleSessions,
      allSessionIds: Array.from(agentProgressById.keys())
    })
  }, [agentProgress, focusedSessionId, agentProgressById.size, activeSessionCount, hasMultipleSessions])

  // Debug: Log when recording state changes
  useEffect(() => {
    logUI('[Panel] recording state changed:', {
      recording,
      anyActiveNonSnoozed,
      showTextInput,
      mcpMode
    })
  }, [recording, anyActiveNonSnoozed, showTextInput, mcpMode])

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
        // Only pass currentConversationId, NOT lastCompletedConversationId
        // Using lastCompletedConversationId causes message leaking where old conversation
        // history gets loaded into new separate sessions
        conversationId: currentConversationId || undefined,
      })

      // Update conversation ID if backend created/returned one
      if (result?.conversationId && result.conversationId !== currentConversationId) {
        continueConversation(result.conversationId)
      }

      return result
    },
    onError(error) {

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

      tipcClient.hidePanelWindow({})
      tipcClient.displayError({
        title: error.name,
        message: error.message,
      })
    },
    onSuccess() {
      setShowTextInput(false)
      // Ensure main process knows text input is no longer active (prevents textInput positioning)
      tipcClient.clearTextInputState({})
      // Don't hide panel on success - agent mode will handle this and keep panel visible
      // The panel needs to stay visible for agent mode progress updates
    },
  })

  const recorderRef = useRef<Recorder | null>(null)

  useEffect(() => {
    if (recorderRef.current) return

    const recorder = (recorderRef.current = new Recorder())

    recorder.on("record-start", () => {
      setRecording(true)
      recordingRef.current = true
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
      recordingRef.current = false
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
        if (continueConv) {
          setMcpMode(true)
          mcpModeRef.current = true
          requestPanelMode("normal")
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
      // Reset any previous pending state to ensure textarea is enabled
      logUI('[Panel] showTextInput received: resetting text input mutations and enabling textarea')
      textInputMutation.reset()
      mcpTextInputMutation.reset()

      // Show text input and focus
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

    // Hide the text input immediately and show processing/overlay
    setShowTextInput(false)
    // Ensure main process no longer treats panel as textInput mode
    tipcClient.clearTextInputState({})

    // Always try to use MCP processing first if available
    try {
      const config = await tipcClient.getConfig({})
      if ((config as any).mcpToolsEnabled) {
        mcpTextInputMutation.mutate({
          text,
          conversationId: currentConversation?.id ?? currentConversationId ?? lastCompletedConversationId ?? undefined,
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
      // Mode sizing is now applied in main before show; avoid duplicate calls here
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
        requestPanelMode("normal") // Ensure panel is normal size for recording
        tipcClient.showPanelWindow({})
        recorderRef.current?.startRecording()
      }
    })

    return unlisten
  }, [recording])

  // Agent progress handler - request mode changes only when target changes
  // Note: Progress updates are session-aware in ConversationContext; avoid redundant mode requests here
  useEffect(() => {
    const isTextSubmissionPending = textInputMutation.isPending || mcpTextInputMutation.isPending

    let targetMode: "agent" | "normal" | null = null
    if (anyActiveNonSnoozed) {
      targetMode = "agent"
      // When switching to agent mode, stop any ongoing recording
      if (recordingRef.current) {
        logUI('[Panel] Switching to agent mode - stopping ongoing recording')
        isConfirmedRef.current = false
        setRecording(false)
        recordingRef.current = false
        setVisualizerData(() => getInitialVisualizerData())
        recorderRef.current?.stopRecording()
      }
    } else if (isTextSubmissionPending) {
      targetMode = null // keep current size briefly to avoid flicker
    } else {
      targetMode = "normal"
    }

    let tid: ReturnType<typeof setTimeout> | null = null
    if (targetMode && lastRequestedModeRef.current !== targetMode) {
      const delay = targetMode === "agent" ? 100 : 0
      tid = setTimeout(() => {
        requestPanelMode(targetMode!)
      }, delay)
    }
    return () => {
      if (tid) clearTimeout(tid)
    }
  }, [anyActiveNonSnoozed, textInputMutation.isPending, mcpTextInputMutation.isPending])

  // Note: We don't need to hide text input when agentProgress changes because:
  // 1. handleTextSubmit already hides it immediately on submit (line 375)
  // 2. mcpTextInputMutation.onSuccess/onError also hide it (lines 194, 204)
  // 3. Hiding on ANY agentProgress change would close text input when background
  //    sessions get updates, which breaks the UX when user is typing

  // Debug: Log overlay visibility conditions
  useEffect(() => {
    logUI('[Panel] Overlay visibility check:', {
      hasAgentProgress: !!agentProgress,
      mcpTranscribePending: mcpTranscribeMutation.isPending,
      shouldShowOverlay: anyActiveNonSnoozed,
      agentProgressSessionId: agentProgress?.sessionId,
      agentProgressComplete: agentProgress?.isComplete,
      agentProgressSnoozed: agentProgress?.isSnoozed
    })
  }, [agentProgress, anyActiveNonSnoozed, mcpTranscribeMutation.isPending])

  // Clear agent progress handler
  useEffect(() => {
    const unlisten = rendererHandlers.clearAgentProgress.listen(() => {
      console.log('[Panel] Clearing agent progress - stopping all TTS audio and resetting mutations')
      // Stop all TTS audio when clearing progress (ESC key pressed)
      ttsManager.stopAll()

      // Stop any ongoing recording and reset recording state
      if (recordingRef.current) {
        isConfirmedRef.current = false
        setRecording(false)
        recordingRef.current = false
        setVisualizerData(() => getInitialVisualizerData())
        recorderRef.current?.stopRecording()
      }

      // Reset all mutations to clear isPending state
      transcribeMutation.reset()
      mcpTranscribeMutation.reset()
      textInputMutation.reset()
      mcpTextInputMutation.reset()

      setMcpMode(false)
      mcpModeRef.current = false
      // End conversation when clearing progress (user pressed ESC)
      if (isConversationActive) {
        endConversation()
      }
    })

    return unlisten
  }, [isConversationActive, endConversation, transcribeMutation, mcpTranscribeMutation, textInputMutation, mcpTextInputMutation])

  // Emergency stop handler - stop all TTS audio and reset processing state
  useEffect(() => {
    const unlisten = rendererHandlers.emergencyStopAgent.listen(() => {
      console.log('[Panel] Emergency stop triggered - stopping all TTS audio and resetting state')
      ttsManager.stopAll()

      // Stop any ongoing recording and reset recording state
      if (recordingRef.current) {
        isConfirmedRef.current = false
        setRecording(false)
        recordingRef.current = false
        setVisualizerData(() => getInitialVisualizerData())
        recorderRef.current?.stopRecording()
      }

      // Reset all processing states
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


	  // Auto-close the panel when there's nothing to show
	  useEffect(() => {
	    // Keep panel open if a text submission is still pending (to avoid flicker)
	    const isTextSubmissionPending = textInputMutation.isPending || mcpTextInputMutation.isPending
	    const showsAgentOverlay = anyActiveNonSnoozed

	    const shouldAutoClose =
	      !showsAgentOverlay &&
	      !showTextInput &&
	      !recording &&
	      !isTextSubmissionPending

	    if (shouldAutoClose) {
	      const t = setTimeout(() => {
	        // Ensure normal size before hide, then hide the window

	        tipcClient.hidePanelWindow({})
	      }, 200)
	      return () => clearTimeout(t)
	    }

      return undefined as void

	  }, [anyActiveNonSnoozed, showTextInput, recording, textInputMutation.isPending, mcpTextInputMutation.isPending])

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
              tipcClient.hidePanelWindow({})
            }}
            isProcessing={
              textInputMutation.isPending || mcpTextInputMutation.isPending
            }
            agentProgress={agentProgress}
          />
        ) : (
          <div className={cn(
            "voice-input-panel modern-text-strong flex h-full w-full rounded-xl transition-all duration-300",
            isDark ? "dark" : ""
          )}>

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
              {anyActiveNonSnoozed && (
                hasMultipleSessions ? (
                  <MultiAgentProgressView
                    variant="overlay"
                    className="absolute inset-0 z-20"
                  />
                ) : (
                  displayProgress && (
                    <AgentProgress
                      progress={displayProgress}
                      variant="overlay"
                      className="absolute inset-0 z-20"
                    />
                  )
                )
              )}

              {/* Waveform visualization - only show when recording is active */}
              {recording && (
                <div
                  className={cn(
                    "absolute inset-x-0 flex h-6 items-center justify-center transition-opacity duration-300 px-4 z-30 pointer-events-none",
                    "opacity-100",
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
              )}
            </div>
          </div>
        )}
      </div>
    </PanelResizeWrapper>
  )
}
