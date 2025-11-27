import fs from "fs"
import path from "path"
import { recordingsFolder, configStore } from "./config"
import { getAudioBackend } from "./audio-backends"
import { getRecordingHistory, saveRecordingHistory } from "./recordings-store"
import { RecordingHistoryItem } from "../shared/types"
import { postProcessTranscript } from "./llm"
import { logApp } from "./debug"

interface LongRecordingSession {
  id: string
  createdAt: number
  buffers: Buffer[]
  sampleRate: number | null
  channels: number | null
}

async function transcribeWavRecording(
  recording: ArrayBuffer | SharedArrayBuffer,
  durationMs: number,
): Promise<{ transcript: string }> {
  const config = configStore.get()

  const form = new FormData()
  form.append(
    "file",
    new File(
      [new Uint8Array(recording as ArrayBufferLike)],
      "recording.wav",
      { type: "audio/wav" },
    ),
  )
  form.append(
    "model",
    config.sttProviderId === "groq" ? "whisper-large-v3" : "whisper-1",
  )
  form.append("response_format", "json")

  if (config.sttProviderId === "groq" && config.groqSttPrompt?.trim()) {
    form.append("prompt", config.groqSttPrompt.trim())
  }

  const languageCode =
    config.sttProviderId === "groq"
      ? config.groqSttLanguage || config.sttLanguage
      : config.openaiSttLanguage || config.sttLanguage

  if (languageCode && languageCode !== "auto") {
    form.append("language", languageCode)
  }

  const groqBaseUrl = config.groqBaseUrl || "https://api.groq.com/openai/v1"
  const openaiBaseUrl = config.openaiBaseUrl || "https://api.openai.com/v1"

  const transcriptResponse = await fetch(
    config.sttProviderId === "groq"
      ? `${groqBaseUrl}/audio/transcriptions`
      : `${openaiBaseUrl}/audio/transcriptions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${
          config.sttProviderId === "groq" ? config.groqApiKey : config.openaiApiKey
        }`,
      },
      body: form,
    },
  )

  if (!transcriptResponse.ok) {
    const message = `${transcriptResponse.statusText} ${(await transcriptResponse
      .text())
      .slice(0, 300)}`
    throw new Error(message)
  }

  const json: { text: string } = await transcriptResponse.json()
  const transcript = await postProcessTranscript(json.text)

  return { transcript }
}

function createWavFromPcm(
  pcmBuffer: Buffer,
  sampleRate: number,
  channels: number,
): Buffer {
  const bytesPerSample = 2 // 16-bit PCM
  const blockAlign = channels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = pcmBuffer.length
  const headerSize = 44

  const buffer = Buffer.alloc(headerSize)

  buffer.write("RIFF", 0)
  buffer.writeUInt32LE(headerSize - 8 + dataSize, 4)
  buffer.write("WAVE", 8)

  buffer.write("fmt ", 12)
  buffer.writeUInt32LE(16, 16) // PCM chunk size
  buffer.writeUInt16LE(1, 20) // Audio format: PCM
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(byteRate, 28)
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(bytesPerSample * 8, 34) // bits per sample

  buffer.write("data", 36)
  buffer.writeUInt32LE(dataSize, 40)

  return Buffer.concat([buffer, pcmBuffer])
}

class LongRecordingService {
  private currentSession: LongRecordingSession | null = null
  private backend = getAudioBackend()



  constructor() {
    this.backend.onAudioChunk((buffer, info) => {
      if (!this.currentSession || info.sessionId !== this.currentSession.id) {
        return
      }

      if (this.currentSession.sampleRate == null) {
        this.currentSession.sampleRate = info.sampleRate
      }

      if (this.currentSession.channels == null) {
        this.currentSession.channels = info.channels
      }

      if (this.currentSession.buffers.length === 0) {
        logApp(
          "[LongRecordingService] Received first audio chunk for session",
          info.sessionId,
          "sequence=",
          info.sequence,
          "bytes=",
          buffer.length,
          "sampleRate=",
          info.sampleRate,
          "channels=",
          info.channels,
        )
      }

      this.currentSession.buffers.push(buffer)
    })

    this.backend.onError((error) => {
      logApp(
        "[LongRecordingService] Audio service error",
        error?.name || "",
        error?.message || "",
      )
    })


    // Subscriptions are configured via backend instance in constructor.
  }

  async start() {
    if (this.currentSession) {
      throw new Error("Long recording already in progress")
    }

    const id = Date.now().toString()
    const createdAt = Date.now()

    this.currentSession = {
      id,
      createdAt,
      buffers: [],
      sampleRate: null,
      channels: null,
    }

    try {
      await this.backend.startCapture(id)
    } catch (err) {
      this.currentSession = null
      throw err
    }

    return { sessionId: id, createdAt }
  }

  async stop() {
    const session = this.currentSession
    if (!session) {
      throw new Error("No long recording in progress")
    }

	    try {
	      await this.backend.stopCapture(session.id)
	    } finally {
	      this.currentSession = null
	    }

    const pcmBuffer = Buffer.concat(session.buffers)

    if (pcmBuffer.length === 0) {
      logApp(
        "[LongRecordingService] No audio data captured for session",
        session.id,
      )
      throw new Error(
        "No audio was captured during desktop recording. Please check your microphone permissions and default input device, then try again.",
      )
    }

    const sampleRate = session.sampleRate || 48000
    const channels = session.channels || 1

    const durationMs = Math.round(
      (pcmBuffer.length / (channels * 2)) / sampleRate * 1000,
    )

    logApp(
      "[LongRecordingService] Stopping session",
      session.id,
      "bytes=",
      pcmBuffer.length,
      "buffers=",
      session.buffers.length,
      "sampleRate=",
      sampleRate,
      "channels=",
      channels,
      "durationMs=",
      durationMs,
    )

    const wavBuffer = createWavFromPcm(pcmBuffer, sampleRate, channels)

    const arrayBuffer = wavBuffer.buffer.slice(
      wavBuffer.byteOffset,
      wavBuffer.byteOffset + wavBuffer.byteLength,
    )

    const { transcript } = await transcribeWavRecording(arrayBuffer, durationMs)

    fs.mkdirSync(recordingsFolder, { recursive: true })

    const history = getRecordingHistory()
    const item: RecordingHistoryItem = {
      id: session.id,
      createdAt: session.createdAt,
      duration: durationMs,
      transcript,
    }
    history.push(item)
    saveRecordingHistory(history)

    fs.writeFileSync(
      path.join(recordingsFolder, `${session.id}.wav`),
      wavBuffer,
    )

    return {
      id: session.id,
      createdAt: session.createdAt,
      duration: durationMs,
      transcript,
    }
  }
}

export const longRecordingService = new LongRecordingService()

