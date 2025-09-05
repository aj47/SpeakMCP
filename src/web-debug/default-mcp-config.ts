/**
 * Default MCP configuration for web debugging mode
 * This provides a basic set of MCP servers that can be used for testing
 */

import { MCPConfig } from '../shared/types'

export const defaultWebDebugMCPConfig: MCPConfig = {
  mcpServers: {
    // Memory server - for persistent memory across conversations
    memory: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
      env: {},
      timeout: 10000,
      disabled: false
    },

    // Sequential thinking server - for step-by-step reasoning
    'sequential-thinking': {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
      env: {},
      timeout: 10000,
      disabled: false
    },

    // Filesystem server - for file operations (if available)
    filesystem: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', process.cwd()],
      env: {},
      timeout: 10000,
      disabled: false
    },

    // Playwright server - for web automation (the one we're using!)
    playwright: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@executeautomation/playwright-mcp-server'],
      env: {},
      timeout: 15000,
      disabled: false
    },

    // Time server - for date/time operations
    time: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-time'],
      env: {},
      timeout: 10000,
      disabled: false
    },

    // Brave search server - for web search (requires API key)
    'brave-search': {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
      env: {
        BRAVE_API_KEY: process.env.BRAVE_API_KEY || ''
      },
      timeout: 15000,
      disabled: !process.env.BRAVE_API_KEY // Disable if no API key
    },

    // SQLite server - for database operations
    sqlite: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sqlite', ':memory:'],
      env: {},
      timeout: 10000,
      disabled: false
    },

    // Fetch server - for HTTP requests
    fetch: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-fetch'],
      env: {},
      timeout: 15000,
      disabled: false
    }
  }
}

/**
 * Get a minimal MCP configuration for basic testing
 */
export const getMinimalMCPConfig = (): MCPConfig => ({
  mcpServers: {
    memory: defaultWebDebugMCPConfig.mcpServers.memory,
    'sequential-thinking': defaultWebDebugMCPConfig.mcpServers['sequential-thinking'],
    time: defaultWebDebugMCPConfig.mcpServers.time
  }
})

/**
 * Get MCP configuration with Playwright for web debugging
 */
export const getWebDebugMCPConfig = (): MCPConfig => ({
  mcpServers: {
    memory: defaultWebDebugMCPConfig.mcpServers.memory,
    'sequential-thinking': defaultWebDebugMCPConfig.mcpServers['sequential-thinking'],
    playwright: defaultWebDebugMCPConfig.mcpServers.playwright,
    time: defaultWebDebugMCPConfig.mcpServers.time,
    fetch: defaultWebDebugMCPConfig.mcpServers.fetch
  }
})

/**
 * Get full MCP configuration with all available servers
 */
export const getFullMCPConfig = (): MCPConfig => defaultWebDebugMCPConfig

/**
 * Check if required dependencies are available for a server
 */
export const checkServerDependencies = async (serverName: string): Promise<boolean> => {
  const server = defaultWebDebugMCPConfig.mcpServers[serverName]
  if (!server) return false

  // For stdio servers using npx, we can check if the package exists
  if (server.transport === 'stdio' && server.command === 'npx') {
    try {
      const { spawn } = await import('child_process')
      const packageName = server.args?.[1] // Skip -y flag
      if (!packageName) return false

      return new Promise((resolve) => {
        const child = spawn('npm', ['view', packageName, 'version'], {
          stdio: 'pipe'
        })
        
        child.on('close', (code) => {
          resolve(code === 0)
        })
        
        child.on('error', () => {
          resolve(false)
        })
        
        // Timeout after 5 seconds
        setTimeout(() => {
          child.kill()
          resolve(false)
        }, 5000)
      })
    } catch (error) {
      console.warn(`Failed to check dependencies for ${serverName}:`, error)
      return false
    }
  }

  return true
}

/**
 * Get recommended MCP configuration based on available dependencies
 */
export const getRecommendedMCPConfig = async (): Promise<MCPConfig> => {
  const config: MCPConfig = { mcpServers: {} }
  
  // Always include these basic servers (they're lightweight and usually work)
  const basicServers = ['memory', 'sequential-thinking', 'time']
  
  for (const serverName of basicServers) {
    const server = defaultWebDebugMCPConfig.mcpServers[serverName]
    if (server) {
      config.mcpServers[serverName] = server
    }
  }

  // Check for optional servers
  const optionalServers = ['playwright', 'fetch', 'filesystem', 'sqlite']
  
  for (const serverName of optionalServers) {
    try {
      const isAvailable = await checkServerDependencies(serverName)
      if (isAvailable) {
        const server = defaultWebDebugMCPConfig.mcpServers[serverName]
        if (server) {
          config.mcpServers[serverName] = server
        }
      }
    } catch (error) {
      console.warn(`Failed to check ${serverName} availability:`, error)
    }
  }

  return config
}
