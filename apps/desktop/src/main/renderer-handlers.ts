import { UpdateDownloadedEvent } from "electron-updater"
import { AgentProgressUpdate } from "../shared/types"
import type { AgentSession } from "./agent-session-tracker"

export type RendererHandlers = {
  startRecording: () => void
  finishRecording: () => void
  stopRecording: () => void
  startOrFinishRecording: () => void
  refreshRecordingHistory: () => void

  // MCP Tool Calling handlers
  startMcpRecording: (data?: { conversationId?: string; sessionId?: string; fromTile?: boolean }) => void
  finishMcpRecording: () => void
  startOrFinishMcpRecording: (data?: { conversationId?: string; sessionId?: string; fromTile?: boolean }) => void

  // Text Input handlers
  showTextInput: () => void
  hideTextInput: () => void

  // Agent Mode Progress handlers
  agentProgressUpdate: (update: AgentProgressUpdate) => void
  clearAgentProgress: () => void
  emergencyStopAgent: () => void
  clearAgentSessionProgress: (sessionId: string) => void

  // Agent Session tracking - push-based updates instead of polling
  agentSessionsUpdated: (data: { activeSessions: AgentSession[], recentSessions: AgentSession[] }) => void

  // Cross-window focus control for agent sessions
  focusAgentSession: (sessionId: string) => void

  updateAvailable: (e: UpdateDownloadedEvent) => void
  navigate: (url: string) => void
}
