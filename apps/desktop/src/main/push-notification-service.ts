/**
 * Push Notification Service for Desktop App
 * Sends push notifications to registered mobile clients via Expo Push Notification Service.
 */

import { configStore } from "./config"
import { diagnosticsService } from "./diagnostics"
import { PushNotificationToken } from "../shared/types"

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

export interface PushNotificationPayload {
  title: string
  body: string
  data?: Record<string, unknown>
  badge?: number
  sound?: "default" | null
  channelId?: string
  priority?: "default" | "high" | "normal"
}

interface ExpoPushMessage {
  to: string
  title?: string
  body?: string
  data?: Record<string, unknown>
  badge?: number
  sound?: "default" | null
  channelId?: string
  priority?: "default" | "high" | "normal"
}

interface ExpoPushTicket {
  status: "ok" | "error"
  id?: string
  message?: string
  details?: {
    error?: string
  }
}

/**
 * Send push notification to all registered mobile clients
 */
export async function sendPushNotification(payload: PushNotificationPayload): Promise<{
  success: boolean
  sent: number
  failed: number
  errors: string[]
}> {
  const cfg = configStore.get()
  const tokens = cfg.pushNotificationTokens || []

  if (tokens.length === 0) {
    diagnosticsService.logInfo("push-service", "No push tokens registered, skipping notification")
    return { success: true, sent: 0, failed: 0, errors: [] }
  }

  // Increment badge count for each token and save updated counts
  const updatedTokens = tokens.map((token: PushNotificationToken) => ({
    ...token,
    badgeCount: (token.badgeCount ?? 0) + 1,
  }))

  // Save updated badge counts
  configStore.save({ ...cfg, pushNotificationTokens: updatedTokens })

  const messages: ExpoPushMessage[] = updatedTokens.map((token: PushNotificationToken) => ({
    to: token.token,
    title: payload.title,
    body: payload.body,
    data: payload.data,
    badge: token.badgeCount ?? 1, // Use per-token badge count
    sound: payload.sound ?? "default",
    channelId: payload.channelId ?? "default",
    priority: payload.priority ?? "high",
  }))

  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Accept-Encoding": "gzip, deflate",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    })

    if (!response.ok) {
      const errorText = await response.text()
      diagnosticsService.logError("push-service", `Expo push failed: ${response.status} ${errorText}`)
      return { success: false, sent: 0, failed: tokens.length, errors: [errorText] }
    }

    const result = await response.json() as { data: ExpoPushTicket[] }
    const tickets = result.data || []

    let sent = 0
    let failed = 0
    const errors: string[] = []
    const invalidTokens: string[] = []

    tickets.forEach((ticket: ExpoPushTicket, index: number) => {
      if (ticket.status === "ok") {
        sent++
      } else {
        failed++
        const errorMsg = ticket.message || ticket.details?.error || "Unknown error"
        errors.push(errorMsg)

        // Track invalid tokens for cleanup
        if (ticket.details?.error === "DeviceNotRegistered") {
          invalidTokens.push(tokens[index].token)
        }
      }
    })

    // Clean up invalid tokens
    if (invalidTokens.length > 0) {
      const validTokens = updatedTokens.filter((t: PushNotificationToken) => !invalidTokens.includes(t.token))
      // Fetch fresh config to avoid overwriting other concurrent changes
      const freshCfg = configStore.get()
      configStore.save({ ...freshCfg, pushNotificationTokens: validTokens })
      diagnosticsService.logInfo("push-service", `Removed ${invalidTokens.length} invalid push tokens`)
    }

    diagnosticsService.logInfo("push-service", `Push notification sent: ${sent} success, ${failed} failed`)

    return { success: failed === 0, sent, failed, errors }
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    diagnosticsService.logError("push-service", `Failed to send push notification: ${errorMsg}`)
    return { success: false, sent: 0, failed: tokens.length, errors: [errorMsg] }
  }
}

/**
 * Send notification for a new message in a conversation
 */
export async function sendMessageNotification(
  conversationId: string,
  conversationTitle: string,
  messagePreview: string
): Promise<void> {
  const truncatedPreview = messagePreview.length > 100
    ? messagePreview.substring(0, 100) + "..."
    : messagePreview

  await sendPushNotification({
    title: "SpeakMCP",
    body: truncatedPreview,
    data: {
      type: "message",
      conversationId,
      conversationTitle,
    },
    // badge is now handled per-token in sendPushNotification
    sound: "default",
    priority: "high",
  })
}

/**
 * Check if push notifications are enabled (any tokens registered)
 */
export function isPushEnabled(): boolean {
  const cfg = configStore.get()
  const tokens = cfg.pushNotificationTokens || []
  return tokens.length > 0
}

/**
 * Clear badge count for a specific token (called when mobile app opens)
 */
export function clearBadgeCount(tokenValue: string): void {
  const cfg = configStore.get()
  const tokens = cfg.pushNotificationTokens || []

  const updatedTokens = tokens.map((token: PushNotificationToken) =>
    token.token === tokenValue
      ? { ...token, badgeCount: 0 }
      : token
  )

  configStore.save({ ...cfg, pushNotificationTokens: updatedTokens })
  diagnosticsService.logInfo("push-service", `Badge count cleared for token: ${tokenValue.substring(0, 20)}...`)
}

