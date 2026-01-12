import fs from "fs"
import path from "path"
import {
  MCPServerMetadata,
  MCPToolFile,
  MCPToolSummary,
  FILE_DISCOVERY_FOLDERS,
  FILE_DISCOVERY_FILES,
} from "@shared/file-discovery-types"
import { dataFolder } from "./config"
import { logApp } from "./debug"

/**
 * Service for syncing MCP tool descriptions to files for dynamic context discovery.
 * Following Cursor's approach of using files as a primitive for dynamic context discovery.
 */
export class MCPFileSyncService {
  private discoveryFolder: string
  private mcpToolsFolder: string

  constructor() {
    // Initialize folders using dataFolder from config
    this.discoveryFolder = path.join(dataFolder, FILE_DISCOVERY_FOLDERS.ROOT)
    this.mcpToolsFolder = path.join(this.discoveryFolder, FILE_DISCOVERY_FOLDERS.MCP_TOOLS)
  }

  /**
   * Ensure folder structure exists
   */
  ensureFolders(): void {
    try {
      fs.mkdirSync(this.discoveryFolder, { recursive: true })
      fs.mkdirSync(this.mcpToolsFolder, { recursive: true })
    } catch (error) {
      logApp("[MCPFileSyncService] Error creating folders:", error)
    }
  }

  /**
   * Sync tools for a server (call this when server connects/updates)
   */
  syncServerTools(
    serverName: string,
    tools: Array<{ name: string; description: string; inputSchema: object }>
  ): void {
    try {
      this.ensureFolders()
      const serverFolder = path.join(this.mcpToolsFolder, serverName)
      fs.mkdirSync(serverFolder, { recursive: true })

      const now = Date.now()

      // Write each tool as a separate JSON file
      for (const tool of tools) {
        const toolFile: MCPToolFile = {
          name: tool.name,
          serverName,
          description: tool.description || "",
          inputSchema: tool.inputSchema as Record<string, unknown>,
          lastUpdated: now,
        }

        const toolPath = path.join(serverFolder, `${tool.name}.json`)
        fs.writeFileSync(toolPath, JSON.stringify(toolFile, null, 2))
      }

      // Clean up old tool files that no longer exist
      const existingFiles = fs.readdirSync(serverFolder)
      const currentToolNames = new Set(tools.map((t) => `${t.name}.json`))

      for (const file of existingFiles) {
        if (file !== FILE_DISCOVERY_FILES.SERVER_METADATA && !currentToolNames.has(file)) {
          try {
            fs.unlinkSync(path.join(serverFolder, file))
          } catch (error) {
            logApp(`[MCPFileSyncService] Error removing old tool file ${file}:`, error)
          }
        }
      }

      logApp(`[MCPFileSyncService] Synced ${tools.length} tools for server ${serverName}`)
    } catch (error) {
      logApp("[MCPFileSyncService] Error syncing server tools:", error)
    }
  }

  /**
   * Update server status (call on connect/disconnect/error)
   */
  updateServerStatus(serverName: string, status: Omit<MCPServerMetadata, "name">): void {
    try {
      this.ensureFolders()
      const serverFolder = path.join(this.mcpToolsFolder, serverName)
      fs.mkdirSync(serverFolder, { recursive: true })

      const metadata: MCPServerMetadata = {
        name: serverName,
        ...status,
      }

      const metadataPath = path.join(serverFolder, FILE_DISCOVERY_FILES.SERVER_METADATA)
      fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2))

      logApp(`[MCPFileSyncService] Updated status for server ${serverName}: ${status.status}`)
    } catch (error) {
      logApp("[MCPFileSyncService] Error updating server status:", error)
    }
  }

  /**
   * Remove server folder when server is deleted
   */
  removeServer(serverName: string): void {
    try {
      const serverFolder = path.join(this.mcpToolsFolder, serverName)
      if (fs.existsSync(serverFolder)) {
        fs.rmSync(serverFolder, { recursive: true, force: true })
        logApp(`[MCPFileSyncService] Removed server folder for ${serverName}`)
      }
    } catch (error) {
      logApp("[MCPFileSyncService] Error removing server:", error)
    }
  }

  /**
   * Get tool summaries for system prompt (names only)
   */
  getToolSummaries(): MCPToolSummary[] {
    const summaries: MCPToolSummary[] = []

    try {
      if (!fs.existsSync(this.mcpToolsFolder)) {
        return summaries
      }

      const serverFolders = fs.readdirSync(this.mcpToolsFolder)

      for (const serverName of serverFolders) {
        const serverFolder = path.join(this.mcpToolsFolder, serverName)
        const stats = fs.statSync(serverFolder)

        if (!stats.isDirectory()) continue

        // Read server metadata
        const metadataPath = path.join(serverFolder, FILE_DISCOVERY_FILES.SERVER_METADATA)
        let status: MCPServerMetadata["status"] = "disconnected"

        if (fs.existsSync(metadataPath)) {
          try {
            const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8")) as MCPServerMetadata
            status = metadata.status
          } catch {
            // Use default status if metadata is invalid
          }
        }

        // Get tool names from JSON files
        const files = fs.readdirSync(serverFolder)
        const toolNames = files
          .filter((f) => f.endsWith(".json") && f !== FILE_DISCOVERY_FILES.SERVER_METADATA)
          .map((f) => f.replace(".json", ""))

        summaries.push({
          serverName,
          status,
          toolNames,
        })
      }
    } catch (error) {
      logApp("[MCPFileSyncService] Error getting tool summaries:", error)
    }

    return summaries
  }

  /**
   * Read a specific tool file (for when agent needs full description)
   */
  readToolFile(serverName: string, toolName: string): MCPToolFile | null {
    try {
      const toolPath = path.join(this.mcpToolsFolder, serverName, `${toolName}.json`)

      if (!fs.existsSync(toolPath)) {
        return null
      }

      const content = fs.readFileSync(toolPath, "utf-8")
      return JSON.parse(content) as MCPToolFile
    } catch (error) {
      logApp(`[MCPFileSyncService] Error reading tool file ${serverName}/${toolName}:`, error)
      return null
    }
  }

  /**
   * Get the path to discovery folder (for system prompt hints)
   */
  getDiscoveryFolderPath(): string {
    return this.discoveryFolder
  }
}

export const mcpFileSyncService = new MCPFileSyncService()
