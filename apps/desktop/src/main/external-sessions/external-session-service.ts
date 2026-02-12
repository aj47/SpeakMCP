/**
 * External Session Service
 * 
 * Aggregates sessions from multiple external providers and merges them
 * with native SpeakMCP conversations for a unified history view.
 */

import { logApp } from '../debug'
import { AugmentSessionProvider } from './augment-provider'
import { ClaudeCodeSessionProvider } from './claude-code-provider'
import type {
  ExternalSessionProvider,
  ExternalSessionSource,
  ExternalSessionMetadata,
  ExternalSession,
  UnifiedConversationHistoryItem,
  ContinueSessionOptions,
  ContinueSessionResult,
} from './types'

class ExternalSessionService {
  private providers: Map<ExternalSessionSource, ExternalSessionProvider> = new Map()
  
  constructor() {
    // Register providers
    const augmentProvider = new AugmentSessionProvider()
    const claudeCodeProvider = new ClaudeCodeSessionProvider()
    
    this.providers.set('augment', augmentProvider)
    this.providers.set('claude-code', claudeCodeProvider)
  }
  
  /**
   * Get all available providers
   */
  async getAvailableProviders(): Promise<ExternalSessionProvider[]> {
    const available: ExternalSessionProvider[] = []
    
    for (const provider of this.providers.values()) {
      if (await provider.isAvailable()) {
        available.push(provider)
      }
    }
    
    return available
  }
  
  /**
   * Get external session metadata from all available providers
   */
  async getExternalSessionMetadata(limit: number = 100): Promise<ExternalSessionMetadata[]> {
    const providers = await this.getAvailableProviders()
    
    // Fetch from all providers in parallel
    const results = await Promise.all(
      providers.map(async (provider) => {
        try {
          return await provider.getSessionMetadata(limit)
        } catch (error) {
          logApp(`[ExternalSessionService] Failed to get metadata from ${provider.displayName}: ${error}`)
          return []
        }
      })
    )
    
    // Flatten and sort by updatedAt
    const allSessions = results.flat()
    return allSessions.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
  }
  
  /**
   * Get unified conversation history including external sessions
   * Merges native SpeakMCP conversations with external sessions
   */
  async getUnifiedConversationHistory(
    nativeConversations: Array<{
      id: string
      title: string
      createdAt: number
      updatedAt: number
      messageCount: number
      lastMessage: string
      preview: string
    }>,
    limit: number = 100
  ): Promise<UnifiedConversationHistoryItem[]> {
    // Get external sessions
    const externalSessions = await this.getExternalSessionMetadata(limit)
    
    // Convert native conversations to unified format
    const unifiedNative: UnifiedConversationHistoryItem[] = nativeConversations.map(conv => ({
      ...conv,
      source: 'speakmcp' as const,
    }))
    
    // Convert external sessions to unified format
    const unifiedExternal: UnifiedConversationHistoryItem[] = externalSessions.map(session => ({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: session.messageCount || 0,
      lastMessage: session.preview || '',
      preview: session.preview || '',
      source: session.source,
      workspacePath: session.workspacePath,
      filePath: session.filePath,
    }))
    
    // Merge and sort by updatedAt
    const unified = [...unifiedNative, ...unifiedExternal]
    return unified.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit)
  }
  
  /**
   * Load full session data
   */
  async loadSession(sessionId: string, source: ExternalSessionSource): Promise<ExternalSession | null> {
    const provider = this.providers.get(source)
    if (!provider) {
      logApp(`[ExternalSessionService] Unknown provider: ${source}`)
      return null
    }
    
    return provider.loadSession(sessionId)
  }
  
  /**
   * Continue an external session
   */
  async continueSession(
    sessionId: string,
    source: ExternalSessionSource,
    workspacePath?: string
  ): Promise<ContinueSessionResult> {
    const provider = this.providers.get(source)
    if (!provider) {
      return { success: false, error: `Unknown provider: ${source}` }
    }
    
    // Load session metadata first
    const sessions = await provider.getSessionMetadata(1000)
    const session = sessions.find(s => s.id === sessionId)
    
    if (!session) {
      return { success: false, error: `Session not found: ${sessionId}` }
    }
    
    return provider.continueSession({
      session,
      workspacePath,
    })
  }
}

// Export singleton instance
export const externalSessionService = new ExternalSessionService()

