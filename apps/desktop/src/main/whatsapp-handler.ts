/**
 * WhatsApp Cloud API Integration for SpeakMCP
 * 
 * This module handles incoming WhatsApp messages via webhook and sends responses
 * back through the WhatsApp Cloud API.
 */

import { configStore } from "./config"
import { diagnosticsService } from "./diagnostics"

// Types for WhatsApp Cloud API
export interface WhatsAppMessage {
  from: string
  id: string
  timestamp: string
  type: "text" | "image" | "audio" | "video" | "document" | "location" | "contacts" | "interactive" | "button" | "unknown"
  text?: {
    body: string
  }
}

export interface WhatsAppWebhookPayload {
  object: string
  entry: Array<{
    id: string
    changes: Array<{
      value: {
        messaging_product: string
        metadata: {
          display_phone_number: string
          phone_number_id: string
        }
        contacts?: Array<{
          profile: { name: string }
          wa_id: string
        }>
        messages?: WhatsAppMessage[]
        statuses?: Array<{
          id: string
          status: string
          timestamp: string
          recipient_id: string
        }>
      }
      field: string
    }>
  }>
}

// In-memory conversation tracking (phone number -> conversation ID)
const phoneToConversation = new Map<string, string>()

/**
 * Extract the text message from a WhatsApp webhook payload
 */
export function extractTextMessage(payload: WhatsAppWebhookPayload): { from: string; text: string; phoneNumberId: string } | null {
  try {
    const entry = payload.entry?.[0]
    const change = entry?.changes?.[0]
    const value = change?.value
    const message = value?.messages?.[0]

    if (!message || message.type !== "text" || !message.text?.body) {
      return null
    }

    return {
      from: message.from,
      text: message.text.body,
      phoneNumberId: value.metadata.phone_number_id,
    }
  } catch (error) {
    diagnosticsService.logError("whatsapp-handler", "Failed to extract text message", error)
    return null
  }
}

/**
 * Send a text message back to WhatsApp
 */
export async function sendWhatsAppMessage(
  to: string,
  text: string,
  phoneNumberId: string
): Promise<boolean> {
  const cfg = configStore.get()
  const accessToken = cfg.whatsappAccessToken

  if (!accessToken) {
    diagnosticsService.logError("whatsapp-handler", "WhatsApp access token not configured")
    return false
  }

  const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { body: text },
      }),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      diagnosticsService.logError("whatsapp-handler", `Failed to send message: ${response.status} ${errorBody}`)
      return false
    }

    diagnosticsService.logInfo("whatsapp-handler", `Message sent to ${to}`)
    return true
  } catch (error) {
    diagnosticsService.logError("whatsapp-handler", "Error sending WhatsApp message", error)
    return false
  }
}

/**
 * Get or create a conversation ID for a phone number
 */
export function getConversationIdForPhone(phoneNumber: string): string | undefined {
  return phoneToConversation.get(phoneNumber)
}

/**
 * Store conversation ID for a phone number
 */
export function setConversationIdForPhone(phoneNumber: string, conversationId: string): void {
  phoneToConversation.set(phoneNumber, conversationId)
}

/**
 * Clear conversation for a phone number (e.g., when user sends "clear" or "reset")
 */
export function clearConversationForPhone(phoneNumber: string): void {
  phoneToConversation.delete(phoneNumber)
}

/**
 * Verify WhatsApp webhook token
 */
export function verifyWebhookToken(hubMode: string, hubVerifyToken: string, hubChallenge: string): string | null {
  const cfg = configStore.get()
  const expectedToken = cfg.whatsappWebhookVerifyToken

  if (hubMode === "subscribe" && hubVerifyToken === expectedToken) {
    diagnosticsService.logInfo("whatsapp-handler", "Webhook verified successfully")
    return hubChallenge
  }

  diagnosticsService.logWarning("whatsapp-handler", "Webhook verification failed")
  return null
}

