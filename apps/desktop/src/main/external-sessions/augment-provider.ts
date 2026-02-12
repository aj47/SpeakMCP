/**
 * Augment Session Provider
 * 
 * Reads sessions from ~/.augment/sessions/ directory.
 * Sessions are JSON files with chatHistory containing exchanges.
 */

import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { logApp } from '../debug'
import type {
  ExternalSessionProvider,
  ExternalSessionMetadata,
  ExternalSession,
  ExternalSessionMessage,
  ContinueSessionOptions,
  ContinueSessionResult,
} from './types'

// Augment session file structure (partial, only what we need)
interface AugmentSessionFile {
  sessionId: string
  title?: string
  created: string
  modified: string
  workspaceId?: string
  chatHistory?: Array<{
    exchange: {
      request_message: string
      response_text: string
      request_nodes?: Array<{
        type: number
        ide_state_node?: {
          workspace_folders?: Array<{
            folder_root?: string
            repository_root?: string
          }>
        }
      }>
    }
    completed?: boolean
    finishedAt?: string
  }>
}

/**
 * Get the Augment sessions directory path
 */
function getAugmentSessionsPath(): string {
  const homeDir = app.getPath('home')
  return path.join(homeDir, '.augment', 'sessions')
}

/**
 * Extract workspace path from Augment session
 */
function extractWorkspacePath(session: AugmentSessionFile): string | undefined {
  // Try to get workspace from first exchange's ide_state_node
  const firstExchange = session.chatHistory?.[0]?.exchange
  const ideStateNode = firstExchange?.request_nodes?.find(n => n.type === 4)?.ide_state_node
  const workspaceFolder = ideStateNode?.workspace_folders?.[0]
  return workspaceFolder?.repository_root || workspaceFolder?.folder_root
}

/**
 * Parse Augment session file to metadata (fast, minimal parsing)
 */
async function parseSessionMetadata(filePath: string): Promise<ExternalSessionMetadata | null> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8')
    const session: AugmentSessionFile = JSON.parse(content)
    
    // Extract first user message for preview
    const firstMessage = session.chatHistory?.[0]?.exchange?.request_message || ''
    const preview = firstMessage.slice(0, 200)
    
    return {
      id: session.sessionId,
      title: session.title || preview.slice(0, 50) || 'Untitled Session',
      createdAt: new Date(session.created).getTime(),
      updatedAt: new Date(session.modified).getTime(),
      source: 'augment',
      workspacePath: extractWorkspacePath(session),
      messageCount: session.chatHistory?.length ? session.chatHistory.length * 2 : 0, // Rough estimate
      preview,
      filePath,
    }
  } catch (error) {
    logApp(`[AugmentProvider] Failed to parse session ${filePath}: ${error}`)
    return null
  }
}

export class AugmentSessionProvider implements ExternalSessionProvider {
  readonly source = 'augment' as const
  readonly displayName = 'Augment'
  
  private sessionsPath: string
  private metadataCache: Map<string, ExternalSessionMetadata> = new Map()
  private lastCacheTime: number = 0
  private readonly CACHE_TTL_MS = 30000 // 30 seconds
  
  constructor() {
    this.sessionsPath = getAugmentSessionsPath()
  }
  
  async isAvailable(): Promise<boolean> {
    try {
      await fs.promises.access(this.sessionsPath, fs.constants.R_OK)
      return true
    } catch {
      return false
    }
  }
  
