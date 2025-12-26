import { MCPToolResult } from "./types"

/**
 * ResourceTracker - Tracks MCP resource lifecycle
 *
 * Responsibilities:
 * - Track active resources (sessions, connections, handles)
 * - Update resource activity
 * - Clean up inactive resources
 * - Extract resource IDs from tool results
 */
export class ResourceTracker {
  private activeResources = new Map<
    string,
    {
      serverId: string
      resourceId: string
      resourceType: string
      lastUsed: number
    }
  >()

  private sessionCleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor() {
    // Set up periodic cleanup every 5 minutes
    this.sessionCleanupInterval = setInterval(
      () => {
        this.cleanupInactiveResources()
      },
      5 * 60 * 1000,
    )
  }

  /**
   * Track a resource
   */
  trackResource(
    serverId: string,
    resourceId: string,
    resourceType: string = "session",
  ): void {
    const key = `${serverId}:${resourceType}:${resourceId}`
    this.activeResources.set(key, {
      serverId,
      resourceId,
      resourceType,
      lastUsed: Date.now(),
    })
  }

  /**
   * Update resource activity timestamp
   */
  updateResourceActivity(
    serverId: string,
    resourceId: string,
    resourceType: string = "session",
  ): void {
    const key = `${serverId}:${resourceType}:${resourceId}`
    const resource = this.activeResources.get(key)
    if (resource) {
      resource.lastUsed = Date.now()
    }
  }

  /**
   * Clean up inactive resources (older than 30 minutes)
   */
  private cleanupInactiveResources(): void {
    const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000
    let cleanedCount = 0

    for (const [key, resource] of this.activeResources) {
      if (resource.lastUsed < thirtyMinutesAgo) {
        this.activeResources.delete(key)
        cleanedCount++
      }
    }
  }

  /**
   * Get all tracked resources
   */
  getTrackedResources(): Array<{
    serverId: string
    resourceId: string
    resourceType: string
    lastUsed: number
  }> {
    return Array.from(this.activeResources.values())
  }

  /**
   * Track resource from tool result by parsing the result text
   */
  trackResourceFromResult(
    serverName: string,
    result: MCPToolResult,
  ): void {
    if (!result.isError && result.content[0]?.text) {
      const text = result.content[0].text

      const resourcePatterns = [
        {
          pattern: /(?:Session|session)\s+(?:ID|id):\s*([a-f0-9-]+)/i,
          type: "session",
        },
        {
          pattern: /(?:Connection|connection)\s+(?:ID|id):\s*([a-f0-9-]+)/i,
          type: "connection",
        },
        { pattern: /(?:Handle|handle):\s*([a-f0-9-]+)/i, type: "handle" },
      ]

      for (const { pattern, type } of resourcePatterns) {
        const match = text.match(pattern)
        if (match && match[1]) {
          this.trackResource(serverName, match[1], type)
          break
        }
      }
    }
  }

  /**
   * Cleanup on shutdown
   */
  cleanup(): void {
    if (this.sessionCleanupInterval) {
      clearInterval(this.sessionCleanupInterval)
      this.sessionCleanupInterval = null
    }
    this.activeResources.clear()
  }
}
