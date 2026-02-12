/**
 * Claude Code Session Provider
 * 
 * Reads sessions from ~/.claude/projects/ directory.
 * Sessions are JSONL files with one JSON object per line.
 * Project folders are named with encoded paths (e.g., -Users-ajjoobandi-Development-project)
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

// Claude Code JSONL line structure (partial)
interface ClaudeCodeLine {
  type: 'user' | 'assistant' | 'system' | 'queue-operation'
  sessionId: string
  cwd?: string
  timestamp: string
  message?: {
    role: 'user' | 'assistant'
    content: string | Array<{ type: string; text?: string }>
  }
  uuid?: string
  parentUuid?: string | null
  gitBranch?: string
  version?: string
}

/**
 * Get the Claude Code projects directory path
 */
function getClaudeProjectsPath(): string {
  const homeDir = app.getPath('home')
  return path.join(homeDir, '.claude', 'projects')
}

/**
 * Decode project folder name to workspace path
 * e.g., "-Users-ajjoobandi-Development-project" -> "/Users/ajjoobandi/Development/project"
 */
function decodeProjectPath(folderName: string): string {
  // Replace leading dash and all dashes with path separators
  return folderName.replace(/^-/, '/').replace(/-/g, '/')
}

/**
 * Parse first few lines of JSONL to get session metadata
 */
async function parseSessionMetadata(filePath: string, projectPath: string): Promise<ExternalSessionMetadata | null> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8')
    const lines = content.split('\n').filter(l => l.trim())
    
    if (lines.length === 0) return null
    
    // Parse first line to get session info
    const firstLine: ClaudeCodeLine = JSON.parse(lines[0])
    
    // Skip agent warmup files and queue operations
    if (firstLine.type === 'queue-operation') {
      // Find first actual message
      const firstMessage = lines.find(l => {
        try {
          const parsed = JSON.parse(l)
          return parsed.type === 'user' || parsed.type === 'assistant'
        } catch { return false }
      })
      if (!firstMessage) return null
    }
    
    // Find first user message for preview
    let preview = ''
    let title = ''
    for (const line of lines.slice(0, 10)) {
      try {
        const parsed: ClaudeCodeLine = JSON.parse(line)
        if (parsed.type === 'user' && parsed.message) {
          const content = parsed.message.content
          if (typeof content === 'string') {
            preview = content.slice(0, 200)
            title = content.slice(0, 50)
          } else if (Array.isArray(content)) {
            const textContent = content.find(c => c.type === 'text')?.text || ''
            preview = textContent.slice(0, 200)
            title = textContent.slice(0, 50)
          }
          break
        }
      } catch { /* skip malformed lines */ }
    }
    
    // Get file stats for timestamps
    const stats = await fs.promises.stat(filePath)
    
    // Extract session ID from filename (UUID.jsonl or agent-xxx.jsonl)
    const fileName = path.basename(filePath, '.jsonl')
    const sessionId = firstLine.sessionId || fileName
    
    return {
      id: sessionId,
      title: title || fileName,
      createdAt: stats.birthtimeMs,
      updatedAt: stats.mtimeMs,
      source: 'claude-code',
      workspacePath: firstLine.cwd || projectPath,
      messageCount: lines.length,
      preview,
      filePath,
    }
  } catch (error) {
    logApp(`[ClaudeCodeProvider] Failed to parse session ${filePath}: ${error}`)
    return null
  }
}

export class ClaudeCodeSessionProvider implements ExternalSessionProvider {
  readonly source = 'claude-code' as const
  readonly displayName = 'Claude Code'
  
  private projectsPath: string
  private metadataCache: Map<string, ExternalSessionMetadata> = new Map()
  private lastCacheTime: number = 0
  private readonly CACHE_TTL_MS = 30000 // 30 seconds
  
  constructor() {
    this.projectsPath = getClaudeProjectsPath()
  }
  
