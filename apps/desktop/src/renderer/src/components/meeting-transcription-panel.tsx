import { useState, useRef, useEffect } from "react"
import { useMutation } from "@tanstack/react-query"
import { MeetingRecorder } from "@renderer/lib/meeting-recorder"
import { tipcClient } from "~/lib/tipc-client"
import { cn } from "@renderer/lib/utils"
import { Mic, Square, Loader2, AlertCircle } from "lucide-react"

const VISUALIZER_BUFFER_LENGTH = 50

export function MeetingTranscriptionPanel() {
  const [isRecording, setIsRecording] = useState(false)
  const [visualizerData, setVisualizerData] = useState<number[]>(() =>
    Array(VISUALIZER_BUFFER_LENGTH).fill(0.01)
  )
  const [error, setError] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)
  const recorderRef = useRef<MeetingRecorder | null>(null)
  const startTimeRef = useRef<number>(0)
  const durationIntervalRef = useRef<number | null>(null)

  const transcribeMutation = useMutation({
    mutationFn: async ({ blob, duration }: { blob: Blob; duration: number }) => {
      const result = await tipcClient.createMeetingTranscription({
        recording: await blob.arrayBuffer(),
        duration,
      })
      return result
    },
    onSuccess: (data) => {
      console.log("[MeetingTranscription] Transcription complete:", data.transcript?.slice(0, 100))
    },
    onError: (error) => {
      console.error("[MeetingTranscription] Transcription failed:", error)
      setError(error instanceof Error ? error.message : "Transcription failed")
    },
  })

  const startRecording = async () => {
    setError(null)
    try {
      const recorder = new MeetingRecorder()
      recorderRef.current = recorder

      recorder.on("record-start", () => {
        setIsRecording(true)
        startTimeRef.current = Date.now()
        durationIntervalRef.current = window.setInterval(() => {
          setDuration(Math.floor((Date.now() - startTimeRef.current) / 1000))
        }, 1000)
      })

      recorder.on("visualizer-data", (rms) => {
        setVisualizerData((prev) => {
          const next = [...prev.slice(1), rms]
          return next
        })
      })

      recorder.on("record-end", async (blob, recordingDuration) => {
        if (durationIntervalRef.current) {
          clearInterval(durationIntervalRef.current)
          durationIntervalRef.current = null
        }
        setIsRecording(false)
        setDuration(0)
        setVisualizerData(Array(VISUALIZER_BUFFER_LENGTH).fill(0.01))

        if (blob.size > 0) {
          transcribeMutation.mutate({ blob, duration: recordingDuration })
        }
      })

      recorder.on("error", (err) => {
        // Clear the duration interval on error to prevent timer from continuing
        if (durationIntervalRef.current) {
          clearInterval(durationIntervalRef.current)
          durationIntervalRef.current = null
        }
        setError(err.message)
        setIsRecording(false)
        setDuration(0)
        setVisualizerData(Array(VISUALIZER_BUFFER_LENGTH).fill(0.01))
      })

      await recorder.startRecording()
    } catch (err) {
      console.error("[MeetingTranscription] Failed to start recording:", err)
      setError(err instanceof Error ? err.message : "Failed to start recording")
      setIsRecording(false)
    }
  }

  const stopRecording = () => {
    recorderRef.current?.stopRecording()
  }

  useEffect(() => {
    return () => {
      if (durationIntervalRef.current) {
        clearInterval(durationIntervalRef.current)
      }
      recorderRef.current?.stopRecording()
    }
  }, [])

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`
  }

  return (
    <div className="flex flex-col items-center gap-4 p-4">
      <h3 className="text-lg font-semibold">Meeting Transcription</h3>
      <p className="text-sm text-muted-foreground text-center">
        Captures both your microphone and system audio (meeting participants)
      </p>

      {error && (
        <div className="flex items-center gap-2 text-destructive text-sm">
          <AlertCircle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      {/* Visualizer */}
      <div className="flex items-end justify-center gap-0.5 h-16 w-full max-w-xs">
        {visualizerData.map((value, index) => (
          <div
            key={index}
            className={cn(
              "w-1 rounded-full transition-all duration-75",
              isRecording ? "bg-red-500" : "bg-muted"
            )}
            style={{ height: `${Math.max(4, value * 60)}px` }}
          />
        ))}
      </div>

      {/* Duration */}
      {isRecording && (
        <div className="text-2xl font-mono text-red-500">
          {formatDuration(duration)}
        </div>
      )}

      {/* Controls */}
      <div className="flex gap-2">
        {!isRecording ? (
          <button
            onClick={startRecording}
            disabled={transcribeMutation.isPending}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg",
              "bg-red-500 hover:bg-red-600 text-white",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {transcribeMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Transcribing...</span>
              </>
            ) : (
              <>
                <Mic className="h-4 w-4" />
                <span>Start Meeting Recording</span>
              </>
            )}
          </button>
        ) : (
          <button
            onClick={stopRecording}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white"
          >
            <Square className="h-4 w-4" />
            <span>Stop Recording</span>
          </button>
        )}
      </div>
    </div>
  )
}

