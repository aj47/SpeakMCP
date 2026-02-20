/**
 * Session User Response Store
 *
 * Stores the user-facing response for each agent session.
 * This is set by the respond_to_user tool and retrieved at session completion
 * to deliver to the user via TTS (voice), messaging (mobile/WhatsApp), etc.
 */
const sessionUserResponse = new Map<string, string>()

export function setSessionUserResponse(sessionId: string, text: string): void {
  sessionUserResponse.set(sessionId, text)
}

export function getSessionUserResponse(sessionId: string): string | undefined {
  return sessionUserResponse.get(sessionId)
}

export function clearSessionUserResponse(sessionId: string): void {
  sessionUserResponse.delete(sessionId)
}

