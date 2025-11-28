import { describe, it, expect } from "vitest"

import type { PcmTrack } from "./audio-mixing"
import { mixTracksToPcmS16le } from "./audio-mixing"

function makePcmBuffer(values: number[]): Buffer {
  const buf = Buffer.alloc(values.length * 2)
  for (let i = 0; i < values.length; i++) {
    buf.writeInt16LE(values[i], i * 2)
  }
  return buf
}

describe("mixTracksToPcmS16le", () => {
  it("returns system track unchanged when only system is present", () => {
    const data = makePcmBuffer([0, 32767, -32768, 1000])
    const system: PcmTrack = { data, sampleRate: 48_000, channels: 1 }

    const { buffer, sampleRate, channels } = mixTracksToPcmS16le({ system })

    expect(sampleRate).toBe(48_000)
    expect(channels).toBe(1)
    expect(buffer.length).toBe(data.length)
  })

  it("mixes system and mic by averaging when formats match", () => {
    const systemData = makePcmBuffer([1000, 1000])
    const micData = makePcmBuffer([3000, -1000])
    const system: PcmTrack = { data: systemData, sampleRate: 48_000, channels: 1 }
    const mic: PcmTrack = { data: micData, sampleRate: 48_000, channels: 1 }

    const { buffer, sampleRate, channels } = mixTracksToPcmS16le({ system, mic })

    expect(sampleRate).toBe(48_000)
    expect(channels).toBe(1)

    const out0 = buffer.readInt16LE(0)
    const out1 = buffer.readInt16LE(2)

    expect(out0).toBe(2000)
    expect(out1).toBe(0)
  })

  it("prefers system sample rate when both tracks are present", () => {
    const system: PcmTrack = {
      data: makePcmBuffer([1000, 1000, 1000, 1000]),
      sampleRate: 48_000,
      channels: 1,
    }
    const mic: PcmTrack = {
      data: makePcmBuffer([0, 0]),
      sampleRate: 24_000,
      channels: 1,
    }

    const { sampleRate, channels } = mixTracksToPcmS16le({ system, mic })

    expect(sampleRate).toBe(48_000)
    expect(channels).toBe(1)
  })
})

