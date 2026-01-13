/**
 * Conversation Sync Service
 * Handles syncing chat sessions between mobile and desktop.
 */

import { Session, ChatMessage } from '../types/session';
import {
  SettingsApiClient,
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

/**
 * Convert a mobile ChatMessage to server message format
 */
function toServerMessage(msg: ChatMessage): ServerConversationMessage {
  return {
    role: msg.role as 'user' | 'assistant' | 'tool',
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
  return {
    id: `msg_${msg.timestamp || Date.now()}_${index}_${Math.random().toString(36).substr(2, 9)}`,
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp || Date.now(),
    toolCalls: msg.toolCalls as any,
    toolResults: msg.toolResults as any,
  };
}

/**
 * Convert a server conversation to a mobile Session
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
              await client.updateConversation(session.serverConversationId, {
                title: session.title,
                messages: session.messages.map(toServerMessage),
                updatedAt: session.updatedAt,
              });
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
          
          // Update local session with server ID
          updatedSessions[i] = {
            ...session,
            serverConversationId: created.id,
          };
          result.pushed++;
        } catch (err: any) {
          result.errors.push(`Failed to create on server: ${err.message}`);
        }
      }
      // Empty sessions without serverConversationId are ignored
    }

    // Step 3: Pull new server conversations not in local
    for (const serverItem of serverList) {
      if (!localByServerId.has(serverItem.id)) {
        // Server conversation not in local - pull it
        try {
          const fullConv = await client.getConversation(serverItem.id);
          const newSession = serverConversationToSession(fullConv);
          updatedSessions.unshift(newSession); // Add to beginning (most recent)
          result.pulled++;
        } catch (err: any) {
          result.errors.push(`Failed to pull new ${serverItem.id}: ${err.message}`);
        }
      }
    }

  } catch (err: any) {
    result.errors.push(`Sync failed: ${err.message}`);
  }

  return { result, sessions: updatedSessions };
}

