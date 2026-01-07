/**
 * Types for WhatsApp MCP Server
 */

export interface WhatsAppConfig {
  /** Directory to store authentication credentials */
  authDir: string
  /** Phone numbers (E.164 format) allowed to trigger agent responses */
  allowFrom?: string[]
  /** Whether to auto-reply to messages */
  autoReply?: boolean
  /** Callback URL for forwarding messages to SpeakMCP */
  callbackUrl?: string
  /** API key for callback authentication */
  callbackApiKey?: string
  /** Maximum message length before chunking */
  maxMessageLength?: number
  /** Whether to log message content (disable for privacy) */
  logMessages?: boolean
}

export interface WhatsAppMessage {
  /** Message ID from WhatsApp */
  id: string
  /** Sender's phone number (E.164 format) */
  from: string
  /** Sender's push name (display name) */
  fromName?: string
  /** Chat JID (could be group or individual) */
  chatId: string
  /** Whether this is a group message */
  isGroup: boolean
  /** Group name if applicable */
  groupName?: string
  /** Message text content */
  text: string
  /** Timestamp of the message */
  timestamp: number
  /** Whether this message mentions the bot */
  isMention?: boolean
  /** Quoted message if this is a reply */
  quotedMessage?: {
    id: string
    text: string
    from: string
  }
  /** Media type if message contains media */
  mediaType?: "image" | "video" | "audio" | "document" | "sticker"
  /** Media buffer if downloaded */
  mediaBuffer?: Buffer
  /** Media mimetype */
  mediaMimetype?: string
}

export interface WhatsAppChat {
  /** Chat JID */
  id: string
  /** Chat name (contact name or group name) */
  name: string
  /** Whether this is a group chat */
  isGroup: boolean
  /** Number of unread messages */
  unreadCount: number
  /** Last message timestamp */
  lastMessageTime?: number
  /** Last message preview */
  lastMessage?: string
}

export interface SendMessageOptions {
  /** Recipient phone number or group JID */
  to: string
  /** Message text */
  text: string
  /** Optional media URL to attach */
  mediaUrl?: string
  /** Media type if sending media */
  mediaType?: "image" | "video" | "audio" | "document"
  /** Whether to send as a reply */
  quotedMessageId?: string
}

export interface SendMessageResult {
  /** Whether the message was sent successfully */
  success: boolean
  /** Message ID if successful */
  messageId?: string
  /** Error message if failed */
  error?: string
}

export interface ConnectionStatus {
  /** Whether connected to WhatsApp */
  connected: boolean
  /** Current user's phone number */
  phoneNumber?: string
  /** Current user's name */
  userName?: string
  /** QR code data if waiting for scan */
  qrCode?: string
  /** Last connection error */
  lastError?: string
}

export type ConnectionState = "disconnected" | "connecting" | "qr" | "connected"

export interface WhatsAppEvents {
  /** Emitted when connection state changes */
  connectionUpdate: (status: ConnectionStatus) => void
  /** Emitted when a new message is received */
  message: (message: WhatsAppMessage) => void
  /** Emitted when QR code is available for scanning */
  qr: (qrCode: string) => void
  /** Emitted on errors */
  error: (error: Error) => void
}
