/**
 * External Sessions Module
 * 
 * Provides unified access to sessions from external AI coding agents
 * (Augment, Claude Code) alongside native SpeakMCP sessions.
 */

export * from './types'
export { AugmentSessionProvider } from './augment-provider'
export { ClaudeCodeSessionProvider } from './claude-code-provider'
export { externalSessionService } from './external-session-service'

