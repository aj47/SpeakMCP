/**
 * External Session Service
 *
 * Aggregates sessions from multiple external providers (Augment, Claude Code)
 * and provides unified access for session continuation.
 */

import type { MessageSource } from './types';
import type { SessionData } from './session-store';
import {
  isAugmentAvailable,
  listAugmentSessions,
  loadAugmentSession,
} from './augment-provider';
import {
  isClaudeCodeAvailable,
  listClaudeCodeSessions,
  loadClaudeCodeSession,
} from './claude-code-provider';

export interface ExternalSessionMetadata {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  source: MessageSource;
  workspacePath?: string;
  messageCount: number;
  preview: string;
  filePath: string;
}

export interface ExternalSessionProviderInfo {
  source: MessageSource;
  displayName: string;
  available: boolean;
}

/**
 * Get information about available external session providers
 */
export async function getExternalProviders(): Promise<ExternalSessionProviderInfo[]> {
  const [augmentAvailable, claudeCodeAvailable] = await Promise.all([
    isAugmentAvailable(),
    isClaudeCodeAvailable(),
  ]);

  return [
    {
      source: 'augment',
      displayName: 'Augment',
      available: augmentAvailable,
    },
    {
      source: 'claude-code',
      displayName: 'Claude Code',
      available: claudeCodeAvailable,
    },
  ];
}

/**
 * List external sessions from all available providers
 */
export async function listExternalSessions(
  limit: number = 100
): Promise<ExternalSessionMetadata[]> {
  const [augmentSessions, claudeCodeSessions] = await Promise.all([
    listAugmentSessions(limit),
    listClaudeCodeSessions(limit),
  ]);

  // Merge and sort by updatedAt
  const allSessions: ExternalSessionMetadata[] = [
    ...augmentSessions,
    ...claudeCodeSessions,
  ];

  return allSessions.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}

/**
 * Load full external session data
 */
export async function loadExternalSession(
  sessionId: string,
  source: MessageSource
): Promise<(SessionData & { source: MessageSource }) | null> {
  switch (source) {
    case 'augment':
      return loadAugmentSession(sessionId);
    case 'claude-code':
      // For Claude Code, we need the file path - for now, return null
      // In a full implementation, we'd cache the file paths
      console.warn('[ExternalSessionService] Claude Code session loading requires file path');
      return null;
    default:
      console.warn(`[ExternalSessionService] Unknown source: ${source}`);
      return null;
  }
}

/**
 * Get sessions grouped by source
 */
export async function getSessionsBySource(): Promise<Record<MessageSource, ExternalSessionMetadata[]>> {
  const [augmentSessions, claudeCodeSessions] = await Promise.all([
    listAugmentSessions(1000),
    listClaudeCodeSessions(1000),
  ]);

  return {
    augment: augmentSessions,
    'claude-code': claudeCodeSessions,
    native: [],
    mobile: [],
    api: [],
  };
}
