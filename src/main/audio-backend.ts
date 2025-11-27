export interface AudioBackend {
  /**
   * Start capturing audio for the given logical session.
   * Implementations may support only a single active session at a time and
   * should stop any previous capture if needed.
   */
  startCapture(sessionId: string): Promise<void>

  /**
   * Stop capturing audio for the given logical session.
   */
  stopCapture(sessionId: string): Promise<void>

  /**
   * Subscribe to audio chunks. The handler will be called with raw PCM data
   * and associated metadata. Implementations must include the originating
   * sessionId in the info payload.
   */
  onAudioChunk(
    handler: (
      buffer: Buffer,
      info: {
        sessionId: string
        sequence: number
        sampleRate: number
        channels: number
      },
    ) => void,
  ): void

  /**
   * Subscribe to backend-level errors (e.g. spawn failures, permission issues).
   */
  onError(handler: (error: Error) => void): void
}

