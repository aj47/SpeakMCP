import { app } from "electron"
import path from "path"
import fs from "fs"
import { Readable } from "stream"
import { logApp } from "./debug"
import { configStore } from "./config"
import {
  Meeting,
  MeetingListItem,
  MeetingRecordingConfig,
  MeetingRecordingState,
  MeetingTranscriptSegment,
  MeetingAudioSource,
} from "../shared/types"

const MEETINGS_FOLDER = path.join(app.getPath("appData"), process.env.APP_ID, "meetings")

// Audio buffer settings for transcription
const TRANSCRIPTION_INTERVAL_MS = 30000 // Transcribe every 30 seconds
const SAMPLE_RATE = 48000
const CHANNELS = 1
const BYTES_PER_SAMPLE = 2 // 16-bit audio

// Dynamically import macos-system-audio-recorder (only available on macOS)
let SystemAudioRecorder: any = null

async function loadSystemAudioRecorder() {
  if (process.platform !== "darwin") {
    logApp("[MeetingRecorder] System audio recording only available on macOS")
    return null
  }

  try {
    const module = await import("macos-system-audio-recorder")
    SystemAudioRecorder = module.SystemAudioRecorder
    return SystemAudioRecorder
  } catch (error) {
    logApp("[MeetingRecorder] Failed to load macos-system-audio-recorder:", error)
    return null
  }
}

interface AudioBuffer {
  data: Buffer[]
  source: "microphone" | "system"
  startTime: number
}

class MeetingRecorderService {
  private currentMeeting: Meeting | null = null
  private systemRecorder: any = null
  private micStream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private micProcessor: ScriptProcessorNode | null = null
  private systemAudioBuffer: AudioBuffer | null = null
  private micAudioBuffer: AudioBuffer | null = null
  private transcriptionTimer: ReturnType<typeof setInterval> | null = null
  private isRecording = false

  constructor() {
    fs.mkdirSync(MEETINGS_FOLDER, { recursive: true })
  }

  getState(): MeetingRecordingState {
    return {
      isRecording: this.isRecording,
      meetingId: this.currentMeeting?.id,
      startedAt: this.currentMeeting?.createdAt,
      audioSource: this.currentMeeting?.audioSource,
    }
  }

  async startRecording(config: MeetingRecordingConfig): Promise<Meeting> {
    if (this.isRecording) {
      throw new Error("Recording already in progress")
    }

    if (process.platform !== "darwin") {
      throw new Error("Meeting transcription is only available on macOS")
    }

    const meetingId = `meeting_${Date.now()}`
    const meeting: Meeting = {
      id: meetingId,
      title: `Meeting ${new Date().toLocaleString()}`,
      createdAt: Date.now(),
      audioSource: config.audioSource,
      transcriptSegments: [],
      status: "recording",
    }

    this.currentMeeting = meeting
    this.isRecording = true

    try {
      // Start system audio recording if needed
      if (config.audioSource === "system" || config.audioSource === "both") {
        await this.startSystemAudioRecording()
      }

      // Note: Microphone recording will be handled by the renderer process
      // using the existing MediaRecorder API and sent to main via IPC

      // Start periodic transcription
      this.startTranscriptionLoop()

      // Save initial meeting state
      await this.saveMeeting(meeting)

      logApp(`[MeetingRecorder] Started recording meeting ${meetingId}`)
      return meeting
    } catch (error) {
      this.isRecording = false
      this.currentMeeting = null
      throw error
    }
  }

  private async startSystemAudioRecording(): Promise<void> {
    const RecorderClass = await loadSystemAudioRecorder()
    if (!RecorderClass) {
      throw new Error("System audio recording not available")
    }

    this.systemRecorder = new RecorderClass()
    this.systemRecorder.start()

    this.systemAudioBuffer = {
      data: [],
      source: "system",
      startTime: Date.now(),
    }

    // Get the audio stream and collect data
    const stream = this.systemRecorder.getStream() as Readable
    stream.on("data", (chunk: Buffer) => {
      if (this.systemAudioBuffer) {
        this.systemAudioBuffer.data.push(chunk)
      }
    })

    stream.on("error", (error: Error) => {
      logApp("[MeetingRecorder] System audio stream error:", error)
    })

    logApp("[MeetingRecorder] System audio recording started")
  }

