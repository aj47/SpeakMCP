import React, { createContext, useContext, ReactNode } from "react"
import { MCPConfig, MCPServerConfig, ServerLogEntry } from "@shared/types"

export interface ServerStatus {
  connected: boolean
  toolCount: number
  error?: string
  runtimeEnabled?: boolean
  configDisabled?: boolean
}

export interface OAuthStatus {
  configured: boolean
  authenticated: boolean
  tokenExpiry?: number
  error?: string
}

export interface ServerConfigContextValue {
  config: MCPConfig
  serverStatus: Record<string, ServerStatus>
  oauthStatus: Record<string, OAuthStatus>
  serverLogs: Record<string, ServerLogEntry[]>
  onConfigChange: (config: MCPConfig) => void
  onAddServer: (name: string, config: MCPServerConfig) => void
  onEditServer: (oldName: string, newName: string, config: MCPServerConfig) => void
  onDeleteServer: (name: string) => void
}

const ServerConfigContext = createContext<ServerConfigContextValue | undefined>(undefined)

interface ServerConfigProviderProps {
  children: ReactNode
  config: MCPConfig
  serverStatus: Record<string, ServerStatus>
  oauthStatus: Record<string, OAuthStatus>
  serverLogs: Record<string, ServerLogEntry[]>
  onConfigChange: (config: MCPConfig) => void
  onAddServer: (name: string, config: MCPServerConfig) => void
  onEditServer: (oldName: string, newName: string, config: MCPServerConfig) => void
  onDeleteServer: (name: string) => void
}

export function ServerConfigProvider({
  children,
  config,
  serverStatus,
  oauthStatus,
  serverLogs,
  onConfigChange,
  onAddServer,
  onEditServer,
  onDeleteServer,
}: ServerConfigProviderProps) {
  const value: ServerConfigContextValue = {
    config,
    serverStatus,
    oauthStatus,
    serverLogs,
    onConfigChange,
    onAddServer,
    onEditServer,
    onDeleteServer,
  }

  return <ServerConfigContext.Provider value={value}>{children}</ServerConfigContext.Provider>
}

export function useServerConfig() {
  const context = useContext(ServerConfigContext)
  if (!context) {
    throw new Error("useServerConfig must be used within a ServerConfigProvider")
  }
  return context
}
