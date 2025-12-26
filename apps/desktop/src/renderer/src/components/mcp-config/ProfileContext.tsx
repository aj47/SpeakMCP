import React, { createContext, useContext, ReactNode } from "react"
import { Profile } from "@shared/types"

// Built-in server name - always enabled regardless of profile config
const BUILTIN_SERVER_NAME = "speakmcp-settings"

/**
 * Check if a tool is enabled for a specific profile
 */
export function isToolEnabledForProfile(toolName: string, serverName: string, profile: Profile): boolean {
  const mcpConfig = profile.mcpServerConfig
  if (!mcpConfig) return true // No config means all enabled

  // Built-in server tools are always enabled regardless of profile config
  if (serverName === BUILTIN_SERVER_NAME) return true

  // Check if the server is disabled for this profile
  if (mcpConfig.allServersDisabledByDefault) {
    // In opt-in mode, server must be in enabledServers
    if (!mcpConfig.enabledServers?.includes(serverName)) {
      return false
    }
  } else {
    // In opt-out mode, server must not be in disabledServers
    if (mcpConfig.disabledServers?.includes(serverName)) {
      return false
    }
  }

  // Check if the tool itself is disabled
  if (mcpConfig.disabledTools?.includes(toolName)) {
    return false
  }

  return true
}

/**
 * Check if a server is enabled for a specific profile
 */
export function isServerEnabledForProfile(serverName: string, profile: Profile): boolean {
  const mcpConfig = profile.mcpServerConfig
  if (!mcpConfig) return true // No config means all enabled

  // Built-in server is always enabled regardless of profile config
  if (serverName === BUILTIN_SERVER_NAME) return true

  if (mcpConfig.allServersDisabledByDefault) {
    // In opt-in mode, server must be in enabledServers
    return mcpConfig.enabledServers?.includes(serverName) ?? false
  } else {
    // In opt-out mode, server must not be in disabledServers
    return !mcpConfig.disabledServers?.includes(serverName)
  }
}

interface ProfileContextValue {
  profiles: Profile[]
  currentProfileId: string | null
  isToolEnabledForProfile: (toolName: string, serverName: string, profile: Profile) => boolean
  isServerEnabledForProfile: (serverName: string, profile: Profile) => boolean
}

const ProfileContext = createContext<ProfileContextValue | undefined>(undefined)

interface ProfileProviderProps {
  children: ReactNode
  profiles: Profile[]
  currentProfileId: string | null
}

export function ProfileProvider({ children, profiles, currentProfileId }: ProfileProviderProps) {
  const value: ProfileContextValue = {
    profiles,
    currentProfileId,
    isToolEnabledForProfile,
    isServerEnabledForProfile,
  }

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
}

export function useProfiles() {
  const context = useContext(ProfileContext)
  if (!context) {
    throw new Error("useProfiles must be used within a ProfileProvider")
  }
  return context
}
