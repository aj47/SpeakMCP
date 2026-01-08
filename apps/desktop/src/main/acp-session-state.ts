/**
 * ACP Session State Manager
 *
 * Manages mapping between SpeakMCP conversations and ACP sessions.
 * This allows maintaining context across multiple prompts in the same conversation
 * when using an ACP agent as the main agent.
 */

import { logApp } from "./debug"

/**
 * Information about an active ACP session
 */
export interface ACPSessionInfo {
  /** The ACP session ID */
  sessionId: string
  /** Name of the ACP agent */
  agentName: string
  /** Timestamp when the session was created */
  createdAt: number
  /** Timestamp when the session was last used */
  lastUsedAt: number
}

// In-memory storage for conversation-to-session mapping
const conversationSessions: Map<string, ACPSessionInfo> = new Map()

// Mapping from ACP session ID → SpeakMCP session ID
// This is needed for routing tool approval requests to the correct UI session
const acpToSpeakMcpSession: Map<string, string> = new Map()

/**
 * Get the ACP session for a conversation (if any).
 * @param conversationId The SpeakMCP conversation ID
 * @returns Session info if exists, undefined otherwise
 */
export function getSessionForConversation(conversationId: string): ACPSessionInfo | undefined {
  return conversationSessions.get(conversationId)
}

/**
 * Set/update the ACP session for a conversation.
 * @param conversationId The SpeakMCP conversation ID
 * @param sessionId The ACP session ID
 * @param agentName The name of the ACP agent
 */
export function setSessionForConversation(
  conversationId: string,
  sessionId: string,
  agentName: string
): void {
  const now = Date.now()
  const existing = conversationSessions.get(conversationId)

  if (existing) {
    // Update existing session info
    existing.sessionId = sessionId
    existing.agentName = agentName
    existing.lastUsedAt = now
    logApp(`[ACP Session] Updated session for conversation ${conversationId}: ${sessionId}`)
  } else {
    // Create new session info
    conversationSessions.set(conversationId, {
      sessionId,
      agentName,
      createdAt: now,
      lastUsedAt: now,
    })
    logApp(`[ACP Session] Created session mapping for conversation ${conversationId}: ${sessionId}`)
  }
}

/**
 * Clear the session for a conversation.
 * Use when user explicitly requests a new session or when conversation is deleted.
 * @param conversationId The SpeakMCP conversation ID
 */
export function clearSessionForConversation(conversationId: string): void {
  if (conversationSessions.has(conversationId)) {
    conversationSessions.delete(conversationId)
    logApp(`[ACP Session] Cleared session for conversation ${conversationId}`)
  }
}

/**
 * Clear all sessions.
 * Use on app shutdown or when ACP agent is restarted.
 */
export function clearAllSessions(): void {
  const count = conversationSessions.size
  conversationSessions.clear()
  logApp(`[ACP Session] Cleared all ${count} sessions`)
}

/**
 * Get all active sessions.
 * Useful for debugging and UI display.
 * @returns Map of conversation ID to session info
 */
export function getAllSessions(): Map<string, ACPSessionInfo> {
  return new Map(conversationSessions)
}

/**
 * Update the last used timestamp for a session.
 * @param conversationId The SpeakMCP conversation ID
 */
export function touchSession(conversationId: string): void {
  const session = conversationSessions.get(conversationId)
  if (session) {
    session.lastUsedAt = Date.now()
  }
}

/**
 * Map an ACP session ID to a SpeakMCP session ID.
 * This is needed for routing tool approval requests to the correct UI session.
 * @param acpSessionId The ACP agent's session ID
 * @param speakMcpSessionId The SpeakMCP internal session ID (for UI progress tracking)
 */
export function setAcpToSpeakMcpSessionMapping(
  acpSessionId: string,
  speakMcpSessionId: string
): void {
  acpToSpeakMcpSession.set(acpSessionId, speakMcpSessionId)
  logApp(`[ACP Session] Mapped ACP session ${acpSessionId} → SpeakMCP session ${speakMcpSessionId}`)
}

/**
 * Get the SpeakMCP session ID for a given ACP session ID.
 * @param acpSessionId The ACP agent's session ID
 * @returns The SpeakMCP session ID, or undefined if not mapped
 */
export function getSpeakMcpSessionForAcpSession(acpSessionId: string): string | undefined {
  return acpToSpeakMcpSession.get(acpSessionId)
}

/**
 * Clear the ACP → SpeakMCP session mapping.
 * @param acpSessionId The ACP session ID to remove
 */
export function clearAcpToSpeakMcpSessionMapping(acpSessionId: string): void {
  if (acpToSpeakMcpSession.has(acpSessionId)) {
    acpToSpeakMcpSession.delete(acpSessionId)
    logApp(`[ACP Session] Cleared ACP → SpeakMCP mapping for ${acpSessionId}`)
  }
}

