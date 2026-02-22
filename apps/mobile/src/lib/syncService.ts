/**
 * Conversation Sync Service
 * Handles syncing chat sessions between mobile and desktop.
 */

import { Session, ChatMessage } from '../types/session';
import {
  SettingsApiClient,
  ServerConversation,
  ServerConversationFull,
  ServerConversationMessage
} from './settingsApi';

export interface SyncResult {
  pulled: number;  // Number of conversations pulled from server
  pushed: number;  // Number of conversations pushed to server
  updated: number; // Number of conversations updated
  errors: string[];
}

export interface SyncableSession extends Session {
  // Session already has serverConversationId optional field
}

const VALID_ROLES = ['user', 'assistant', 'tool'] as const;

/**
 * Convert a mobile ChatMessage to server message format
 */
function toServerMessage(msg: ChatMessage): ServerConversationMessage {
  // Normalize role to valid values - default to 'user' for legacy/invalid data
  const role: 'user' | 'assistant' | 'tool' = VALID_ROLES.includes(msg.role as any)
    ? (msg.role as 'user' | 'assistant' | 'tool')
    : 'user';

  return {
    role,
    content: msg.content,
    timestamp: msg.timestamp,
    toolCalls: msg.toolCalls,
    toolResults: msg.toolResults,
  };
}

/**
 * Convert a server message to mobile ChatMessage format
 */
function fromServerMessage(msg: ServerConversationMessage, index: number): ChatMessage {
  // Use nullish coalescing (??) so that timestamp=0 is not treated as "missing"
  const ts = msg.timestamp ?? Date.now();
  // Convert server image format to mobile ImageAttachment format
  const images = msg.images?.map(img => ({
    uri: `data:${img.mimeType};base64,${img.base64}`,
    base64: img.base64,
    mimeType: img.mimeType,
  }));
  return {
    id: `msg_${ts}_${index}_${Math.random().toString(36).substr(2, 9)}`,
    role: msg.role,
    content: msg.content,
    timestamp: ts,
    toolCalls: msg.toolCalls as any,
    toolResults: msg.toolResults as any,
    images: images && images.length > 0 ? images : undefined,
  };
}

/**
 * Convert a full server conversation to a mobile Session (with messages)
 */
function serverConversationToSession(conv: ServerConversationFull): Session {
  return {
    id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    title: conv.title,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    messages: conv.messages.map(fromServerMessage),
    serverConversationId: conv.id,
    metadata: conv.metadata as Session['metadata'],
  };
}

/**
 * Convert a server conversation list item to a lazy stub Session (no messages, just metadata)
 */
function serverConversationToStubSession(item: ServerConversation): Session {
  return {
    id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    title: item.title,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    messages: [],
    serverConversationId: item.id,
    serverMetadata: {
      messageCount: item.messageCount,
      lastMessage: (item.lastMessage || '').substring(0, 100),
      preview: (item.preview || '').substring(0, 200),
    },
  };
}

/**
 * Sync conversations between mobile and server.
 *
 * Strategy:
 * 1. Fetch list of all server conversations
 * 2. For each local session:
 *    - If it has a serverConversationId: compare updatedAt, sync if needed
 *    - If no serverConversationId and has messages: push to server
 * 3. For each server conversation not in local sessions: pull and create local session
 *
 * @param client - The settings API client with valid credentials
 * @param localSessions - Current local sessions
 * @returns SyncResult with pulled/pushed counts and updated sessions
 */
