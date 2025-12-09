import { UpdateDownloadedEvent } from "electron-updater"
import { AgentProgressUpdate } from "../shared/types"
import type { AgentSession } from "./agent-session-tracker"

export type RendererHandlers = {
  startRecording: (data?: { fromButtonClick?: boolean }) => void
  finishRecording: () => void
  stopRecording: () => void
  startOrFinishRecording: (data?: { fromButtonClick?: boolean }) => void
  refreshRecordingHistory: () => void

  startMcpRecording: (data?: { conversationId?: string; sessionId?: string; fromTile?: boolean; fromButtonClick?: boolean }) => void
  finishMcpRecording: () => void
  startOrFinishMcpRecording: (data?: { conversationId?: string; sessionId?: string; fromTile?: boolean; fromButtonClick?: boolean }) => void

  showTextInput: () => void
  hideTextInput: () => void

  agentProgressUpdate: (update: AgentProgressUpdate) => void
  clearAgentProgress: () => void
  emergencyStopAgent: () => void
  clearAgentSessionProgress: (sessionId: string) => void
  clearInactiveSessions: () => void

  agentSessionsUpdated: (data: { activeSessions: AgentSession[], recentSessions: AgentSession[] }) => void

  focusAgentSession: (sessionId: string) => void

  updateAvailable: (e: UpdateDownloadedEvent) => void
  navigate: (url: string) => void
}
