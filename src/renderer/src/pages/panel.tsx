import { Spinner } from "@renderer/components/ui/spinner"
import { Recorder } from "@renderer/lib/recorder"
import { playSound } from "@renderer/lib/sound"
import { cn } from "@renderer/lib/utils"
import { useMutation } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"
import { rendererHandlers, tipcClient } from "~/lib/tipc-client"
import { useAuthStateQuery } from "@renderer/lib/query-client"
import { AuthWarningModal } from "@renderer/components/auth-warning-modal"



const VISUALIZER_BUFFER_LENGTH = 70

const getInitialVisualizerData = () =>
  Array<number>(VISUALIZER_BUFFER_LENGTH).fill(-1000)

export function Component() {
  const authStateQuery = useAuthStateQuery()
  const [visualizerData, setVisualizerData] = useState(() =>
    getInitialVisualizerData(),
  )
  const [recording, setRecording] = useState(false)
  const [mcpMode, setMcpMode] = useState(false)
  const [showAuthWarning, setShowAuthWarning] = useState(false)
  const [authWarningMode, setAuthWarningMode] = useState<"regular" | "mcp">("regular")
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
      console.log("[MCP-DEBUG] 🚀 Starting MCP transcription mutation")
      const arrayBuffer = await blob.arrayBuffer()
      console.log(`[MCP-DEBUG] Audio blob converted to ArrayBuffer, size: ${arrayBuffer.byteLength} bytes`)

      await tipcClient.createMcpRecording({
        recording: arrayBuffer,
        duration,
      })
      console.log("[MCP-DEBUG] ✅ MCP transcription completed successfully")
    },
    onError(error) {
      console.error("[MCP-DEBUG] ❌ MCP transcription error:", error)
      tipcClient.hidePanelWindow()
      tipcClient.displayError({
        title: error.name,
        message: error.message,
      })
    },
  })

  const recorderRef = useRef<Recorder | null>(null)

  // Helper function to check authentication before recording
  const checkAuthAndStartRecording = (mode: "regular" | "mcp" = "regular") => {
    const isAuthenticated = authStateQuery.data?.user && authStateQuery.data?.token

    if (!isAuthenticated) {
      setAuthWarningMode(mode)
      setShowAuthWarning(true)
      return false
    }

    return true
  }

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
      console.log(`[MCP-DEBUG] 📹 Recording ended, mcpMode: ${currentMcpMode}, duration: ${duration}ms`)
      setRecording(false)
      setVisualizerData(() => getInitialVisualizerData())
      tipcClient.recordEvent({ type: "end" })

      if (!isConfirmedRef.current) {
        console.log("[MCP-DEBUG] Recording not confirmed, skipping transcription")
        return
      }

      playSound("end_record")

      // Use appropriate mutation based on mode
      if (currentMcpMode) {
        console.log("[MCP-DEBUG] 🔧 Using MCP transcription mutation")
        mcpTranscribeMutation.mutate({
          blob,
          duration,
        })
      } else {
        console.log("[MCP-DEBUG] 📝 Using regular transcription mutation")
        transcribeMutation.mutate({
          blob,
          duration,
        })
      }

      // Reset MCP mode after recording
      console.log("[MCP-DEBUG] Resetting MCP mode to false")
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
        // Check authentication before starting recording
        if (!checkAuthAndStartRecording("regular")) {
          return
        }

        tipcClient.showPanelWindow()
        recorderRef.current?.startRecording()
      }
    })

    return unlisten
  }, [recording, authStateQuery.data])

  // MCP handlers
  useEffect(() => {

    const unlisten = rendererHandlers.startMcpRecording.listen(() => {
      console.log("[MCP-DEBUG] 🎤 startMcpRecording handler triggered")

      // Check authentication before starting MCP recording
      if (!checkAuthAndStartRecording("mcp")) {
        console.log("[MCP-DEBUG] Authentication required, showing warning modal")
        return
      }

      console.log("[MCP-DEBUG] Setting mcpMode to true")
      setMcpMode(true)
      mcpModeRef.current = true
      setVisualizerData(() => getInitialVisualizerData())
      console.log("[MCP-DEBUG] Starting recording in MCP mode")
      recorderRef.current?.startRecording()
    })

    return unlisten
  }, [authStateQuery.data])

  useEffect(() => {
    const unlisten = rendererHandlers.finishMcpRecording.listen(() => {
      console.log("[MCP-DEBUG] 🛑 finishMcpRecording handler triggered")
      console.log(`[MCP-DEBUG] Current mcpMode: ${mcpMode}, recording: ${recording}`)
      isConfirmedRef.current = true
      recorderRef.current?.stopRecording()
    })

    return unlisten
  }, [])

  useEffect(() => {
    const unlisten = rendererHandlers.startOrFinishMcpRecording.listen(() => {
      console.log(`[MCP-DEBUG] 🔄 startOrFinishMcpRecording handler triggered, recording: ${recording}`)
      if (recording) {
        console.log("[MCP-DEBUG] Already recording, stopping MCP recording")
        isConfirmedRef.current = true
        recorderRef.current?.stopRecording()
      } else {
        console.log("[MCP-DEBUG] Not recording, starting MCP recording")

        // Check authentication before starting MCP recording
        if (!checkAuthAndStartRecording("mcp")) {
          console.log("[MCP-DEBUG] Authentication required, showing warning modal")
          return
        }

        setMcpMode(true)
        tipcClient.showPanelWindow()
        recorderRef.current?.startRecording()
      }
    })

    return unlisten
  }, [recording, authStateQuery.data])

  return (
    <div className="flex h-screen dark:text-white">
      {(transcribeMutation.isPending || mcpTranscribeMutation.isPending) ? (
        <div className="flex h-full w-full items-center justify-center">
          <Spinner />
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
            <div className="absolute right-0 flex h-6 items-center gap-0.5">
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

      <AuthWarningModal
        open={showAuthWarning}
        onOpenChange={setShowAuthWarning}
        mode={authWarningMode}
      />
    </div>
  )
}
