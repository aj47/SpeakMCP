import { describe, expect, it } from "vitest"
import { inferTransportType, normalizeMcpConfig } from "./mcp-utils"
import { MCPConfig } from "./types"

describe("normalizeMcpConfig", () => {
  it("infers streamableHttp when url is present and transport is missing", () => {
    const input: MCPConfig = {
      mcpServers: {
        exa: {
          url: "https://exa.ai/mcp",
        },
      },
    }

    const { normalized, changed } = normalizeMcpConfig(input)

    expect(normalized.mcpServers.exa.transport).toBe("streamableHttp")
    expect(changed).toBe(true)
  })

  it("preserves explicit transport when provided", () => {
    const input: MCPConfig = {
      mcpServers: {
        foo: {
          transport: "websocket",
          url: "wss://example.com/mcp",
        },
      },
    }

    const { normalized, changed } = normalizeMcpConfig(input)

    expect(normalized.mcpServers.foo.transport).toBe("websocket")
    expect(changed).toBe(false)
  })

  it("infers websocket when url uses wss:// protocol and transport is missing", () => {
    const input: MCPConfig = {
      mcpServers: {
        wsServer: {
          url: "wss://example.com/mcp",
        },
      },
    }

    const { normalized, changed } = normalizeMcpConfig(input)

    expect(normalized.mcpServers.wsServer.transport).toBe("websocket")
    expect(changed).toBe(true)
  })

})

describe("inferTransportType", () => {
  it("defaults to stdio when no transport or url is provided", () => {
    expect(inferTransportType({ command: "cmd" })).toBe("stdio")
  })

  it("infers websocket when url starts with ws://", () => {
    expect(inferTransportType({ url: "ws://localhost:8080" })).toBe("websocket")
  })

  it("infers websocket when url starts with wss://", () => {
    expect(inferTransportType({ url: "wss://example.com/mcp" })).toBe("websocket")
  })

  it("infers streamableHttp when url starts with http://", () => {
    expect(inferTransportType({ url: "http://localhost:8080/mcp" })).toBe("streamableHttp")
  })

  it("infers streamableHttp when url starts with https://", () => {
    expect(inferTransportType({ url: "https://exa.ai/mcp" })).toBe("streamableHttp")
  })

})
