#!/usr/bin/env node

/**
 * Mock MCP Server for Testing
 *
 * This is a simple MCP server implementation that can be used for testing
 * without requiring external dependencies like @modelcontextprotocol/server-filesystem
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"

class MockMCPServer {
  private server: Server

  constructor() {
    this.server = new Server(
      {
        name: "mock-mcp-server",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    )

    this.setupHandlers()
  }

  private setupHandlers() {
    // Handle tool listing
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
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
                a: {
                  type: "number",
                  description: "First number",
                },
                b: {
                  type: "number",
                  description: "Second number",
                },
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
                filename: {
                  type: "string",
                  description: "Name of the file to create",
                },
                content: {
                  type: "string",
                  description: "Content of the file",
                },
              },
              required: ["filename", "content"],
            },
          },
          {
            name: "simulate_error",
            description: "Simulate an error for testing error handling",
            inputSchema: {
              type: "object",
              properties: {
                error_message: {
                  type: "string",
                  description: "Error message to simulate",
                },
              },
              required: ["error_message"],
            },
          },
        ],
      }
    })

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params

      switch (name) {
        case "echo":
          return {
            content: [
              {
                type: "text",
                text: `Echo: ${args.message}`,
              },
            ],
          }

        case "add_numbers":
          const sum = args.a + args.b
          return {
            content: [
              {
                type: "text",
                text: `${args.a} + ${args.b} = ${sum}`,
              },
            ],
          }

        case "create_test_file":
          return {
            content: [
              {
                type: "text",
                text: `Created test file "${args.filename}" with content: "${args.content}"`,
              },
            ],
          }

        case "simulate_error":
          throw new Error(args.error_message)

        default:
          throw new Error(`Unknown tool: ${name}`)
      }
    })
  }

  async run() {
    const transport = new StdioServerTransport()
    await this.server.connect(transport)

    // Keep the server running
    console.error("[MOCK-MCP] Mock MCP server started")
  }
}

// Run the server if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new MockMCPServer()
  server.run().catch((error) => {
    console.error("[MOCK-MCP] Server error:", error)
    process.exit(1)
  })
}

export { MockMCPServer }
