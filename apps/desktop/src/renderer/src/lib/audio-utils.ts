/**
 * Decode an audio blob (webm, etc.) to raw float32 PCM samples at the specified
 * sample rate (mono). Uses the Web Audio API available in the renderer/browser context.
 *
 * Parakeet STT requires raw float32 PCM at 16kHz mono, but MediaRecorder produces
 * compressed webm audio. This function handles the conversion.
 *
 * @param blob - Audio blob from MediaRecorder (webm or other browser-decodable format)
 * @param targetSampleRate - Desired output sample rate (default: 16000 for Parakeet)
 * @returns ArrayBuffer containing interleaved float32 PCM samples
 */
export async function decodeBlobToPcm(
  blob: Blob,
  targetSampleRate = 16000,
): Promise<ArrayBuffer> {
  // Decode the audio at its native sample rate using a temporary AudioContext
  const decodeContext = new AudioContext()
  let audioBuffer: AudioBuffer
  try {
    const rawBuffer = await blob.arrayBuffer()
    audioBuffer = await decodeContext.decodeAudioData(rawBuffer)
  } finally {
    await decodeContext.close()
  }

  // Resample to the target sample rate and mix down to mono using OfflineAudioContext.
  // OfflineAudioContext with 1 output channel automatically down-mixes stereo to mono
  // per the Web Audio API spec (averaging the two channels), which is ideal for speech.
  const numFrames = Math.max(1, Math.ceil(audioBuffer.duration * targetSampleRate))
  const offlineContext = new OfflineAudioContext(1, numFrames, targetSampleRate)

  const source = offlineContext.createBufferSource()
  source.buffer = audioBuffer
  source.connect(offlineContext.destination)
  source.start(0)

  const resampled = await offlineContext.startRendering()

  // Copy into a fresh Float32Array so the resulting buffer is properly owned
  // (getChannelData may return a view into a shared internal buffer).
  const channelData = resampled.getChannelData(0)
  return Float32Array.from(channelData).buffer
}

