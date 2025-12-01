import { UpdateDownloadedEvent } from "electron-updater"
import { AgentProgressUpdate } from "../shared/types"
import type { AgentSession } from "./agent-session-tracker"

export type RendererHandlers = {
  startRecording: () => void
  finishRecording: () => void
  stopRecording: () => void
  startOrFinishRecording: () => void
  refreshRecordingHistory: () => void

  // Desktop + mic long recording handlers
  startDesktopRecording: () => void
  stopDesktopRecording: () => void

  // MCP Tool Calling handlers
  startMcpRecording: () => void
  finishMcpRecording: () => void
  startOrFinishMcpRecording: () => void

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