  // Called from renderer to add microphone audio data
  addMicrophoneAudioData(audioData: ArrayBuffer): void {
    if (!this.isRecording || !this.currentMeeting) return
    if (this.currentMeeting.audioSource !== "microphone" && this.currentMeeting.audioSource !== "both") return

    if (!this.micAudioBuffer) {
      this.micAudioBuffer = {
        data: [],
        source: "microphone",
        startTime: Date.now(),
      }
    }

    this.micAudioBuffer.data.push(Buffer.from(audioData))
  }

  private startTranscriptionLoop(): void {
    this.transcriptionTimer = setInterval(async () => {
      await this.transcribeBufferedAudio()
    }, TRANSCRIPTION_INTERVAL_MS)
  }

  private async transcribeBufferedAudio(): Promise<void> {
    if (!this.currentMeeting || !this.isRecording) return

    const buffers: AudioBuffer[] = []

    // Collect system audio buffer
    if (this.systemAudioBuffer && this.systemAudioBuffer.data.length > 0) {
      buffers.push({
        data: [...this.systemAudioBuffer.data],
        source: "system",
        startTime: this.systemAudioBuffer.startTime,
      })
      this.systemAudioBuffer.data = []
      this.systemAudioBuffer.startTime = Date.now()
    }

    // Collect mic audio buffer
    if (this.micAudioBuffer && this.micAudioBuffer.data.length > 0) {
      buffers.push({
        data: [...this.micAudioBuffer.data],
        source: "microphone",
        startTime: this.micAudioBuffer.startTime,
      })
      this.micAudioBuffer.data = []
      this.micAudioBuffer.startTime = Date.now()
    }

    // Transcribe each buffer
    for (const buffer of buffers) {
      try {
        const audioBlob = this.createWavBlob(buffer.data)
        const transcript = await this.transcribeAudio(audioBlob)

        if (transcript && transcript.trim()) {
          const segment: MeetingTranscriptSegment = {
            id: `seg_${Date.now()}_${buffer.source}`,
            text: transcript,
            timestamp: buffer.startTime,
            source: buffer.source,
          }

          this.currentMeeting.transcriptSegments.push(segment)
          await this.saveMeeting(this.currentMeeting)

          logApp(`[MeetingRecorder] Transcribed ${buffer.source} audio: ${transcript.substring(0, 50)}...`)
        }
      } catch (error) {
        logApp(`[MeetingRecorder] Transcription error for ${buffer.source}:`, error)
      }
    }
  }

  private createWavBlob(chunks: Buffer[]): Blob {
    const audioData = Buffer.concat(chunks)

    // Create WAV header
    const wavHeader = this.createWavHeader(audioData.length, SAMPLE_RATE, CHANNELS, BYTES_PER_SAMPLE * 8)
    const wavBuffer = Buffer.concat([wavHeader, audioData])

    return new Blob([wavBuffer], { type: "audio/wav" })
  }

  private createWavHeader(dataLength: number, sampleRate: number, channels: number, bitsPerSample: number): Buffer {
    const header = Buffer.alloc(44)
    const byteRate = sampleRate * channels * (bitsPerSample / 8)
    const blockAlign = channels * (bitsPerSample / 8)

    // RIFF chunk descriptor
    header.write("RIFF", 0)
    header.writeUInt32LE(36 + dataLength, 4)
    header.write("WAVE", 8)

    // fmt sub-chunk
    header.write("fmt ", 12)
    header.writeUInt32LE(16, 16) // Subchunk1Size (16 for PCM)
    header.writeUInt16LE(1, 20) // AudioFormat (1 = PCM)
    header.writeUInt16LE(channels, 22)
    header.writeUInt32LE(sampleRate, 24)
    header.writeUInt32LE(byteRate, 28)
    header.writeUInt16LE(blockAlign, 32)
    header.writeUInt16LE(bitsPerSample, 34)

    // data sub-chunk
    header.write("data", 36)
    header.writeUInt32LE(dataLength, 40)

    return header
  }

