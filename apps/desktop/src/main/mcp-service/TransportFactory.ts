import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { WebSocketClientTransport } from "@modelcontextprotocol/sdk/client/websocket.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { MCPServerConfig } from "../../shared/types"
import { inferTransportType } from "../../shared/mcp-utils"
import { promisify } from "util"
import { access, constants } from "fs"
import path from "path"
import os from "os"

const accessAsync = promisify(access)

/**
 * TransportFactory - Creates MCP client transports
 *
 * Responsibilities:
 * - Create transports based on config (stdio, WebSocket, HTTP)
 * - Resolve command paths
 * - Prepare environment variables
 */
export class TransportFactory {
  /**
   * Create appropriate transport based on server configuration
   */
  async createTransport(
    serverName: string,
    serverConfig: MCPServerConfig,
    getOAuthToken?: (serverName: string) => Promise<string | null>
  ): Promise<
    | StdioClientTransport
    | WebSocketClientTransport
    | StreamableHTTPClientTransport
  > {
    const transportType = inferTransportType(serverConfig)

    switch (transportType) {
      case "stdio":
        if (!serverConfig.command) {
          throw new Error("Command is required for stdio transport")
        }
        const resolvedCommand = await this.resolveCommandPath(
          serverConfig.command,
        )
        const environment = await this.prepareEnvironment(serverConfig.env)

        // Create transport with stderr piped so we can capture logs
        const transport = new StdioClientTransport({
          command: resolvedCommand,
          args: serverConfig.args || [],
          env: environment,
          stderr: "pipe", // Pipe stderr so we can capture it
        })

        return transport

      case "websocket":
        if (!serverConfig.url) {
          throw new Error("URL is required for websocket transport")
        }
        return new WebSocketClientTransport(new URL(serverConfig.url))

      case "streamableHttp":
        if (!serverConfig.url) {
          throw new Error("URL is required for streamableHttp transport")
        }

        // For streamableHttp, we need to handle OAuth properly
        return await this.createStreamableHttpTransport(serverName, serverConfig, getOAuthToken)

      default:
        throw new Error(`Unsupported transport type: ${transportType}`)
    }
  }

  /**
   * Create streamable HTTP transport with optional OAuth
   */
  private async createStreamableHttpTransport(
    serverName: string,
    serverConfig: MCPServerConfig,
    getOAuthToken?: (serverName: string) => Promise<string | null>
  ): Promise<StreamableHTTPClientTransport> {
    if (!serverConfig.url) {
      throw new Error("URL is required for streamableHttp transport")
    }

    // Prepare custom headers from configuration
    const customHeaders = serverConfig.headers || {}

    // Try to get OAuth token if handler is provided
    if (getOAuthToken) {
      try {
        const accessToken = await getOAuthToken(serverName)
        if (accessToken) {
          return new StreamableHTTPClientTransport(new URL(serverConfig.url), {
            requestInit: {
              headers: {
                ...customHeaders,
                'Authorization': `Bearer ${accessToken}`,
              },
            },
          })
        }
      } catch (error) {
        // Token invalid - fall through to try without auth
      }
    }

    // Create transport without authentication
    // If server requires OAuth, it will return 401 and we'll handle it in the connection logic
    if (Object.keys(customHeaders).length > 0) {
      return new StreamableHTTPClientTransport(new URL(serverConfig.url), {
        requestInit: {
          headers: customHeaders,
        },
      })
    }

    return new StreamableHTTPClientTransport(new URL(serverConfig.url))
  }

  /**
   * Resolve the full path to a command, handling different platforms and PATH resolution
   */
  async resolveCommandPath(command: string): Promise<string> {
    // If it's already an absolute path, return as-is
    if (path.isAbsolute(command)) {
      return command
    }

    // Get the system PATH
    const systemPath = process.env.PATH || ""
    const pathSeparator = process.platform === "win32" ? ";" : ":"
    const pathExtensions =
      process.platform === "win32" ? [".exe", ".cmd", ".bat"] : [""]

    // Split PATH and search for the command
    const pathDirs = systemPath.split(pathSeparator)

    // Add common Node.js paths that might be missing in Electron
    const additionalPaths = [
      "/usr/local/bin",
      "/opt/homebrew/bin",
      path.join(os.homedir(), ".npm-global", "bin"),
      path.join(os.homedir(), "node_modules", ".bin"),
    ]

    pathDirs.push(...additionalPaths)

    for (const dir of pathDirs) {
      if (!dir) continue

      for (const ext of pathExtensions) {
        const fullPath = path.join(dir, command + ext)
        try {
          await accessAsync(fullPath, constants.F_OK | constants.X_OK)
          return fullPath
        } catch {
          // Continue searching
        }
      }
    }

    // If not found, check if npx is available and this might be an npm package
    if (command === "npx" || command.startsWith("@")) {
      throw new Error(
        `npx not found in PATH. Please ensure Node.js is properly installed.`,
      )
    }

    // Return original command and let the system handle it
    return command
  }

  /**
   * Prepare environment variables for spawning MCP servers
   */
  async prepareEnvironment(
    serverEnv?: Record<string, string>,
  ): Promise<Record<string, string>> {
    // Create a clean environment with only string values
    const environment: Record<string, string> = {}

    // Copy process.env, filtering out undefined values
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        environment[key] = value
      }
    }

    // Ensure PATH is properly set for finding npm/npx
    if (!environment.PATH) {
      environment.PATH = "/usr/local/bin:/usr/bin:/bin"
    }

    // Add common Node.js paths to PATH if not already present
    const additionalPaths = [
      "/usr/local/bin",
      "/opt/homebrew/bin",
      path.join(os.homedir(), ".npm-global", "bin"),
      path.join(os.homedir(), "node_modules", ".bin"),
    ]

    const pathSeparator = process.platform === "win32" ? ";" : ":"
    const currentPaths = environment.PATH.split(pathSeparator)

    for (const additionalPath of additionalPaths) {
      if (!currentPaths.includes(additionalPath)) {
        environment.PATH += pathSeparator + additionalPath
      }
    }

    // Add server-specific environment variables
    if (serverEnv) {
      Object.assign(environment, serverEnv)
    }

    return environment
  }
}
