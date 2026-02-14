/**
 * Chat History Merger for SpeakMCP
 * Merges conversation histories from multiple sources into a unified timeline
 */

import type { MessageSource } from './types';
import type { SessionMessage } from './session-store';
import { isExternal } from './sources';

/**
 * Merged message with conflict resolution metadata
 */
export interface MergedMessage {
  /** Original message from source */
  original: SessionMessage;
  /** Source this message came from */
  source: MessageSource;
  /** Normalized content */
  content: string;
  /** Deduplication key (content hash) */
  deduplicationKey: string;
  /** Order in merged timeline */
  order: number;
  /** Conflicting messages merged into this one */
  conflicts?: SessionMessage[];
}

/**
 * Merge options
 */
export interface MergeOptions {
  /** Deduplicate identical messages */
  deduplicate?: boolean;
  /** Conflict resolution strategy */
  conflictResolution?: 'newest' | 'oldest' | 'prefer-native' | 'merge-all';
  /** Maximum messages to keep */
  maxMessages?: number;
  /** Whether to include internal messages (thinking, tool calls) */
  includeInternal?: boolean;
}

/**
 * Result of merging histories
 */
export interface MergeResult {
  /** Merged messages in chronological order */
  messages: MergedMessage[];
  /** Statistics about the merge */
  stats: {
    total: number;
    merged: number;
    deduplicated: number;
    discarded: number;
  };
  /** Sources included in the merge */
  sources: MessageSource[];
}

/**
 * Merge multiple conversation histories into a unified timeline
 */
export function mergeConversationHistories(
  histories: Array<{
    source: MessageSource;
    messages: SessionMessage[];
  }>,
  options: MergeOptions = {}
): MergeResult {
  const {
    deduplicate = true,
    conflictResolution = 'prefer-native',
    maxMessages,
    includeInternal = false,
  } = options;

  // Collect all messages with source
  let allMessages: MergedMessage[] = [];
  
  for (const history of histories) {
    for (const msg of history.messages) {
      // Filter internal messages if needed
      if (!includeInternal && (msg.role === 'tool' || isInternalContent(msg.content))) {
        continue;
      }

      const normalized = normalizeMessageContent(msg.content);
      const deduplicationKey = deduplicate 
        ? generateDeduplicationKey(msg.role, normalized)
        : `${Date.now()}-${Math.random()}`;

      allMessages.push({
        original: msg,
        source: history.source,
        content: normalized,
        deduplicationKey,
        order: msg.timestamp ?? Date.now(),
      });
    }
  }

  // Sort by timestamp
  allMessages.sort((a, b) => a.order - b.order);

  // Assign final order
  allMessages = allMessages.map((msg, index) => ({ ...msg, order: index }));

  const stats = {
    total: allMessages.length,
    merged: 0,
    deduplicated: 0,
    discarded: 0,
  };

  // Deduplicate
  if (deduplicate) {
    const seen = new Set<string>();
    const deduped: MergedMessage[] = [];

    for (const msg of allMessages) {
      if (seen.has(msg.deduplicationKey)) {
        stats.deduplicated++;
        continue;
      }
      seen.add(msg.deduplicationKey);
      deduped.push(msg);
    }

    allMessages = deduped;
  }

  // Resolve conflicts (concurrent messages at same timestamp)
  allMessages = resolveConflicts(allMessages, conflictResolution);
  stats.merged = allMessages.filter(m => m.conflicts && m.conflicts.length > 0).length;

  // Apply max messages limit
  if (maxMessages && allMessages.length > maxMessages) {
    stats.discarded = allMessages.length - maxMessages;
    allMessages = allMessages.slice(-maxMessages);
  }

  // Extract unique sources
  const sources = Array.from(new Set(histories.map(h => h.source)));

  return {
    messages: allMessages,
    stats,
    sources,
  };
}

/**
 * Resolve conflicts between messages at the same timestamp
 */
function resolveConflicts(
  messages: MergedMessage[],
  strategy: MergeOptions['conflictResolution']
): MergedMessage[] {
  const grouped = groupByTimestamp(messages);
  const result: MergedMessage[] = [];

  for (const group of grouped) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }

    // Multiple messages at same timestamp - resolve conflict
    const winner = resolveConflictGroup(group, strategy);
    
    // Collect conflicts (non-winning messages)
    const conflicts = group.filter(m => m !== winner);
    if (conflicts.length > 0) {
      winner.conflicts = conflicts.map(m => m.original);
    }

    result.push(winner);
  }

  return result;
}

/**
 * Group messages by approximate timestamp (within 1 second)
 */
function groupByTimestamp(messages: MergedMessage[]): MergedMessage[][] {
  const groups: Map<number, MergedMessage[]> = new Map();

  for (const msg of messages) {
    // Round to nearest second
    const key = Math.floor(msg.order / 1000) * 1000;
    const group = groups.get(key) ?? [];
    group.push(msg);
    groups.set(key, group);
  }

  return Array.from(groups.values());
}

/**
 * Resolve a group of conflicting messages
 */
function resolveConflictGroup(
  group: MergedMessage[],
  strategy: 'newest' | 'oldest' | 'prefer-native' | 'merge-all'
): MergedMessage {
  switch (strategy) {
    case 'newest':
      return group.reduce((a, b) => (a.order > b.order ? a : b));
    case 'oldest':
      return group.reduce((a, b) => (a.order < b.order ? a : b));
    case 'prefer-native':
      return group.find(m => m.source === 'native') ?? group[0];
    case 'merge-all':
      // For merge-all, we pick the first and attach others as conflicts
      return group[0];
    default:
      return group[0];
  }
}

/**
 * Normalize message content for comparison
 */
function normalizeMessageContent(content: string): string {
  return content
    .replace(/\s+/g, ' ')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/\n?\[/g, '[')
    .trim();
}

/**
 * Generate a deduplication key for a message
 */
function generateDeduplicationKey(role: string, content: string): string {
  return `${role}:${content}`;
}

/**
 * Check if content is internal (thinking, tool calls, etc.)
 */
function isInternalContent(content: string): boolean {
  return (
    content.includes('<thinking>') ||
    content.includes('[TOOL_CALL]') ||
    content.includes('[TOOL_RESULT]')
  );
}

/**
 * Convert merged messages back to session messages
 */
export function mergedToSessionMessages(
  merged: MergedMessage[],
  options: { includeConflicts?: boolean } = {}
): SessionMessage[] {
  return merged.map(m => {
    const msg = { ...m.original };
    
    if (!options.includeConflicts && m.conflicts) {
      // Mark as merged in metadata
      (msg as Record<string, unknown>).metadata = {
        ...((msg as Record<string, unknown>).metadata as Record<string, unknown>),
        merged: true,
        sources: [m.source, ...m.conflicts.map(c => (c as SessionMessage).source)],
      };
    }
    
    return msg;
  });
}
