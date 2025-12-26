import EventEmitter from "./event-emitter"

const MIN_DECIBELS = -45

const calculateRMS = (data: Uint8Array) => {
  let sumSquares = 0
  for (let i = 0; i < data.length; i++) {
    const normalizedValue = (data[i] - 128) / 128
    sumSquares += normalizedValue * normalizedValue
  }
  return Math.sqrt(sumSquares / data.length)
}

const normalizeRMS = (rms: number) => {
  rms = rms * 10
  const exp = 1.5
  const scaledRMS = Math.pow(rms, exp)
  return Math.min(1.0, Math.max(0.01, scaledRMS))
}

export type MeetingRecorderEvents = {
  "record-start": []
  "record-end": [Blob, number]
  "visualizer-data": [number]
  "error": [Error]
  destroy: []
}

/**
 * MeetingRecorder captures both microphone and system audio for meeting transcription.
 * Uses electron-audio-loopback for system audio capture on macOS 12.3+.
 * 
 * The audio streams are mixed together and recorded as a single audio file
 * that can be sent to transcription providers.
 */
export class MeetingRecorder extends EventEmitter<MeetingRecorderEvents> {
  private micStream: MediaStream | null = null
  private systemStream: MediaStream | null = null
  private mediaRecorder: MediaRecorder | null = null
  private audioContext: AudioContext | null = null
  private mixedDestination: MediaStreamAudioDestinationNode | null = null
  private isRecording = false

  constructor() {
    super()
  }

  private analyseAudio(stream: MediaStream) {
    let processFrameTimer: number | null = null

    const audioContext = new AudioContext()
    const audioStreamSource = audioContext.createMediaStreamSource(stream)

    const analyser = audioContext.createAnalyser()
    analyser.minDecibels = MIN_DECIBELS
    audioStreamSource.connect(analyser)

    const bufferLength = analyser.frequencyBinCount
    const timeDomainData = new Uint8Array(analyser.fftSize)

    const animate = (fn: () => void) => {
      processFrameTimer = requestAnimationFrame(fn)
    }

    const detectSound = () => {
      const processFrame = () => {
        analyser.getByteTimeDomainData(timeDomainData)
        const rmsLevel = calculateRMS(timeDomainData)
        const rms = normalizeRMS(rmsLevel)
        this.emit("visualizer-data", rms)
        animate(processFrame)
      }
      animate(processFrame)
    }

    detectSound()

    return () => {
      processFrameTimer && cancelAnimationFrame(processFrameTimer)
      audioStreamSource.disconnect()
      audioContext.close()
    }
  }

  /**
   * Get system audio stream using electron-audio-loopback.
   * This captures all system audio output (e.g., meeting participants' voices).
   */
  private async getSystemAudioStream(): Promise<MediaStream> {
    // Enable loopback audio mode
    await window.electronAPI.enableLoopbackAudio()

    try {
      // getDisplayMedia with loopback enabled will capture system audio
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true, // Required, but we'll remove video tracks
        audio: true,
      })

      // Remove video tracks - we only need audio
      const videoTracks = stream.getVideoTracks()
      videoTracks.forEach(track => {
        track.stop()
        stream.removeTrack(track)
      })

      return stream
    } finally {
      // Disable loopback mode to restore normal getDisplayMedia behavior
      await window.electronAPI.disableLoopbackAudio()
    }
  }

  /**
   * Mix microphone and system audio streams into a single stream.
   */
  private mixAudioStreams(micStream: MediaStream, systemStream: MediaStream): MediaStream {
    this.audioContext = new AudioContext()
    this.mixedDestination = this.audioContext.createMediaStreamDestination()

    // Connect microphone
    const micSource = this.audioContext.createMediaStreamSource(micStream)
    micSource.connect(this.mixedDestination)

    // Connect system audio
    const systemSource = this.audioContext.createMediaStreamSource(systemStream)
    systemSource.connect(this.mixedDestination)

    return this.mixedDestination.stream
  }

  async startRecording(): Promise<void> {
    if (this.isRecording) {
      console.warn("[MeetingRecorder] Already recording")
      return
    }

    try {
      // Get microphone stream
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: "default" },
        video: false,
      })

      // Get system audio stream (macOS only)
      this.systemStream = await this.getSystemAudioStream()

      // Mix both streams
      const mixedStream = this.mixAudioStreams(this.micStream, this.systemStream)

      // Create MediaRecorder with mixed stream
      this.mediaRecorder = new MediaRecorder(mixedStream, {
        audioBitsPerSecond: 128000,
      })

      let audioChunks: Blob[] = []
      let startTime = Date.now()

      this.mediaRecorder.onstart = () => {
        startTime = Date.now()
        this.isRecording = true
        this.emit("record-start")
        const stopAnalysing = this.analyseAudio(mixedStream)
        this.once("destroy", stopAnalysing)
      }

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunks.push(event.data)
        }
      }

      this.mediaRecorder.onstop = async () => {
        const duration = Date.now() - startTime
        const blob = new Blob(audioChunks, { type: this.mediaRecorder?.mimeType || "audio/webm" })

        if (blob.size === 0) {
          console.warn("[MeetingRecorder] Recording blob is empty, duration:", duration)
        }

        this.emit("record-end", blob, duration)
        audioChunks = []
      }

      this.mediaRecorder.onerror = (event) => {
        console.error("[MeetingRecorder] MediaRecorder error:", event)
        this.emit("error", new Error("MediaRecorder error"))
      }

      // Start recording with timeslice to ensure data is collected periodically
      this.mediaRecorder.start(100)
    } catch (error) {
      console.error("[MeetingRecorder] Failed to start recording:", error)
      this.cleanup()
      throw error
    }
  }

  stopRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop()
    }
    this.cleanup()
  }

  private cleanup(): void {
    this.isRecording = false

    if (this.mediaRecorder) {
      this.mediaRecorder = null
    }

    if (this.micStream) {
      this.micStream.getTracks().forEach(track => track.stop())
      this.micStream = null
    }

    if (this.systemStream) {
      this.systemStream.getTracks().forEach(track => track.stop())
      this.systemStream = null
    }

    if (this.audioContext) {
      this.audioContext.close()
      this.audioContext = null
    }

    this.mixedDestination = null
    this.emit("destroy")
  }

  getIsRecording(): boolean {
    return this.isRecording
  }
}

