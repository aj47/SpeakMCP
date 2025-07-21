import { Spinner } from "@renderer/components/ui/spinner"
import { AgentProgress } from "@renderer/components/agent-progress"
import { Recorder } from "@renderer/lib/recorder"
import { playSound } from "@renderer/lib/sound"
import { cn } from "@renderer/lib/utils"
import { useMutation } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { rendererHandlers, tipcClient } from "~/lib/tipc-client"
import { AgentProgressUpdate } from "../../../shared/types"



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
  const isConfirmedRef = useRef(false)
  const mcpModeRef = useRef(false)



  const transcribeMutation = useMutation({
    mutationFn: async ({
      blob,
      duration,
    }: {
      blob: Blob
      duration: number
    }) => {
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
    }: {
      blob: Blob
      duration: number
    }) => {
      const arrayBuffer = await blob.arrayBuffer()

      await tipcClient.createMcpRecording({
        recording: arrayBuffer,
        duration,
      })
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
      setAgentProgress(update)

      // Resize panel for agent mode on first progress update or when transitioning from no progress
      if (!agentProgress && update && !update.isComplete) {
        // Small delay to ensure the panel is ready
        setTimeout(() => {
          tipcClient.resizePanelForAgentMode()
        }, 100)
      }

      // Auto-clear progress and hide panel after completion with a delay
      if (update.isComplete) {
        setTimeout(() => {
          setAgentProgress(null)
          // Resize back to normal and hide the panel after showing completion
          tipcClient.resizePanelToNormal()
          setTimeout(() => {
            tipcClient.hidePanelWindow()
          }, 200) // Small delay to ensure resize completes before hiding
        }, 4000) // Show completion for 4 seconds
      }
    })

    return unlisten
  }, [agentProgress])



  return (
    <div className="flex h-screen dark:text-white">
      {(transcribeMutation.isPending || mcpTranscribeMutation.isPending) ? (
        <div className="flex h-full w-full items-center justify-center relative">
          {agentProgress ? (
            <div className="absolute inset-0 flex items-center justify-center p-4 z-20">
              <AgentProgress progress={agentProgress} className="max-w-sm w-full" />
            </div>
          ) : (
            <Spinner />
          )}
          {/* Show a subtle background spinner when agent progress is active */}
          {agentProgress && (
            <div className="absolute inset-0 flex items-center justify-center opacity-20">
              <Spinner />
            </div>
          )}
        </div>
      ) : (
        <div className="flex h-full w-full rounded-xl transition-colors">
          <div className="flex shrink-0">
            {mcpMode && (
              <div className="flex items-center justify-center w-8 h-full">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" title="MCP Tool Mode" />
              </div>
            )}
          </div>
          <div
            className="relative flex grow items-center overflow-hidden"
            dir="rtl"
          >
            {/* Agent progress overlay - positioned to not interfere with waveform */}
            {agentProgress && !mcpTranscribeMutation.isPending && (
              <div className="absolute inset-0 flex items-center justify-start pl-4 pr-16 z-20">
                <AgentProgress progress={agentProgress} className="max-w-sm w-full shadow-lg" />
              </div>
            )}

            {/* Waveform visualization - dimmed when agent progress is showing */}
            <div className={cn(
              "absolute right-0 flex h-6 items-center gap-0.5 transition-opacity duration-300",
              agentProgress && !mcpTranscribeMutation.isPending ? "opacity-30" : "opacity-100"
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
  )
}
