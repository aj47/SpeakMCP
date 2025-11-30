import { MCPConfig, MCPServerConfig, MCPTransportType } from "./types"

/**
 * Determine transport type when it isn't explicitly set.
 * Infers websocket for ws/wss URLs, streamableHttp for http/https URLs,
 * and falls back to stdio when no URL is present.
 */
export function inferTransportType(config: MCPServerConfig): MCPTransportType {
  if (config.transport) return config.transport
  if (!config.url) return "stdio"
  const lower = config.url.toLowerCase()
  if (lower.startsWith("ws://") || lower.startsWith("wss://")) return "websocket"
  return "streamableHttp"
}

/**
 * Ensure a server config has an explicit transport.
 */
export function normalizeMcpServerConfig(config: MCPServerConfig): {
  normalized: MCPServerConfig
  changed: boolean
} {
  const inferredTransport = inferTransportType(config)
  const changed = config.transport !== inferredTransport
  if (!changed) return { normalized: config, changed: false }
  return { normalized: { ...config, transport: inferredTransport }, changed: true }
}

/**
 * Normalize all MCP server configs by inferring transports when missing.
 */
export function normalizeMcpConfig(mcpConfig: MCPConfig): {
  normalized: MCPConfig
  changed: boolean
} {
  let changed = false

  const normalizedServers = Object.fromEntries(
    Object.entries(mcpConfig.mcpServers || {}).map(([name, serverConfig]) => {
      const { normalized, changed: serverChanged } = normalizeMcpServerConfig(serverConfig)
      if (serverChanged) changed = true
      return [name, normalized]
    }),
  ) as MCPConfig["mcpServers"]

  return {
    normalized: {
      ...mcpConfig,
      mcpServers: normalizedServers,
    },
    changed,
  }
}
