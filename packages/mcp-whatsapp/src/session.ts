/**
 * WhatsApp Session Management using Baileys
 * Handles authentication, connection, and socket lifecycle
 */

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  ConnectionState,
  BaileysEventMap,
  proto,
  makeCacheableSignalKeyStore,
} from "@whiskeysockets/baileys"
import { Boom } from "@hapi/boom"
import pino from "pino"
import * as qrcode from "qrcode-terminal"
import { EventEmitter } from "events"
import path from "path"
import fs from "fs"
import type {
  WhatsAppConfig,
  WhatsAppMessage,
  ConnectionStatus,
  ConnectionState as AppConnectionState,
  SendMessageOptions,
  SendMessageResult,
  WhatsAppChat,
} from "./types.js"

// Create a silent logger for Baileys (it's very noisy by default)
const logger = pino({ level: "silent" })

export class WhatsAppSession extends EventEmitter {
  private socket: WASocket | null = null
  private config: WhatsAppConfig
  private connectionState: AppConnectionState = "disconnected"
  private phoneNumber: string | null = null
  private userName: string | null = null
  private qrCodeData: string | null = null
  private lastError: string | null = null
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private messageHistory: Map<string, WhatsAppMessage[]> = new Map()
  private readonly MAX_HISTORY_PER_CHAT = 50

  constructor(config: WhatsAppConfig) {
    super()
    this.config = {
      maxMessageLength: 4000,
      logMessages: false,
      ...config,
    }

    // Ensure auth directory exists
    if (!fs.existsSync(this.config.authDir)) {
      fs.mkdirSync(this.config.authDir, { recursive: true })
    }
  }

  /**
   * Initialize and connect to WhatsApp
   */
  async connect(): Promise<void> {
    if (this.socket) {
      console.log("[WhatsApp] Already connected or connecting")
      return
    }

    this.connectionState = "connecting"
    this.emit("connectionUpdate", this.getStatus())

    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.config.authDir)