export async function syncConversations(
  client: SettingsApiClient,
  localSessions: Session[]
): Promise<{ result: SyncResult; sessions: Session[] }> {
  const result: SyncResult = {
    pulled: 0,
    pushed: 0,
    updated: 0,
    errors: [],
  };

  const updatedSessions: Session[] = [...localSessions];

  try {
    // Step 1: Fetch server conversation list
    const { conversations: serverList } = await client.getConversations();

    // Create a map of serverConversationId -> local session
    const localByServerId = new Map<string, { session: Session; index: number }>();
    localSessions.forEach((session, index) => {
      if (session.serverConversationId) {
        localByServerId.set(session.serverConversationId, { session, index });
      }
    });

    // Step 2: Process local sessions
    for (let i = 0; i < updatedSessions.length; i++) {
      const session = updatedSessions[i];

      if (session.serverConversationId) {
        // Session is linked to server - check if we need to sync
        const serverItem = serverList.find(c => c.id === session.serverConversationId);

        if (serverItem) {
          // Both exist - compare timestamps to see who's newer
          if (serverItem.updatedAt > session.updatedAt) {
            // Server is newer - pull full conversation
            try {
              const fullConv = await client.getConversation(session.serverConversationId);
              updatedSessions[i] = {
                ...session,
                title: fullConv.title,
                updatedAt: fullConv.updatedAt,
                messages: fullConv.messages.map(fromServerMessage),
              };
              result.updated++;
            } catch (err: any) {
              result.errors.push(`Failed to pull ${session.serverConversationId}: ${err.message}`);
            }
          } else if (session.updatedAt > serverItem.updatedAt && session.messages.length > 0) {
            // Local is newer - push to server
            try {
              const updated = await client.updateConversation(session.serverConversationId, {
                title: session.title,
                messages: session.messages.map(toServerMessage),
                updatedAt: session.updatedAt,
              });
              // Update local session with server-returned updatedAt to prevent sync oscillation
              updatedSessions[i] = {
                ...session,
                updatedAt: updated.updatedAt,
              };
              result.updated++;
            } catch (err: any) {
              result.errors.push(`Failed to push ${session.serverConversationId}: ${err.message}`);
            }
          }
          // If timestamps are equal, no action needed
        }
        // If server item not found, the conversation may have been deleted on server
        // We could handle this by either deleting locally or re-pushing
        // For now, we leave it as is
      } else if (session.messages.length > 0) {
        // Local-only session with messages - push to server
        try {
          const created = await client.createConversation({
            title: session.title,
            messages: session.messages.map(toServerMessage),
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
          });

          // Update local session with server ID and updatedAt
          updatedSessions[i] = {
            ...session,
            serverConversationId: created.id,
            updatedAt: created.updatedAt,
          };
          result.pushed++;
        } catch (err: any) {
          result.errors.push(`Failed to create on server: ${err.message}`);
        }
      }
      // Empty sessions without serverConversationId are ignored
    }

    // Step 3: Pull new server conversations not in local (lazy - stubs only)
    const newSessions: Session[] = [];
    for (const serverItem of serverList) {
      if (!localByServerId.has(serverItem.id)) {
        // Server conversation not in local - create a lazy stub (no message fetch)
        const stubSession = serverConversationToStubSession(serverItem);
        newSessions.push(stubSession);
        result.pulled++;
      }
    }
    // Add all new sessions to the beginning, preserving server order
    updatedSessions.unshift(...newSessions);

  } catch (err: any) {
    result.errors.push(`Sync failed: ${err.message}`);
  }

  return { result, sessions: updatedSessions };
}



/**
 * Fetch full conversation messages from server for a lazy-loaded session.
 * Used when user opens a stub session that only has metadata.
 *
 * @param client - The settings API client
 * @param serverConversationId - The server-side conversation ID
 * @returns The messages and updated metadata, or null on failure
 */
export async function fetchFullConversation(
  client: SettingsApiClient,
  serverConversationId: string
): Promise<{ messages: ChatMessage[]; title: string; updatedAt: number } | null> {
  try {
    const fullConv = await client.getConversation(serverConversationId);
    return {
      messages: fullConv.messages.map(fromServerMessage),
      title: fullConv.title,
      updatedAt: fullConv.updatedAt,
    };
  } catch (err: any) {
    console.error(`[syncService] Failed to fetch conversation ${serverConversationId}:`, err.message);
    return null;
  }
}