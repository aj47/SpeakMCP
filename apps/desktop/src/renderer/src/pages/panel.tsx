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
import { useAgentStore, useAgentProgress, useConversationStore } from "@renderer/stores"
import { useConversationQuery, useCreateConversationMutation, useAddMessageToConversationMutation } from "@renderer/lib/queries"
import { PanelDragBar } from "@renderer/components/panel-drag-bar"
import { useConfigQuery } from "@renderer/lib/query-client"
import { useTheme } from "@renderer/contexts/theme-context"
import { ttsManager } from "@renderer/lib/tts-manager"
import { formatKeyComboForDisplay } from "@shared/key-utils"
import { Send } from "lucide-react"

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
  const mcpConversationIdRef = useRef<string | undefined>(undefined)
  const mcpSessionIdRef = useRef<string | undefined>(undefined)
  const fromTileRef = useRef<boolean>(false)
  const mcpScreenshotRef = useRef<string | undefined>(undefined)
  const [fromButtonClick, setFromButtonClick] = useState(false)
  const { isDark } = useTheme()
  const lastRequestedModeRef = useRef<"normal" | "agent" | "textInput">("normal")
  const requestPanelMode = (mode: "normal" | "agent" | "textInput") => {
    if (lastRequestedModeRef.current === mode) return
    lastRequestedModeRef.current = mode
    tipcClient.setPanelMode({ mode })
  }


  const agentProgress = useAgentProgress()
  const focusedSessionId = useAgentStore((s) => s.focusedSessionId)
  const agentProgressById = useAgentStore((s) => s.agentProgressById)

  const currentConversationId = useConversationStore((s) => s.currentConversationId)
  const setCurrentConversationId = useConversationStore((s) => s.setCurrentConversationId)
  const endConversation = useConversationStore((s) => s.endConversation)

  const conversationQuery = useConversationQuery(currentConversationId)
  const currentConversation = conversationQuery.data ?? null
  const isConversationActive = !!currentConversation

  const createConversationMutation = useCreateConversationMutation()
  const addMessageMutation = useAddMessageToConversationMutation()

  const startNewConversation = async (message: string, role: "user" | "assistant") => {
    const result = await createConversationMutation.mutateAsync({ firstMessage: message, role })
    if (result?.id) {
      setCurrentConversationId(result.id)
    }
    return result
  }

  const addMessage = async (content: string, role: "user" | "assistant") => {
    if (!currentConversationId) return
    await addMessageMutation.mutateAsync({
      conversationId: currentConversationId,
      content,
      role,
    })
  }

  const activeSessionCount = Array.from(agentProgressById?.values() ?? [])
    .filter(progress => progress && !progress.isSnoozed && !progress.isComplete).length

  // Count all visible sessions (including completed but not snoozed) for overlay display
  const visibleSessionCount = Array.from(agentProgressById?.values() ?? [])
    .filter(progress => progress && !progress.isSnoozed).length
  const hasMultipleSessions = visibleSessionCount > 1

  // Aggregate session state helpers
  // Only consider non-snoozed AND non-completed sessions as "active" for mode switching
  const anyActiveNonSnoozed = activeSessionCount > 0
  // Any non-snoozed session (including completed) should show the overlay
  const anyVisibleSessions = visibleSessionCount > 0
  const displayProgress = useMemo(() => {
    if (agentProgress && !agentProgress.isSnoozed) return agentProgress
    // pick first non-snoozed session if focused one is missing/snoozed
    const entry = Array.from(agentProgressById?.values() ?? []).find(p => p && !p.isSnoozed)
    return entry || null
  }, [agentProgress, agentProgressById])

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

  useEffect(() => {
    logUI('[Panel] recording state changed:', {
      recording,
      anyActiveNonSnoozed,
      anyVisibleSessions,
      showTextInput,
      mcpMode
    })
  }, [recording, anyActiveNonSnoozed, anyVisibleSessions, showTextInput, mcpMode])

  const configQuery = useConfigQuery()
  const isDragEnabled = (configQuery.data as any)?.panelDragEnabled ?? true

  const getSubmitShortcutText = useMemo(() => {
    const config = configQuery.data
    if (!config) return "Enter"

    if (fromButtonClick) {
      return "Enter"
    }

    if (mcpMode) {
      const shortcut = config.mcpToolsShortcut
      if (shortcut === "hold-ctrl-alt") {
        return "Release keys"
      } else if (shortcut === "ctrl-alt-slash") {
        return "Ctrl+Alt+/"
      } else if (shortcut === "custom" && config.customMcpToolsShortcut) {
        return formatKeyComboForDisplay(config.customMcpToolsShortcut)
      }
    } else {
      const shortcut = config.shortcut
      if (shortcut === "hold-ctrl") {
        return "Release Ctrl"
      } else if (shortcut === "ctrl-slash") {
        return "Ctrl+/"
      } else if (shortcut === "custom" && config.customShortcut) {
        const mode = config.customShortcutMode || "hold"
        if (mode === "hold") {
          return "Release keys"
        }
        return formatKeyComboForDisplay(config.customShortcut)
      }
    }
    return "Enter"
  }, [configQuery.data, mcpMode, fromButtonClick])

  const handleSubmitRecording = () => {
    if (!recording) return
    isConfirmedRef.current = true
    recorderRef.current?.stopRecording()
  }

  useEffect(() => {
    if (!recording || !fromButtonClick) return undefined

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === "Enter" || e.code === "NumpadEnter") && !e.shiftKey) {
        e.preventDefault()
        handleSubmitRecording()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [recording, fromButtonClick])

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

      // Use the conversationId and sessionId passed through IPC (from mic button clicks).
      // The refs are more reliable for mic button clicks as they avoid timing issues.
      const conversationIdForMcp = mcpConversationIdRef.current ?? currentConversationId
      const sessionIdForMcp = mcpSessionIdRef.current
      const wasFromTile = fromTileRef.current
      const screenshotForMcp = mcpScreenshotRef.current

      // Clear the refs after capturing to avoid reusing stale IDs
      mcpConversationIdRef.current = undefined
      mcpSessionIdRef.current = undefined
      fromTileRef.current = false
      mcpScreenshotRef.current = undefined

      // If recording was from a tile, hide the floating panel immediately
      // The session will continue in the tile view
      if (wasFromTile) {
        tipcClient.hidePanelWindow({})
      }

      // If we have a transcript, start a conversation with it
      if (transcript && !isConversationActive) {
        await startNewConversation(transcript, "user")
      }

      const result = await tipcClient.createMcpRecording({
        recording: arrayBuffer,
        duration,
        // Pass conversationId and sessionId if user explicitly continued a conversation,
        // otherwise undefined to create a fresh conversation/session.
        conversationId: conversationIdForMcp ?? undefined,
        sessionId: sessionIdForMcp,
        // Pass fromTile so session starts snoozed when recording was from a tile
        fromTile: wasFromTile,
        // Pass screenshot for multimodal input if provided
        screenshot: screenshotForMcp,
      })

      // NOTE: Do NOT call continueConversation here!
      // The currentConversationId should only be set through explicit user actions
      // (like clicking "Continue" in history or using TileFollowUpInput).
      // Automatically setting it here would cause subsequent new sessions to
      // inherit this session's conversation history (session pollution bug).

      return result
    },
    onError(error) {
      // Clear the refs on error as well
      mcpConversationIdRef.current = undefined
      mcpSessionIdRef.current = undefined
      fromTileRef.current = false

      tipcClient.hidePanelWindow({})
      tipcClient.displayError({
        title: error.name,
        message: error.message,
      })
    },
    onSuccess() {
      // Don't clear progress or hide panel on success - agent mode will handle this
      // The panel needs to stay visible for agent mode progress updates
      // (unless recording was from a tile, which already hid the panel in mutationFn)
    },
  })

  const textInputMutation = useMutation({
    mutationFn: async ({ text, screenshot }: { text: string; screenshot?: string }) => {
      await tipcClient.createTextInput({ text, screenshot })
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
      screenshot,
    }: {
      text: string
      conversationId?: string
      screenshot?: string
    }) => {
      const result = await tipcClient.createMcpTextInput({ text, conversationId, screenshot })

      // NOTE: Do NOT call continueConversation here!
      // The currentConversationId should only be set through explicit user actions
      // (like clicking "Continue" in history or using TileFollowUpInput).
      // Automatically setting it here would cause subsequent new sessions to
      // inherit this session's conversation history (session pollution bug).

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

      // Reset MCP mode and button click state after recording
      setMcpMode(false)
      mcpModeRef.current = false
      setFromButtonClick(false)
    })
  }, [mcpMode, mcpTranscribeMutation, transcribeMutation])

  useEffect(() => {
    const unlisten = rendererHandlers.startRecording.listen((data) => {
      // Ensure we are in normal dictation mode (not MCP/agent)
      setMcpMode(false)
      mcpModeRef.current = false
      // Track if recording was triggered via UI button click (e.g., tray menu)
      setFromButtonClick(data?.fromButtonClick ?? false)
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
    const unlisten = rendererHandlers.startOrFinishRecording.listen((data) => {
      // Use recordingRef instead of recording state to avoid race condition
      // where listener recreation with recording=false could trigger a new recording
      if (recordingRef.current) {
        isConfirmedRef.current = true
        recorderRef.current?.stopRecording()
      } else {
        // Force normal dictation mode - each new recording starts fresh
        setMcpMode(false)
        mcpModeRef.current = false
        // Track if recording was triggered via UI button click
        setFromButtonClick(data?.fromButtonClick ?? false)
        tipcClient.showPanelWindow({})
        recorderRef.current?.startRecording()
      }
    })

    return unlisten
  }, []) // No dependencies - use refs for current state

  // Text input handlers
  useEffect(() => {
    const unlisten = rendererHandlers.showTextInput.listen(() => {
      // Reset any previous pending state to ensure textarea is enabled
      logUI('[Panel] showTextInput received: resetting text input mutations and enabling textarea')
      textInputMutation.reset()
      mcpTextInputMutation.reset()

      // Clear any existing conversation ID to ensure a fresh conversation is started
      // This prevents the bug where previous session messages are included when
      // submitting a new message via the text input keybind
      endConversation()

      // Show text input and focus
      setShowTextInput(true)
      // Panel window is already shown by the keyboard handler
      // Focus the text input after a short delay to ensure it's rendered
      setTimeout(() => {
        textInputPanelRef.current?.focus()
      }, 100)
    })

    return unlisten
  }, [endConversation])

  useEffect(() => {
    const unlisten = rendererHandlers.hideTextInput.listen(() => {
      setShowTextInput(false)
    })

    return unlisten
  }, [])

  const handleTextSubmit = async (text: string, screenshot?: string) => {
    // Capture the conversation ID at submit time - if user explicitly continued a conversation
    // from history, currentConversationId will be set. Otherwise it's null for new inputs.
    const conversationIdForMcp = currentConversationId

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

    // Always use MCP processing with optional screenshot
    mcpTextInputMutation.mutate({
      text,
      // Pass currentConversationId if user explicitly continued from history,
      // otherwise undefined to create a fresh conversation.
      // This prevents message leaking while still supporting explicit continuation.
      conversationId: conversationIdForMcp ?? undefined,
      screenshot,
    })
  }



  // MCP handlers
  useEffect(() => {
    const unlisten = rendererHandlers.startMcpRecording.listen((data) => {
      // Store the conversationId, sessionId, fromTile flag, and screenshot for use when recording ends
      mcpConversationIdRef.current = data?.conversationId
      mcpSessionIdRef.current = data?.sessionId
      fromTileRef.current = data?.fromTile ?? false
      mcpScreenshotRef.current = data?.screenshot
      // Track if recording was triggered via UI button click vs keyboard shortcut
      // When true, we show "Enter" as the submit hint instead of "Release keys"
      setFromButtonClick(data?.fromButtonClick ?? false)

      // If recording is NOT from a tile and no explicit conversationId was passed,
      // clear any existing conversation ID to ensure a fresh conversation is started.
      // This prevents the bug where previous session messages are included when
      // submitting a new message via the agent mode keybind.
      if (!data?.fromTile && !data?.conversationId) {
        endConversation()
      }

      setMcpMode(true)
      mcpModeRef.current = true
      // Mode sizing is now applied in main before show; avoid duplicate calls here
      setVisualizerData(() => getInitialVisualizerData())
      recorderRef.current?.startRecording()
    })

    return unlisten
  }, [endConversation])

  useEffect(() => {
    const unlisten = rendererHandlers.finishMcpRecording.listen(() => {
      isConfirmedRef.current = true
      recorderRef.current?.stopRecording()
    })

    return unlisten
  }, [])

  useEffect(() => {
    const unlisten = rendererHandlers.startOrFinishMcpRecording.listen((data) => {
      // Use recordingRef instead of recording state to avoid race condition
      // where listener recreation with recording=false could trigger a new recording
      if (recordingRef.current) {
        isConfirmedRef.current = true
        recorderRef.current?.stopRecording()
      } else {
        // Store the conversationId, sessionId, and screenshot for use when recording ends
        mcpConversationIdRef.current = data?.conversationId
        mcpSessionIdRef.current = data?.sessionId
        mcpScreenshotRef.current = data?.screenshot
        // Track if recording was triggered via UI button click vs keyboard shortcut
        setFromButtonClick(data?.fromButtonClick ?? false)
        setMcpMode(true)
        requestPanelMode("normal") // Ensure panel is normal size for recording
        tipcClient.showPanelWindow({})
        recorderRef.current?.startRecording()
      }
    })

    return unlisten
  }, []) // No dependencies - use refs for current state

  // Agent progress handler - request mode changes only when target changes
  // Note: Progress updates are session-aware in ConversationContext; avoid redundant mode requests here
  useEffect(() => {
    const isTextSubmissionPending = textInputMutation.isPending || mcpTextInputMutation.isPending

    // If text input is active, don't override the mode - keep it as textInput
    // This prevents the panel from becoming unfocusable while user is typing
    if (showTextInput) {
      return undefined
    }

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
  }, [anyActiveNonSnoozed, textInputMutation.isPending, mcpTextInputMutation.isPending, showTextInput])

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
      shouldShowOverlay: anyVisibleSessions && !recording,
      anyVisibleSessions,
      recording,
      anyActiveNonSnoozed,
      agentProgressSessionId: agentProgress?.sessionId,
      agentProgressComplete: agentProgress?.isComplete,
      agentProgressSnoozed: agentProgress?.isSnoozed
    })
  }, [agentProgress, anyActiveNonSnoozed, anyVisibleSessions, recording, mcpTranscribeMutation.isPending])

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


	  // Track latest state values in a ref to avoid race conditions with auto-close timeout
	  const autoCloseStateRef = useRef({
	    anyVisibleSessions,
	    showTextInput,
	    recording,
	    isTextSubmissionPending: textInputMutation.isPending || mcpTextInputMutation.isPending
	  })

	  // Keep ref in sync with latest state
	  useEffect(() => {
	    autoCloseStateRef.current = {
	      anyVisibleSessions,
	      showTextInput,
	      recording,
	      isTextSubmissionPending: textInputMutation.isPending || mcpTextInputMutation.isPending
	    }
	  }, [anyVisibleSessions, showTextInput, recording, textInputMutation.isPending, mcpTextInputMutation.isPending])

	  // Auto-close the panel when there's nothing to show
	  useEffect(() => {
	    // Keep panel open if a text submission is still pending (to avoid flicker)
	    const isTextSubmissionPending = textInputMutation.isPending || mcpTextInputMutation.isPending
	    const showsAgentOverlay = anyVisibleSessions

	    const shouldAutoClose =
	      !showsAgentOverlay &&
	      !showTextInput &&
	      !recording &&
	      !isTextSubmissionPending

	    if (shouldAutoClose) {
	      const t = setTimeout(() => {
	        // Re-check latest state before closing to prevent race conditions
	        // State may have changed during the 200ms delay
	        const latestState = autoCloseStateRef.current
	        const stillShouldClose =
	          !latestState.anyVisibleSessions &&
	          !latestState.showTextInput &&
	          !latestState.recording &&
	          !latestState.isTextSubmissionPending

	        if (stillShouldClose) {
	          tipcClient.hidePanelWindow({})
	        }
	      }, 200)
	      return () => clearTimeout(t)
	    }

      return undefined as void

	  }, [anyVisibleSessions, showTextInput, recording, textInputMutation.isPending, mcpTextInputMutation.isPending])

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
              {/* Agent progress overlay - left-aligned and full coverage */}
              {/* Hide overlay when recording to prevent waveform from appearing over completed sessions */}
              {anyVisibleSessions && !recording && (
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

              {/* Waveform visualization and submit controls - only show when recording is active */}
              {recording && (
                <div className="absolute inset-0 flex flex-col items-center justify-center z-30">
                  {/* Waveform */}
                  <div
                    className={cn(
                      "flex h-6 items-center justify-center transition-opacity duration-300 px-4 pointer-events-none",
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

                  {/* Submit button and keyboard hint */}
                  <div className="flex items-center gap-3 mt-2">
                    <button
                      onClick={handleSubmitRecording}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                        "bg-blue-500 hover:bg-blue-600 text-white",
                        "dark:bg-blue-600 dark:hover:bg-blue-700"
                      )}
                    >
                      <Send className="h-3.5 w-3.5" />
                      <span>Submit</span>
                    </button>
                    <span className="text-xs text-muted-foreground">
                      or press <kbd className="px-1.5 py-0.5 rounded bg-muted text-foreground font-mono text-xs">{getSubmitShortcutText}</kbd>
                    </span>
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
