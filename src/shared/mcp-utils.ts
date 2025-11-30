import { MCPConfig, MCPServerConfig, MCPTransportType } from "./types"

/**
 * Determine transport type when it isn't explicitly set.
 * Falls back to streamableHttp when a URL is present, otherwise stdio.
 */
export function inferTransportType(config: MCPServerConfig): MCPTransportType {
  if (config.transport) return config.transport
  return config.url ? "streamableHttp" : "stdio"
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
