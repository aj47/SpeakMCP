const sessionSpokenContent = new Map<string, string>()

export function setSessionSpokenContent(sessionId: string, text: string): void {
  sessionSpokenContent.set(sessionId, text)
}

export function getSessionSpokenContent(sessionId: string): string | undefined {
  return sessionSpokenContent.get(sessionId)
}

export function clearSessionSpokenContent(sessionId: string): void {
  sessionSpokenContent.delete(sessionId)
}