  async getSessionMetadata(limit: number = 100): Promise<ExternalSessionMetadata[]> {
    // Check cache validity
    const now = Date.now()
    if (this.metadataCache.size > 0 && (now - this.lastCacheTime) < this.CACHE_TTL_MS) {
      const cached = Array.from(this.metadataCache.values())
      return cached.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
    }
    
    try {
      const files = await fs.promises.readdir(this.sessionsPath)
      const jsonFiles = files.filter(f => f.endsWith('.json')).slice(0, limit * 2) // Read more to account for failures
      
      // Get file stats for sorting by modification time
      const fileStats = await Promise.all(
        jsonFiles.map(async (file) => {
          const filePath = path.join(this.sessionsPath, file)
          try {
            const stats = await fs.promises.stat(filePath)
            return { file, filePath, mtime: stats.mtimeMs }
          } catch {
            return null
          }
        })
      )
      
      // Sort by modification time (most recent first) and take limit
      const sortedFiles = fileStats
        .filter((f): f is NonNullable<typeof f> => f !== null)
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, limit)
      
      // Parse metadata in parallel (with concurrency limit)
      const CONCURRENCY = 10
      const results: ExternalSessionMetadata[] = []
      
      for (let i = 0; i < sortedFiles.length; i += CONCURRENCY) {
        const batch = sortedFiles.slice(i, i + CONCURRENCY)
        const batchResults = await Promise.all(
          batch.map(({ filePath }) => parseSessionMetadata(filePath))
        )
        results.push(...batchResults.filter((r): r is ExternalSessionMetadata => r !== null))
      }
      
      // Update cache
      this.metadataCache.clear()
      for (const meta of results) {
        this.metadataCache.set(meta.id, meta)
      }
      this.lastCacheTime = now
      
      return results.sort((a, b) => b.updatedAt - a.updatedAt)
    } catch (error) {
      logApp(`[AugmentProvider] Failed to list sessions: ${error}`)
      return []
    }
  }

  async loadSession(sessionId: string): Promise<ExternalSession | null> {
    // Check cache for file path
    let filePath = this.metadataCache.get(sessionId)?.filePath

    if (!filePath) {
      // Try to find the file
      filePath = path.join(this.sessionsPath, `${sessionId}.json`)
    }

    try {
      const content = await fs.promises.readFile(filePath, 'utf-8')
      const session: AugmentSessionFile = JSON.parse(content)

      // Convert chat history to messages
      const messages: ExternalSessionMessage[] = []
      for (const exchange of session.chatHistory || []) {
        if (exchange.exchange.request_message) {
          messages.push({
            role: 'user',
            content: exchange.exchange.request_message,
            timestamp: exchange.finishedAt ? new Date(exchange.finishedAt).getTime() : undefined,
          })
        }
        if (exchange.exchange.response_text) {
          messages.push({
            role: 'assistant',
            content: exchange.exchange.response_text,
            timestamp: exchange.finishedAt ? new Date(exchange.finishedAt).getTime() : undefined,
          })
        }
      }

      const firstMessage = session.chatHistory?.[0]?.exchange?.request_message || ''

      return {
        id: session.sessionId,
        title: session.title || firstMessage.slice(0, 50) || 'Untitled Session',
        createdAt: new Date(session.created).getTime(),
        updatedAt: new Date(session.modified).getTime(),
        source: 'augment',
        workspacePath: extractWorkspacePath(session),
        messageCount: messages.length,
        preview: firstMessage.slice(0, 200),
        filePath,
        messages,
        agentMetadata: {
          workspaceId: session.workspaceId,
        },
      }
    } catch (error) {
      logApp(`[AugmentProvider] Failed to load session ${sessionId}: ${error}`)
      return null
    }
  }

  async continueSession(options: ContinueSessionOptions): Promise<ContinueSessionResult> {
    const { session, workspacePath, initialMessage } = options

    // For Augment sessions, we need to:
    // 1. Spawn the Augment agent (if not already running)
    // 2. Call session/load with the session ID
    // 3. The agent will replay the conversation history

    // Import dynamically to avoid circular dependencies
    const { acpService } = await import('../acp-service')
    const { agentProfileService } = await import('../agent-profile-service')

    // Find an Augment agent profile
    const augmentProfile = agentProfileService.getAll().find(
      p => p.name.toLowerCase().includes('augment') || p.name.toLowerCase().includes('auggie')
    )

    if (!augmentProfile) {
      return {
        success: false,
        error: 'No Augment agent profile found. Please configure an Augment agent in Settings → Agents.',
      }
    }

    const agentName = augmentProfile.name
    const cwd = workspacePath || session.workspacePath || process.cwd()

    try {
      // Load the session via ACP
      const result = await acpService.loadSession(agentName, session.id, cwd)

      if (!result.success) {
        return {
          success: false,
          error: result.error || 'Failed to load session',
        }
      }

      // If there's an initial message, send it
      if (initialMessage && result.sessionId) {
        // TODO: Send initial message via acpService.sendMessage
      }

      return {
        success: true,
        sessionId: result.sessionId,
        conversationId: session.id, // Use original session ID as conversation ID
      }
    } catch (error) {
      logApp(`[AugmentProvider] Failed to continue session: ${error}`)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

