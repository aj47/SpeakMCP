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
const TRANSCRIPTION_TIMEOUT_MS = 60000 // 60 second timeout for transcription requests
const MAX_BUFFER_SIZE_BYTES = 25 * 1024 * 1024 // 25MB max buffer size to prevent unbounded growth

// Default audio settings (can be overridden by actual recorder settings)
const DEFAULT_SAMPLE_RATE = 48000
const DEFAULT_CHANNELS = 1
const DEFAULT_BYTES_PER_SAMPLE = 2 // 16-bit audio

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

interface AudioDetails {
  sampleRate: number
  channels: number
  bitsPerSample: number
}

interface AudioBuffer {
  data: Buffer[]
  source: "microphone" | "system"
  startTime: number
  audioDetails: AudioDetails
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
  private isTranscribing = false // Guard to prevent overlapping transcription runs
  private systemAudioDetails: AudioDetails = {
    sampleRate: DEFAULT_SAMPLE_RATE,
    channels: DEFAULT_CHANNELS,
    bitsPerSample: DEFAULT_BYTES_PER_SAMPLE * 8,
  }

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
      // Clean up any resources that may have been started before the error
      this.cleanupRecordingResources()
      this.isRecording = false
      this.currentMeeting = null
      throw error
    }
  }

  private cleanupRecordingResources(): void {
    // Stop transcription timer
    if (this.transcriptionTimer) {
      clearInterval(this.transcriptionTimer)
      this.transcriptionTimer = null
    }

    // Stop system audio recording
    if (this.systemRecorder) {
      try {
        this.systemRecorder.stop()
      } catch (error) {
        logApp("[MeetingRecorder] Error stopping system recorder during cleanup:", error)
      }
      this.systemRecorder = null
    }

    // Clear audio buffers
    this.systemAudioBuffer = null
    this.micAudioBuffer = null
  }

  private async startSystemAudioRecording(): Promise<void> {
    const RecorderClass = await loadSystemAudioRecorder()
    if (!RecorderClass) {
      throw new Error("System audio recording not available")
    }

    this.systemRecorder = new RecorderClass()
    this.systemRecorder.start()

    // Get actual audio details from the recorder if available
    try {
      const details = this.systemRecorder.getAudioDetails?.()
      if (details) {
        this.systemAudioDetails = {
          sampleRate: details.sampleRate || DEFAULT_SAMPLE_RATE,
          channels: details.channels || DEFAULT_CHANNELS,
          bitsPerSample: details.bitsPerSample || (DEFAULT_BYTES_PER_SAMPLE * 8),
        }
        logApp(`[MeetingRecorder] System audio details: ${JSON.stringify(this.systemAudioDetails)}`)
      }
    } catch (error) {
      logApp("[MeetingRecorder] Could not get audio details, using defaults:", error)
    }

    this.systemAudioBuffer = {
      data: [],
      source: "system",
      startTime: Date.now(),
      audioDetails: { ...this.systemAudioDetails },
    }

    // Get the audio stream and collect data
    const stream = this.systemRecorder.getStream() as Readable
    stream.on("data", (chunk: Buffer) => {
      if (this.systemAudioBuffer) {
        // Check buffer size limit to prevent unbounded growth
        const currentSize = this.getBufferSize(this.systemAudioBuffer.data)
        if (currentSize + chunk.length > MAX_BUFFER_SIZE_BYTES) {
          logApp(`[MeetingRecorder] System audio buffer size limit reached (${Math.round(currentSize / 1024 / 1024)}MB), discarding oldest data`)
          // Remove oldest chunks until we have room
          while (this.systemAudioBuffer.data.length > 0 && 
                 this.getBufferSize(this.systemAudioBuffer.data) + chunk.length > MAX_BUFFER_SIZE_BYTES) {
            this.systemAudioBuffer.data.shift()
          }
        }
        this.systemAudioBuffer.data.push(chunk)
      }
    })

    stream.on("error", (error: Error) => {
      logApp("[MeetingRecorder] System audio stream error:", error)
    })

    logApp("[MeetingRecorder] System audio recording started")
  }

  // Called from renderer to add microphone audio data
  // Microphone audio is always 48kHz mono 16-bit from the renderer AudioContext
  addMicrophoneAudioData(audioData: ArrayBuffer): void {
    if (!this.isRecording || !this.currentMeeting) return
    if (this.currentMeeting.audioSource !== "microphone" && this.currentMeeting.audioSource !== "both") return

    if (!this.micAudioBuffer) {
      this.micAudioBuffer = {
        data: [],
        source: "microphone",
        startTime: Date.now(),
        audioDetails: {
          sampleRate: DEFAULT_SAMPLE_RATE,
          channels: DEFAULT_CHANNELS,
          bitsPerSample: DEFAULT_BYTES_PER_SAMPLE * 8,
        },
      }
    }

    // Check buffer size limit to prevent unbounded growth
    const newData = Buffer.from(audioData)
    const currentSize = this.getBufferSize(this.micAudioBuffer.data)
    if (currentSize + newData.length > MAX_BUFFER_SIZE_BYTES) {
      logApp(`[MeetingRecorder] Mic audio buffer size limit reached (${Math.round(currentSize / 1024 / 1024)}MB), discarding oldest data`)
      // Remove oldest chunks until we have room
      while (this.micAudioBuffer.data.length > 0 && 
             this.getBufferSize(this.micAudioBuffer.data) + newData.length > MAX_BUFFER_SIZE_BYTES) {
        this.micAudioBuffer.data.shift()
      }
    }
    this.micAudioBuffer.data.push(newData)
  }

  private getBufferSize(chunks: Buffer[]): number {
    return chunks.reduce((total, chunk) => total + chunk.length, 0)
  }

  private startTranscriptionLoop(): void {
    this.transcriptionTimer = setInterval(async () => {
      await this.transcribeBufferedAudio()
    }, TRANSCRIPTION_INTERVAL_MS)
  }

  private async transcribeBufferedAudio(): Promise<void> {
    if (!this.currentMeeting || !this.isRecording) return

    // Prevent overlapping transcription runs
    if (this.isTranscribing) {
      logApp("[MeetingRecorder] Transcription already in progress, skipping this interval")
      return
    }

    this.isTranscribing = true

    try {
      await this.performTranscription()
    } finally {
      this.isTranscribing = false
    }
  }

  private async performTranscription(): Promise<void> {
    if (!this.currentMeeting) return

    // Transcribe system audio buffer if available
    if (this.systemAudioBuffer && this.systemAudioBuffer.data.length > 0) {
      await this.transcribeBuffer(this.systemAudioBuffer, "system")
    }

    // Transcribe mic audio buffer if available
    if (this.micAudioBuffer && this.micAudioBuffer.data.length > 0) {
      await this.transcribeBuffer(this.micAudioBuffer, "microphone")
    }
  }

  private async transcribeBuffer(
    buffer: AudioBuffer,
    source: "system" | "microphone"
  ): Promise<void> {
    if (!this.currentMeeting) return

    // Copy buffer data for transcription (don't clear yet in case of failure)
    const bufferData = [...buffer.data]
    const bufferStartTime = buffer.startTime
    const bufferAudioDetails = { ...buffer.audioDetails }

    try {
      const audioBlob = this.createWavBlob(bufferData, bufferAudioDetails)
      const transcript = await this.transcribeAudio(audioBlob)

      // Only clear the buffer after successful transcription
      buffer.data = []
      buffer.startTime = Date.now()

      if (transcript && transcript.trim()) {
        const segment: MeetingTranscriptSegment = {
          id: `seg_${Date.now()}_${source}`,
          text: transcript,
          timestamp: bufferStartTime,
          source: source,
        }

        this.currentMeeting.transcriptSegments.push(segment)
        await this.saveMeeting(this.currentMeeting)

        logApp(`[MeetingRecorder] Transcribed ${source} audio: ${transcript.substring(0, 50)}...`)
      }
    } catch (error) {
      // Keep the buffer data for retry on next interval
      logApp(`[MeetingRecorder] Transcription error for ${source} (will retry):`, error)
    }
  }

  private createWavBlob(chunks: Buffer[], audioDetails: AudioDetails): Blob {
    const audioData = Buffer.concat(chunks)

    // Create WAV header using actual audio details
    const wavHeader = this.createWavHeader(
      audioData.length,
      audioDetails.sampleRate,
      audioDetails.channels,
      audioDetails.bitsPerSample
    )
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

    // Use AbortController for timeout to prevent hanging requests
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TRANSCRIPTION_TIMEOUT_MS)

    try {
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
          signal: controller.signal,
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Transcription API error: ${response.statusText} - ${errorText.substring(0, 200)}`)
      }

      const result: { text: string } = await response.json()
      return result.text
    } finally {
      clearTimeout(timeoutId)
    }
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

    // Wait for any in-progress transcription to complete
    while (this.isTranscribing) {
      logApp("[MeetingRecorder] Waiting for in-progress transcription to complete...")
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    // Final transcription of remaining audio (bypass the guard since we're stopping)
    this.isTranscribing = true
    try {
      await this.performTranscription()
    } finally {
      this.isTranscribing = false
    }

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
