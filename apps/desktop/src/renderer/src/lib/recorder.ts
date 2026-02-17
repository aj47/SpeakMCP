import EventEmitter from "./event-emitter"
import { playSound } from "./sound"

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

export class Recorder extends EventEmitter<{
  "record-start": []
  "record-end": [Blob, number]
  "visualizer-data": [number]
  destroy: []
}> {
  stream: MediaStream | null = null
  mediaRecorder: MediaRecorder | null = null
  audioChunks: Blob[] = []

  constructor() {
    super()
  }

  analyseAudio(stream: MediaStream) {
    let processFrameTimer: number | null = null

    const audioContext = new AudioContext()
    const audioStreamSource = audioContext.createMediaStreamSource(stream)

    const analyser = audioContext.createAnalyser()
    analyser.minDecibels = MIN_DECIBELS
    audioStreamSource.connect(analyser)

    const bufferLength = analyser.frequencyBinCount

    const domainData = new Uint8Array(bufferLength)
    const timeDomainData = new Uint8Array(analyser.fftSize)

    const animate = (fn: () => void) => {
      processFrameTimer = requestAnimationFrame(fn)
    }

    const detectSound = () => {
      const processFrame = () => {
        analyser.getByteTimeDomainData(timeDomainData)
        analyser.getByteFrequencyData(domainData)

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

  async startRecording() {
    this.stopRecording()

    const stream = (this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: "default",
      },
      video: false,
    }))

    const mediaRecorder = (this.mediaRecorder = new MediaRecorder(stream, {
      audioBitsPerSecond: 128e3,
    }))

    this.audioChunks = []
    let startTime = Date.now()

    mediaRecorder.onstart = () => {
      startTime = Date.now()
      this.emit("record-start")
      const stopAnalysing = this.analyseAudio(stream)
      this.once("destroy", stopAnalysing)
    }

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        this.audioChunks.push(event.data)
      }
    }
    mediaRecorder.onstop = async () => {
      const duration = Date.now() - startTime
      const blob = new Blob(this.audioChunks, { type: mediaRecorder.mimeType })

      // Check if blob has actual data
      if (blob.size === 0) {
        console.warn("[Recorder] Recording blob is empty, duration:", duration)
      }

      this.emit("record-end", blob, duration)

      this.audioChunks = []
    }

    // Start recording with timeslice to ensure data is collected periodically
    // This helps prevent empty blobs on short recordings
    mediaRecorder.start(100) // Collect data every 100ms
  }

  getRecordingBlob(): Blob | null {
    if (!this.mediaRecorder || this.audioChunks.length === 0) return null
    return new Blob(this.audioChunks, { type: this.mediaRecorder.mimeType })
  }

  getAudioChunkCount(): number {
    return this.audioChunks.length
  }

  stopRecording() {
    if (this.mediaRecorder) {
      this.mediaRecorder.stop()
      this.mediaRecorder = null
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop())
      this.stream = null
    }

    this.emit("destroy")
  }
}
