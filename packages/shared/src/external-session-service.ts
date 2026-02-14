/**
 * External Session Service
 * 
 * Aggregates sessions from multiple external providers (Augment, Claude Code)
 * and provides unified access for session continuation.
 */

import { log } from './debug';
import { AugmentSessionProvider, augmentSessionProvider } from './augment-provider';
import { ClaudeCodeSessionProvider, claudeCodeSessionProvider } from './claude-code-provider';
import type {
  ExternalSessionProvider,
  ExternalSessionSource,
  ExternalSessionMetadata,
  ExternalSession,
  ContinueSessionOptions,
  ContinueSessionResult,
} from './external-session-types';
import type { MessageSource } from './types';

export type { ExternalSessionMetadata } from './external-session-types';

export interface ExternalSessionProviderInfo {
  source: ExternalSessionSource;
  displayName: string;
  available: boolean;
}

class ExternalSessionService {
  private providers: Map<ExternalSessionSource, ExternalSessionProvider> = new Map();
  
  constructor() {
    // Register providers
    this.providers.set('augment', augmentSessionProvider);
    this.providers.set('claude-code', claudeCodeSessionProvider);
  }
  
  /**
   * Get all available providers
   */
  async getAvailableProviders(): Promise<ExternalSessionProvider[]> {
    const available: ExternalSessionProvider[] = [];
    
    for (const provider of this.providers.values()) {
      if (await provider.isAvailable()) {
        available.push(provider);
      }
    }
    
    return available;
  }
  
  /**
   * Get information about available external session providers
   */
  async getProviderInfo(): Promise<ExternalSessionProviderInfo[]> {
    const providers = await this.getAvailableProviders();
    
    return providers.map(p => ({
      source: p.source,
      displayName: p.displayName,
      available: true,
    }));
  }
  
  /**
   * Get external session metadata from all available providers
   */
  async getSessionMetadata(limit: number = 100): Promise<ExternalSessionMetadata[]> {
    const providers = await this.getAvailableProviders();
    
    // Fetch from all providers in parallel
    const results = await Promise.all(
      providers.map(async (provider) => {
        try {
          return await provider.getSessionMetadata(limit);
        } catch (error) {
          log(`[ExternalSessionService] Failed to get metadata from ${provider.displayName}: ${error}`);
          return [];
        }
      })
    );
    
    // Flatten and sort by updatedAt
    const allSessions = results.flat();
    return allSessions.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
  }
  
  /**
   * Get sessions grouped by source
   */
  async getSessionsBySource(): Promise<Record<ExternalSessionSource, ExternalSessionMetadata[]>> {
    const sessions = await this.getSessionMetadata(1000);
    
    const grouped: Record<ExternalSessionSource, ExternalSessionMetadata[]> = {
      'augment': [],
      'claude-code': [],
      'native': [],
    };
    
    for (const session of sessions) {
      grouped[session.source].push(session);
    }
    
    return grouped;
  }
  
  /**
   * Load full session data
   */
  async loadSession(sessionId: string, source: ExternalSessionSource): Promise<ExternalSession | null> {
    const provider = this.providers.get(source);
    if (!provider) {
      log(`[ExternalSessionService] Unknown provider: ${source}`);
      return null;
    }
    
    return provider.loadSession(sessionId);
  }
  
  /**
   * Continue an external session
   */
  async continueSession(
    sessionId: string,
    source: ExternalSessionSource,
    workspacePath?: string
  ): Promise<ContinueSessionResult> {
    const provider = this.providers.get(source);
    if (!provider) {
      return { success: false, error: `Unknown provider: ${source}` };
    }
    
    // Load session metadata first
    const sessions = await provider.getSessionMetadata(1000);
    const session = sessions.find(s => s.id === sessionId);
    
    if (!session) {
      return { success: false, error: `Session not found: ${sessionId}` };
    }
    
    return provider.continueSession({
      session,
      workspacePath,
    });
  }
}

// Export singleton instance
export const externalSessionService = new ExternalSessionService();

// Backward compatibility functions for existing code
export async function isAugmentAvailable(): Promise<boolean> {
  return augmentSessionProvider.isAvailable();
}

export async function listAugmentSessions(limit: number = 100): Promise<ExternalSessionMetadata[]> {
  return augmentSessionProvider.getSessionMetadata(limit);
}

export async function loadAugmentSession(sessionId: string): Promise<ExternalSession | null> {
  return augmentSessionProvider.loadSession(sessionId);
}

export async function isClaudeCodeAvailable(): Promise<boolean> {
  return claudeCodeSessionProvider.isAvailable();
}

export async function listClaudeCodeSessions(limit: number = 100): Promise<ExternalSessionMetadata[]> {
  return claudeCodeSessionProvider.getSessionMetadata(limit);
}

export async function loadClaudeCodeSession(sessionId: string): Promise<ExternalSession | null> {
  return claudeCodeSessionProvider.loadSession(sessionId);
}

/**
 * Get the appropriate provider for a source
 */
export function getProviderForSource(source: MessageSource): ExternalSessionProvider | null {
  const sourceMap: Record<MessageSource, ExternalSessionSource> = {
    'augment': 'augment',
    'claude-code': 'claude-code',
    'native': 'native',
    'mobile': 'native',
    'api': 'native',
  };
  
  const externalSource = sourceMap[source];
  if (!externalSource || externalSource === 'native') {
    return null;
  }
  
  const provider = externalSessionService.providers.get(externalSource);
  return provider || null;
}