  private async transcribeAudio(audioBlob: Blob): Promise<string> {
    const config = configStore.get()

    const form = new FormData()
    form.append(
      "file",
      new File([audioBlob], "meeting_audio.wav", { type: "audio/wav" })
    )
    form.append(
      "model",
      config.sttProviderId === "groq" ? "whisper-large-v3" : "whisper-1"
    )
    form.append("response_format", "json")

    // Add language if specified
    const languageCode = config.sttProviderId === "groq"
      ? config.groqSttLanguage || config.sttLanguage
      : config.openaiSttLanguage || config.sttLanguage

    if (languageCode && languageCode !== "auto") {
      form.append("language", languageCode)
    }

    const groqBaseUrl = config.groqBaseUrl || "https://api.groq.com/openai/v1"
    const openaiBaseUrl = config.openaiBaseUrl || "https://api.openai.com/v1"

    const response = await fetch(
      config.sttProviderId === "groq"
        ? `${groqBaseUrl}/audio/transcriptions`
        : `${openaiBaseUrl}/audio/transcriptions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.sttProviderId === "groq" ? config.groqApiKey : config.openaiApiKey}`,
        },
        body: form,
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Transcription API error: ${response.statusText} - ${errorText.substring(0, 200)}`)
    }

    const result: { text: string } = await response.json()
    return result.text
  }

  async stopRecording(): Promise<Meeting | null> {
    if (!this.isRecording || !this.currentMeeting) {
      return null
    }

    // Stop transcription timer
    if (this.transcriptionTimer) {
      clearInterval(this.transcriptionTimer)
      this.transcriptionTimer = null
    }

    // Final transcription of remaining audio
    await this.transcribeBufferedAudio()

    // Stop system audio recording
    if (this.systemRecorder) {
      try {
        this.systemRecorder.stop()
      } catch (error) {
        logApp("[MeetingRecorder] Error stopping system recorder:", error)
      }
      this.systemRecorder = null
    }

    // Finalize meeting
    this.currentMeeting.endedAt = Date.now()
    this.currentMeeting.duration = this.currentMeeting.endedAt - this.currentMeeting.createdAt
    this.currentMeeting.status = "processing"

    // Generate full transcript
    this.currentMeeting.fullTranscript = this.currentMeeting.transcriptSegments
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(s => s.text)
      .join(" ")

    this.currentMeeting.status = "completed"

    await this.saveMeeting(this.currentMeeting)

    const completedMeeting = this.currentMeeting

    // Reset state
    this.isRecording = false
    this.currentMeeting = null
    this.systemAudioBuffer = null
    this.micAudioBuffer = null

    logApp(`[MeetingRecorder] Stopped recording meeting ${completedMeeting.id}`)
    return completedMeeting
  }

  private async saveMeeting(meeting: Meeting): Promise<void> {
    const meetingPath = path.join(MEETINGS_FOLDER, `${meeting.id}.json`)
    await fs.promises.writeFile(meetingPath, JSON.stringify(meeting, null, 2))
  }

  async getMeeting(meetingId: string): Promise<Meeting | null> {
    const meetingPath = path.join(MEETINGS_FOLDER, `${meetingId}.json`)
    try {
      const data = await fs.promises.readFile(meetingPath, "utf-8")
      return JSON.parse(data) as Meeting
    } catch {
      return null
    }
  }

  async listMeetings(): Promise<MeetingListItem[]> {
    try {
      const files = await fs.promises.readdir(MEETINGS_FOLDER)
      const meetings: MeetingListItem[] = []

      for (const file of files) {
        if (!file.endsWith(".json")) continue
        try {
          const data = await fs.promises.readFile(path.join(MEETINGS_FOLDER, file), "utf-8")
          const meeting = JSON.parse(data) as Meeting
          meetings.push({
            id: meeting.id,
            title: meeting.title,
            createdAt: meeting.createdAt,
            endedAt: meeting.endedAt,
            duration: meeting.duration,
            status: meeting.status,
            segmentCount: meeting.transcriptSegments.length,
            previewText: meeting.fullTranscript?.substring(0, 100),
          })
        } catch (error) {
          logApp(`[MeetingRecorder] Error reading meeting file ${file}:`, error)
        }
      }

      return meetings.sort((a, b) => b.createdAt - a.createdAt)
    } catch {
      return []
    }
  }

  async deleteMeeting(meetingId: string): Promise<boolean> {
    const meetingPath = path.join(MEETINGS_FOLDER, `${meetingId}.json`)
    try {
      await fs.promises.unlink(meetingPath)
      return true
    } catch {
      return false
    }
  }

  async updateMeetingTitle(meetingId: string, title: string): Promise<Meeting | null> {
    const meeting = await this.getMeeting(meetingId)
    if (!meeting) return null

    meeting.title = title
    await this.saveMeeting(meeting)
    return meeting
  }
}

export const meetingRecorderService = new MeetingRecorderService()
