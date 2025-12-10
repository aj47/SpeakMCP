const DEFAULT_MAX_MESSAGE_LENGTH = 1500

function normalizeWhatsAppAddress(address: string): string {
  const trimmed = String(address || "").trim()
  if (!trimmed) return trimmed
  return trimmed.startsWith("whatsapp:") ? trimmed : `whatsapp:${trimmed}`
}

export function chunkWhatsAppText(text: string, maxLength = DEFAULT_MAX_MESSAGE_LENGTH): string[] {
  const cleaned = String(text || "").trim()
  if (!cleaned) return ["(empty)"]

  const chunks: string[] = []
  let remaining = cleaned

  while (remaining.length > maxLength) {
    const slice = remaining.slice(0, maxLength)
    // Prefer splitting on whitespace/newline when possible.
    const lastBreak = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(" "))
    const splitAt = lastBreak > Math.floor(maxLength * 0.6) ? lastBreak : maxLength

    chunks.push(remaining.slice(0, splitAt).trim())
    remaining = remaining.slice(splitAt).trim()
  }

  if (remaining.length) chunks.push(remaining)
  return chunks.length ? chunks : ["(empty)"]
}

export async function sendTwilioWhatsAppMessages(options: {
  accountSid: string
  authToken: string
  from: string
  to: string
  body: string
  maxMessageLength?: number
}) {
  const { accountSid, authToken } = options
  const from = normalizeWhatsAppAddress(options.from)
  const to = normalizeWhatsAppAddress(options.to)

  const parts = chunkWhatsAppText(options.body, options.maxMessageLength)

  for (const part of parts) {
    const params = new URLSearchParams({ From: from, To: to, Body: part })

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: params.toString(),
      },
    )

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(
        `Twilio WhatsApp send failed (${res.status} ${res.statusText}): ${text}`,
      )
    }
  }
}

