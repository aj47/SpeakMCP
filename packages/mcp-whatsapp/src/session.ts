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
  fetchLatestBaileysVersion,
  Browsers,
  downloadMediaMessage,
} from "@whiskeysockets/baileys"
import { Boom } from "@hapi/boom"
import pino from "pino"
import QRCode from "qrcode"
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

// Simple pino logger for Baileys
const logger = pino({
  level: "warn", // Only log warnings and errors to reduce noise
}, pino.destination(2)) // 2 = stderr file descriptor

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
  // Map of LID -> phone number for allowlist checking
  private lidToPhoneMap: Map<string, string> = new Map()
  // Flag to suppress auto-reconnect on explicit disconnect
  private explicitDisconnect = false

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

    // Load LID mappings from auth directory if available
    this.loadLidMappings()
  }

  /**
   * Load LID to phone number mappings from auth state files
   */
  private loadLidMappings(): void {
    try {
      // Try to load lid-mappings.json which Baileys may create
      const mappingsFile = path.join(this.config.authDir, "lid-mappings.json")
      if (fs.existsSync(mappingsFile)) {
        const data = JSON.parse(fs.readFileSync(mappingsFile, "utf-8"))
        for (const [lid, phone] of Object.entries(data)) {
          if (typeof phone === "string") {
            this.lidToPhoneMap.set(lid.replace(/[^0-9]/g, ""), phone.replace(/[^0-9]/g, ""))
          }
        }
        console.error(`[WhatsApp] Loaded ${this.lidToPhoneMap.size} LID mappings from file`)
      }

      // Also scan for any app-state files that might contain mappings
      const files = fs.readdirSync(this.config.authDir)
      for (const file of files) {
        if (file.startsWith("app-state-sync-key-") && file.endsWith(".json")) {
          // These files sometimes contain contact info with LID mappings
          continue // Skip for now, complex format
        }
      }
    } catch (error) {
      console.error(`[WhatsApp] Error loading LID mappings: ${error}`)
    }
  }

  /**
   * Save LID mappings to file for persistence
   */
  private saveLidMappings(): void {
    try {
      const mappingsFile = path.join(this.config.authDir, "lid-mappings.json")
      const data: Record<string, string> = {}
      for (const [lid, phone] of this.lidToPhoneMap) {
        data[lid] = phone
      }
      fs.writeFileSync(mappingsFile, JSON.stringify(data, null, 2))
    } catch (error) {
      console.error(`[WhatsApp] Error saving LID mappings: ${error}`)
    }
  }

  /**
   * Load LID mappings from Baileys auth state
   */
  private loadLidMappingsFromAuthState(state: { creds: unknown; keys: unknown }): void {
    try {
      // Check if creds has lid info
      const creds = state.creds as Record<string, unknown>
      if (creds && creds.lid && creds.me) {
        const me = creds.me as { id?: string; lid?: string }
        if (me.id && me.lid) {
          const phoneNumber = me.id.replace(/@.*$/, "").replace(/[^0-9]/g, "").split(":")[0]
          const lid = me.lid.replace(/@.*$/, "").replace(/[^0-9]/g, "")
          if (lid && phoneNumber) {
            this.lidToPhoneMap.set(lid, phoneNumber)
            console.error(`[WhatsApp] Loaded own LID mapping from creds: ${lid} -> ${phoneNumber}`)
          }
        }
      }

      // Also try to read lid-mappings from auth directory files
      const files = fs.readdirSync(this.config.authDir)
      for (const file of files) {
        if (file.includes("lid") && file.endsWith(".json")) {
          try {
            const filePath = path.join(this.config.authDir, file)
            const data = JSON.parse(fs.readFileSync(filePath, "utf-8"))
            // Try to extract any LID mappings from the file
            if (typeof data === "object" && data !== null) {
              for (const [key, value] of Object.entries(data)) {
                if (typeof value === "string" && key.match(/^\d+$/) && value.match(/^\d+$/)) {
                  this.lidToPhoneMap.set(key, value)
                }
              }
            }
          } catch {
            // Ignore parse errors
          }
        }
      }

      console.error(`[WhatsApp] Total LID mappings loaded: ${this.lidToPhoneMap.size}`)
    } catch (error) {
      console.error(`[WhatsApp] Error loading LID mappings from auth state: ${error}`)
    }
  }

  /**
   * Initialize and connect to WhatsApp
   */
  async connect(): Promise<void> {
    if (this.socket) {
      console.error("[WhatsApp] Already connected or connecting")
      return
    }

    console.error("[WhatsApp] Starting connection...")
    // Reset explicit disconnect flag when connecting
    this.explicitDisconnect = false
    this.connectionState = "connecting"
    this.emit("connectionUpdate", this.getStatus())

    try {
      // Fetch the latest WhatsApp version to avoid 405 errors
      const { version } = await fetchLatestBaileysVersion()
      const { state, saveCreds } = await useMultiFileAuthState(this.config.authDir)

      // Try to load LID mappings from auth state
      this.loadLidMappingsFromAuthState(state)

      this.socket = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        printQRInTerminal: false, // We handle QR ourselves
        logger,
        browser: Browsers.macOS("Safari"), // Use Safari browser to avoid 405 errors
        version, // Use the fetched WhatsApp version
        connectTimeoutMs: 60000,
        qrTimeout: 60000,
        defaultQueryTimeoutMs: 60000,
        markOnlineOnConnect: false,
        syncFullHistory: false,
      })

      // Handle connection updates
      this.socket.ev.on("connection.update", async (update) => {
        // Only log significant connection state changes
        if (update.connection || update.qr) {
          console.error(`[WhatsApp] connection.update: ${update.connection || (update.qr ? 'qr' : 'other')}`)
        }
        await this.handleConnectionUpdate(update, saveCreds)
      })

      // Handle credential updates
      this.socket.ev.on("creds.update", saveCreds)

      // Handle incoming messages
      this.socket.ev.on("messages.upsert", (m) => {
        this.handleMessagesUpsert(m)
      })

      // Handle contacts update to capture LID -> phone number mappings
      this.socket.ev.on("contacts.update", (contacts) => {
        let newMappings = 0
        for (const contact of contacts) {
          // contacts.update can include LID info
          if (contact.id && contact.lid) {
            const phoneNumber = contact.id.replace(/@.*$/, "").replace(/[^0-9]/g, "")
            const lid = contact.lid.replace(/@.*$/, "").replace(/[^0-9]/g, "")
            if (lid && phoneNumber && !this.lidToPhoneMap.has(lid)) {
              this.lidToPhoneMap.set(lid, phoneNumber)
              newMappings++
            }
          }
        }
        if (newMappings > 0) {
          console.error(`[WhatsApp] Added ${newMappings} new LID mappings (total: ${this.lidToPhoneMap.size})`)
          this.saveLidMappings()
        }
      })

      console.error("[WhatsApp] Event handlers set up, waiting for connection...")

    } catch (error) {
      console.error(`[WhatsApp] Connection error: ${error instanceof Error ? error.stack : String(error)}`)
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
      QRCode.toString(qr, { type: "terminal", small: true })
        .then((qrString) => console.log(qrString))
        .catch((err) => console.error("[WhatsApp] Failed to generate QR code:", err))

      this.emit("qr", qr)
      this.emit("connectionUpdate", this.getStatus())
    }

    // Handle connection state changes
    if (connection === "close") {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
      // Don't reconnect if logged out, conflict, or explicit disconnect
      // Conflict status code is 440
      const isConflict = statusCode === 440
      const isLoggedOut = statusCode === DisconnectReason.loggedOut
      const isExplicitDisconnect = this.explicitDisconnect
      const shouldReconnect = !isLoggedOut && !isConflict && !isExplicitDisconnect

      console.error(
        `[WhatsApp] Connection closed. Status: ${statusCode}. Conflict: ${isConflict}. Explicit: ${isExplicitDisconnect}. Reconnect: ${shouldReconnect}`
      )

      this.socket = null
      this.connectionState = "disconnected"
      this.lastError = lastDisconnect?.error?.message || "Connection closed"

      if (shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000)
        console.error(
          `[WhatsApp] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
        )
        // Handle promise rejection from connect() to prevent unhandled rejection
        // that could potentially terminate the MCP server process
        setTimeout(() => {
          this.connect().catch((err) => {
            console.error(`[WhatsApp] Reconnect attempt failed: ${err instanceof Error ? err.message : String(err)}`)
          })
        }, delay)
      } else if (isLoggedOut) {
        // Clear credentials on logout
        console.error("[WhatsApp] Logged out. Clearing credentials.")
        this.clearCredentials()
      } else if (isConflict) {
        console.error("[WhatsApp] Session conflict - another client connected. Not auto-reconnecting.")
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
        this.userName = this.socket.user.name || null
        console.log(`[WhatsApp] Logged in as: ${this.userName} (${this.phoneNumber})`)
      }

      this.emit("connectionUpdate", this.getStatus())
    }
  }

  /**
   * Handle incoming messages
   */
  private async handleMessagesUpsert(m: BaileysEventMap["messages.upsert"]): Promise<void> {
    // Only process "notify" messages (real-time incoming messages)
    if (m.type !== "notify") {
      return
    }

    for (const msg of m.messages) {
      // Skip messages from self
      if (msg.key.fromMe) {
        continue
      }

      // Skip status broadcasts
      if (msg.key.remoteJid === "status@broadcast") {
        continue
      }

      const message = this.parseMessage(msg)
      if (!message) {
        continue
      }

      // Download media for image messages
      if (message.mediaType === "image" && msg.message?.imageMessage) {
        try {
          console.error(`[WhatsApp] Downloading image from ${message.fromName || message.from}...`)
          const buffer = await downloadMediaMessage(
            msg,
            "buffer",
            {},
            {
              logger,
              reuploadRequest: this.socket!.updateMediaMessage
            }
          )
          if (buffer && Buffer.isBuffer(buffer)) {
            message.mediaBuffer = buffer
            message.mediaMimetype = msg.message.imageMessage.mimetype || "image/jpeg"
            console.error(`[WhatsApp] Downloaded image: ${buffer.length} bytes, type: ${message.mediaMimetype}`)
          }
        } catch (error) {
          console.error(`[WhatsApp] Failed to download image: ${error instanceof Error ? error.message : String(error)}`)
        }
      }

      // Check allowlist if configured
      if (this.config.allowFrom && this.config.allowFrom.length > 0) {
        // Get the sender identifier - could be phone number or LID
        const senderNumber = message.from.replace(/[^0-9]/g, "")

        // Also try to get the phone number from the chatId (which may have both formats)
        // LIDs look like "98389177934034@lid", phone numbers like "61406142826@s.whatsapp.net"
        const chatIdNumber = message.chatId?.replace(/@.*$/, "").replace(/[^0-9]/g, "") || ""

        // Detect if this is a LID-based message by checking the chatId (not message.from)
        // message.from is already split at "@" so it won't contain "@lid"
        const isLidMessage = message.chatId?.includes("@lid") || false

        // Look up phone number from LID mapping if sender is a LID
        let mappedPhoneNumber = ""
        if (isLidMessage) {
          // First check our local map
          if (this.lidToPhoneMap.has(senderNumber)) {
            mappedPhoneNumber = this.lidToPhoneMap.get(senderNumber) || ""
          }
          // If not found, try to get it from the message's verifiedBizName or pushName
          // which might contain the phone number
          if (!mappedPhoneNumber && msg.verifiedBizName) {
            const bizPhone = msg.verifiedBizName.replace(/[^0-9]/g, "")
            if (bizPhone.length >= 10) {
              mappedPhoneNumber = bizPhone
              this.lidToPhoneMap.set(senderNumber, bizPhone)
              this.saveLidMappings()
            }
          }
        }

        const isAllowed = this.config.allowFrom.some((allowed) => {
          const normalizedAllowed = allowed.replace(/[^0-9]/g, "")
          // Security: Require minimum length for allowlist entries to prevent weak matches
          if (normalizedAllowed.length < 7) {
            console.error(`[WhatsApp] Skipping allowlist entry "${allowed}" - too short (min 7 digits)`)
            return false
          }
          // Check if any identifier matches the allowlist using exact normalized match
          // This is more secure than partial matching which could allow unintended numbers
          const senderMatches = senderNumber === normalizedAllowed
          const chatIdMatches = chatIdNumber === normalizedAllowed
          // Also check the mapped phone number if we have one
          const mappedMatches = mappedPhoneNumber ? mappedPhoneNumber === normalizedAllowed : false
          return senderMatches || chatIdMatches || mappedMatches
        })

        if (!isAllowed) {
          // Provide clear, actionable instructions for blocked messages
          const senderName = message.fromName ? ` (${message.fromName})` : ""
          if (isLidMessage) {
            console.error(`[WhatsApp] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
            console.error(`[WhatsApp] ⚠️  MESSAGE BLOCKED - Sender not in allowlist`)
            console.error(`[WhatsApp] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
            console.error(`[WhatsApp] 👤 Sender: ${senderNumber}${senderName}`)
            console.error(`[WhatsApp] 📋 To allow this sender, copy this LID: ${senderNumber}`)
            console.error(`[WhatsApp] ➡️  Go to Settings > WhatsApp > Allowed Senders and add it`)
            console.error(`[WhatsApp] 💡 WhatsApp uses LIDs (Linked IDs) for privacy - phone numbers may not work`)
            console.error(`[WhatsApp] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
          } else {
            console.error(`[WhatsApp] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
            console.error(`[WhatsApp] ⚠️  MESSAGE BLOCKED - Sender not in allowlist`)
            console.error(`[WhatsApp] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
            console.error(`[WhatsApp] 👤 Sender: ${senderNumber}${senderName}`)
            console.error(`[WhatsApp] 📋 To allow this sender, copy this number: ${senderNumber}`)
            console.error(`[WhatsApp] ➡️  Go to Settings > WhatsApp > Allowed Senders and add it`)
            console.error(`[WhatsApp] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`)
          }
          continue
        }

        // Log allowed message
        if (this.config.logMessages) {
          console.error(`[WhatsApp] ✅ Message allowed from ${message.from}`)
        }
      }

      // Store in history
      this.addToHistory(message)

      // Log received message if logging enabled
      if (this.config.logMessages) {
        console.error(`[WhatsApp] ✅ New message from ${message.fromName || message.from}: ${message.text}`)
      }

      this.emit("message", message)
    }
  }

  /**
   * Parse a Baileys message into our format
   */
  private parseMessage(msg: proto.IWebMessageInfo): WhatsAppMessage | null {
    const remoteJid = msg.key?.remoteJid
    if (!remoteJid) return null

    const isGroup = remoteJid.endsWith("@g.us")
    const senderJid = isGroup ? msg.key?.participant : remoteJid
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

    // Safely parse messageTimestamp which can be a number, Long, or undefined
    // Baileys may return Long-like objects, so we need to handle them properly
    let timestamp = Date.now()
    const rawTimestamp = msg.messageTimestamp
    if (rawTimestamp !== undefined && rawTimestamp !== null) {
      // Handle Long-like objects (with low/high properties) or direct numbers
      if (typeof rawTimestamp === "object" && "low" in rawTimestamp) {
        // Long type from protobuf - extract the number safely
        const longObj = rawTimestamp as { low: number; high: number; unsigned?: boolean }
        // For timestamps in seconds, the high bits should be 0 for reasonable dates
        timestamp = (longObj.low >>> 0) * 1000 // Use unsigned right shift to get positive value
      } else if (typeof rawTimestamp === "number" && !isNaN(rawTimestamp) && rawTimestamp > 0) {
        timestamp = rawTimestamp * 1000
      } else if (typeof rawTimestamp === "bigint") {
        timestamp = Number(rawTimestamp) * 1000
      }
    }

    return {
      id: msg.key?.id || "",
      from: senderJid.split("@")[0],
      fromName: msg.pushName || undefined,
      chatId: remoteJid,
      isGroup,
      text,
      timestamp,
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
      // Format the JID - determine if it's already formatted, or needs @s.whatsapp.net or @lid suffix
      let jid = options.to
      let fallbackJid: string | null = null

      if (!jid.includes("@")) {
        const numericId = jid.replace(/[^0-9]/g, "")

        // Check if this ID is a known LID from our mapping (reverse lookup)
        const isKnownLid = Array.from(this.lidToPhoneMap.keys()).includes(numericId)

        if (isKnownLid) {
          // This is a known LID, use @lid format
          jid = `${numericId}@lid`
          console.error(`[WhatsApp] Sending to known LID: ${jid}`)
        } else {
          // Assume it's a phone number - try @s.whatsapp.net first, with @lid as fallback
          // The tool/docs advertise sending to phone numbers, so we default to that format
          jid = `${numericId}@s.whatsapp.net`
          fallbackJid = `${numericId}@lid`
          console.error(`[WhatsApp] Sending to phone number format: ${jid} (fallback: ${fallbackJid})`)
        }
      }

      // Helper function to send message chunks to a specific JID
      const sendToJid = async (targetJid: string): Promise<{ success: boolean; messageId?: string; error?: string }> => {
        const chunks = this.chunkMessage(options.text)
        let lastMessageId: string | undefined

        for (const chunk of chunks) {
          const result = await this.socket!.sendMessage(targetJid, {
            text: chunk,
          })
          lastMessageId = result?.key?.id || undefined
        }
        return { success: true, messageId: lastMessageId }
      }

      // Try primary JID first
      try {
        return await sendToJid(jid)
      } catch (primaryError) {
        // If primary fails and we have a fallback, try that
        if (fallbackJid) {
          console.error(`[WhatsApp] Primary JID failed, trying fallback: ${fallbackJid}`)
          try {
            return await sendToJid(fallbackJid)
          } catch (fallbackError) {
            // Both failed, throw original error
            throw primaryError
          }
        }
        throw primaryError
      }
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
   * Send typing indicator (composing presence) to a chat
   * Mirrors the same JID normalization/fallback as sendMessage to support LID-only chats
   */
  async sendTypingIndicator(chatId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.socket || this.connectionState !== "connected") {
      return { success: false, error: "Not connected to WhatsApp" }
    }

    try {
      // Format the JID - determine if it's already formatted, or needs @s.whatsapp.net or @lid suffix
      // Mirror the same logic as sendMessage to support LID-only chats
      let jid = chatId
      let fallbackJid: string | null = null

      if (!jid.includes("@")) {
        const numericId = jid.replace(/[^0-9]/g, "")

        // Check if this ID is a known LID from our mapping
        const isKnownLid = Array.from(this.lidToPhoneMap.keys()).includes(numericId)

        if (isKnownLid) {
          // This is a known LID, use @lid format
          jid = `${numericId}@lid`
        } else {
          // Assume it's a phone number - try @s.whatsapp.net first, with @lid as fallback
          jid = `${numericId}@s.whatsapp.net`
          fallbackJid = `${numericId}@lid`
        }
      }

      // Helper function to send presence to a specific JID
      const sendToJid = async (targetJid: string): Promise<void> => {
        await this.socket!.sendPresenceUpdate("composing", targetJid)
      }

      // Try primary JID first
      try {
        await sendToJid(jid)
        console.error(`[WhatsApp] Sent typing indicator to ${jid}`)
        return { success: true }
      } catch (primaryError) {
        // If primary fails and we have a fallback, try that
        if (fallbackJid) {
          console.error(`[WhatsApp] Primary JID failed for typing, trying fallback: ${fallbackJid}`)
          await sendToJid(fallbackJid)
          console.error(`[WhatsApp] Sent typing indicator to ${fallbackJid}`)
          return { success: true }
        }
        throw primaryError
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`[WhatsApp] Failed to send typing indicator: ${errorMessage}`)
      return { success: false, error: errorMessage }
    }
  }

  /**
   * Stop typing indicator (paused presence) for a chat
   * Mirrors the same JID normalization/fallback as sendMessage to support LID-only chats
   */
  async stopTypingIndicator(chatId: string): Promise<{ success: boolean; error?: string }> {
    if (!this.socket || this.connectionState !== "connected") {
      return { success: false, error: "Not connected to WhatsApp" }
    }

    try {
      // Format the JID - determine if it's already formatted, or needs @s.whatsapp.net or @lid suffix
      // Mirror the same logic as sendMessage to support LID-only chats
      let jid = chatId
      let fallbackJid: string | null = null

      if (!jid.includes("@")) {
        const numericId = jid.replace(/[^0-9]/g, "")

        // Check if this ID is a known LID from our mapping
        const isKnownLid = Array.from(this.lidToPhoneMap.keys()).includes(numericId)

        if (isKnownLid) {
          // This is a known LID, use @lid format
          jid = `${numericId}@lid`
        } else {
          // Assume it's a phone number - try @s.whatsapp.net first, with @lid as fallback
          jid = `${numericId}@s.whatsapp.net`
          fallbackJid = `${numericId}@lid`
        }
      }

      // Helper function to send presence to a specific JID
      const sendToJid = async (targetJid: string): Promise<void> => {
        await this.socket!.sendPresenceUpdate("paused", targetJid)
      }

      // Try primary JID first
      try {
        await sendToJid(jid)
        console.error(`[WhatsApp] Stopped typing indicator for ${jid}`)
        return { success: true }
      } catch (primaryError) {
        // If primary fails and we have a fallback, try that
        if (fallbackJid) {
          console.error(`[WhatsApp] Primary JID failed for stop typing, trying fallback: ${fallbackJid}`)
          await sendToJid(fallbackJid)
          console.error(`[WhatsApp] Stopped typing indicator for ${fallbackJid}`)
          return { success: true }
        }
        throw primaryError
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`[WhatsApp] Failed to stop typing indicator: ${errorMessage}`)
      return { success: false, error: errorMessage }
    }
  }

  /**
   * Disconnect from WhatsApp
   */
  async disconnect(): Promise<void> {
    // Set flag to suppress auto-reconnect
    this.explicitDisconnect = true
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
