/**
 * WhatsApp MCP Server for SpeakMCP
 *
 * This MCP server enables WhatsApp messaging capabilities through the
 * Model Context Protocol. It allows AI agents to send and receive
 * WhatsApp messages.
 *
 * Usage:
 *   npx @speakmcp/mcp-whatsapp
 *
 * Or add to SpeakMCP MCP config:
 *   {
 *     "mcpServers": {
 *       "whatsapp": {
 *         "command": "npx",
 *         "args": ["@speakmcp/mcp-whatsapp"]
 *       }
 *     }
 *   }
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import path from "path"
import os from "os"
import { WhatsAppSession } from "./session.js"
import type { WhatsAppConfig, WhatsAppMessage } from "./types.js"

// Configuration from environment variables
const config: WhatsAppConfig = {
  authDir: process.env.WHATSAPP_AUTH_DIR || path.join(os.homedir(), ".speakmcp", "whatsapp-auth"),
  allowFrom: process.env.WHATSAPP_ALLOW_FROM?.split(",").map((s) => s.trim()) || [],
  autoReply: process.env.WHATSAPP_AUTO_REPLY === "true",
  callbackUrl: process.env.WHATSAPP_CALLBACK_URL,
  callbackApiKey: process.env.WHATSAPP_CALLBACK_API_KEY,
  logMessages: process.env.WHATSAPP_LOG_MESSAGES === "true",
}

// Create WhatsApp session
const whatsapp = new WhatsAppSession(config)

// Pending messages queue for the agent to process
const pendingMessages: WhatsAppMessage[] = []
const MAX_PENDING_MESSAGES = 100

// Handle incoming messages
whatsapp.on("message", async (message: WhatsAppMessage) => {
  // Only log message content if logging is enabled to avoid accidental leakage
  if (config.logMessages) {
    console.error(`[MCP-WhatsApp] New message from ${message.fromName || message.from}: ${message.text.substring(0, 50)}...`)
  } else {
    const mediaInfo = message.mediaType ? ` [${message.mediaType}]` : ""
    console.error(`[MCP-WhatsApp] New message from ${message.fromName || message.from}${mediaInfo}`)
  }

  // Add to pending queue
  pendingMessages.push(message)
  if (pendingMessages.length > MAX_PENDING_MESSAGES) {
    pendingMessages.shift()
  }

  // If callback URL is configured, forward the message
  if (config.callbackUrl && config.callbackApiKey) {
    try {
      // Use message.chatId for groups/DMs instead of message.from
      // In groups, message.from is the participant, but we need to reply to the chat
      const replyTarget = message.chatId || message.from

      // Build message content - use array format if there's an image, otherwise string
      let messageContent: string | Array<{ type: string; text?: string; image_url?: { url: string } }>
      const textContent = `[WhatsApp message from ${message.fromName || message.from} (chat_id: ${replyTarget})]: ${message.text}

ACTION REQUIRED - RESPOND IMMEDIATELY:
1. FIRST, call whatsapp_send_typing with to="${replyTarget}" to show typing indicator
2. THEN, briefly acknowledge the message and explain what you're doing (e.g., "Got it, let me look into that..." or "Processing your request...")
3. If you need to think or process, you can continue after sending the initial acknowledgment

To send any reply, use whatsapp_send_message with to="${replyTarget}"`

      if (message.mediaType === "image" && message.mediaBuffer) {
        // Format as OpenAI-compatible content array with image
        const base64Image = message.mediaBuffer.toString("base64")
        const mimeType = message.mediaMimetype || "image/jpeg"
        messageContent = [
          {
            type: "text",
            text: textContent,
          },
          {
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${base64Image}`,
            },
          },
        ]
        console.error(`[MCP-WhatsApp] Forwarding image message (${message.mediaBuffer.length} bytes)`)
      } else {
        messageContent = textContent
      }

      const response = await fetch(config.callbackUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.callbackApiKey}`,
        },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: messageContent,
            },
          ],
          conversation_id: `whatsapp_${replyTarget}`,
          stream: false,
        }),
      })

      if (response.ok && config.autoReply) {
        // Parse response - support both OpenAI-style (choices[0].message.content) and simple (content) formats
        const data = (await response.json()) as {
          content?: string
          choices?: Array<{ message?: { content?: string } }>
        }
        // Try OpenAI format first, then fall back to simple format
        const replyContent = data.choices?.[0]?.message?.content || data.content
        if (replyContent) {
          await whatsapp.sendMessage({
            to: replyTarget,
            text: replyContent,
          })
        }
      }
    } catch (error) {
      console.error("[MCP-WhatsApp] Failed to forward message to callback:", error)
    }
  }
})

// Handle connection updates
whatsapp.on("connectionUpdate", (status) => {
  console.error(`[MCP-WhatsApp] Connection status: ${status.connected ? "connected" : "disconnected"}`)
  if (status.phoneNumber) {
    console.error(`[MCP-WhatsApp] Logged in as: ${status.userName || "Unknown"} (${status.phoneNumber})`)
  }
  if (status.lastError) {
    console.error(`[MCP-WhatsApp] Last error: ${status.lastError}`)
  }
})

// Handle QR code
whatsapp.on("qr", (qr) => {
  console.error("[MCP-WhatsApp] QR code available - scan with WhatsApp to authenticate")
})

// Define tool schemas
const tools = [
  {
    name: "whatsapp_send_message",
    description:
      "Send a WhatsApp message to a phone number or chat. The recipient should be a phone number in international format (e.g., 14155551234) without the + sign.",
    inputSchema: {
      type: "object" as const,
      properties: {
        to: {
          type: "string",
          description: "Recipient phone number in international format (e.g., 14155551234) or chat JID",
        },
        text: {
          type: "string",
          description: "Message text to send. Long messages will be automatically chunked.",
        },
      },
      required: ["to", "text"],
    },
  },
  {
    name: "whatsapp_get_messages",
    description:
      "Get recent messages from a specific chat. Returns the last N messages from the chat history.",
    inputSchema: {
      type: "object" as const,
      properties: {
        chat_id: {
          type: "string",
          description: "Chat ID (phone number or group JID) to get messages from",
        },
        limit: {
          type: "number",
          description: "Maximum number of messages to return (default: 20, max: 50)",
        },
      },
      required: ["chat_id"],
    },
  },
  {
    name: "whatsapp_list_chats",
    description:
      "List all available WhatsApp chats with their last message and timestamp. Useful for seeing who has messaged recently.",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of chats to return (default: 20)",
        },
      },
      required: [],
    },
  },
  {
    name: "whatsapp_get_pending_messages",
    description:
      "Get messages that have arrived since the last check. Returns and clears the pending message queue. Use this to check for new incoming messages.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "whatsapp_get_status",
    description:
      "Get the current WhatsApp connection status including whether connected, phone number, and any errors.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "whatsapp_connect",
    description:
      "Connect to WhatsApp. If not authenticated, this will generate a QR code that needs to be scanned with the WhatsApp mobile app.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "whatsapp_disconnect",
    description: "Disconnect from WhatsApp without logging out. Credentials are preserved for reconnection.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "whatsapp_logout",
    description:
      "Logout from WhatsApp and clear all credentials. You will need to scan the QR code again to reconnect.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "whatsapp_send_typing",
    description:
      "Send a typing indicator to a WhatsApp chat. This shows the 'typing...' status to the recipient. Call this immediately when you receive a message to let the user know you're processing their request. The typing indicator will automatically stop when you send a message.",
    inputSchema: {
      type: "object" as const,
      properties: {
        to: {
          type: "string",
          description: "Recipient phone number in international format (e.g., 14155551234) or chat JID",
        },
      },
      required: ["to"],
    },
  },
]

// Create MCP server
const server = new Server(
  {
    name: "whatsapp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
)

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools }
})

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    switch (name) {
      case "whatsapp_send_message": {
        const { to, text } = args as { to: string; text: string }
        if (!to || !text) {
          return {
            content: [{ type: "text", text: "Error: 'to' and 'text' are required" }],
            isError: true,
          }
        }

        const result = await whatsapp.sendMessage({ to, text })
        if (result.success) {
          return {
            content: [
              {
                type: "text",
                text: `Message sent successfully to ${to}. Message ID: ${result.messageId || "unknown"}`,
              },
            ],
          }
        } else {
          return {
            content: [{ type: "text", text: `Failed to send message: ${result.error}` }],
            isError: true,
          }
        }
      }

      case "whatsapp_get_messages": {
        const { chat_id, limit = 20 } = args as { chat_id: string; limit?: number }
        if (!chat_id) {
          return {
            content: [{ type: "text", text: "Error: 'chat_id' is required" }],
            isError: true,
          }
        }

        // Normalize chat ID and search both @s.whatsapp.net and @lid formats
        // Some DMs may be keyed/stored under @lid chat IDs
        let messages: WhatsAppMessage[] = []
        const numericId = chat_id.replace(/[^0-9]/g, "")

        if (chat_id.includes("@")) {
          // Already has a suffix, use as-is
          messages = whatsapp.getMessages(chat_id, Math.min(limit, 50))
        } else {
          // Try @s.whatsapp.net first (standard phone number format)
          const phoneJid = `${numericId}@s.whatsapp.net`
          messages = whatsapp.getMessages(phoneJid, Math.min(limit, 50))

          // If no messages found, try @lid format (WhatsApp Linked ID)
          if (messages.length === 0) {
            const lidJid = `${numericId}@lid`
            messages = whatsapp.getMessages(lidJid, Math.min(limit, 50))
          }
        }

        if (messages.length === 0) {
          return {
            content: [{ type: "text", text: `No messages found for chat ${chat_id}` }],
          }
        }

        const formatted = messages.map((m) => ({
          from: m.fromName || m.from,
          text: m.text,
          timestamp: new Date(m.timestamp).toISOString(),
          isGroup: m.isGroup,
        }))

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(formatted, null, 2),
            },
          ],
        }
      }

      case "whatsapp_list_chats": {
        const { limit = 20 } = args as { limit?: number }
        const chats = await whatsapp.getChats()
        const limitedChats = chats.slice(0, limit)

        if (limitedChats.length === 0) {
          return {
            content: [{ type: "text", text: "No chats found. You may need to receive some messages first." }],
          }
        }

        const formatted = limitedChats.map((c) => ({
          id: c.id,
          name: c.name,
          isGroup: c.isGroup,
          lastMessage: c.lastMessage?.substring(0, 100),
          lastMessageTime: c.lastMessageTime ? new Date(c.lastMessageTime).toISOString() : null,
        }))

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(formatted, null, 2),
            },
          ],
        }
      }

      case "whatsapp_get_pending_messages": {
        const messages = [...pendingMessages]
        pendingMessages.length = 0 // Clear the queue

        if (messages.length === 0) {
          return {
            content: [{ type: "text", text: "No pending messages" }],
          }
        }

        // Build response - include image data inline as base64 when available
        const contentParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = []

        const formatted = messages.map((m) => {
          const msgInfo: Record<string, unknown> = {
            from: m.from,
            fromName: m.fromName,
            text: m.text,
            timestamp: new Date(m.timestamp).toISOString(),
            isGroup: m.isGroup,
            chatId: m.chatId,
          }

          // Add media info if present
          if (m.mediaType) {
            msgInfo.mediaType = m.mediaType
            if (m.mediaBuffer) {
              msgInfo.hasMedia = true
              msgInfo.mediaSize = m.mediaBuffer.length
            }
          }

          return msgInfo
        })

        // Add text content with message info
        contentParts.push({
          type: "text",
          text: JSON.stringify(formatted, null, 2),
        })

        // Add image content parts for messages with images
        for (const m of messages) {
          if (m.mediaType === "image" && m.mediaBuffer) {
            const base64Image = m.mediaBuffer.toString("base64")
            const mimeType = m.mediaMimetype || "image/jpeg"
            contentParts.push({
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
              },
            })
          }
        }

        // If we have images, return as content array; otherwise just text
        if (contentParts.length > 1) {
          return {
            content: contentParts.map(part => {
              if (part.type === "text") {
                return { type: "text", text: part.text || "" }
              } else if (part.type === "image_url" && part.image_url) {
                return { type: "image", data: part.image_url.url, mimeType: "image/jpeg" }
              }
              return { type: "text", text: "" }
            }),
          }
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(formatted, null, 2),
            },
          ],
        }
      }

      case "whatsapp_get_status": {
        const status = whatsapp.getStatus()
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  connected: status.connected,
                  phoneNumber: status.phoneNumber,
                  userName: status.userName,
                  hasQrCode: !!status.qrCode,
                  qrCode: status.qrCode, // Include actual QR code data for UI display
                  lastError: status.lastError,
                  hasCredentials: whatsapp.hasCredentials(),
                },
                null,
                2
              ),
            },
          ],
        }
      }

      case "whatsapp_connect": {
        const currentStatus = whatsapp.getStatus()
        if (currentStatus.connected) {
          return {
            content: [
              {
                type: "text",
                text: `Already connected as ${currentStatus.userName} (${currentStatus.phoneNumber})`,
              },
            ],
          }
        }

        await whatsapp.connect()

        // Wait a bit for connection or QR code
        await new Promise((resolve) => setTimeout(resolve, 2000))

        const newStatus = whatsapp.getStatus()
        if (newStatus.connected) {
          return {
            content: [
              {
                type: "text",
                text: `Connected successfully as ${newStatus.userName} (${newStatus.phoneNumber})`,
              },
            ],
          }
        } else if (newStatus.qrCode) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  status: "qr_required",
                  qrCode: newStatus.qrCode,
                  message: "QR code generated. Scan with your WhatsApp mobile app to authenticate.",
                }),
              },
            ],
          }
        } else {
          return {
            content: [
              {
                type: "text",
                text: `Connecting... Current status: ${newStatus.lastError || "waiting"}`,
              },
            ],
          }
        }
      }

      case "whatsapp_disconnect": {
        await whatsapp.disconnect()
        return {
          content: [{ type: "text", text: "Disconnected from WhatsApp. Credentials preserved." }],
        }
      }

      case "whatsapp_logout": {
        await whatsapp.logout()
        return {
          content: [
            {
              type: "text",
              text: "Logged out from WhatsApp. Credentials cleared. You will need to scan QR code again.",
            },
          ],
        }
      }

      case "whatsapp_send_typing": {
        const { to } = args as { to: string }
        if (!to) {
          return {
            content: [{ type: "text", text: "Error: 'to' is required" }],
            isError: true,
          }
        }

        const result = await whatsapp.sendTypingIndicator(to)
        if (result.success) {
          return {
            content: [
              {
                type: "text",
                text: `Typing indicator sent to ${to}. The recipient will see "typing..." until you send a message.`,
              },
            ],
          }
        } else {
          return {
            content: [{ type: "text", text: `Failed to send typing indicator: ${result.error}` }],
            isError: true,
          }
        }
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error(`[MCP-WhatsApp] Tool error (${name}):`, errorMessage)
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true,
    }
  }
})

// Main entry point
async function main() {
  console.error("[MCP-WhatsApp] Starting WhatsApp MCP Server...")
  console.error(`[MCP-WhatsApp] Auth directory: ${config.authDir}`)

  if (config.allowFrom && config.allowFrom.length > 0) {
    console.error(`[MCP-WhatsApp] Allowlist: ${config.allowFrom.join(", ")}`)
  } else {
    console.error("[MCP-WhatsApp] No allowlist configured - all messages will be accepted")
  }

  if (config.callbackUrl) {
    console.error(`[MCP-WhatsApp] Callback URL: ${config.callbackUrl}`)
    console.error(`[MCP-WhatsApp] Auto-reply: ${config.autoReply}`)
  }

  // Auto-connect if credentials exist
  if (whatsapp.hasCredentials()) {
    console.error("[MCP-WhatsApp] Found existing credentials, connecting...")
    try {
      await whatsapp.connect()
    } catch (error) {
      console.error("[MCP-WhatsApp] Auto-connect failed:", error)
    }
  } else {
    console.error("[MCP-WhatsApp] No credentials found. Use whatsapp_connect tool to authenticate.")
  }

  // Start MCP server
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error("[MCP-WhatsApp] MCP Server started successfully")
}

main().catch((error) => {
  console.error("[MCP-WhatsApp] Fatal error:", error)
  process.exit(1)
})