  async isAvailable(): Promise<boolean> {
    try {
      await fs.promises.access(this.projectsPath, fs.constants.R_OK)
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
      // List all project directories
      const projectDirs = await fs.promises.readdir(this.projectsPath)
      const allSessions: Array<{ filePath: string; projectPath: string; mtime: number }> = []

      // Scan each project directory for session files
      for (const projectDir of projectDirs) {
        const projectFullPath = path.join(this.projectsPath, projectDir)
        const projectPath = decodeProjectPath(projectDir)

        try {
          const stat = await fs.promises.stat(projectFullPath)
          if (!stat.isDirectory()) continue

          const files = await fs.promises.readdir(projectFullPath)
          for (const file of files) {
            // Only process .jsonl files that look like sessions (UUID or session-*)
            if (!file.endsWith('.jsonl')) continue
            // Skip agent-* files (these are sub-agent warmup sessions)
            if (file.startsWith('agent-')) continue

            const filePath = path.join(projectFullPath, file)
            try {
              const fileStat = await fs.promises.stat(filePath)
              if (fileStat.isFile()) {
                allSessions.push({ filePath, projectPath, mtime: fileStat.mtimeMs })
              }
            } catch { /* skip inaccessible files */ }
          }
        } catch { /* skip inaccessible directories */ }
      }

      // Sort by modification time and take limit
      const sortedSessions = allSessions
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, limit)

      // Parse metadata in parallel
      const CONCURRENCY = 10
      const results: ExternalSessionMetadata[] = []

      for (let i = 0; i < sortedSessions.length; i += CONCURRENCY) {
        const batch = sortedSessions.slice(i, i + CONCURRENCY)
        const batchResults = await Promise.all(
          batch.map(({ filePath, projectPath }) => parseSessionMetadata(filePath, projectPath))
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
      logApp(`[ClaudeCodeProvider] Failed to list sessions: ${error}`)
      return []
    }
  }

  async loadSession(sessionId: string): Promise<ExternalSession | null> {
    // Check cache for file path
    const cached = this.metadataCache.get(sessionId)
    if (!cached?.filePath) {
      logApp(`[ClaudeCodeProvider] Session ${sessionId} not found in cache`)
      return null
    }

    try {
      const content = await fs.promises.readFile(cached.filePath, 'utf-8')
      const lines = content.split('\n').filter(l => l.trim())

      const messages: ExternalSessionMessage[] = []
      let cwd: string | undefined

      for (const line of lines) {
        try {
          const parsed: ClaudeCodeLine = JSON.parse(line)
          if (!cwd && parsed.cwd) cwd = parsed.cwd

          if ((parsed.type === 'user' || parsed.type === 'assistant') && parsed.message) {
            const content = parsed.message.content
            const textContent = typeof content === 'string'
              ? content
              : (content.find(c => c.type === 'text')?.text || '')

            messages.push({
              role: parsed.message.role,
              content: textContent,
              timestamp: new Date(parsed.timestamp).getTime(),
            })
          }
        } catch { /* skip malformed lines */ }
      }

      return {
        ...cached,
        messages,
        workspacePath: cwd || cached.workspacePath,
      }
    } catch (error) {
      logApp(`[ClaudeCodeProvider] Failed to load session ${sessionId}: ${error}`)
      return null
    }
  }

  async continueSession(options: ContinueSessionOptions): Promise<ContinueSessionResult> {
    const { session, workspacePath } = options
    const cwd = workspacePath || session.workspacePath || process.cwd()

    // For Claude Code, we spawn the CLI with --continue flag
    // This requires the claude CLI to be installed

    try {
      const { spawn } = await import('child_process')

      // Check if claude CLI is available
      const which = spawn('which', ['claude'])
      const claudePath = await new Promise<string | null>((resolve) => {
        let output = ''
        which.stdout.on('data', (data) => { output += data.toString() })
        which.on('close', (code) => {
          resolve(code === 0 ? output.trim() : null)
        })
      })

      if (!claudePath) {
        return {
          success: false,
          error: 'Claude CLI not found. Please install Claude Code CLI to continue sessions.',
        }
      }

      // Spawn claude with --continue flag
      // Note: This opens a new terminal window with the session
      const { exec } = await import('child_process')
      const command = `cd "${cwd}" && claude --continue "${session.id}"`

      // Open in default terminal
      exec(`osascript -e 'tell app "Terminal" to do script "${command.replace(/"/g, '\\"')}"'`)

      return {
        success: true,
        sessionId: session.id,
        conversationId: session.id,
      }
    } catch (error) {
      logApp(`[ClaudeCodeProvider] Failed to continue session: ${error}`)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}

