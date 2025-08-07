#!/usr/bin/env node

/**
 * Simple Mock MCP Server for Testing
 *
 * This script simulates an MCP server without requiring the full MCP SDK.
 * It responds to JSON-RPC messages over stdio to test the MCP client functionality.
 */

import { createReadStream, createWriteStream } from "fs"
import { Transform } from "stream"

class MockMCPServer {
  constructor() {
    this.messageId = 0
    this.setupStdio()
  }

  setupStdio() {
    // Set up JSON-RPC communication over stdio
    let buffer = ""

    process.stdin.on("data", (chunk) => {
      buffer += chunk.toString()

      // Process complete messages (separated by newlines)
      const lines = buffer.split("\n")
      buffer = lines.pop() || "" // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.trim()) {
          try {
            const message = JSON.parse(line)
            this.handleMessage(message)
          } catch (error) {
            console.error("[MOCK-MCP] Failed to parse message:", error)
          }
        }
      }
    })

    process.stdin.on("end", () => {
      console.error("[MOCK-MCP] Input stream ended")
      process.exit(0)
    })
  }

  sendMessage(message) {
    const jsonMessage = JSON.stringify(message)
    process.stdout.write(jsonMessage + "\n")
  }

  handleMessage(message) {
    console.error(`[MOCK-MCP] Received message:`, JSON.stringify(message))

    if (message.method === "initialize") {
      this.sendMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "mock-mcp-server",
            version: "1.0.0",
          },
        },
      })
    } else if (message.method === "tools/list") {
      this.sendMessage({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          tools: [
            {
              name: "echo",
              description: "Echo back the input message",
              inputSchema: {
                type: "object",
                properties: {
                  message: {
                    type: "string",
                    description: "Message to echo back",
                  },
                },
                required: ["message"],
              },
            },
            {
              name: "add_numbers",
              description: "Add two numbers together",
              inputSchema: {
                type: "object",
                properties: {
                  a: { type: "number", description: "First number" },
                  b: { type: "number", description: "Second number" },
                },
                required: ["a", "b"],
              },
            },
            {
              name: "create_test_file",
              description: "Create a test file (simulated)",
              inputSchema: {
                type: "object",
                properties: {
                  filename: { type: "string", description: "Name of the file" },
                  content: { type: "string", description: "File content" },
                },
                required: ["filename", "content"],
              },
            },
          ],
        },
      })
    } else if (message.method === "tools/call") {
      const { name, arguments: args } = message.params

      let result
      try {
        switch (name) {
          case "echo":
            result = {
              content: [
                {
                  type: "text",
                  text: `Echo: ${args.message}`,
                },
              ],
            }
            break

          case "add_numbers":
            const sum = args.a + args.b
            result = {
              content: [
                {
                  type: "text",
                  text: `${args.a} + ${args.b} = ${sum}`,
                },
              ],
            }
            break

          case "create_test_file":
            result = {
              content: [
                {
                  type: "text",
                  text: `Created test file "${args.filename}" with content: "${args.content}"`,
                },
              ],
            }
            break

          default:
            throw new Error(`Unknown tool: ${name}`)
        }

        this.sendMessage({
          jsonrpc: "2.0",
          id: message.id,
          result,
        })
      } catch (error) {
        this.sendMessage({
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: -32000,
            message: error.message,
          },
        })
      }
    } else if (message.method === "notifications/initialized") {
      // No response needed for notifications
      console.error("[MOCK-MCP] Server initialized")
    } else {
      // Unknown method
      this.sendMessage({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32601,
          message: `Method not found: ${message.method}`,
        },
      })
    }
  }

  start() {
    console.error("[MOCK-MCP] Mock MCP server starting...")
    console.error("[MOCK-MCP] Waiting for messages on stdin")

    // Send a ready signal
    process.stderr.write("[MOCK-MCP] Ready\n")
  }
}

// Start the server
const server = new MockMCPServer()
server.start()

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.error("[MOCK-MCP] Shutting down...")
  process.exit(0)
})

process.on("SIGTERM", () => {
  console.error("[MOCK-MCP] Shutting down...")
  process.exit(0)
})