      this.socket = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        printQRInTerminal: false, // We handle QR ourselves
        logger,
        browser: ["SpeakMCP", "Chrome", "1.0.0"],
        connectTimeoutMs: 60000,
        qrTimeout: 60000,
        defaultQueryTimeoutMs: 60000,
      })

      // Handle connection updates
      this.socket.ev.on("connection.update", async (update) => {
        await this.handleConnectionUpdate(update, saveCreds)
      })

      // Handle credential updates
      this.socket.ev.on("creds.update", saveCreds)

      // Handle incoming messages
      this.socket.ev.on("messages.upsert", (m) => {
        this.handleMessagesUpsert(m)
      })

    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      this.connectionState = "disconnected"
      this.emit("error", error)
      this.emit("connectionUpdate", this.getStatus())
      throw error
    }
  }

  /**
   * Handle connection state updates from Baileys
   */
  private async handleConnectionUpdate(
    update: Partial<ConnectionState>,
    saveCreds: () => Promise<void>
  ): Promise<void> {
    const { connection, lastDisconnect, qr } = update

    // Handle QR code
    if (qr) {
      this.connectionState = "qr"
      this.qrCodeData = qr

      // Print QR to terminal
      console.log("\n[WhatsApp] Scan this QR code with your WhatsApp app:\n")
      qrcode.generate(qr, { small: true })

      this.emit("qr", qr)
      this.emit("connectionUpdate", this.getStatus())
    }

    // Handle connection state changes
    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut

      console.log(
        `[WhatsApp] Connection closed. Status: ${statusCode}. Reconnect: ${shouldReconnect}`
      )

      this.socket = null
      this.connectionState = "disconnected"
      this.lastError = lastDisconnect?.error?.message || "Connection closed"

      if (shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)
        console.log(
          `[WhatsApp] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
        )
        setTimeout(() => this.connect(), delay)
      } else if (statusCode === DisconnectReason.loggedOut) {
        // Clear credentials on logout
        console.log("[WhatsApp] Logged out. Clearing credentials.")
        this.clearCredentials()
      }

      this.emit("connectionUpdate", this.getStatus())
    } else if (connection === "open") {
      console.log("[WhatsApp] Connected successfully!")
      this.connectionState = "connected"
      this.qrCodeData = null
      this.reconnectAttempts = 0
      this.lastError = null

      // Get user info
      if (this.socket?.user) {
        this.phoneNumber = this.socket.user.id.split(":")[0]
        this.userName = this.socket.user.name || undefined
        console.log(`[WhatsApp] Logged in as: ${this.userName} (${this.phoneNumber})`)
      }

      this.emit("connectionUpdate", this.getStatus())
    }
  }

  /**
   * Handle incoming messages
   */
  private handleMessagesUpsert(m: BaileysEventMap["messages.upsert"]): void {
    if (m.type !== "notify") return

    for (const msg of m.messages) {
      // Skip messages from self
      if (msg.key.fromMe) continue

      // Skip status broadcasts
      if (msg.key.remoteJid === "status@broadcast") continue

      const message = this.parseMessage(msg)
      if (!message) continue

      // Check allowlist if configured
      if (this.config.allowFrom && this.config.allowFrom.length > 0) {
        const senderNumber = message.from.replace(/[^0-9]/g, "")
        const isAllowed = this.config.allowFrom.some((allowed) => {
          const normalizedAllowed = allowed.replace(/[^0-9]/g, "")
          return senderNumber.endsWith(normalizedAllowed) || normalizedAllowed.endsWith(senderNumber)
        })

        if (!isAllowed) {
          if (this.config.logMessages) {
            console.log(`[WhatsApp] Message from ${message.from} not in allowlist, ignoring`)
          }
          continue
        }
      }

      // Store in history
      this.addToHistory(message)

      if (this.config.logMessages) {
        console.log(`[WhatsApp] Message from ${message.fromName || message.from}: ${message.text}`)
      }

      this.emit("message", message)
    }
  }

  /**
   * Parse a Baileys message into our format
   */
  private parseMessage(msg: proto.IWebMessageInfo): WhatsAppMessage | null {
    const remoteJid = msg.key.remoteJid
    if (!remoteJid) return null

    const isGroup = remoteJid.endsWith("@g.us")
    const senderJid = isGroup ? msg.key.participant : remoteJid
    if (!senderJid) return null

    // Extract text content from various message types
    let text = ""
    let mediaType: WhatsAppMessage["mediaType"] = undefined

    const messageContent = msg.message
    if (!messageContent) return null

    if (messageContent.conversation) {
      text = messageContent.conversation
    } else if (messageContent.extendedTextMessage?.text) {
      text = messageContent.extendedTextMessage.text
    } else if (messageContent.imageMessage) {
      text = messageContent.imageMessage.caption || "<image>"
      mediaType = "image"
    } else if (messageContent.videoMessage) {
      text = messageContent.videoMessage.caption || "<video>"
      mediaType = "video"
    } else if (messageContent.audioMessage) {
      text = "<audio>"
      mediaType = "audio"
    } else if (messageContent.documentMessage) {
      text = messageContent.documentMessage.fileName || "<document>"
      mediaType = "document"
    } else if (messageContent.stickerMessage) {
      text = "<sticker>"
      mediaType = "sticker"
    } else {
      // Unknown message type
      return null
    }

    // Parse quoted message if present
    let quotedMessage: WhatsAppMessage["quotedMessage"] = undefined
    const contextInfo = messageContent.extendedTextMessage?.contextInfo
    if (contextInfo?.quotedMessage) {
      const quotedText =
        contextInfo.quotedMessage.conversation ||
        contextInfo.quotedMessage.extendedTextMessage?.text ||
        ""
      quotedMessage = {
        id: contextInfo.stanzaId || "",
        text: quotedText,
        from: contextInfo.participant || "",
      }
    }

    return {
      id: msg.key.id || "",
      from: senderJid.split("@")[0],
      fromName: msg.pushName || undefined,
      chatId: remoteJid,
      isGroup,
      text,
      timestamp: (msg.messageTimestamp as number) * 1000 || Date.now(),
      mediaType,
      quotedMessage,
    }
  }

  /**
   * Add a message to history
   */
  private addToHistory(message: WhatsAppMessage): void {
    const chatHistory = this.messageHistory.get(message.chatId) || []
    chatHistory.push(message)

    // Keep only the last N messages
    if (chatHistory.length > this.MAX_HISTORY_PER_CHAT) {
      chatHistory.shift()
    }

    this.messageHistory.set(message.chatId, chatHistory)
  }

  /**
   * Send a message
   */
  async sendMessage(options: SendMessageOptions): Promise<SendMessageResult> {
    if (!this.socket || this.connectionState !== "connected") {
      return { success: false, error: "Not connected to WhatsApp" }
    }

    try {
      // Format the JID
      let jid = options.to
      if (!jid.includes("@")) {
        // Assume it's a phone number, add @s.whatsapp.net
        jid = `${jid.replace(/[^0-9]/g, "")}@s.whatsapp.net`
      }

      // Chunk long messages
      const chunks = this.chunkMessage(options.text)
      let lastMessageId: string | undefined

      for (const chunk of chunks) {
        const result = await this.socket.sendMessage(jid, {
          text: chunk,
        })
        lastMessageId = result?.key?.id || undefined
      }

      return { success: true, messageId: lastMessageId }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`[WhatsApp] Failed to send message: ${errorMessage}`)
      return { success: false, error: errorMessage }
    }
  }

  /**
   * Chunk a long message into smaller pieces
   */
  private chunkMessage(text: string): string[] {
    const maxLength = this.config.maxMessageLength || 4000
    if (text.length <= maxLength) {
      return [text]
    }

    const chunks: string[] = []
    let remaining = text

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining)
        break
      }

      // Try to break at a newline or space
      let breakPoint = remaining.lastIndexOf("\n", maxLength)
      if (breakPoint === -1 || breakPoint < maxLength / 2) {
        breakPoint = remaining.lastIndexOf(" ", maxLength)
      }
      if (breakPoint === -1 || breakPoint < maxLength / 2) {
        breakPoint = maxLength
      }

      chunks.push(remaining.slice(0, breakPoint))
      remaining = remaining.slice(breakPoint).trim()
    }

    return chunks
  }

  /**
   * Get list of chats
   */
  async getChats(): Promise<WhatsAppChat[]> {
    if (!this.socket || this.connectionState !== "connected") {
      return []
    }

    // Return chats from message history
    const chats: WhatsAppChat[] = []

    for (const [chatId, messages] of this.messageHistory) {
      const lastMessage = messages[messages.length - 1]
      chats.push({
        id: chatId,
        name: lastMessage?.fromName || chatId.split("@")[0],
        isGroup: chatId.endsWith("@g.us"),
        unreadCount: 0, // We don't track this currently
        lastMessageTime: lastMessage?.timestamp,
        lastMessage: lastMessage?.text,
      })
    }

    return chats.sort((a, b) => (b.lastMessageTime || 0) - (a.lastMessageTime || 0))
  }

  /**
   * Get recent messages for a chat
   */
  getMessages(chatId: string, limit = 20): WhatsAppMessage[] {
    const history = this.messageHistory.get(chatId) || []
    return history.slice(-limit)
  }

  /**
   * Get current connection status
   */
  getStatus(): ConnectionStatus {
    return {
      connected: this.connectionState === "connected",
      phoneNumber: this.phoneNumber || undefined,
      userName: this.userName || undefined,
      qrCode: this.qrCodeData || undefined,
      lastError: this.lastError || undefined,
    }
  }

  /**
   * Check if credentials exist
   */
  hasCredentials(): boolean {
    const credsPath = path.join(this.config.authDir, "creds.json")
    return fs.existsSync(credsPath)
  }

  /**
   * Clear stored credentials (logout)
   */
  clearCredentials(): void {
    if (fs.existsSync(this.config.authDir)) {
      const files = fs.readdirSync(this.config.authDir)
      for (const file of files) {
        fs.unlinkSync(path.join(this.config.authDir, file))
      }
    }
    this.phoneNumber = null
    this.userName = null
  }

  /**
   * Disconnect from WhatsApp
   */
  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.end(undefined)
      this.socket = null
    }
    this.connectionState = "disconnected"
    this.emit("connectionUpdate", this.getStatus())
  }

  /**
   * Logout and clear credentials
   */
  async logout(): Promise<void> {
    if (this.socket) {
      await this.socket.logout()
      this.socket = null
    }
    this.clearCredentials()
    this.connectionState = "disconnected"
    this.emit("connectionUpdate", this.getStatus())
  }
}
