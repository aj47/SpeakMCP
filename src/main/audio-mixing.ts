import { Buffer } from "node:buffer"

export interface PcmTrack {
  data: Buffer
  sampleRate: number
  channels: number
}

interface MixInput {
  system?: PcmTrack
  mic?: PcmTrack
}

interface MixResult {
  buffer: Buffer
  sampleRate: number
  channels: number
}

function framesForTrack(track: PcmTrack): number {
  if (track.channels <= 0) return 0
  return Math.floor(track.data.length / (track.channels * 2))
}

function accumulateTrack(
  track: PcmTrack,
  targetSampleRate: number,
  targetChannels: number,
  weight: number,
  out: Float32Array,
): void {
  const frames = framesForTrack(track)
  if (frames === 0) return

  const src = new Int16Array(track.data.buffer, track.data.byteOffset, track.data.byteLength / 2)
  const framesOut = out.length / targetChannels
  const ratio = track.sampleRate / targetSampleRate

  for (let i = 0; i < framesOut; i++) {
    const srcPos = i * ratio
    if (srcPos >= frames - 1) break

    const idx0 = Math.floor(srcPos)
    const idx1 = Math.min(idx0 + 1, frames - 1)
    const frac = srcPos - idx0

    for (let ch = 0; ch < targetChannels; ch++) {
      const srcCh = track.channels === 1 ? 0 : Math.min(ch, track.channels - 1)
      const s0 = src[idx0 * track.channels + srcCh] / 32768
      const s1 = src[idx1 * track.channels + srcCh] / 32768
      const sample = (s0 + (s1 - s0) * frac) * weight
      out[i * targetChannels + ch] += sample
    }
  }
}

export function mixTracksToPcmS16le({ system, mic }: MixInput): MixResult {
  if (!system && !mic) {
    throw new Error("No audio tracks provided to mix")
  }

  const sampleRate = system?.sampleRate ?? mic?.sampleRate ?? 48_000
  const channels = Math.max(system?.channels ?? 0, mic?.channels ?? 0, 1)

  const systemFrames = system ? framesForTrack(system) : 0
  const micFrames = mic ? framesForTrack(mic) : 0

  const systemFramesAtTarget =
    system && system.sampleRate !== sampleRate
      ? Math.round(systemFrames * (sampleRate / system.sampleRate))
      : systemFrames
  const micFramesAtTarget =
    mic && mic.sampleRate !== sampleRate
      ? Math.round(micFrames * (sampleRate / mic.sampleRate))
      : micFrames

  const totalFrames = Math.max(systemFramesAtTarget, micFramesAtTarget)
  if (totalFrames <= 0) {
    throw new Error("Audio tracks are empty")
  }

  const out = new Float32Array(totalFrames * channels)
  const activeTracks = (system ? 1 : 0) + (mic ? 1 : 0)
  const weight = activeTracks > 0 ? 1 / activeTracks : 1

  if (system) {
    accumulateTrack(system, sampleRate, channels, weight, out)
  }
  if (mic) {
    accumulateTrack(mic, sampleRate, channels, weight, out)
  }

  const buffer = Buffer.alloc(totalFrames * channels * 2)
  for (let i = 0; i < out.length; i++) {
    let v = out[i]
    if (v > 1) v = 1
    else if (v < -1) v = -1
    const int = Math.round(v * 32767)
    buffer.writeInt16LE(int, i * 2)
  }

  return { buffer, sampleRate, channels }
}

