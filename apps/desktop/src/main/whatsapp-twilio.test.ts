import { beforeEach, describe, expect, it, vi } from "vitest"

import { chunkWhatsAppText, sendTwilioWhatsAppMessages } from "./whatsapp-twilio"

describe("whatsapp-twilio", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  it("chunks text and respects maxLength", () => {
    const parts = chunkWhatsAppText("1234567 89 012345", 10)

    expect(parts.length).toBeGreaterThan(1)
    expect(parts.every((p) => p.length <= 10)).toBe(true)
    expect(parts.join(" ")).toContain("1234567")
  })

  it("returns (empty) for empty input", () => {
    expect(chunkWhatsAppText("", 10)).toEqual(["(empty)"])
  })

  it("sends to Twilio and normalizes whatsapp: prefix", async () => {
    const mockRes = {
      ok: true,
      status: 201,
      statusText: "Created",
      text: async () => "",
    }

    global.fetch = vi.fn().mockResolvedValue(mockRes)

    await sendTwilioWhatsAppMessages({
      accountSid: "AC123",
      authToken: "token",
      from: "+14155552671",
      to: "+15551231234",
      body: "hello",
    })

    expect(global.fetch).toHaveBeenCalledTimes(1)

    const [url, options] = (global.fetch as any).mock.calls[0]
    expect(String(url)).toContain("/Accounts/AC123/Messages.json")
    expect(options.method).toBe("POST")

    const auth = options.headers.Authorization as string
    expect(auth).toMatch(/^Basic /)
    const decoded = Buffer.from(auth.replace("Basic ", ""), "base64").toString("utf8")
    expect(decoded).toBe("AC123:token")

    const params = new URLSearchParams(options.body)
    expect(params.get("From")).toBe("whatsapp:+14155552671")
    expect(params.get("To")).toBe("whatsapp:+15551231234")
    expect(params.get("Body")).toBe("hello")
  })

  it("splits a long body into multiple sends", async () => {
    const mockRes = {
      ok: true,
      status: 201,
      statusText: "Created",
      text: async () => "",
    }

    global.fetch = vi.fn().mockResolvedValue(mockRes)

    await sendTwilioWhatsAppMessages({
      accountSid: "AC123",
      authToken: "token",
      from: "whatsapp:+14155552671",
      to: "whatsapp:+15551231234",
      body: "1234567890",
      maxMessageLength: 5,
    })

    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it("throws a helpful error on non-ok response", async () => {
    const mockRes = {
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "nope",
    }

    global.fetch = vi.fn().mockResolvedValue(mockRes)

    await expect(
      sendTwilioWhatsAppMessages({
        accountSid: "AC123",
        authToken: "token",
        from: "whatsapp:+14155552671",
        to: "whatsapp:+15551231234",
        body: "hello",
      }),
    ).rejects.toThrow(/Twilio WhatsApp send failed/)
  })
})

